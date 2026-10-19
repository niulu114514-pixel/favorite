// EdgeOne Pages Favicon 统一缓存与代理接口
// 支持在 EdgeOne Pages Blob 存储上使用二进制缓存

import {
  clientAddress,
  getCorsHeaders,
  getKV,
  jsonResponse,
  normalizeDomain,
  parsePublicHttpsUrl,
  sanitizeBlobKey,
} from './_kvAdapter.js'

const UPSTREAM_PROVIDERS = [
  // 目标网站自身的经典 favicon（首选，保证拿到该网址自己的图标）
  domain => `https://${encodeURIComponent(domain)}/favicon.ico`,
  // Google S2，覆盖面广、响应快
  domain => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
  // faviconextractor 最后兜底
  domain => `https://www.faviconextractor.com/favicon/${encodeURIComponent(domain)}?larger=true`,
]

const UPSTREAM_TIMEOUT_MS = 10_000
const MAX_FAVICON_BYTES = 512 * 1024
const PAGE_TIMEOUT_MS = 6000
const MAX_PAGE_BYTES = 512 * 1024

/**
 * 判断字节流是否真的是图片。
 * 上游常见两种坑：站点对任意路径都返回 200 + 首页 HTML，
 * 以及历史缓存里被写入过非图片内容。只看 Content-Type 拦不住这两种。
 */
export function looksLikeImage(buffer) {
  if (!buffer || buffer.byteLength < 4) return false
  const u = new Uint8Array(buffer)
  if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return true // PNG
  if (u[0] === 0xff && u[1] === 0xd8) return true // JPEG
  if (u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) return true // GIF
  if (u[0] === 0x00 && u[1] === 0x00 && u[2] === 0x01 && u[3] === 0x00) return true // ICO
  if (u[0] === 0x42 && u[1] === 0x4d) return true // BMP
  if (
    u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 &&
    u.byteLength >= 12 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50
  ) {
    return true // WEBP
  }
  // AVIF / HEIF: 4 字节长度 + 'ftyp' + brand
  if (
    u.byteLength >= 12 &&
    u[4] === 0x66 && u[5] === 0x74 && u[6] === 0x79 && u[7] === 0x70
  ) {
    const brand = String.fromCharCode(u[8], u[9], u[10], u[11])
    if (/^(avif|avis|heic|heix|mif1|msf1)$/.test(brand)) return true
  }
  try {
    const head = new TextDecoder('utf-8').decode(u.subarray(0, 200)).trim().toLowerCase()
    if (head.startsWith('<svg')) return true
    if (head.startsWith('<?xml') && head.includes('<svg')) return true
  } catch {
    // 落到 false
  }
  return false
}

// 抓取配额：该接口无需认证即可触发上游抓取并写入 Blob，
// 不设限就等同于对外开放一个可以无限灌入存储的写入通道。
const FETCH_LIMIT_PER_WINDOW = 20
const FETCH_WINDOW_SECONDS = 60

async function consumeFetchQuota(env, request) {
  let kv
  try {
    kv = getKV(env)
  } catch {
    return true // 没有 KV 时不阻断正常使用
  }
  const key = `favicon_rate:${clientAddress(request)}`
  try {
    const raw = await kv.get(key)
    const parsed = raw ? JSON.parse(raw) : null
    const active = parsed && Number(parsed.resetAt) > Date.now()
    const count = active ? Number(parsed.count) || 0 : 0
    if (count >= FETCH_LIMIT_PER_WINDOW) return false
    await kv.put(
      key,
      JSON.stringify({
        count: count + 1,
        resetAt: active ? parsed.resetAt : Date.now() + FETCH_WINDOW_SECONDS * 1000,
      }),
      { expirationTtl: FETCH_WINDOW_SECONDS }
    )
    return true
  } catch {
    return true
  }
}

async function fetchUpstreamIcon(url) {
  let safeUrl
  try {
    safeUrl = parsePublicHttpsUrl(url).toString()
  } catch {
    return null
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await fetch(safeUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'manual',
      signal: controller.signal,
    })
    if (!res.ok) return null
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > MAX_FAVICON_BYTES) return null
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_FAVICON_BYTES) return null
    // 站点对不存在的 /favicon.ico 返回 200 + 首页 HTML 的情况很常见，
    // 必须以字节头确认是图片，否则会把整页 HTML 当图标缓存下来。
    if (!looksLikeImage(buffer)) return null
    return buffer
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function absoluteUrl(base, src) {
  try {
    return new URL(src, base).href
  } catch {
    return null
  }
}

// 抓取目标网站首页 HTML，从 <link rel="icon"> / apple-touch-icon 中解析该网站自带的图标。
// 这比直接猜 /favicon.ico 更准确，能拿到高分辨率的网站专属图标。
async function scrapeSiteIcon(domain) {
  const base = `https://${domain}/`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
  try {
    const res = await fetch(base, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,*/*;q=0.5' },
      redirect: 'manual',
      signal: controller.signal,
    })
    if (!res.ok) return null
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > MAX_PAGE_BYTES) return null
    const text = await res.text().catch(() => '')
    if (!text || text.length > 1024 * 1024) return null

    // 优先 apple-touch-icon（通常分辨率更高），其次 icon / shortcut icon（SVG 优先）
    const candidates = []
    const linkRe = /<link\b[^>]*>/gi
    let m
    while ((m = linkRe.exec(text)) && candidates.length < 8) {
      const tag = m[0]
      const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(tag)
      if (!hrefMatch) continue
      const rel =
        (/(?:rel|data-icon)\s*=\s*["'][^"']*["']/i.exec(tag) || [''])[0]?.toLowerCase() || ''
      const isApple = rel.includes('apple-touch-icon')
      const isSvg = rel.includes('icon') && tag.toLowerCase().includes('.svg')
      const isIcon = rel.includes('icon')
      if (!isIcon && !isApple) continue
      const url = absoluteUrl(base, hrefMatch[1])
      if (url) candidates.push({ url, score: isApple ? 3 : isSvg ? 2 : 1 })
    }
    candidates.sort((a, b) => b.score - a.score)
    for (const { url } of candidates) {
      const buffer = await fetchUpstreamIcon(url)
      if (buffer) return buffer
    }
  } catch {
    // ignore, fall through to providers
  } finally {
    clearTimeout(timer)
  }
  return null
}

export function detectMimeType(arrayBuffer) {
  const uint8 = new Uint8Array(arrayBuffer)
  if (
    uint8.length >= 8 &&
    uint8[0] === 0x89 &&
    uint8[1] === 0x50 &&
    uint8[2] === 0x4e &&
    uint8[3] === 0x47
  ) {
    return 'image/png'
  }
  if (uint8.length >= 2 && uint8[0] === 0xff && uint8[1] === 0xd8) {
    return 'image/jpeg'
  }
  if (
    uint8.length >= 4 &&
    uint8[0] === 0x47 &&
    uint8[1] === 0x49 &&
    uint8[2] === 0x46 &&
    uint8[3] === 0x38
  ) {
    return 'image/gif'
  }
  if (
    uint8.length >= 4 &&
    uint8[0] === 0x00 &&
    uint8[1] === 0x00 &&
    uint8[2] === 0x01 &&
    uint8[3] === 0x00
  ) {
    return 'image/x-icon'
  }
  if (
    uint8.length >= 12 &&
    uint8[0] === 0x52 &&
    uint8[1] === 0x49 &&
    uint8[2] === 0x46 &&
    uint8[3] === 0x46 &&
    uint8[8] === 0x57 &&
    uint8[9] === 0x45 &&
    uint8[10] === 0x42 &&
    uint8[11] === 0x50
  ) {
    return 'image/webp'
  }
  // AVIF：不少新站点已改用这种格式，标错 MIME 会导致浏览器不渲染。
  if (uint8.length >= 12 && uint8[4] === 0x66 && uint8[5] === 0x74 && uint8[6] === 0x79 && uint8[7] === 0x70) {
    const brand = String.fromCharCode(uint8[8], uint8[9], uint8[10], uint8[11])
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand === 'heic' || brand === 'heix') return 'image/heic'
  }
  if (uint8.length >= 2 && uint8[0] === 0x42 && uint8[1] === 0x4d) {
    return 'image/bmp'
  }

  try {
    const decoder = new TextDecoder('utf-8')
    const prefix = decoder.decode(uint8.subarray(0, 150)).trim().toLowerCase()
    if (prefix.includes('<svg') || prefix.includes('<?xml')) {
      return 'image/svg+xml'
    }
  } catch {
    // Keep the conservative default below.
  }

  return 'image/x-icon'
}

function iconHeaders(mime, corsHeaders, cacheControl) {
  const isSvg = mime === 'image/svg+xml'
  return {
    'Content-Type': mime,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    // SVG 是唯一能在自身内部携带脚本的图片格式：直接打开这个地址时，
    // 同源脚本会执行。用 sandbox 禁用脚本，同时保持 inline 让 <img> 能渲染。
    // 位图则收紧到只允许自带样式。
    'Content-Security-Policy': isSvg
      ? "default-src 'none'; style-src 'unsafe-inline'; sandbox"
      : "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'",
    'Content-Disposition': 'inline',
    ...corsHeaders,
  }
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)
  const url = new URL(request.url)

  const referer = request.headers.get('referer')
  // 只有同源页面发起的请求才允许触发上游抓取并写缓存。
  // 脚本直接调用（不带 referer）只能读已有缓存，无法制造新的 Blob 写入。
  let canFetch = false
  if (referer) {
    try {
      const refererHost = new URL(referer).hostname
      const requestHost = url.hostname
      if (
        refererHost !== requestHost &&
        refererHost !== 'localhost' &&
        refererHost !== '127.0.0.1'
      ) {
        return new Response('Forbidden', { status: 403 })
      }
      canFetch = true
    } catch {
      return new Response('Forbidden', { status: 403 })
    }
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)
  }

  const key = sanitizeBlobKey(url.searchParams.get('key'))
  const domain = normalizeDomain(url.searchParams.get('domain'))

  if (!key && !domain) {
    return jsonResponse({ error: 'key or domain parameter required' }, 400, corsHeaders)
  }

  const storageKey = key || `favicon:${domain}`
  let store = null

  try {
    try {
      const blobSdk = await import('@edgeone/pages-blob')
      store = blobSdk.getStore('favicons')
    } catch (e) {
      console.warn('Failed to import @edgeone/pages-blob for read:', e)
    }

    if (store) {
      const cached = await store.get(storageKey, { type: 'arrayBuffer' })
      if (cached && looksLikeImage(cached)) {
        const mime = detectMimeType(cached)
        return new Response(cached, {
          status: 200,
          headers: iconHeaders(mime, corsHeaders, 'public, max-age=31536000, immutable'),
        })
      }
      if (cached) {
        // 历史遗留的非图片内容（早期写入漏洞或上游错误页），丢弃后重新抓取。
        console.warn('Discarding non-image favicon cache entry:', storageKey)
      }
    } else {
      console.warn('Blob store not available for read (getStore is undefined)')
    }
  } catch (err) {
    console.error('Storage read error:', err)
  }

  if (key) {
    return new Response('File Not Found', { status: 404, headers: corsHeaders })
  }

  // 未通过同源校验或超出抓取配额时，不发起上游请求、不写 Blob。
  if (!canFetch) {
    return Response.redirect(`${url.origin}/favicon.ico`, 302)
  }
  if (!(await consumeFetchQuota(env, request))) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { ...corsHeaders, 'Retry-After': String(FETCH_WINDOW_SECONDS) },
    })
  }

  let buffer = null
  // 第 1 步：从网站首页 HTML 中解析其自带的专属图标（最精准的“自身图标”）
  const scraped = await scrapeSiteIcon(domain)
  if (scraped) {
    buffer = scraped
  }
  // 第 2 步：多来源回退（站点 /favicon.ico → Google S2 → faviconextractor）
  if (!buffer) {
    for (const getUrl of UPSTREAM_PROVIDERS) {
      const candidate = await fetchUpstreamIcon(getUrl(domain))
      if (candidate) {
        buffer = candidate
        break
      }
    }
  }

  if (buffer) {
    let cacheEnabled = true
    try {
      const kv = getKV(env)
      const iconStr = await kv.get('config:icon')
      const legacyStr = iconStr ? null : await kv.get('config')
      const iconConfig = iconStr
        ? JSON.parse(iconStr)
        : legacyStr
          ? JSON.parse(legacyStr)?.icon
          : null
      if (iconConfig && typeof iconConfig.cacheEnabled === 'boolean') {
        cacheEnabled = iconConfig.cacheEnabled
      }
    } catch (err) {
      console.warn('Failed to read icon config from KV:', err)
    }
    if (cacheEnabled) {
      try {
        if (store) {
          await store.set(storageKey, buffer, {
            cacheControl: 'public, max-age=31536000',
          })
        } else {
          console.warn('Blob store not available for write (getStore is undefined)')
        }
      } catch (err) {
        console.error('Storage write error:', err)
      }
    }

    const mime = detectMimeType(buffer)
    return new Response(buffer, {
      status: 200,
      headers: iconHeaders(mime, corsHeaders, 'public, max-age=604800'),
    })
  }

  return Response.redirect(`${url.origin}/favicon.ico`, 302)
}

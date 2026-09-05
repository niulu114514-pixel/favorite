// EdgeOne Pages Favicon 统一缓存与代理接口
// 支持在 EdgeOne Pages Blob 存储上使用二进制缓存

import {
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
  domain => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
  // faviconextractor 最后兜底
  domain => `https://www.faviconextractor.com/favicon/${encodeURIComponent(domain)}?larger=true`,
]

const UPSTREAM_TIMEOUT_MS = 10_000
const MAX_FAVICON_BYTES = 512 * 1024
const PAGE_TIMEOUT_MS = 6000
const MAX_PAGE_BYTES = 512 * 1024

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

function detectMimeType(arrayBuffer) {
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

  try {
    const decoder = new TextDecoder('utf-8')
    const prefix = decoder.decode(uint8.subarray(0, 150)).trim().toLowerCase()
    if (prefix.includes('<svg') || prefix.includes('<?xml')) {
      return 'application/octet-stream'
    }
  } catch {
    // Keep the conservative default below.
  }

  return 'image/x-icon'
}

function iconHeaders(mime, corsHeaders, cacheControl) {
  return {
    'Content-Type': mime,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'",
    'Content-Disposition': mime === 'application/octet-stream' ? 'attachment' : 'inline',
    ...corsHeaders,
  }
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)
  const url = new URL(request.url)

  const referer = request.headers.get('referer')
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
      if (cached) {
        const mime = detectMimeType(cached)
        return new Response(cached, {
          status: 200,
          headers: iconHeaders(mime, corsHeaders, 'public, max-age=31536000, immutable'),
        })
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

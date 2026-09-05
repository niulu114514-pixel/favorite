import {
  getCorsHeaders,
  getKV,
  jsonResponse,
  parsePublicHttpsUrl,
  verifyRequestAuth,
} from './_kvAdapter.js'

const REQUEST_TIMEOUT_MS = 8_000
const MAX_PAGE_BYTES = 768 * 1024
const MAX_REDIRECTS = 3

function decodeHtml(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
  return String(value || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalized = entity.toLowerCase()
    if (normalized[0] !== '#') return named[normalized] ?? match
    const hex = normalized[1] === 'x'
    const code = Number.parseInt(normalized.slice(hex ? 2 : 1), hex ? 16 : 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : match
  })
}

function cleanTitle(value) {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

function attribute(tag, name) {
  const match = new RegExp(`${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, 'i').exec(tag)
  return match?.[1] || match?.[2] || ''
}

export function extractSiteTitle(html, hostname) {
  const metaTags = String(html || '').match(/<meta\b[^>]*>/gi) || []
  const preferredNames = ['og:site_name', 'application-name', 'og:title', 'twitter:title']
  for (const preferred of preferredNames) {
    for (const tag of metaTags) {
      const key = (attribute(tag, 'property') || attribute(tag, 'name')).toLowerCase()
      if (key !== preferred) continue
      const title = cleanTitle(attribute(tag, 'content'))
      if (title) return title
    }
  }
  const title = cleanTitle(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''))?.[1])
  if (title) return title
  const host = String(hostname || '').replace(/^www\./i, '')
  const label = host.split('.')[0] || host
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '未命名网站'
}

async function fetchHtml(startUrl, signal) {
  let current = parsePublicHttpsUrl(startUrl)
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current.toString(), {
      redirect: 'manual',
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
        'User-Agent': 'Mozilla/5.0 (compatible; CloudNav-Metadata/1.0)',
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirectCount === MAX_REDIRECTS) throw new Error('网站重定向次数过多')
      current = parsePublicHttpsUrl(new URL(location, current).toString())
      continue
    }
    if (!response.ok) throw new Error(`网站返回错误（${response.status}）`)
    const contentType = response.headers.get('content-type') || ''
    if (contentType && !/html|xhtml/i.test(contentType)) throw new Error('该地址不是网页')
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > MAX_PAGE_BYTES) throw new Error('网页内容过大，无法自动识别')
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_PAGE_BYTES) throw new Error('网页内容过大，无法自动识别')
    return {
      html: new TextDecoder().decode(buffer),
      finalUrl: current,
    }
  }
  throw new Error('无法访问该网站')
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'GET')
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)

  try {
    const kv = getKV(env)
    if (!(await verifyRequestAuth(request, env, kv))) {
      return jsonResponse({ error: '请先登录后识别网站信息' }, 401, corsHeaders)
    }
    const raw = new URL(request.url).searchParams.get('url') || ''
    const initialUrl = parsePublicHttpsUrl(raw)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const { html, finalUrl } = await fetchHtml(initialUrl.toString(), controller.signal)
      const domain = finalUrl.hostname.toLowerCase()
      return jsonResponse(
        {
          title: extractSiteTitle(html, domain),
          url: finalUrl.toString(),
          domain,
          icon: `/api/favicon?domain=${encodeURIComponent(domain)}`,
        },
        200,
        { ...corsHeaders, 'Cache-Control': 'private, max-age=300' }
      )
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    const message =
      error?.name === 'AbortError'
        ? '网站响应超时，请稍后重试'
        : error instanceof Error && error.message === 'Only public HTTPS URLs are allowed'
          ? '仅支持公开的 HTTPS 网站地址'
          : error instanceof Error
            ? error.message
            : '无法识别该网站'
    return jsonResponse({ error: message }, 400, corsHeaders)
  }
}

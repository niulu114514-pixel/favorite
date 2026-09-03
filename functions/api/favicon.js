// EdgeOne Pages Favicon 统一缓存与代理接口
// 支持在 EdgeOne Pages Blob 存储上使用二进制缓存

import {
  getCorsHeaders,
  getKV,
  jsonResponse,
  normalizeDomain,
  sanitizeBlobKey,
} from './_kvAdapter.js'

const UPSTREAM_PROVIDERS = [
  domain => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
  domain => `https://www.faviconextractor.com/favicon/${encodeURIComponent(domain)}?larger=true`,
]

const UPSTREAM_TIMEOUT_MS = 10_000
const MAX_FAVICON_BYTES = 512 * 1024

async function fetchUpstreamIcon(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
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
  if (uint8.length >= 4 && uint8[0] === 0x00 && uint8[1] === 0x00 && uint8[2] === 0x01 && uint8[3] === 0x00) {
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
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'none'; script-src 'none'",
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
      if (refererHost !== requestHost && refererHost !== 'localhost' && refererHost !== '127.0.0.1') {
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

  let cacheEnabled = true
  try {
    const kv = getKV(env)
    let iconConfig = null
    const iconStr = await kv.get('config:icon')
    if (iconStr) {
      iconConfig = JSON.parse(iconStr)
    } else {
      const configVal = await kv.get('config')
      if (configVal) {
        const config = JSON.parse(configVal)
        iconConfig = config?.icon || null
      }
    }
    if (iconConfig && typeof iconConfig.cacheEnabled === 'boolean') {
      cacheEnabled = iconConfig.cacheEnabled
    }
  } catch (err) {
    console.warn('Failed to read config from KV:', err)
  }

  const storageKey = key || `favicon:${domain}`

  try {
    let getStore
    try {
      const blobSdk = await import('@edgeone/pages-blob')
      getStore = blobSdk.getStore
    } catch (e) {
      console.warn('Failed to import @edgeone/pages-blob for read:', e)
    }

    if (getStore) {
      const store = getStore('favicons')
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
  for (const getUrl of UPSTREAM_PROVIDERS) {
    const candidate = await fetchUpstreamIcon(getUrl(domain))
    if (candidate) {
      buffer = candidate
      break
    }
  }

  if (buffer) {
    if (cacheEnabled) {
      try {
        let getStore
        try {
          const blobSdk = await import('@edgeone/pages-blob')
          getStore = blobSdk.getStore
        } catch (e) {
          console.warn('Failed to import @edgeone/pages-blob for write:', e)
        }

        if (getStore) {
          const store = getStore('favicons')
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

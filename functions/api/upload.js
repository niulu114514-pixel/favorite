// EdgeOne Pages 统一上传接口
// 支持将图标上传到 EdgeOne Pages Blob (腾讯云)

import {
  getCorsHeaders,
  getKV,
  jsonResponse,
  parsePublicHttpsUrl,
  sanitizeBlobKey,
  verifyRequestAuth,
} from './_kvAdapter.js'

const MAX_ICON_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 10_000
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico'])

async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { redirect: 'manual', ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function extensionFromType(contentType) {
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('icon') || contentType.includes('x-icon')) return 'ico'
  if (contentType.includes('png')) return 'png'
  return ''
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)
  }

  let kv
  try {
    kv = getKV(env)
  } catch (e) {
    if (!env.PASSWORD) {
      return jsonResponse({ error: 'Storage is not configured' }, 500, corsHeaders)
    }
  }

  const isAuthenticated = await verifyRequestAuth(request, env, kv)
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_ICON_BYTES + 128 * 1024) {
    return jsonResponse({ error: 'Icon file is too large' }, 413, corsHeaders)
  }

  if (!isAuthenticated) {
    return jsonResponse({ error: '需要密码验证' }, 401, corsHeaders)
  }

  if (request.method === 'DELETE') {
    const url = new URL(request.url)
    const key = sanitizeBlobKey(url.searchParams.get('key'))
    if (!key) {
      return jsonResponse({ error: 'Key parameter required' }, 400, corsHeaders)
    }

    try {
      let getStore
      try {
        const blobSdk = await import('@edgeone/pages-blob')
        getStore = blobSdk.getStore
      } catch (e) {}

      if (getStore) {
        const store = getStore('favicons')
        await store.delete(key)
      }
      return jsonResponse({ success: true }, 200, corsHeaders)
    } catch (err) {
      console.error('Delete error:', err)
      return jsonResponse({ error: 'Delete failed' }, 500, corsHeaders)
    }
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    let arrayBuffer
    let contentType = 'image/png'
    let ext = 'png'

    const fetchUrl = formData.get('url')
    if (!file && !fetchUrl) {
      return jsonResponse({ error: 'No file or url provided' }, 400, corsHeaders)
    }

    let categoryName = formData.get('categoryName') || 'common'
    categoryName = String(categoryName)
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim()
    categoryName = categoryName.slice(0, 80)
    if (!categoryName || !/^[a-zA-Z0-9._-]+$/.test(categoryName)) {
      categoryName = 'common'
    }

    if (fetchUrl) {
      try {
        const safeUrl = parsePublicHttpsUrl(fetchUrl)
        const fetchRes = await fetchWithTimeout(safeUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        })
        if (!fetchRes.ok) {
          return jsonResponse({ error: 'Failed to fetch external URL' }, 400, corsHeaders)
        }
        const remoteLength = Number(fetchRes.headers.get('content-length') || 0)
        if (remoteLength > MAX_ICON_BYTES) {
          return jsonResponse({ error: 'Icon file is too large' }, 413, corsHeaders)
        }
        arrayBuffer = await fetchRes.arrayBuffer()
        if (arrayBuffer.byteLength > MAX_ICON_BYTES) {
          return jsonResponse({ error: 'Icon file is too large' }, 413, corsHeaders)
        }
        contentType = fetchRes.headers.get('content-type') || 'image/png'
        if (!/^image\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
          return jsonResponse({ error: 'Only image files are allowed' }, 415, corsHeaders)
        }
        if (/svg/i.test(contentType)) {
          return jsonResponse({ error: 'SVG files are not allowed' }, 415, corsHeaders)
        }

        const pathExt = safeUrl.pathname.split('.').pop()
        ext = ALLOWED_EXT.has(String(pathExt || '').toLowerCase())
          ? String(pathExt).toLowerCase()
          : extensionFromType(contentType) || 'png'
      } catch (fetchErr) {
        console.error('Fetch URL error:', fetchErr)
        return jsonResponse({ error: 'Failed to fetch external URL' }, 400, corsHeaders)
      }
    } else {
      if (!file || typeof file.arrayBuffer !== 'function') {
        return jsonResponse({ error: 'Invalid file upload' }, 400, corsHeaders)
      }
      arrayBuffer = await file.arrayBuffer()
      if (arrayBuffer.byteLength > MAX_ICON_BYTES) {
        return jsonResponse({ error: 'Icon file is too large' }, 413, corsHeaders)
      }
      const filename = file.name || 'icon.png'
      contentType = file.type || 'image/png'
      ext = String(filename.split('.').pop() || 'png').toLowerCase()
      if (!/^image\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
        return jsonResponse({ error: 'Only image files are allowed' }, 415, corsHeaders)
      }
      if (/svg/i.test(contentType) || ext === 'svg') {
        return jsonResponse({ error: 'SVG files are not allowed' }, 415, corsHeaders)
      }
    }

    if (!ALLOWED_EXT.has(ext)) ext = 'png'

    const randomId = crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 10)
    const key = `${categoryName}/${randomId}.${ext}`

    let getStore
    try {
      const blobSdk = await import('@edgeone/pages-blob')
      getStore = blobSdk.getStore
    } catch (e) {}

    if (!getStore) {
      return jsonResponse({ error: 'Storage backend not available' }, 500, corsHeaders)
    }

    const store = getStore('favicons')
    await store.set(key, arrayBuffer, {
      cacheControl: 'public, max-age=31536000',
    })

    const iconUrl = `/api/favicon?key=${encodeURIComponent(key)}`
    return jsonResponse({ success: true, url: iconUrl }, 200, corsHeaders)
  } catch (err) {
    console.error('Upload error:', err)
    return jsonResponse({ error: 'Upload failed' }, 500, corsHeaders)
  }
}

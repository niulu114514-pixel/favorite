// EdgeOne Pages 统一上传接口
// 支持将图标上传到 EdgeOne Pages Blob (腾讯云)
// 简洁注释以遵循用户全局规则

import { getKV, getCorsHeaders, verifyAuth, jsonResponse } from './_kvAdapter.js'

const MAX_ICON_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 10_000

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host === '::1' || host.includes(':'))
    return true
  const octets = host.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)
  )
    return false
  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function parsePublicHttpsUrl(value) {
  const parsed = new URL(String(value))
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    isPrivateHostname(parsed.hostname)
  ) {
    throw new Error('Only public HTTPS URLs are allowed')
  }
  return parsed
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { redirect: 'manual', ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
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

  // 1. 认证检查
  let kv
  try {
    kv = getKV(env)
  } catch (e) {
    if (!env.PASSWORD) {
      return jsonResponse({ error: 'KV or PASSWORD not configured' }, 500, corsHeaders)
    }
  }

  const providedPassword = request.headers.get('x-auth-password')
  const isAuthenticated = await verifyAuth({
    providedPassword,
    serverPassword: env.PASSWORD,
    kv,
  })

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_ICON_BYTES + 128 * 1024) {
    return jsonResponse({ error: 'Icon file is too large' }, 413, corsHeaders)
  }

  if (!isAuthenticated) {
    return jsonResponse({ error: '需要密码验证' }, 401, corsHeaders)
  }

  // 处理删除请求 (DELETE)
  if (request.method === 'DELETE') {
    const url = new URL(request.url)
    const key = url.searchParams.get('key')
    if (!key) {
      return jsonResponse({ error: 'Key parameter required' }, 400, corsHeaders)
    }

    try {
      // EdgeOne Pages Blob 删除
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
      return jsonResponse({ error: err.message }, 500, corsHeaders)
    }
  }

  try {
    const formData = await request.formData()
    let file = formData.get('file')
    let arrayBuffer
    let contentType = 'image/png'
    let ext = 'png'
    let filename = 'icon.png'

    const fetchUrl = formData.get('url')
    if (!file && !fetchUrl) {
      return jsonResponse({ error: 'No file or url provided' }, 400, corsHeaders)
    }

    // 获取分类名并净化
    let categoryName = formData.get('categoryName') || 'common'
    categoryName = String(categoryName)
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim()
    categoryName = categoryName.slice(0, 80)
    if (!categoryName) {
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
          return jsonResponse(
            { error: `Failed to fetch external URL: ${fetchRes.statusText}` },
            400,
            corsHeaders
          )
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

        const urlObj = new URL(fetchUrl)
        const pathExt = urlObj.pathname.split('.').pop()
        if (pathExt && /^[a-zA-Z0-9]+$/.test(pathExt) && pathExt.length < 5) {
          ext = pathExt.toLowerCase()
        } else if (contentType.includes('svg')) {
          ext = 'svg'
        } else if (contentType.includes('icon') || contentType.includes('x-icon')) {
          ext = 'ico'
        } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
          ext = 'jpg'
        } else if (contentType.includes('webp')) {
          ext = 'webp'
        } else if (contentType.includes('gif')) {
          ext = 'gif'
        }
        filename = `icon.${ext}`
      } catch (fetchErr) {
        return jsonResponse({ error: `Fetch URL error: ${fetchErr.message}` }, 400, corsHeaders)
      }
    } else {
      if (!file || typeof file.arrayBuffer !== 'function') {
        return jsonResponse({ error: 'Invalid file upload' }, 400, corsHeaders)
      }
      arrayBuffer = await file.arrayBuffer()
      if (arrayBuffer.byteLength > MAX_ICON_BYTES) {
        return jsonResponse({ error: 'Icon file is too large' }, 413, corsHeaders)
      }
      filename = file.name || 'icon.png'
      contentType = file.type || 'image/png'
      ext = filename.split('.').pop() || 'png'
      if (!/^image\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
        return jsonResponse({ error: 'Only image files are allowed' }, 415, corsHeaders)
      }
    }

    if (!/^[a-z0-9]{1,5}$/i.test(ext)) ext = 'png'

    // 生成唯一 Key 并按分类存放
    const randomId = crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 10)
    const key = `${categoryName}/${randomId}.${ext}`

    // 2. 上传到 EdgeOne Pages Blob
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
    return jsonResponse({ error: err.message }, 500, corsHeaders)
  }
}

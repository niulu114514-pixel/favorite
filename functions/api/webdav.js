// WebDAV 代理接口
// 支持 EdgeOne Pages

import { getCorsHeaders, getKV, jsonResponse, verifyAuth } from './_kvAdapter.js'

const REQUEST_TIMEOUT_MS = 10_000
const MAX_BACKUP_BYTES = 2 * 1024 * 1024
const BACKUP_PREFIX = 'cloudnav_backup'

function credential(request) {
  const authorization = request.headers.get('authorization') || ''
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim()
  return request.headers.get('x-auth-password') || ''
}

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

function parseRemoteUrl(value) {
  const parsed = new URL(value)
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    isPrivateHostname(parsed.hostname)
  ) {
    throw new Error('Only public HTTPS WebDAV URLs are allowed')
  }
  parsed.search = ''
  parsed.hash = ''
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

/** 拼接自定义文件夹目录，返回以 / 结尾的目录 URL */
function buildDirUrl(baseUrl, folder) {
  const f = String(folder || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  return f ? baseUrl + f + '/' : baseUrl
}

/** 防止文件名穿越，仅允许安全的纯文件名 */
function sanitizeFilename(name) {
  const base = String(name || '').split('/').filter(Boolean).pop() || ''
  return /^[a-zA-Z0-9._-]+$/.test(base) ? base : ''
}

function defaultBackupFilename() {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19)
  return `${BACKUP_PREFIX}_${ts}.json`
}

/** 粗粒度解析 PROPFIND 的多状态响应，兼容 d:、D:、lp1: 等不同命名空间前缀 */
function parsePropfind(body) {
  const parts = body.split(/<(?:[^>:]+:)?response[\s>]/gi)
  const items = []
  for (let i = 1; i < parts.length; i++) {
    let block = parts[i]
    const close = block.search(/<\/(?:[^>:]+:)?response\s*>/i)
    if (close !== -1) block = block.slice(0, close)
    const hrefMatch = block.match(/<(?:[^>:]+:)?href(?:\s[^>]*)?>([^<]*)</i)
    if (!hrefMatch) continue
    const href = decodeURIComponent(hrefMatch[1].trim())
    const sizeMatch = block.match(/<(?:[^>:]+:)?getcontentlength(?:\s[^>]*)?>([0-9]+)/i)
    const modMatch = block.match(/<(?:[^>:]+:)?getlastmodified(?:\s[^>]*)?>([^<]*)</i)
    items.push({
      name: href.split('/').filter(Boolean).pop() || href,
      href,
      size: sizeMatch ? Number(sizeMatch[1]) : 0,
      modified: modMatch ? modMatch[1] : '',
    })
  }
  return items
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)
  }

  try {
    const kv = getKV(env)
    const authenticated = await verifyAuth({
      providedPassword: credential(request),
      serverPassword: env.PASSWORD,
      kv,
    })
    if (!authenticated) return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)

    const body = await request.json()
    const { operation, config, payload } = body

    if (!config || !config.url || !config.username || !config.password) {
      return jsonResponse({ error: 'Missing configuration' }, 400, corsHeaders)
    }

    let parsedBaseUrl
    try {
      parsedBaseUrl = parseRemoteUrl(config.url.trim())
    } catch {
      return jsonResponse({ error: 'Invalid WebDAV URL' }, 400, corsHeaders)
    }
    let baseUrl = parsedBaseUrl.toString()
    if (!baseUrl.endsWith('/')) baseUrl += '/'

    const dirUrl = buildDirUrl(baseUrl, config.folder)
    const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`

    let fetchUrl = dirUrl
    let method = 'PROPFIND'
    let headers = {
      Authorization: authHeader,
      'User-Agent': 'CloudNav/1.0',
    }
    let requestBody = undefined

    const payloadFilename = sanitizeFilename(payload && payload.filename)

    if (operation === 'check') {
      fetchUrl = dirUrl
      method = 'PROPFIND'
      headers['Depth'] = '0'
    } else if (operation === 'list') {
      fetchUrl = dirUrl
      method = 'PROPFIND'
      headers['Depth'] = '1'
    } else if (operation === 'backup') {
      fetchUrl = dirUrl + (payloadFilename || defaultBackupFilename())
      method = 'PUT'
      headers['Content-Type'] = 'application/json'
      requestBody = JSON.stringify(payload?.data ?? {})
    } else if (operation === 'restore') {
      fetchUrl = dirUrl + (payloadFilename || defaultBackupFilename())
      method = 'GET'
    } else {
      return jsonResponse({ error: 'Invalid operation' }, 400, corsHeaders)
    }

    if (
      operation === 'backup' &&
      new TextEncoder().encode(requestBody || '').byteLength > MAX_BACKUP_BYTES
    ) {
      return jsonResponse({ error: 'Backup file is too large' }, 413, corsHeaders)
    }

    const response = await fetchWithTimeout(fetchUrl, { method, headers, body: requestBody })

    if (operation === 'restore') {
      if (response.status === 404) {
        return jsonResponse({ error: 'Backup file not found' }, 404, corsHeaders)
      }
      if (!response.ok) {
        return jsonResponse(
          { error: `WebDAV Error: ${response.status}` },
          response.status,
          corsHeaders
        )
      }
      const contentLength = Number(response.headers.get('content-length') || 0)
      if (contentLength > MAX_BACKUP_BYTES) {
        return jsonResponse({ error: 'Backup file is too large' }, 413, corsHeaders)
      }
      let data
      try {
        data = JSON.parse(new TextDecoder().decode(await response.arrayBuffer()))
      } catch {
        return jsonResponse({ error: 'Backup file is corrupted' }, 422, corsHeaders)
      }
      return jsonResponse(data, 200, corsHeaders)
    }

    if (operation === 'list') {
      const text = await response.text()
      const all = response.ok || response.status === 207 ? parsePropfind(text) : []
      const items = all.filter(item => {
        const name = item.name.toLowerCase()
        return name.startsWith(BACKUP_PREFIX) && name.endsWith('.json')
      })
      return jsonResponse({ success: true, items }, 200, corsHeaders)
    }

    const success = response.ok || response.status === 207 || response.status === 201
    return jsonResponse({ success, status: response.status }, 200, corsHeaders)
  } catch (err) {
    console.error('WebDAV API error:', err)
    return jsonResponse({ error: err.message }, 500, corsHeaders)
  }
}
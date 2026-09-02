// WebDAV 代理接口
// 支持 EdgeOne Pages

import { getCorsHeaders, getKV, jsonResponse, verifyAuth } from './_kvAdapter.js'

const REQUEST_TIMEOUT_MS = 10_000
const MAX_BACKUP_BYTES = 2 * 1024 * 1024

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

    const filename = 'cloudnav_backup.json'
    const fileUrl = baseUrl + filename
    const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`

    let fetchUrl = baseUrl
    let method = 'PROPFIND'
    let headers = {
      Authorization: authHeader,
      'User-Agent': 'CloudNav/1.0',
    }
    let requestBody = undefined

    if (operation === 'check') {
      fetchUrl = baseUrl
      method = 'PROPFIND'
      headers['Depth'] = '0'
    } else if (operation === 'upload') {
      fetchUrl = fileUrl
      method = 'PUT'
      headers['Content-Type'] = 'application/json'
      requestBody = JSON.stringify(payload)
    } else if (operation === 'download') {
      fetchUrl = fileUrl
      method = 'GET'
    } else {
      return jsonResponse({ error: 'Invalid operation' }, 400, corsHeaders)
    }

    if (
      operation === 'upload' &&
      new TextEncoder().encode(requestBody || '').byteLength > MAX_BACKUP_BYTES
    ) {
      return jsonResponse({ error: 'Backup file is too large' }, 413, corsHeaders)
    }

    const response = await fetchWithTimeout(fetchUrl, { method, headers, body: requestBody })

    if (operation === 'download') {
      if (!response.ok) {
        if (response.status === 404) {
          return jsonResponse({ error: 'Backup file not found' }, 404, corsHeaders)
        }
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
      const data = JSON.parse(new TextDecoder().decode(await response.arrayBuffer()))
      return jsonResponse(data, 200, corsHeaders)
    }

    const success = response.ok || response.status === 207
    return jsonResponse({ success, status: response.status }, 200, corsHeaders)
  } catch (err) {
    console.error('WebDAV API error:', err)
    return jsonResponse({ error: err.message }, 500, corsHeaders)
  }
}

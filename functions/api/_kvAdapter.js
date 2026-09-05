// EdgeOne Pages KV 适配层

export const AUTH_COOKIE_NAME = 'cloudnav_auth'
export const MAX_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60

const SECRET_KEY_PATTERN = /api[-_]?key|password|token|secret|authorization|credential|private/i

export function isSecretConfigKey(key) {
  return SECRET_KEY_PATTERN.test(String(key)) || String(key).toLowerCase() === 'headers'
}

/**
 * 获取 EdgeOne Pages KV 实例
 * @param {object} [env] - 函数 context.env
 * @returns {object} KV 实例
 */
export function getKV(env) {
  if (env && env.CLOUDNAV_KV && typeof env.CLOUDNAV_KV.get === 'function') {
    return env.CLOUDNAV_KV
  }
  if (typeof CLOUDNAV_KV !== 'undefined' && typeof CLOUDNAV_KV.get === 'function') {
    return CLOUDNAV_KV
  }
  throw new Error('KV binding "CLOUDNAV_KV" not found. Please check your deployment configuration.')
}

/**
 * 获取 CORS 头，支持配置化
 * @param {object} env - 函数 context.env
 * @returns {object} CORS headers
 */
export function getCorsHeaders(env) {
  const origin = env?.ALLOWED_ORIGIN || '*'
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Accept, Authorization, x-auth-password, MCP-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
  }
  if (origin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true'
    headers['Vary'] = 'Origin'
  }
  return headers
}

/**
 * MCP Streamable HTTP requires Origin validation to mitigate DNS rebinding.
 * Non-browser clients normally omit Origin and remain supported.
 */
export function isAllowedRequestOrigin(request, env) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    if (origin === new URL(request.url).origin) return true
  } catch {
    return false
  }
  const allowed = env?.ALLOWED_ORIGIN
  return Boolean(allowed && allowed !== '*' && origin === allowed)
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  const len = Math.max(left.length, right.length)
  let mismatch = left.length ^ right.length
  for (let i = 0; i < len; i++) {
    mismatch |= (left[i] || 0) ^ (right[i] || 0)
  }
  return mismatch === 0
}

export function isHexToken(value) {
  return typeof value === 'string' && value.length === 64 && /^[0-9a-f]{64}$/i.test(value)
}

function parseCookies(header) {
  const cookies = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name) cookies[name] = value
  }
  return cookies
}

export function getRequestCredentials(request) {
  const credentials = []
  const authorization = request.headers.get('authorization') || ''
  if (/^bearer\s+/i.test(authorization)) {
    credentials.push(authorization.replace(/^bearer\s+/i, '').trim())
  }
  const header = request.headers.get('x-auth-password') || ''
  if (header) credentials.push(header)
  const cookie = parseCookies(request.headers.get('cookie') || '')[AUTH_COOKIE_NAME] || ''
  if (cookie) credentials.push(cookie)
  return [...new Set(credentials.filter(Boolean))]
}

export function getRequestCredential(request) {
  return getRequestCredentials(request)[0] || ''
}

export function isHttpsRequest(request) {
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

export function buildAuthCookie(token, maxAgeSeconds, secure) {
  const parts = [`${AUTH_COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict']
  if (secure) parts.push('Secure')
  const ttl = Number.isFinite(maxAgeSeconds)
    ? Math.min(Math.max(1, maxAgeSeconds), MAX_TOKEN_TTL_SECONDS)
    : MAX_TOKEN_TTL_SECONDS
  parts.push(`Max-Age=${ttl}`)
  return parts.join('; ')
}

export function clearAuthCookie(secure) {
  const parts = [`${AUTH_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clientAddress(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('eo-connecting-ip') ||
    request.headers.get('true-client-ip') ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

function isPrivateIPv4(host) {
  if (/^\d+$/.test(host)) {
    const n = Number(host)
    if (n >= 0 && n <= 4294967295) {
      return isPrivateIPv4(`${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`)
    }
  }
  const parts = host.split('.')
  if (parts.length !== 4) return false
  if (parts.some(part => !/^\d+$/.test(part))) return true
  const octets = parts.map(Number)
  if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

export function isPrivateHostname(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (!host) return true
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal')
  ) {
    return true
  }
  if (host.includes(':')) return true
  return isPrivateIPv4(host)
}

export function parsePublicHttpsUrl(value) {
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

export function normalizeDomain(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
  if (!raw || raw.length > 253) return null
  let hostname = raw
  try {
    if (raw.includes('://')) hostname = new URL(raw).hostname
  } catch {
    return null
  }
  hostname = hostname.replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (
    !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(hostname)
  ) {
    return null
  }
  if (isPrivateHostname(hostname)) return null
  return hostname
}

export function sanitizeBlobKey(key) {
  const value = String(key || '')
  if (!value || value.length > 200) return null
  if (value.includes('..') || value.includes('\\') || value.startsWith('/')) return null
  if (!/^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(value)) return null
  return value
}

export function sanitizePublicConfig(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicConfig)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEY_PATTERN.test(key) && key !== 'headers')
      .map(([key, entry]) => [key, sanitizePublicConfig(entry)])
  )
}

/** Preserve stored secrets when the browser submits a redacted/blank draft. */
export function mergeSecretConfig(previous, incoming) {
  if (Array.isArray(incoming) || !incoming || typeof incoming !== 'object') return incoming
  const before =
    previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}
  const merged = { ...incoming }
  for (const [key, oldValue] of Object.entries(before)) {
    const hasNewValue = Object.prototype.hasOwnProperty.call(incoming, key)
    const nextValue = incoming[key]
    if (isSecretConfigKey(key)) {
      if (!hasNewValue || nextValue === '' || nextValue == null) merged[key] = oldValue
      continue
    }
    if (
      hasNewValue &&
      oldValue &&
      typeof oldValue === 'object' &&
      !Array.isArray(oldValue) &&
      nextValue &&
      typeof nextValue === 'object' &&
      !Array.isArray(nextValue)
    ) {
      merged[key] = mergeSecretConfig(oldValue, nextValue)
    }
  }
  return merged
}

export function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value))
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 认证检查：验证密码或 Token
 * @param {object} params
 * @param {string} params.providedPassword - 客户端提供的密码或 Token
 * @param {string} params.serverPassword - 环境变量中的密码
 * @param {object} params.kv - KV 实例
 * @returns {Promise<boolean>}
 */
export async function verifyAuth({ providedPassword, serverPassword, kv }) {
  if (!providedPassword) return false

  if (serverPassword && timingSafeEqual(providedPassword, serverPassword)) {
    return true
  }

  if (!isHexToken(providedPassword) || !kv) return false

  try {
    const tokenVal = await kv.get(`auth_token:${providedPassword}`)
    return tokenVal === 'valid'
  } catch {
    return false
  }
}

export async function verifyRequestAuth(request, env, kv) {
  for (const providedPassword of getRequestCredentials(request)) {
    if (await verifyAuth({ providedPassword, serverPassword: env?.PASSWORD, kv })) {
      return true
    }
  }
  return false
}

/** MCP accepts the admin session/password plus independently revocable MCP tokens. */
export async function verifyMcpRequestAuth(request, env, kv) {
  if (await verifyRequestAuth(request, env, kv)) return true
  for (const credential of getRequestCredentials(request)) {
    if (!isHexToken(credential)) continue
    try {
      if ((await kv.get(`mcp_token:${credential}`)) === 'valid') return true
    } catch {
      // Try the next credential.
    }
  }
  return false
}

/**
 * 创建标准 JSON 响应
 * @param {any} data - 响应数据
 * @param {number} status - HTTP 状态码
 * @param {object} extraHeaders - 额外响应头
 * @returns {Response}
 */
export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  })
}

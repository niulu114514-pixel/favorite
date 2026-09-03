// 认证接口
// 支持 EdgeOne Pages

import {
  MAX_TOKEN_TTL_SECONDS,
  buildAuthCookie,
  clearAuthCookie,
  clientAddress,
  getCorsHeaders,
  getKV,
  isHttpsRequest,
  jsonResponse,
  timingSafeEqual,
} from './_kvAdapter.js'

const AUTH_WINDOW_SECONDS = 5 * 60
const MAX_FAILED_ATTEMPTS = 5

async function readRateLimit(kv, request) {
  const key = `auth_rate:${clientAddress(request)}`
  try {
    const value = await kv.get(key)
    const parsed = value ? JSON.parse(value) : null
    if (parsed && Number.isFinite(parsed.resetAt) && parsed.resetAt > Date.now()) {
      return { key, count: Number(parsed.count) || 0, resetAt: parsed.resetAt }
    }
  } catch {
    // A malformed or unavailable counter should not block a valid login.
  }
  return { key, count: 0, resetAt: Date.now() + AUTH_WINDOW_SECONDS * 1000 }
}

async function recordFailedAttempt(kv, rate) {
  await kv.put(rate.key, JSON.stringify({ count: rate.count + 1, resetAt: rate.resetAt }), {
    expirationTtl: AUTH_WINDOW_SECONDS,
  })
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method === 'DELETE') {
    const headers = {
      ...corsHeaders,
      'Set-Cookie': clearAuthCookie(isHttpsRequest(request)),
    }
    return jsonResponse({ success: true }, 200, headers)
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)
  }

  try {
    const kv = getKV(env)
    const { password } = await request.json()

    if (!env.PASSWORD) {
      return jsonResponse({ error: '服务器未配置管理员密码' }, 500, corsHeaders)
    }

    const rate = await readRateLimit(kv, request)
    if (rate.count >= MAX_FAILED_ATTEMPTS) {
      return jsonResponse({ error: 'Too many login attempts. Try again later.' }, 429, {
        ...corsHeaders,
        'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)),
      })
    }

    if (typeof password !== 'string' || !timingSafeEqual(password, env.PASSWORD)) {
      await recordFailedAttempt(kv, rate)
      return jsonResponse({ error: '密码错误' }, 401, corsHeaders)
    }

    try {
      const oldToken = await kv.get('last_token')
      if (oldToken) {
        await kv.delete(`auth_token:${oldToken}`)
      }
    } catch (e) {
      console.warn('Failed to clean old token:', e)
    }

    await kv.delete(rate.key).catch(() => {})
    const token = generateSecureToken()

    let expirationTtl = 24 * 60 * 60
    try {
      const configStr = await kv.get('config:website')
      const legacyStr = configStr ? null : await kv.get('config')
      const source = configStr
        ? JSON.parse(configStr)
        : legacyStr
          ? JSON.parse(legacyStr)?.website
          : null
      const expiry = source?.passwordExpiry
      if (expiry) expirationTtl = calcExpiryTtl(expiry)
    } catch (e) {
      console.warn('Failed to read expiry config:', e)
    }

    await kv.put('last_auth_time', Date.now().toString())

    const kvOptions = expirationTtl ? { expirationTtl } : { expirationTtl: MAX_TOKEN_TTL_SECONDS }
    await kv.put(`auth_token:${token}`, 'valid', kvOptions)
    await kv.put('last_token', token, kvOptions)

    const cookieMaxAge = expirationTtl || MAX_TOKEN_TTL_SECONDS
    return jsonResponse(
      {
        success: true,
        message: '认证成功',
      },
      200,
      {
        ...corsHeaders,
        'Set-Cookie': buildAuthCookie(token, cookieMaxAge, isHttpsRequest(request)),
      }
    )
  } catch (err) {
    console.error('Auth API error:', err)
    return jsonResponse({ error: '认证请求失败' }, 500, corsHeaders)
  }
}

function generateSecureToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function calcExpiryTtl(expiry) {
  const { value = 1, unit = 'week' } = expiry
  const multipliers = {
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  }
  if (unit === 'permanent') return MAX_TOKEN_TTL_SECONDS
  const ttl = (multipliers[unit] || 604800) * Number(value || 1)
  return Math.min(Math.max(60, ttl), MAX_TOKEN_TTL_SECONDS)
}

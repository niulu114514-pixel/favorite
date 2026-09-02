// 认证接口
// 支持 EdgeOne Pages

import { getKV, getCorsHeaders, jsonResponse } from './_kvAdapter.js'

const AUTH_WINDOW_SECONDS = 5 * 60
const MAX_FAILED_ATTEMPTS = 5

function clientAddress(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

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

    if (password !== env.PASSWORD) {
      await recordFailedAttempt(kv, rate)
      return jsonResponse({ error: '密码错误' }, 401, corsHeaders)
    }

    // 清理旧 Token：读取上次生成的 token 并删除
    try {
      const oldToken = await kv.get('last_token')
      if (oldToken) {
        await kv.delete(`auth_token:${oldToken}`)
      }
    } catch (e) {
      console.warn('Failed to clean old token:', e)
    }

    // 生成安全随机 Token
    await kv.delete(rate.key).catch(() => {})
    const token = generateSecureToken()

    // 读取密码过期配置
    let expirationTtl = 24 * 60 * 60 // 默认 1 天
    try {
      const configStr = await kv.get('config')
      if (configStr) {
        const config = JSON.parse(configStr)
        const expiry = config.website?.passwordExpiry
        if (expiry) {
          expirationTtl = calcExpiryTtl(expiry)
        }
      }
    } catch (e) {
      console.warn('Failed to read expiry config:', e)
    }

    // 记录认证时间
    await kv.put('last_auth_time', Date.now().toString())

    // 存储新 Token
    const kvOptions = expirationTtl ? { expirationTtl } : {}
    await kv.put(`auth_token:${token}`, 'valid', kvOptions)

    // 记录当前 Token（用于下次登录时清理）
    await kv.put('last_token', token, kvOptions)

    return jsonResponse(
      {
        success: true,
        token,
        message: '认证成功',
      },
      200,
      corsHeaders
    )
  } catch (err) {
    console.error('Auth API error:', err)
    return jsonResponse({ error: '认证请求失败' }, 500, corsHeaders)
  }
}

/**
 * 生成安全随机 Token（32 字节 hex = 64 字符）
 */
function generateSecureToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 计算 Token 过期时间（秒）
 */
function calcExpiryTtl(expiry) {
  const { value = 1, unit = 'week' } = expiry
  const multipliers = {
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  }
  if (unit === 'permanent') return null
  return (multipliers[unit] || 604800) * value
}

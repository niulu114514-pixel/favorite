import {
  getCorsHeaders,
  getKV,
  jsonResponse,
  mergeSecretConfig,
  parsePublicHttpsUrl,
  verifyRequestAuth,
} from './_kvAdapter.js'

const REQUEST_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 64 * 1024

async function readAIConfig(kv) {
  const section = await kv.get('config:ai')
  if (section) return JSON.parse(section)
  const legacy = await kv.get('config')
  return legacy ? JSON.parse(legacy)?.ai || {} : {}
}

function providerConfig(config) {
  const provider = ['google', 'openai', 'claude', 'custom'].includes(config.provider)
    ? config.provider
    : 'google'
  const selected = config.providers?.[provider] || {}
  // 旧版本把每个提供商保存在 providers 中，当前设置页使用顶层字段。
  // 顶层非空值必须优先，否则用户更新 Key 后仍会被历史 Key 覆盖并持续返回 403。
  return {
    ...selected,
    ...config,
    provider,
    apiKey: config.apiKey || selected.apiKey || '',
    baseUrl: config.baseUrl || selected.baseUrl || '',
    model: config.model || selected.model || '',
  }
}

export function endpointFor(config) {
  const provider = config.provider
  const fallback =
    provider === 'google'
      ? 'https://generativelanguage.googleapis.com'
      : provider === 'claude'
        ? 'https://api.anthropic.com'
        : 'https://api.openai.com/v1'
  const parsed = parsePublicHttpsUrl(String(config.baseUrl || fallback).replace(/\/$/, ''))
  const base = parsed.toString().replace(/\/$/, '')
  if (provider === 'google') {
    const model = encodeURIComponent(config.model || 'gemini-2.0-flash')
    if (/:generateContent$/i.test(base)) return base
    if (/\/v1(?:beta)?\/models\/[^/]+$/i.test(base)) return `${base}:generateContent`
    const root = base.replace(/\/v1(?:beta)?$/i, '')
    return `${root}/v1beta/models/${model}:generateContent`
  }
  if (provider === 'claude') {
    if (/\/v1\/messages$/i.test(base)) return base
    return /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`
  }
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

function providerLabel(provider) {
  if (provider === 'google') return 'Google Gemini'
  if (provider === 'claude') return 'Claude'
  return 'OpenAI 兼容服务'
}

function redactUpstreamMessage(value, apiKey) {
  let text = String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (apiKey) text = text.split(String(apiKey)).join('[已隐藏]')
  return text
    .replace(/\bAIza[\w-]{20,}\b/g, '[已隐藏]')
    .replace(/\bsk-[\w-]{12,}\b/gi, '[已隐藏]')
    .replace(/Bearer\s+[\w._~+/-]{12,}/gi, 'Bearer [已隐藏]')
    .slice(0, 360)
}

async function readUpstreamError(response, apiKey) {
  const raw = await response.text().catch(() => '')
  let payload
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = null
  }
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : []
  const reason = details.map(item => item?.reason || item?.metadata?.reason).find(Boolean)
  const message =
    payload?.error?.message ||
    payload?.message ||
    payload?.error_description ||
    raw ||
    response.statusText
  return {
    reason: redactUpstreamMessage(reason, apiKey),
    message: redactUpstreamMessage(message, apiKey),
  }
}

function upstreamErrorMessage(provider, status, detail) {
  const label = providerLabel(provider)
  const suffix = [detail.reason, detail.message].filter(Boolean).join('：')
  if (provider === 'google' && status === 403) {
    const locationBlocked = /location|region|country|territor/i.test(suffix)
    const hint = locationBlocked
      ? '当前 EdgeOne 节点所在地区可能不支持 Gemini，请改用可用地区的代理，或切换到 OpenAI 兼容服务。'
      : '请在 Google AI Studio 新建 Authorization Key，并确认该 Key 已启用 Gemini API；旧版标准 Key 或受限 Key 可能被拒绝。'
    return `${label} 拒绝请求（403）${suffix ? `：${suffix}` : ''}。${hint}`
  }
  if (status === 401 || status === 403) {
    return `${label} 鉴权失败（${status}）${suffix ? `：${suffix}` : ''}。请检查 API Key 和 Base URL。`
  }
  if (status === 429) {
    return `${label} 请求过于频繁或额度不足（429）${suffix ? `：${suffix}` : ''}`
  }
  return `${label} 请求失败（${status}）${suffix ? `：${suffix}` : ''}`
}

async function complete(config, system, prompt) {
  const active = providerConfig(config)
  if (!active.apiKey) throw new Error('请先配置 AI API Key')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const headers = { 'Content-Type': 'application/json' }
    let body
    if (active.provider === 'google') {
      headers['x-goog-api-key'] = active.apiKey
      body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 160 },
      }
    } else if (active.provider === 'claude') {
      headers['x-api-key'] = active.apiKey
      headers['anthropic-version'] = '2023-06-01'
      body = {
        model: active.model || 'claude-3-5-sonnet-latest',
        max_tokens: 160,
        system,
        messages: [{ role: 'user', content: prompt }],
      }
    } else {
      headers.Authorization = `Bearer ${active.apiKey}`
      body = {
        model: active.model || 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 160,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }
    }
    const response = await fetch(endpointFor(active), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await readUpstreamError(response, active.apiKey)
      throw new Error(upstreamErrorMessage(active.provider, response.status, detail))
    }
    const data = await response.json().catch(() => null)
    if (!data) throw new Error(`${providerLabel(active.provider)} 返回了无法解析的响应`)
    const text =
      active.provider === 'google'
        ? data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('')
        : active.provider === 'claude'
          ? data.content?.map(part => part.text || '').join('')
          : data.choices?.[0]?.message?.content
    const result = String(text || '').trim()
    if (!result) throw new Error(`${providerLabel(active.provider)} 没有返回有效内容`)
    return result
  } finally {
    clearTimeout(timer)
  }
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (request.method !== 'POST')
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)
  try {
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > MAX_BODY_BYTES)
      return jsonResponse({ error: 'Payload is too large' }, 413, corsHeaders)
    const kv = getKV(env)
    if (!(await verifyRequestAuth(request, env, kv))) {
      return jsonResponse({ error: '请先登录后使用 AI 助手' }, 401, corsHeaders)
    }
    const body = await request.json()
    const title = String(body.title || '')
      .trim()
      .slice(0, 100)
    const url = String(body.url || '')
      .trim()
      .slice(0, 2048)
    if (!title || !url) return jsonResponse({ error: '名称和网址不能为空' }, 400, corsHeaders)
    const stored = await readAIConfig(kv)
    const config = body.config ? mergeSecretConfig(stored, body.config) : stored
    let result
    if (body.action === 'describe' || body.action === 'test') {
      result = await complete(
        config,
        '你是书签助手。只输出简体中文的一句话描述，不超过 30 个字。',
        `网站名称：${title}\n网址：${url}`
      )
    } else if (body.action === 'categorize') {
      const categories = Array.isArray(body.categories)
        ? body.categories
            .slice(0, 200)
            .map(item => ({
              id: String(item.id || '').slice(0, 80),
              name: String(item.name || '').slice(0, 100),
            }))
            .filter(item => item.id && item.name)
        : []
      result = await complete(
        config,
        '你是分类助手。只输出最匹配的分类 id，不要输出其他文字。',
        `网站：${title}（${url}）\n分类：${categories.map(item => `${item.id}: ${item.name}`).join('\n')}`
      )
      const exact = categories.find(item => item.id === result)
      result = exact?.id || null
    } else {
      return jsonResponse({ error: 'Invalid action' }, 400, corsHeaders)
    }
    return jsonResponse({ result }, 200, { ...corsHeaders, 'Cache-Control': 'no-store' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 请求失败'
    return jsonResponse({ error: message }, /请先配置/.test(message) ? 400 : 502, corsHeaders)
  }
}

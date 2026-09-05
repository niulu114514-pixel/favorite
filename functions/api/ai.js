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
  return { ...config, ...selected, provider }
}

function endpointFor(config) {
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
    return `${base}/v1beta/models/${model}:generateContent`
  }
  if (provider === 'claude') return base.endsWith('/v1/messages') ? base : `${base}/v1/messages`
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
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
    if (!response.ok) throw new Error(`AI 服务请求失败（${response.status}）`)
    const data = await response.json()
    const text =
      active.provider === 'google'
        ? data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('')
        : active.provider === 'claude'
          ? data.content?.map(part => part.text || '').join('')
          : data.choices?.[0]?.message?.content
    return String(text || '').trim()
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

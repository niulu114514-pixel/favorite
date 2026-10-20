// 滚动信息条代理接口
// Mastodon / Memos 的数据源由服务端拉取，避免浏览器跨域限制；自定义内容直接走前端配置即可。
// 支持 EdgeOne Pages

import { getCorsHeaders, getKV, isPrivateHostname, jsonResponse } from './_kvAdapter.js'

function str(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// 该接口无需认证即可触发，且会把 memosToken 作为 Bearer 发往配置的 host。
// 因此只接受指向公网的 http(s) 地址，避免配置被写入内网地址后成为探测通道或凭据外泄点。
function safeBase(raw) {
  const candidate = str(raw)
  if (!candidate) return ''
  try {
    const parsed = new URL(candidate)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    if (isPrivateHostname(parsed.hostname)) return ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

async function readTickerConfig(kv) {
  const sectionStr = await kv.get('config:ticker')
  if (sectionStr) return JSON.parse(sectionStr)
  const configStr = await kv.get('config')
  const config = configStr ? JSON.parse(configStr) : {}
  return config.ticker || null
}

// RSS：正则解析（Workers 环境无 DOMParser），KV 缓存 5 分钟减少重复拉取
async function fetchRss(cfg, kv) {
  const raw = str(cfg.rssUrl)
  if (!raw) return { error: 'RSS 未配置订阅地址' }
  let base
  try {
    const parsed = new URL(raw)
    if (!/^https?:$/.test(parsed.protocol) || isPrivateHostname(parsed.hostname)) {
      return { error: 'RSS 地址无效（仅支持公网 http/https）' }
    }
    base = parsed.toString()
  } catch {
    return { error: 'RSS 地址无效' }
  }

  if (kv) {
    try {
      const cached = await kv.get('ticker_rss_cache')
      if (cached) {
        const data = JSON.parse(cached)
        if (data.url === base && data.at > Date.now() - 5 * 60 * 1000) {
          return { enabled: true, items: data.items }
        }
      }
    } catch {
      // 缓存异常时直接拉取
    }
  }

  let xml = ''
  try {
    const res = await fetch(base, {
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    })
    if (!res.ok) return { error: `RSS 拉取失败：${res.status}` }
    xml = await res.text()
  } catch {
    return { error: 'RSS 拉取失败' }
  }

  const items = []
  const itemRe = /<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi
  const titleRe = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i
  let match
  while ((match = itemRe.exec(xml)) && items.length < 10) {
    const t = titleRe.exec(match[0])
    if (t) {
      const text = stripHtml(t[1]).trim()
      if (text) items.push(text.slice(0, 120))
    }
  }
  if (!items.length) return { error: 'RSS 中没有可显示的条目' }

  if (kv) {
    try {
      await kv.put('ticker_rss_cache', JSON.stringify({ url: base, items, at: Date.now() }), {
        expirationTtl: 600,
      })
    } catch {
      // 缓存写入失败不影响本次展示
    }
  }
  return { enabled: true, items }
}

async function fetchMastodon(cfg) {
  const instance = str(cfg.mastodonInstance)
  const username = str(cfg.mastodonUsername)
  if (!instance || !username) return { error: 'Mastodon 未配置实例或账号' }
  const base = safeBase(instance)
  if (!base) return { error: 'Mastodon 实例地址无效（仅支持公网 http/https）' }
  const limit = Math.min(Number(cfg.mastodonLimit) || 10, 50)

  // 1. 解析账号
  const lookupUrl = `${base}/api/v1/accounts/lookup?acct=${encodeURIComponent(username.replace(/^@/, ''))}`
  const lookupRes = await fetch(lookupUrl, {
    headers: { Accept: 'application/json' },
  })
  if (!lookupRes.ok) {
    return { error: `Mastodon 账号查询失败：${lookupRes.status}` }
  }
  const account = await lookupRes.json()
  if (!account || !account.id) return { error: 'Mastodon 未找到该账号' }

  // 2. 拉取状态
  const params = new URLSearchParams({ limit: String(limit) })
  if (cfg.mastodonExcludeReplies) params.set('exclude_replies', 'true')
  if (cfg.mastodonExcludeReblogs) params.set('exclude_reblogs', 'true')
  const statusRes = await fetch(`${base}/api/v1/accounts/${account.id}/statuses?${params}`, {
    headers: { Accept: 'application/json' },
  })
  if (!statusRes.ok) return { error: `Mastodon 状态拉取失败：${statusRes.status}` }
  const statuses = await statusRes.json()
  const items = (Array.isArray(statuses) ? statuses : [])
    .filter(s => !s.reblog || !cfg.mastodonExcludeReblogs)
    .map(s => stripHtml(s.content))
    .filter(Boolean)
  if (!items.length) return { error: '暂无动态' }
  return { enabled: true, items }
}

async function fetchMemos(cfg) {
  const host = str(cfg.memosHost)
  if (!host) return { error: 'Memos 未配置 Host' }
  const base = safeBase(host)
  if (!base) return { error: 'Memos Host 地址无效（仅支持公网 http/https）' }
  const limit = Math.min(Number(cfg.memosLimit) || 10, 50)
  const params = new URLSearchParams({ limit: String(limit) })
  const visibility = str(cfg.memosVisibility) || 'PUBLIC'
  params.set('visibility', visibility)
  if (str(cfg.memosCreator)) params.set('creatorId', str(cfg.memosCreator))
  const headers = { Accept: 'application/json' }
  const token = str(cfg.memosToken)
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${base}/api/v1/memos?${params}`, { headers })
  if (!res.ok) return { error: `Memos 拉取失败：${res.status}` }
  const data = await res.json()
  const list = Array.isArray(data) ? data : []
  const items = list.map(m => stripHtml(m.content ?? m.contentHtml ?? '')).filter(Boolean)
  if (!items.length) return { error: '暂无动态' }
  return { enabled: true, items }
}

// 一言官方接口（hitokoto）。GET 随机返回一条，并行多取几次组成多条文案。
const YIYAN_ENDPOINT = 'https://v1.hitokoto.cn/?encode=json'
const YIYAN_COUNT = 8 // 随机取 8 条，让滚动条内容更丰富

async function fetchYiyan() {
  const tasks = Array.from({ length: YIYAN_COUNT }, async () => {
    try {
      const res = await fetch(YIYAN_ENDPOINT, { headers: { Accept: 'application/json' } })
      if (!res.ok) return null
      const data = await res.json()
      if (!data || typeof data.hitokoto !== 'string' || !data.hitokoto) return null
      const author = typeof data.from_who === 'string' && data.from_who ? data.from_who : ''
      const source = typeof data.from === 'string' && data.from ? data.from : ''
      return author || source ? `${data.hitokoto} —— ${author || source}` : data.hitokoto
    } catch {
      return null
    }
  })
  const raw = await Promise.all(tasks)
  const items = [...new Set(raw.filter(Boolean))]
  if (!items.length) return { error: '一言获取失败' }
  return { enabled: true, items }
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)
  }

  try {
    const kv = getKV(env)
    const cfg = (await readTickerConfig(kv)) || {}
    if (!cfg.enabled || !cfg.source) {
      return jsonResponse({ enabled: false }, 200, corsHeaders)
    }
    if (cfg.source === 'rss') {
      const result = await fetchRss(cfg, kv)
      return jsonResponse({ enabled: true, ...result }, 200, corsHeaders)
    }
    if (cfg.source === 'mastodon') {
      const result = await fetchMastodon(cfg)
      return jsonResponse({ enabled: true, ...result }, 200, corsHeaders)
    }
    if (cfg.source === 'memos') {
      const result = await fetchMemos(cfg)
      return jsonResponse({ enabled: true, ...result }, 200, corsHeaders)
    }
    if (cfg.source === 'yiyan') {
      const result = await fetchYiyan()
      return jsonResponse({ enabled: true, ...result }, 200, corsHeaders)
    }
    return jsonResponse({ enabled: false, error: '该数据源无需代理' }, 200, corsHeaders)
  } catch (err) {
    console.error('Ticker API error:', err)
    return jsonResponse({ enabled: true, error: '动态获取失败' }, 500, corsHeaders)
  }
}

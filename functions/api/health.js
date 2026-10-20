// 链接健康检查：管理员批量探测，结果存 KV 供全站角标展示。
import { getCorsHeaders, getKV, isHttpUrl, jsonResponse, verifyRequestAuth } from './_kvAdapter.js'

const MAX_URLS = 200
const CONCURRENCY = 5
const TIMEOUT_MS = 8000
const REPORT_KEY = 'health_report'
const REPORT_TTL_SECONDS = 7 * 24 * 60 * 60

async function checkOne(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; CloudNav-Health/1.0)',
    Accept: '*/*',
  }
  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers,
    })
    // 部分站点对 HEAD 返回 405/501，退回 GET 重试一次
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers })
    }
    return { url, ok: res.status < 400, status: res.status }
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return { url, ok: false, status: 0, error: aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** 并发固定为 5 的队列，避免对目标站点形成突发流量。 */
async function runBatch(urls) {
  const results = []
  const queue = [...urls]
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift()
      results.push(await checkOne(url))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker))
  return results
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const kv = getKV(env)

    // 公开读取最近一次报告：卡片角标需要未登录也能看到
    if (request.method === 'GET') {
      const raw = await kv.get(REPORT_KEY)
      let report = null
      if (raw) {
        try {
          report = JSON.parse(raw)
        } catch {
          report = null
        }
      }
      return jsonResponse({ report }, 200, {
        ...corsHeaders,
        'Cache-Control': 'no-store',
      })
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)
    }

    if (!(await verifyRequestAuth(request, env, kv))) {
      return jsonResponse({ error: '请先登录后再运行体检' }, 401, corsHeaders)
    }

    const body = await request.json().catch(() => ({}))
    const urls = [
      ...new Set(
        (Array.isArray(body.urls) ? body.urls : [])
          .filter(u => typeof u === 'string' && isHttpUrl(u))
          .map(u => u.trim())
      ),
    ].slice(0, MAX_URLS)
    if (!urls.length) {
      return jsonResponse({ error: '没有可检测的链接' }, 400, corsHeaders)
    }

    const results = await runBatch(urls)
    const report = {
      at: Date.now(),
      total: results.length,
      dead: results.filter(r => !r.ok).length,
      results,
    }
    await kv.put(REPORT_KEY, JSON.stringify(report), { expirationTtl: REPORT_TTL_SECONDS })

    return jsonResponse({ report }, 200, { ...corsHeaders, 'Cache-Control': 'no-store' })
  } catch (err) {
    console.error('Health API error:', err)
    return jsonResponse({ error: '健康检查执行失败' }, 500, corsHeaders)
  }
}

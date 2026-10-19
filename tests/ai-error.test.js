import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequest } from '../functions/api/ai.js'

function createEnv() {
  return {
    PASSWORD: 'admin-password',
    CLOUDNAV_KV: {
      async get(key) {
        return key === 'config:ai'
          ? JSON.stringify({
              provider: 'openai',
              apiKey: 'sk-test',
              baseUrl: 'https://gateway.example.com/v1',
              model: 'gpt-4o-mini',
            })
          : null
      },
    },
  }
}

function createRequest() {
  return new Request('https://cloudnav.test/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auth-password': 'admin-password' },
    body: JSON.stringify({ action: 'describe', title: 'A', url: 'https://a.example' }),
  })
}

test('上游返回 HTML 错误页时，不透传整页样式文本', async t => {
  const previousFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async () =>
    new Response(
      '<html><head><style>*{padding:0;margin:0}body{width:100vw;height:100vh}</style></head>' +
        '<body><div class="flex-display">Tencent EdgeOne</div></body></html>',
      { status: 504, headers: { 'content-type': 'text/html; charset=utf-8' } }
    )

  const response = await onRequest({ request: createRequest(), env: createEnv() })
  const payload = await response.json()

  assert.equal(response.status, 502)
  assert.ok(!payload.error.includes('padding'), '不应包含内联 CSS')
  assert.ok(!payload.error.includes('<style'), '不应包含 HTML 标签')
  assert.ok(payload.error.includes('504'), '应保留状态码便于排查')
  assert.ok(/HTML/.test(payload.error), '应说明上游返回的是 HTML')
})

test('上游返回 JSON 错误时仍保留其原始说明', async t => {
  const previousFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'model not found' } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })

  const response = await onRequest({ request: createRequest(), env: createEnv() })
  const payload = await response.json()
  assert.ok(payload.error.includes('model not found'), 'JSON 错误信息应原样带出')
})

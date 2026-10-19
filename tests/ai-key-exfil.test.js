import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequest } from '../functions/api/ai.js'

function createEnv(config) {
  return {
    PASSWORD: 'admin-password',
    CLOUDNAV_KV: {
      async get(key) {
        return key === 'config:ai' ? JSON.stringify(config) : null
      },
    },
  }
}

function createRequest(payload, password = 'admin-password') {
  return new Request('https://cloudnav.test/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auth-password': password },
    body: JSON.stringify(payload),
  })
}

const STORED = {
  provider: 'google',
  apiKey: 'AIza-stored-server-side-only',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-test',
}

test('请求侧 baseUrl 未附带 apiKey 时，不得把已存储的 key 发往该地址', async t => {
  const previousFetch = globalThis.fetch
  let calledUrl = ''
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async url => {
    calledUrl = String(url)
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  await onRequest({
    request: createRequest({
      action: 'describe',
      title: 'Example',
      url: 'https://example.com',
      config: { provider: 'google', baseUrl: 'https://attacker.example.net/v1beta' },
    }),
    env: createEnv(STORED),
  })

  assert.ok(calledUrl, '应当发起上游请求')
  assert.equal(
    calledUrl.includes('attacker.example.net'),
    false,
    '不应把已存储的 API Key 发往请求侧指定的 baseUrl'
  )
})

test('请求侧同时提供 apiKey 与 baseUrl 时允许自定义端点（设置页测试连通性）', async t => {
  const previousFetch = globalThis.fetch
  let calledUrl = ''
  let sentKey = ''
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async (url, init) => {
    calledUrl = String(url)
    sentKey = new Headers(init.headers).get('x-goog-api-key') || ''
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  await onRequest({
    request: createRequest({
      action: 'test',
      title: 'Example',
      url: 'https://example.com',
      config: {
        provider: 'google',
        baseUrl: 'https://gateway.example.com/v1beta',
        apiKey: 'AIza-user-typed-in-settings',
      },
    }),
    env: createEnv(STORED),
  })

  assert.ok(calledUrl.startsWith('https://gateway.example.com'), '自定义端点应生效')
  assert.equal(sentKey, 'AIza-user-typed-in-settings', '应使用请求侧显式提供的 key')
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { endpointFor, onRequest } from '../functions/api/ai.js'

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

function createAIRequest(payload) {
  return new Request('https://cloudnav.test/api/ai', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-auth-password': 'admin-password',
    },
    body: JSON.stringify(payload),
  })
}

test('AI endpoints accept base roots, version roots and complete operation URLs', () => {
  assert.equal(
    endpointFor({
      provider: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-test',
    }),
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent'
  )
  assert.equal(
    endpointFor({ provider: 'claude', baseUrl: 'https://api.anthropic.com/v1' }),
    'https://api.anthropic.com/v1/messages'
  )
  assert.equal(
    endpointFor({
      provider: 'openai',
      baseUrl: 'https://gateway.example.com/v1/chat/completions',
    }),
    'https://gateway.example.com/v1/chat/completions'
  )
})

test('Gemini 403 returns actionable details without exposing the API key', async t => {
  const apiKey = 'AIza-secret-key-that-must-never-be-returned'
  const previousFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async (url, init) => {
    assert.equal(
      String(url),
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent'
    )
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), apiKey)
    return new Response(
      JSON.stringify({
        error: {
          status: 'PERMISSION_DENIED',
          message: `API key ${apiKey} is not allowed to use this service`,
          details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }],
        },
      }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    )
  }

  const response = await onRequest({
    request: createAIRequest({ action: 'test', title: 'GitHub', url: 'https://github.com' }),
    env: createEnv({
      provider: 'google',
      apiKey,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-test',
      providers: {
        google: {
          apiKey: 'stale-key-from-an-older-version',
          baseUrl: 'https://old-gateway.example.com',
          model: 'stale-model',
        },
      },
    }),
  })
  const data = await response.json()

  assert.equal(response.status, 502)
  assert.match(data.error, /Google Gemini 拒绝请求（403）/)
  assert.match(data.error, /Authorization Key/)
  assert.match(data.error, /API_KEY_SERVICE_BLOCKED/)
  assert.doesNotMatch(data.error, new RegExp(apiKey))
})

test('OpenAI-compatible responses are returned through a complete custom endpoint', async t => {
  const previousFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://gateway.example.com/v1/chat/completions')
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-key')
    return Response.json({ choices: [{ message: { content: '代码托管与协作平台。' } }] })
  }

  const response = await onRequest({
    request: createAIRequest({ action: 'describe', title: 'GitHub', url: 'https://github.com' }),
    env: createEnv({
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://gateway.example.com/v1/chat/completions',
      model: 'compatible-model',
    }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { result: '代码托管与协作平台。' })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../functions/api/mcp-token.js'
import { MemoryKV } from './helpers.js'

function request(method, password) {
  return new Request('https://nav.example/api/mcp-token', {
    method,
    headers: { Authorization: `Bearer ${password}` },
  })
}

test('MCP tokens require admin auth and can be generated then revoked', async () => {
  const password = 'admin-password'
  const kv = new MemoryKV()
  const env = { CLOUDNAV_KV: kv, PASSWORD: password }

  const unauthorized = await onRequest({ request: request('POST', 'wrong'), env })
  assert.equal(unauthorized.status, 401)

  const created = await onRequest({ request: request('POST', password), env })
  const payload = await created.json()
  assert.match(payload.token, /^[a-f0-9]{64}$/)
  assert.equal(await kv.get(`mcp_token:${payload.token}`), 'valid')

  const status = await onRequest({ request: request('GET', password), env })
  assert.deepEqual(await status.json(), { configured: true })

  const revoked = await onRequest({ request: request('DELETE', password), env })
  assert.deepEqual(await revoked.json(), { revoked: true })
  assert.equal(await kv.get(`mcp_token:${payload.token}`), null)
})

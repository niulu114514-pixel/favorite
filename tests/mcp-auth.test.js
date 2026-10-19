import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyMcpRequestAuth, verifyRequestAuth } from '../functions/api/_kvAdapter.js'

function createKV() {
  const store = new Map()
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null
    },
    async put(key, value) {
      store.set(key, value)
    },
    async delete(key) {
      store.delete(key)
    },
  }
}

function authRequest(credential) {
  return new Request('https://cloudnav.test/api/mcp', {
    method: 'POST',
    headers: { 'x-auth-password': credential, 'cf-connecting-ip': '203.0.113.30' },
  })
}

const ENV = { PASSWORD: 'admin-password' }
const MCP_TOKEN = 'b'.repeat(64)
const SESSION_TOKEN = 'c'.repeat(64)

test('MCP 端点不接受明文管理员密码', async () => {
  const kv = createKV()
  assert.equal(await verifyMcpRequestAuth(authRequest('admin-password'), ENV, kv), false)
})

test('MCP 端点接受独立 MCP 令牌与会话令牌', async () => {
  const kv = createKV()
  await kv.put(`mcp_token:${MCP_TOKEN}`, 'valid')
  await kv.put(`auth_token:${SESSION_TOKEN}`, 'valid')

  assert.equal(await verifyMcpRequestAuth(authRequest(MCP_TOKEN), ENV, kv), true)
  assert.equal(await verifyMcpRequestAuth(authRequest(SESSION_TOKEN), ENV, kv), true)
})

test('普通接口仍可用密码认证，未受 MCP 策略影响', async () => {
  const kv = createKV()
  assert.equal(await verifyRequestAuth(authRequest('admin-password'), ENV, kv), true)
})

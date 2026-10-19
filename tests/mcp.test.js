import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../functions/api/mcp.js'
import { jsonRequest, MemoryKV } from './helpers.js'

function rpc(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }
}

test('MCP initializes with matching capabilities and rejects JSON-RPC batches', async () => {
  const env = { CLOUDNAV_KV: new MemoryKV() }
  const init = await onRequest({
    request: jsonRequest(
      'https://nav.example/api/mcp',
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
      })
    ),
    env,
  })
  const payload = await init.json()
  assert.equal(payload.result.protocolVersion, '2025-06-18')
  assert.deepEqual(Object.keys(payload.result.capabilities).sort(), [
    'prompts',
    'resources',
    'tools',
  ])

  const batch = await onRequest({
    request: jsonRequest('https://nav.example/api/mcp', [rpc('ping')]),
    env,
  })
  assert.equal((await batch.json()).error.code, -32600)
})

test('MCP resource responses use the protocol contents shape', async () => {
  const env = {
    CLOUDNAV_KV: new MemoryKV({
      cate_config: JSON.stringify([{ id: 'common', name: '常用推荐', icon: 'Star' }]),
    }),
  }
  const response = await onRequest({
    request: jsonRequest(
      'https://nav.example/api/mcp',
      rpc('resources/read', { uri: 'cloudnav://categories' })
    ),
    env,
  })
  const payload = await response.json()
  assert.equal(payload.result.contents[0].uri, 'cloudnav://categories')
  assert.equal(Array.isArray(JSON.parse(payload.result.contents[0].text)), true)
})

test('MCP blocks foreign browser origins', async () => {
  const response = await onRequest({
    request: jsonRequest('https://nav.example/api/mcp', rpc('ping'), {
      Origin: 'https://attacker.example',
    }),
    env: { CLOUDNAV_KV: new MemoryKV() },
  })
  assert.equal(response.status, 403)
})

test('delete_category removes its subtree and migrates all links', async () => {
  const token = 'a'.repeat(64)
  const kv = new MemoryKV({
    [`mcp_token:${token}`]: 'valid',
    cate_config: JSON.stringify([
      { id: 'common', name: '常用推荐', icon: 'Star' },
      { id: 'dev', name: '开发', icon: 'Code' },
      { id: 'frontend', name: '前端', icon: 'Box', parentId: 'dev' },
    ]),
    'links:dev': JSON.stringify([
      { id: '1', title: 'A', url: 'https://a.example', categoryId: 'dev' },
    ]),
    'links:frontend': JSON.stringify([
      { id: '2', title: 'B', url: 'https://b.example', categoryId: 'frontend' },
    ]),
  })
  const response = await onRequest({
    request: jsonRequest(
      'https://nav.example/api/mcp',
      rpc('tools/call', { name: 'delete_category', arguments: { id: 'dev' } }),
      { Authorization: `Bearer ${token}` }
    ),
    env: { CLOUDNAV_KV: kv },
  })
  const payload = await response.json()
  assert.deepEqual(payload.result.structuredContent.ids.sort(), ['dev', 'frontend'])
  assert.deepEqual(
    JSON.parse(await kv.get('cate_config')).map(item => item.id),
    ['common']
  )
  const migrated = JSON.parse(await kv.get('links:common'))
  assert.deepEqual(
    migrated.map(item => item.categoryId),
    ['common', 'common']
  )
})

test('MCP config updates preserve a stored secret when the submitted value is blank', async () => {
  const token = 'b'.repeat(64)
  const kv = new MemoryKV({
    [`mcp_token:${token}`]: 'valid',
    'config:ai': JSON.stringify({ provider: 'openai', apiKey: 'stored-secret' }),
  })
  const response = await onRequest({
    request: jsonRequest(
      'https://nav.example/api/mcp',
      rpc('tools/call', {
        name: 'update_config',
        arguments: { section: 'ai', value: { provider: 'google', apiKey: '' } },
      }),
      { Authorization: `Bearer ${token}` }
    ),
    env: { CLOUDNAV_KV: kv },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(await kv.get('config:ai')), {
    provider: 'google',
    apiKey: 'stored-secret',
  })
})

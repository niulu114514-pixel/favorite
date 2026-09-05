import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from '../functions/api/storage.js'
import { jsonRequest, MemoryKV } from './helpers.js'

test('bootstrap combines public data and redacts every stored secret', async () => {
  const kv = new MemoryKV({
    cate_config: JSON.stringify([{ id: 'common', name: '常用推荐', icon: 'Star' }]),
    'links:common': JSON.stringify([
      { id: '1', title: 'A', url: 'https://a.example', categoryId: 'common' },
    ]),
    'config:ai': JSON.stringify({ provider: 'google', apiKey: 'secret-key', model: 'gemini' }),
    'config:webdav': JSON.stringify({ url: 'https://dav.example', username: 'u', password: 'p' }),
  })
  const response = await onRequest({
    request: new Request('https://nav.example/api/storage?bootstrap=true'),
    env: { CLOUDNAV_KV: kv, PASSWORD: 'admin' },
  })
  const payload = await response.json()
  assert.equal(payload.links.length, 1)
  assert.equal(payload.config.ai.apiKey, undefined)
  assert.equal(payload.config.webdav.password, undefined)
  assert.equal(payload.auth.authenticated, false)
})

test('blank redacted fields preserve stored secrets when updating settings', async () => {
  const kv = new MemoryKV({
    'config:ai': JSON.stringify({ provider: 'google', apiKey: 'keep-me', model: 'old' }),
  })
  const response = await onRequest({
    request: jsonRequest(
      'https://nav.example/api/storage',
      { saveConfig: 'ai', config: { provider: 'google', apiKey: '', model: 'new' } },
      { Authorization: 'Bearer admin' }
    ),
    env: { CLOUDNAV_KV: kv, PASSWORD: 'admin' },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(await kv.get('config:ai')), {
    provider: 'google',
    apiKey: 'keep-me',
    model: 'new',
  })
})

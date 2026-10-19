import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequest } from '../functions/api/storage.js'
import { jsonRequest, MemoryKV } from './helpers.js'

class CountingKV extends MemoryKV {
  constructor(entries = {}) {
    super(entries)
    this.gets = []
    this.puts = []
    this.deletes = []
  }
  async get(key) {
    this.gets.push(key)
    return super.get(key)
  }
  async put(key, value, options) {
    this.puts.push(key)
    return super.put(key, value, options)
  }
  async delete(key) {
    this.deletes.push(key)
    return super.delete(key)
  }
}

const SECTIONS = ['ai', 'website', 'mastodon', 'weather', 'ticker', 'search', 'icon', 'view', 'ui', 'webdav', 'background']

test('bootstrap 命中聚合缓存时不再逐个读取 config 分段', async () => {
  const aggregated = { ai: { provider: 'google', apiKey: 'k' }, ui: { showPinnedWebsites: true } }
  const kv = new CountingKV({
    cate_config: JSON.stringify([{ id: 'common', name: '常用', icon: 'Star' }]),
    'links:common': JSON.stringify([]),
    config_all: JSON.stringify(aggregated),
  })

  await onRequest({
    request: new Request('https://nav.example/api/storage?bootstrap=true'),
    env: { CLOUDNAV_KV: kv, PASSWORD: 'admin' },
  })

  const sectionReads = kv.gets.filter(k => SECTIONS.some(s => k === `config:${s}`))
  assert.equal(sectionReads.length, 0, '不应再读 config:<section>')
  assert.ok(kv.gets.includes('config_all'), '应读取聚合 key')
})

test('保存链接时只写入内容真正变化的分类', async () => {
  const common = [{ id: '1', title: 'A', url: 'https://a.example', categoryId: 'common' }]
  const work = [{ id: '2', title: 'B', url: 'https://b.example', categoryId: 'work' }]
  const kv = new CountingKV({
    cate_config: JSON.stringify([
      { id: 'common', name: '常用', icon: 'Star' },
      { id: 'work', name: '工作', icon: 'Briefcase' },
    ]),
    'links:common': JSON.stringify(common),
    'links:work': JSON.stringify(work),
  })

  const changed = [{ id: '1', title: 'A2', url: 'https://a.example', categoryId: 'common' }]
  const response = await onRequest({
    request: jsonRequest(
      'https://nav.example/api/storage',
      { saveConfig: 'links', links: [...changed, ...work] },
      { Authorization: 'Bearer admin' }
    ),
    env: { CLOUDNAV_KV: kv, PASSWORD: 'admin' },
  })
  assert.equal(response.status, 200)

  const linkWrites = kv.puts.filter(k => k.startsWith('links:'))
  assert.deepEqual(linkWrites, ['links:common'], '只有 common 发生变化，不应重写 work')
})

test('未变化的分类不会产生写操作', async () => {
  const common = [{ id: '1', title: 'A', url: 'https://a.example', categoryId: 'common' }]
  const kv = new CountingKV({
    cate_config: JSON.stringify([{ id: 'common', name: '常用', icon: 'Star' }]),
    'links:common': JSON.stringify(common),
  })

  await onRequest({
    request: jsonRequest(
      'https://nav.example/api/storage',
      { saveConfig: 'links', links: common },
      { Authorization: 'Bearer admin' }
    ),
    env: { CLOUDNAV_KV: kv, PASSWORD: 'admin' },
  })

  const linkWrites = kv.puts.filter(k => k.startsWith('links:'))
  assert.equal(linkWrites.length, 0, '内容一致时不应写入')
})

test('写入配置后重建聚合 key', async () => {
  const kv = new CountingKV({
    'config:ai': JSON.stringify({ provider: 'google', apiKey: 'keep' }),
  })

  await onRequest({
    request: jsonRequest(
      'https://nav.example/api/storage',
      { saveConfig: 'ui', config: { showPinnedWebsites: false } },
      { Authorization: 'Bearer admin' }
    ),
    env: { CLOUDNAV_KV: kv, PASSWORD: 'admin' },
  })

  assert.ok(kv.puts.includes('config_all'), '写入后应重建聚合')
  const aggregate = JSON.parse(await kv.get('config_all'))
  assert.equal(aggregate.ai.apiKey, 'keep')
  assert.equal(aggregate.ui.showPinnedWebsites, false)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBookmarksHtml } from '../src/utils/bookmarkExport.ts'
import { onRequest } from '../functions/api/health.js'

const CATEGORIES = [
  { id: 'common', name: '常用推荐', icon: 'Star' },
  { id: 'work', name: '工作', icon: 'Briefcase' },
  { id: 'sub', name: '子分类', icon: 'Box', parentId: 'work' },
]

const LINKS = [
  {
    id: '1',
    title: 'GitHub & More <测试>',
    url: 'https://github.com',
    categoryId: 'common',
    createdAt: 1690000000000,
  },
  { id: '2', title: '内部工具', url: 'https://tools.example.com', categoryId: 'work' },
  { id: '3', title: '孤儿链接', url: 'https://orphan.example.com', categoryId: 'gone' },
]

test('书签导出：按分类组织、转义特殊字符、孤儿链接有兜底', () => {
  const html = buildBookmarksHtml(LINKS, CATEGORIES)

  assert.ok(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'), '应为 Netscape 格式')
  assert.ok(html.includes('<H3>常用推荐</H3>'), '一级分类应为文件夹')
  assert.ok(html.includes('<H3>工作</H3>'), '二级分类应嵌套')
  assert.ok(
    html.includes('<A HREF="https://github.com" ADD_DATE="1690000000">GitHub &amp; More &lt;测试&gt;</A>'),
    'URL 与标题应转义并带 ADD_DATE'
  )
  assert.ok(html.includes('<A HREF="https://orphan.example.com"'), '孤儿链接应保留')

  const open = (html.match(/<DL><p>/g) || []).length
  const close = (html.match(/<\/DL><p>/g) || []).length
  assert.equal(open, close, 'DL 标签应成对闭合')
})

function createEnv() {
  const store = new Map()
  return {
    PASSWORD: 'admin-password',
    CLOUDNAV_KV: {
      async get(key) {
        return store.has(key) ? store.get(key) : null
      },
      async put(key, value) {
        store.set(key, value)
      },
      async delete(key) {
        store.delete(key)
      },
    },
  }
}

function postRequest(payload, password = 'admin-password') {
  return new Request('https://cloudnav.test/api/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auth-password': password },
    body: JSON.stringify(payload),
  })
}

test('健康检查：需要认证、过滤非法 URL、结果写入 KV', async t => {
  const previousFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async (url, init) => {
    const ok = String(url).includes('good')
    return new Response(null, { status: ok ? 200 : 500 })
  }

  const env = createEnv()
  const { onRequest } = await import('../functions/api/health.js')

  const denied = await onRequest({ request: postRequest({ urls: ['https://a.example'] }, 'wrong'), env })
  assert.equal(denied.status, 401, '未认证应拒绝')

  const response = await onRequest({
    request: postRequest({
      urls: ['https://good.example.com', 'javascript:alert(1)', 'https://bad.example.com'],
    }),
    env,
  })
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.report.total, 2, '非 http(s) 的 URL 应被过滤')
  assert.equal(data.report.dead, 1)

  const stored = JSON.parse(await env.CLOUDNAV_KV.get('health_report'))
  assert.equal(stored.total, 2)
  assert.equal(stored.results[0].ok, true)
})

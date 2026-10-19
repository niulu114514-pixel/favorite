import assert from 'node:assert/strict'
import test from 'node:test'

import { extractSiteTitle, onRequest } from '../functions/api/metadata.js'

const env = {
  PASSWORD: 'test-password',
  CLOUDNAV_KV: {
    async get() {
      return null
    },
  },
}

test('extractSiteTitle prioritizes site name and decodes entities', () => {
  const html = `
    <html><head>
      <title>Fallback title</title>
      <meta content="Cloud &amp; Navigation" property="og:site_name">
    </head></html>
  `
  assert.equal(extractSiteTitle(html, 'example.com'), 'Cloud & Navigation')
})

test('metadata endpoint returns title, final domain and cached icon URL', async t => {
  const previousFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = previousFetch
  })
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://example.com/')
    return new Response('<html><head><title>Example Domain</title></head></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  const request = new Request('https://cloudnav.test/api/metadata?url=https%3A%2F%2Fexample.com', {
    headers: { 'x-auth-password': 'test-password' },
  })
  const response = await onRequest({ request, env })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    title: 'Example Domain',
    url: 'https://example.com/',
    domain: 'example.com',
    icon: '/api/favicon?domain=example.com',
  })
})

test('metadata endpoint rejects private network targets', async () => {
  const request = new Request(
    'https://cloudnav.test/api/metadata?url=https%3A%2F%2Flocalhost%2Fprivate',
    { headers: { 'x-auth-password': 'test-password' } }
  )
  const response = await onRequest({ request, env })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /公开的 HTTPS/)
})

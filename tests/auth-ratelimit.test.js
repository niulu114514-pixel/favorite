import assert from 'node:assert/strict'
import test from 'node:test'

import { verifyRequestAuth } from '../functions/api/_kvAdapter.js'

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

function createEnv() {
  return { PASSWORD: 'correct-horse-battery-staple' }
}

function authRequest(credential, ip = '203.0.113.7') {
  return new Request('https://cloudnav.test/api/storage', {
    method: 'POST',
    headers: { 'x-auth-password': credential, 'cf-connecting-ip': ip },
  })
}

test('连续失败达到阈值后，即使密码正确也不再放行', async () => {
  const kv = createKV()
  const env = createEnv()

  for (let i = 0; i < 10; i += 1) {
    assert.equal(await verifyRequestAuth(authRequest(`wrong-${i}`), env, kv), false)
  }

  // 第 11 次改用正确密码，应仍被限流挡住。
  assert.equal(await verifyRequestAuth(authRequest('correct-horse-battery-staple'), env, kv), false)
})

test('限流按来源 IP 独立计算，不影响其他客户端', async () => {
  const kv = createKV()
  const env = createEnv()

  for (let i = 0; i < 10; i += 1) {
    await verifyRequestAuth(authRequest(`wrong-${i}`, '198.51.100.9'), env, kv)
  }

  assert.equal(
    await verifyRequestAuth(
      authRequest('correct-horse-battery-staple', '198.51.100.9'),
      env,
      kv
    ),
    false,
    '同一来源应被限流'
  )

  assert.equal(
    await verifyRequestAuth(
      authRequest('correct-horse-battery-staple', '192.0.2.44'),
      env,
      kv
    ),
    true,
    '其他来源不应受影响'
  )
})

test('64 位十六进制令牌不受密码限流影响', async () => {
  const kv = createKV()
  const env = createEnv()
  const token = 'a'.repeat(64)
  await kv.put(`auth_token:${token}`, 'valid')

  // 先把该 IP 的密码失败次数打满。
  for (let i = 0; i < 10; i += 1) {
    await verifyRequestAuth(authRequest(`wrong-${i}`), env, kv)
  }

  assert.equal(
    await verifyRequestAuth(authRequest(token), env, kv),
    true,
    '令牌认证不应被密码失败计数拖累'
  )
})

test('认证成功后清空该来源的失败计数', async () => {
  const kv = createKV()
  const env = createEnv()

  for (let i = 0; i < 5; i += 1) {
    await verifyRequestAuth(authRequest(`wrong-${i}`), env, kv)
  }

  assert.equal(await verifyRequestAuth(authRequest('correct-horse-battery-staple'), env, kv), true)
  assert.equal(await kv.get('auth_fail:203.0.113.7'), null, '成功一次应重置计数')
})

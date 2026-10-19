import {
  MAX_TOKEN_TTL_SECONDS,
  getCorsHeaders,
  getKV,
  jsonResponse,
  verifyRequestAuth,
} from './_kvAdapter.js'

function generateSecureToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
}

export async function onRequest(context) {
  const { request, env } = context
  const headers = { ...getCorsHeaders(env), 'Cache-Control': 'no-store' }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  try {
    const kv = getKV(env)
    if (!(await verifyRequestAuth(request, env, kv))) {
      return jsonResponse({ error: 'Unauthorized' }, 401, headers)
    }
    const previous = await kv.get('last_mcp_token')
    if (request.method === 'GET') {
      return jsonResponse({ configured: Boolean(previous) }, 200, headers)
    }
    if (request.method === 'DELETE') {
      if (previous) await kv.delete(`mcp_token:${previous}`)
      await kv.delete('last_mcp_token')
      return jsonResponse({ revoked: true }, 200, headers)
    }
    if (request.method !== 'POST')
      return jsonResponse({ error: 'Method Not Allowed' }, 405, headers)
    if (previous) await kv.delete(`mcp_token:${previous}`)
    const token = generateSecureToken()
    const options = { expirationTtl: MAX_TOKEN_TTL_SECONDS }
    await Promise.all([
      kv.put(`mcp_token:${token}`, 'valid', options),
      kv.put('last_mcp_token', token, options),
    ])
    return jsonResponse({ token, expiresIn: MAX_TOKEN_TTL_SECONDS }, 200, headers)
  } catch {
    return jsonResponse({ error: 'MCP token operation failed' }, 500, headers)
  }
}

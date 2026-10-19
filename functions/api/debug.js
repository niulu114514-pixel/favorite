// 调试接口（需要认证）
// 支持 EdgeOne Pages

import { getCorsHeaders, getKV, jsonResponse, verifyRequestAuth } from './_kvAdapter.js'

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const kv = getKV(env)
  const isAuthenticated = await verifyRequestAuth(request, env, kv)

  if (!isAuthenticated) {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders)
  }

  const result = {
    message: 'Debug Info',
    envKeys: {},
    kvStatus: 'Unknown',
  }

  try {
    if (env) {
      for (const key in env) {
        result.envKeys[key] = typeof env[key] === 'string' ? 'String (Hidden)' : typeof env[key]
      }
    }

    try {
      await kv.get('__ping__')
      result.kvStatus = 'OK'
    } catch (e) {
      result.kvStatus = 'Error'
    }

    return jsonResponse(result, 200, corsHeaders)
  } catch (e) {
    console.error('Debug API error:', e)
    return jsonResponse({ error: 'Debug request failed' }, 500, corsHeaders)
  }
}

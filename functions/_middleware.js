// 全局安全响应头
// EdgeOne Pages 约定：functions/_middleware.js 对所有请求生效。
// 只处理页面与静态资源；/api/ 由各函数自行设置头部，避免重建响应时丢失 Set-Cookie。

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // 与 index.html 中的 meta CSP 保持一致，但 header 优先级更高且支持 frame-ancestors。
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https:",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
}

export async function onRequest(context) {
  const response = await context.next()
  try {
    const url = new URL(context.request.url)
    // 接口响应由各自函数控制头部，这里跳过以免重建 Response 时影响 Set-Cookie。
    if (url.pathname.startsWith('/api/')) return response

    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!headers.has(name)) headers.set(name, value)
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } catch {
    // 任何异常都不应影响正常响应。
    return response
  }
}

/** Return a safe http(s) href for a user-supplied URL. */
export function safeTargetUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.href
      : `${window.location.origin}/`
  } catch {
    return `${window.location.origin}/`
  }
}

/**
 * 卡片副标题：优先用描述，没有描述时回退到去协议的域名。
 * 直接渲染 link.url 会把 `https://xxx.com/` 原样显示出来，视觉上是噪音。
 */
export function linkSubtitle(link: { description?: string; url: string }): string {
  const description = (link.description || '').trim()
  if (description) return description
  try {
    const parsed = new URL(/^https?:\/\//i.test(link.url) ? link.url : `https://${link.url}`)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

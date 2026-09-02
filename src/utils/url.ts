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
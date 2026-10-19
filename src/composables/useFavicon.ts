import type { LinkItem } from '../../types'

// Module-level cache keeps favicon lookups cheap across components.
const faviconCache = new Map<string, string>()

export function favicon(link: LinkItem): string {
  const cacheKey = `${link.id}:${link.icon || ''}:${link.url}`
  const cached = faviconCache.get(cacheKey)
  if (cached) return cached
  if (link.icon) {
    faviconCache.set(cacheKey, link.icon)
    return link.icon
  }
  try {
    const source = `/api/favicon?domain=${encodeURIComponent(new URL(link.url).hostname)}`
    faviconCache.set(cacheKey, source)
    return source
  } catch {
    return '/favicon.ico'
  }
}

// 主图标与网络兜底都失败时，用站点首字母生成一张本地 SVG。
// 比空白灰块或虚线框更完整，且完全不依赖外部请求。
const INITIAL_RADIUS = 10

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function hueFromSeed(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360
  }
  return hash
}

/** 由标题首字与域名色相生成占位图标。 */
export function initialIconUrl(link: LinkItem): string {
  let host = ''
  try {
    host = new URL(/^https?:\/\//i.test(link.url) ? link.url : `https://${link.url}`).hostname
  } catch {
    host = ''
  }
  const source = host || link.title || '?'
  const letter = (link.title || host || '?').trim().charAt(0).toUpperCase() || '?'
  const hue = hueFromSeed(source)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
    `<rect width="40" height="40" rx="${INITIAL_RADIUS}" fill="hsl(${hue} 68% 93%)"/>` +
    `<text x="20" y="21" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" ` +
    `font-size="17" font-weight="600" fill="hsl(${hue} 52% 42%)" ` +
    `text-anchor="middle" dominant-baseline="middle">${escapeXml(letter)}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** 站内图标代理地址：统一走 /api/favicon，由服务端做抓取与多源兜底。 */
function domainProxyUrl(link: LinkItem): string {
  try {
    const host = new URL(/^https?:\/\//i.test(link.url) ? link.url : `https://${link.url}`).hostname
    return `/api/favicon?domain=${encodeURIComponent(host)}`
  } catch {
    return '/favicon.ico'
  }
}

export function handleFaviconError(event: Event, link: LinkItem) {
  const image = event.target as HTMLImageElement
  const current = image.getAttribute('src') || ''

  // 部分链接的 icon 字段存的是第三方外链，失效后不会自动恢复。
  // 先回退到站内代理（服务端会试站点自身图标、Google S2 与 faviconextractor），
  // 代理也失败时才用本地首字母图标。
  if (!current.startsWith('/api/favicon')) {
    image.src = domainProxyUrl(link)
    return
  }

  image.src = initialIconUrl(link)
  image.style.background = 'transparent'
}

import type { LinkItem } from '../../types'
import { fallbackIconUrl } from '../services/iconService'

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

// Transparent, neutral placeholder used when both the primary icon and its
// fallback fail to load — avoids exposing the white/grey image background.
const BROKEN_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect x="1" y="1" width="38" height="38" rx="10" fill="none" stroke="rgba(130,140,160,0.4)" stroke-width="1.5" stroke-dasharray="4 3"/></svg>`
)}`

export function handleFaviconError(event: Event, link: LinkItem) {
  const image = event.target as HTMLImageElement
  const fallback = fallbackIconUrl(link.url)
  if (image.src !== new URL(fallback, window.location.origin).href) {
    image.src = fallback
  } else {
    // The fallback also failed: switch to a transparent placeholder so no
    // white/grey box shows behind the icon.
    image.src = BROKEN_ICON
    image.style.background = 'transparent'
  }
}

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

export function handleFaviconError(event: Event, link: LinkItem) {
  const image = event.target as HTMLImageElement
  const fallback = fallbackIconUrl(link.url)
  if (image.src !== new URL(fallback, window.location.origin).href) image.src = fallback
}
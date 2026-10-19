import type { IconConfig } from '../../types'

export const DEFAULT_ICON_CONFIG: IconConfig = {
  source: 'google',
  cacheEnabled: true,
  faviconextractor: { enabled: true },
  google: { enabled: true },
}

function hostname(url: string) {
  return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname
}

/** Return an icon URL using the configured provider. The EdgeOne endpoint caches icons at the edge. */
export async function getIconUrl(
  url: string,
  config: IconConfig = DEFAULT_ICON_CONFIG
): Promise<string> {
  const domain = hostname(url)
  if (config.cacheEnabled !== false && config.source === 'google') {
    return `/api/favicon?domain=${encodeURIComponent(domain)}`
  }
  if (config.source === 'faviconextractor') {
    return `https://www.faviconextractor.com/favicon/${domain}?larger=true`
  }
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
}

export function fallbackIconUrl(url: string) {
  try {
    return `https://www.google.com/s2/favicons?domain=${hostname(url)}&sz=64`
  } catch {
    return '/favicon.ico'
  }
}

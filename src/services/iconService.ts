import type { IconConfig } from '../../types'

export const DEFAULT_ICON_CONFIG: IconConfig = {
  source: 'google',
  cacheEnabled: true,
  faviconextractor: { enabled: true },
  google: { enabled: true },
  customapi: { enabled: false, url: '', headers: {} },
  customurl: { enabled: false, url: '' },
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
  if (config.source === 'customurl' && config.customurl?.url) {
    return config.customurl.url
      .replace('{domain}', domain)
      .replace('{url}', encodeURIComponent(url))
  }
  if (config.source === 'customapi' && config.customapi?.url) {
    const response = await fetch(config.customapi.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(config.customapi.headers || {}) },
      body: JSON.stringify({ url }),
    })
    if (!response.ok) throw new Error(`Icon API returned ${response.status}`)
    const data = await response.json()
    return (
      data.iconUrl ||
      data.url ||
      data.favicon ||
      `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    )
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

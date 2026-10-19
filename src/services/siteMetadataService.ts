export interface SiteMetadata {
  title: string
  url: string
  domain: string
  icon: string
}

export async function fetchSiteMetadata(url: string, signal?: AbortSignal): Promise<SiteMetadata> {
  const response = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `网站识别失败（${response.status}）`)
  if (!data.title || !data.domain || !data.icon) throw new Error('网站返回的信息不完整')
  return data as SiteMetadata
}

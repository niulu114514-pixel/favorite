import type { AIConfig, Category } from '../../types'

type AIRequestOptions = {
  token?: string
}

async function requestAI(payload: Record<string, unknown>, options: AIRequestOptions = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token && options.token !== 'session') headers['x-auth-password'] = options.token
  const response = await fetch('/api/ai', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `AI 请求失败（${response.status}）`)
  return typeof data.result === 'string' ? data.result.trim() : null
}

export function generateLinkDescription(title: string, url: string, options?: AIRequestOptions) {
  return requestAI({ action: 'describe', title, url }, options)
}

export function testAIConfig(
  title: string,
  url: string,
  config: AIConfig,
  options?: AIRequestOptions
) {
  return requestAI({ action: 'test', title, url, config }, options)
}

export async function suggestCategory(
  title: string,
  url: string,
  categories: Category[],
  options?: AIRequestOptions
) {
  const result = await requestAI(
    {
      action: 'categorize',
      title,
      url,
      categories: categories.map(({ id, name }) => ({ id, name })),
    },
    options
  )
  return categories.some(item => item.id === result) ? result : null
}

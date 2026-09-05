import type { AIConfig, Category } from '../../types'

async function requestAI(payload: Record<string, unknown>) {
  const response = await fetch('/api/ai', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `AI 请求失败（${response.status}）`)
  return typeof data.result === 'string' ? data.result.trim() : null
}

export function generateLinkDescription(title: string, url: string) {
  return requestAI({ action: 'describe', title, url })
}

export function testAIConfig(title: string, url: string, config: AIConfig) {
  return requestAI({ action: 'test', title, url, config })
}

export async function suggestCategory(title: string, url: string, categories: Category[]) {
  const result = await requestAI({
    action: 'categorize',
    title,
    url,
    categories: categories.map(({ id, name }) => ({ id, name })),
  })
  return categories.some(item => item.id === result) ? result : null
}

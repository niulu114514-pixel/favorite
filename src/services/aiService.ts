import type { AIConfig, Category } from '../../types'

function endpoint(config: AIConfig) {
  let base = (config.baseUrl || '').replace(/\/$/, '')
  if (!base)
    base = config.provider === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
  if (config.provider === 'claude')
    return base.includes('/v1/messages') ? base : `${base}/v1/messages`
  return base.includes('/chat/completions') ? base : `${base}/chat/completions`
}

async function complete(config: AIConfig, system: string, prompt: string) {
  if (!config.apiKey) throw new Error('请先在设置中配置 AI API Key')
  if (config.provider === 'google') {
    const model = config.model || 'gemini-2.0-flash'
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${system}\n${prompt}` }] }],
        }),
      }
    )
    if (!response.ok) throw new Error(`Gemini API returned ${response.status}`)
    const data = await response.json()
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text || '')
        .join('')
        .trim() || ''
    )
  }
  const body =
    config.provider === 'claude'
      ? {
          model: config.model || 'claude-3-5-sonnet-latest',
          max_tokens: 200,
          system,
          messages: [{ role: 'user', content: prompt }],
        }
      : {
          model: config.model || 'gpt-4o-mini',
          temperature: 0.4,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  }
  if (config.provider === 'claude') {
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
  }
  const response = await fetch(endpoint(config), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`AI API returned ${response.status}`)
  const data = await response.json()
  return (
    (config.provider === 'claude'
      ? data.content?.[0]?.text
      : data.choices?.[0]?.message?.content
    )?.trim() || ''
  )
}

export function generateLinkDescription(title: string, url: string, config: AIConfig) {
  return complete(
    config,
    '你是书签助手。只输出简体中文的一句话描述，不超过 30 个字。',
    `网站名称：${title}\n网址：${url}`
  )
}

export async function suggestCategory(
  title: string,
  url: string,
  categories: Category[],
  config: AIConfig
) {
  const result = await complete(
    config,
    '你是分类助手。只输出最匹配的分类 id，不要输出其他文字。',
    `网站：${title}（${url}）\n分类：${categories.map(item => `${item.id}: ${item.name}`).join('\n')}`
  )
  return categories.some(item => item.id === result) ? result : null
}

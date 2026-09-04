import { computed, ref, watch } from 'vue'
import type { TickerConfig } from '../../types'

/**
 * 滚动信息条：Mastodon / Memos 动态经服务端 /api/ticker 代理取回，
 * 自定义内容直接来自本地配置（多行文本按行拆分）。
 */
export interface TickerData {
  enabled: boolean
  items?: string[]
  error?: string
}

const REQUEST_TIMEOUT = 6000

function fetchTicker(): Promise<TickerData> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  return fetch('/api/ticker', { credentials: 'include', signal: controller.signal })
    .then(async res => {
      if (!res.ok) return { enabled: true, error: `请求失败（${res.status}）` }
      return (await res.json()) as TickerData
    })
    .catch(() => ({ enabled: true, error: '网络异常' }))
    .finally(() => window.clearTimeout(timer))
}

export function useTicker(config: { ticker: TickerConfig }) {
  const remote = ref<TickerData>({ enabled: false })
  const loading = ref(false)

  const items = computed<string[]>(() => {
    const cfg = config.ticker
    if (!cfg || !cfg.enabled) return []
    if (cfg.source === 'custom') {
      return (cfg.customItems || []).filter(Boolean)
    }
    return remote.value.items || []
  })

  async function load() {
    const cfg = config.ticker
    if (!cfg || !cfg.enabled) {
      remote.value = { enabled: false }
      return
    }
    loading.value = true
    remote.value = await fetchTicker()
    loading.value = false
  }

  watch(
    () => [config.ticker?.enabled, config.ticker?.source],
    () => {
      if (config.ticker?.enabled && config.ticker.source !== 'custom') void load()
      else remote.value = { enabled: false }
    },
    { immediate: true }
  )

  function stopAll() {}

  return { items, loading, refresh: load, stopAll }
}
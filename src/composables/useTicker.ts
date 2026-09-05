import { computed, ref, watch } from 'vue'
import type { TickerConfig } from '../../types'

/**
 * 滚动信息条：Mastodon / Memos / 每日一言 动态经服务端 /api/ticker 代理取回，
 * 自定义内容直接来自本地配置（多行文本按行拆分）。
 */
export interface TickerData {
  enabled: boolean
  items?: string[]
  error?: string
}

// 可观察的 ticker 配置来源：传入整个响应式配置对象，内部通过 computed
// 实时读取最新的 .ticker 值，从而兼容“整体替换”与“原地修改”两种更新方式。
export interface TickerConfigSource {
  ticker?: TickerConfig
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

export function useTicker(config: TickerConfigSource) {
  const remote = ref<TickerData>({ enabled: false })
  const loading = ref(false)

  const ticker = computed<TickerConfig>(() => (config.ticker || { enabled: false }) as TickerConfig)

  const items = computed<string[]>(() => {
    const cfg = ticker.value
    if (!cfg || !cfg.enabled) return []
    if (cfg.source === 'custom') {
      return (cfg.customItems || []).filter(Boolean)
    }
    return remote.value.items || []
  })

  async function load() {
    const cfg = ticker.value
    if (!cfg || !cfg.enabled) {
      remote.value = { enabled: false }
      return
    }
    loading.value = true
    remote.value = await fetchTicker()
    loading.value = false
  }

  watch(
    () => [ticker.value?.enabled, ticker.value?.source],
    () => {
      if (ticker.value?.enabled && ticker.value.source !== 'custom') void load()
      else remote.value = { enabled: false }
    },
    { immediate: true }
  )

  function stopAll() {}

  return { items, loading, refresh: load, stopAll }
}
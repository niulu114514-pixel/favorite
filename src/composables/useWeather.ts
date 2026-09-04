import { ref, watch } from 'vue'
import type { WeatherConfig } from '../../types'

/**
 * 天气挂件：根据后台天气配置，经服务端 /api/weather 代理取回当前天气。
 * Key 不出浏览器；本地仅持有是否启用/源/单位等公开信息。
 * 已启用且取数失败时，指数退避自动重试；禁用或未配置时静默。
 */
export interface WeatherData {
  enabled: boolean
  temp?: number
  text?: string
  unit?: string
  location?: string
  source?: string
  error?: string
}

const REQUEST_TIMEOUT = 6000
let inflight: Promise<WeatherData> | null = null

function fetchWeather(): Promise<WeatherData> {
  if (inflight) return inflight
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  inflight = fetch('/api/weather', { credentials: 'include', signal: controller.signal })
    .then(async res => {
      if (!res.ok) return { enabled: true, error: `请求失败（${res.status}）` }
      return (await res.json()) as WeatherData
    })
    .catch(() => ({ enabled: true, error: '网络异常' }))
    .finally(() => {
      window.clearTimeout(timer)
      inflight = null
    })
  return inflight
}

export function useWeather(config: { weather: WeatherConfig }) {
  const data = ref<WeatherData>({ enabled: false })
  const loading = ref(false)
  let retryTimer: number | undefined
  let retries = 0
  const MAX_RETRIES = 2
  const RETRY_DELAY = 1500

  function clearRetry() {
    if (retryTimer != null) {
      window.clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }

  async function load() {
    const cfg = config.weather
    if (!cfg || !cfg.enabled) {
      clearRetry()
      data.value = { enabled: false }
      retries = 0
      return
    }
    loading.value = true
    const result = await fetchWeather()
    loading.value = false
    data.value = result
    if (result.error && retries < MAX_RETRIES) {
      retries += 1
      clearRetry()
      retryTimer = window.setTimeout(load, RETRY_DELAY * retries)
    } else if (!result.error) {
      retries = 0
    }
  }

  // 配置变化（含启用/源切换）时重新拉取
  watch(
    () => config.weather,
    () => load(),
    { immediate: true }
  )

  function stopAll() {
    clearRetry()
  }

  return { data, loading, refresh: load, stopAll }
}
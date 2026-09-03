import { ref } from 'vue'
import type { BackgroundConfig } from '../../types'
import { DEFAULT_BACKGROUND_CONFIG } from '../../types'

/**
 * 随机背景管理：根据后台背景配置异步预加载随机图片，
 * 加载成功后再渲染到背景层（避免闪烁）。
 */
export function useRandomBackground() {
  const imageUrl = ref('')
  const loading = ref(false)
  const error = ref('')
  let current: BackgroundConfig = { ...DEFAULT_BACKGROUND_CONFIG }
  let timer: ReturnType<typeof setInterval> | undefined

  /** 依据来源构造成最终可加载的图片地址，并附带时间戳绕开缓存以取新图 */
  function buildSrc(cfg: BackgroundConfig, ts: number) {
    let url =
      cfg.source === 'custom' && cfg.customUrl?.trim()
        ? cfg.customUrl.trim()
        : cfg.apiUrl.trim()
    if (cfg.source === 'loli' && cfg.id && /^\d{1,6}$/.test(cfg.id)) {
      url += (url.includes('?') ? '&' : '?') + 'id=' + cfg.id
    }
    url += (url.includes('?') ? '&' : '?') + 't=' + ts
    return url
  }

  function load(src: string) {
    loading.value = true
    error.value = ''
    const img = new Image()
    img.onload = () => {
      imageUrl.value = src
      loading.value = false
    }
    img.onerror = () => {
      error.value = '背景加载失败，请检查图片地址'
      loading.value = false
    }
    img.src = src
  }

  function apply(cfg: BackgroundConfig) {
    current = { ...cfg }
    stopAuto()
    if (!current.enabled) {
      imageUrl.value = ''
      loading.value = false
      error.value = ''
      return
    }
    load(buildSrc(current, Date.now()))
    if (current.autoRefreshMin > 0) {
      timer = setInterval(
        () => load(buildSrc(current, Date.now())),
        current.autoRefreshMin * 60 * 1000
      )
    }
  }

  /** 换一张（临时预览用） */
  function refresh(cfg: BackgroundConfig = current) {
    if (!cfg.enabled) return
    load(buildSrc(cfg, Date.now()))
  }

  function stopAuto() {
    if (timer != null) {
      clearInterval(timer)
      timer = undefined
    }
  }

  return { imageUrl, loading, error, apply, refresh, stopAuto }
}
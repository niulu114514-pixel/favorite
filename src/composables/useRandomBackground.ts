import { ref } from 'vue'
import type { BackgroundConfig } from '../../types'
import { DEFAULT_BACKGROUND_CONFIG } from '../../types'

/**
 * 随机背景管理：根据后台背景配置异步预加载随机图片，
 * 加载成功后再渲染到背景层（避免闪烁）。加载失败会自动重试换一张，
 * 并对“减少动态效果”偏好与自动轮换做兼容。
 */
export function useRandomBackground() {
  const imageUrl = ref('')
  const loading = ref(false)
  const error = ref('')
  let current: BackgroundConfig = { ...DEFAULT_BACKGROUND_CONFIG }
  let timer: ReturnType<typeof setInterval> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  const MAX_RETRIES = 2
  const RETRY_DELAY = 1200

  /** 配置内容是否完全相同（忽略字段顺序） */
  function sameConfig(a: BackgroundConfig, b: BackgroundConfig) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  /** 用户是否关闭了动画偏好（自动轮换时尊重系统设置） */
  function prefersReducedMotion() {
    return (
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  }

  /** 校验单个参数值，仅接受安全范围内的值 */
  function validParam(value: unknown, pattern: RegExp) {
    return typeof value === 'string' && pattern.test(value)
  }

  /** 依据来源构造成最终可加载的图片地址，并附带时间戳绕开缓存以取新图 */
  function buildSrc(cfg: BackgroundConfig, ts: number) {
    let url =
      cfg.source === 'custom' && cfg.customUrl?.trim() ? cfg.customUrl.trim() : cfg.apiUrl.trim()
    if (cfg.source === 'loli' && validParam(cfg.id, /^\d{1,6}$/)) {
      url += (url.includes('?') ? '&' : '?') + 'id=' + cfg.id
    }
    if (cfg.source === 'jinghuashang' && validParam(cfg.sort, /^[a-zA-Z]{1,20}$/)) {
      url += (url.includes('?') ? '&' : '?') + 'sort=' + cfg.sort
    }
    url += (url.includes('?') ? '&' : '?') + 't=' + ts
    return url
  }

  function clearRetry() {
    if (retryTimer != null) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }

  function load(src: string) {
    loading.value = true
    error.value = ''
    const img = new Image()
    img.crossOrigin = undefined
    img.onload = () => {
      retries = 0
      imageUrl.value = src
      loading.value = false
    }
    img.onerror = () => {
      // 少数接口偶发抖动：尝试换一张重取，仍失败再上报错误。
      if (retries < MAX_RETRIES) {
        retries += 1
        clearRetry()
        retryTimer = setTimeout(() => {
          load(buildSrc(current, Date.now()))
        }, RETRY_DELAY * retries)
      } else {
        retries = 0
        error.value = '背景加载失败，请检查图片地址'
        loading.value = false
      }
    }
    img.src = src
  }

  function apply(cfg: BackgroundConfig) {
    const next = { ...cfg }
    // 刷新时 onMounted 的显式调用与 watch 会对同一配置各触发一次 apply。
    // 若配置内容未变，直接忽略，避免随机背景被连续换两次（每次 buildSrc 时间戳都不同）。
    if (sameConfig(next, current)) return
    current = next
    stopAuto()
    clearRetry()
    if (!current.enabled) {
      imageUrl.value = ''
      loading.value = false
      error.value = ''
      return
    }
    load(buildSrc(current, Date.now()))
    // 自动轮换尊重“减少动态效果”偏好
    if (current.autoRefreshMin > 0 && !prefersReducedMotion()) {
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

  function stopAll() {
    stopAuto()
    clearRetry()
  }

  return { imageUrl, loading, error, apply, refresh, stopAuto, stopAll }
}

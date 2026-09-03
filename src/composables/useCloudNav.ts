import { computed, reactive, ref } from 'vue'
import type { Category, LinkItem } from '../../types'
import { DEFAULT_CATEGORIES, INITIAL_LINKS } from '../../types'
import type { AIConfig, IconConfig, WebDavConfig } from '../../types'
import { DEFAULT_BACKGROUND_CONFIG } from '../../types'
import type { BackgroundConfig } from '../../types'
import { DEFAULT_ICON_CONFIG, getIconUrl } from '../services/iconService'
import { splitCategoryIcon } from '../services/categoryIconUtil'

const DATA_KEY = 'cloudnav_data_cache'
const AUTH_KEY = 'cloudnav_auth_token'
const REQUEST_TIMEOUT = 6500

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    return await fetch(input, { credentials: 'include', ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

export function useCloudNav() {
  const links = ref<LinkItem[]>([])
  const categories = ref<Category[]>([])
  const token = ref(localStorage.getItem(AUTH_KEY) || '')
  // 首次打开（无本地缓存）时保持 loading，用于展示整页品牌过渡；
  // 再次打开时首帧即就绪，直接渲染真实内容，避免闪屏遮罩。
  const hasLocalCache = Boolean(localStorage.getItem(DATA_KEY))
  const loading = ref(!hasLocalCache)

  function authHeaders(extra?: Record<string, string>) {
    const headers: Record<string, string> = { ...extra }
    if (token.value && token.value !== 'session') headers['x-auth-password'] = token.value
    return headers
  }
  const syncStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const authRequired = ref(false)
  let syncIdleTimer: number | undefined
  const config = reactive({
    title: '落花流水个人导航',
    navigationName: 'CloudNav',
    showPinned: true,
    defaultViewMode: 'detailed' as 'compact' | 'detailed',
    ai: {
      provider: 'google' as AIConfig['provider'],
      apiKey: '',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini-2.0-flash',
      websiteTitle: '',
      navigationName: '',
      faviconUrl: '',
    } as AIConfig,
    icon: { ...DEFAULT_ICON_CONFIG } as IconConfig,
    webdav: {
      url: '',
      username: '',
      password: '',
      enabled: false,
    } as WebDavConfig,
    background: { ...DEFAULT_BACKGROUND_CONFIG } as BackgroundConfig,
  })

  function normalize(data: { links?: LinkItem[]; categories?: Category[] }) {
    const nextCategories = data.categories?.length
      ? data.categories.map(category => ({ ...category }))
      : DEFAULT_CATEGORIES.map(category => ({ ...category }))
    if (!nextCategories.some(item => item.id === 'common')) {
      nextCategories.unshift({ id: 'common', name: '常用推荐', icon: 'Star' })
    }
    const byId = new Map(nextCategories.map(item => [item.id, item]))
    for (const category of nextCategories) {
      const parent = category.parentId ? byId.get(category.parentId) : undefined
      if (
        !category.parentId ||
        category.parentId === category.id ||
        !parent ||
        // 只允许两级：父级本身必须是一级分类，避免把顶层误判为二级
        parent.parentId
      ) {
        delete category.parentId
        category.isSubcategory = false
      } else {
        category.isSubcategory = true
      }
    }
    const validIds = new Set(nextCategories.map(item => item.id))
    return {
      categories: nextCategories,
      links: (data.links?.length ? data.links : INITIAL_LINKS).map(link =>
        validIds.has(link.categoryId) ? link : { ...link, categoryId: 'common' }
      ),
    }
  }

  function loadLocal() {
    try {
      const cached = localStorage.getItem(DATA_KEY)
      return normalize(cached ? JSON.parse(cached) : {})
    } catch {
      return normalize({})
    }
  }

  async function init() {
    const local = loadLocal()
    links.value = local.links
    categories.value = local.categories
    try {
      const [dataResponse, configResponse, authResponse] = await Promise.all([
        fetchWithTimeout('/api/storage?getConfig=true&readOnly=true'),
        fetchWithTimeout('/api/storage?getConfig=all', { headers: authHeaders() }),
        fetchWithTimeout('/api/storage?checkAuth=true', { headers: authHeaders() }),
      ])
      if (dataResponse.ok) {
        const cloud = await dataResponse.json()
        if (cloud.links?.length || cloud.categories?.length) {
          const normalized = normalize(cloud)
          links.value = normalized.links
          categories.value = normalized.categories
          saveLocal()
        }
      }
      const loaded = configResponse.ok ? await configResponse.json() : {}
      applyConfig(loaded)
      if (authResponse.ok) {
        const authState = await authResponse.json()
        if (authState.authenticated) {
          if (!token.value) token.value = 'session'
        } else {
          token.value = ''
          localStorage.removeItem(AUTH_KEY)
        }
      }
    } catch (error) {
      console.info('Cloud data is unavailable; using the local cache.', error)
    } finally {
      loading.value = false
    }
  }

  function applyConfig(loaded: Record<string, unknown>) {
    const ai = (loaded.ai || {}) as Partial<AIConfig>
    const icon = (loaded.icon || {}) as Partial<IconConfig>
    const webdav = (loaded.webdav || {}) as Partial<WebDavConfig>
    const view = (loaded.view || {}) as { defaultMode?: 'compact' | 'detailed' }
    const ui = (loaded.ui || {}) as { showPinnedWebsites?: boolean }
    Object.assign(config.ai, ai)
    Object.assign(config.icon, icon)
    Object.assign(config.webdav, webdav)
    Object.assign(config.background, {
      ...DEFAULT_BACKGROUND_CONFIG,
      ...((loaded.background || {}) as Partial<BackgroundConfig>),
    })
    config.title = ai.websiteTitle || config.title
    config.navigationName = ai.navigationName || config.navigationName
    config.defaultViewMode = view.defaultMode || config.defaultViewMode
    config.showPinned = ui.showPinnedWebsites ?? config.showPinned
    document.title = config.title
  }

  function saveLocal() {
    localStorage.setItem(
      DATA_KEY,
      JSON.stringify({ links: links.value, categories: categories.value })
    )
  }

  function invalidateToken() {
    if (!authRequired.value) authRequired.value = true
    token.value = ''
    localStorage.removeItem(AUTH_KEY)
    void fetchWithTimeout('/api/auth', { method: 'DELETE' }).catch(() => {})
  }

  function resetAuthRequired() {
    authRequired.value = false
  }

  // 云端保存：先落本地缓存（同步、零等待），再防抖 + 去重地上报云端。
  // 一次性动作（收藏/编辑/排序）会被合并为一次 POST，且当快照与上次成功
  // 上报内容一致时直接跳过，避免无意义的整体覆写。
  const SYNC_DEBOUNCE = 350
  let debounceTimer: number | undefined
  let flushChain: Promise<void> = Promise.resolve()
  let pendingSnapshot: string | null = null
  let lastSentSnapshot = ''

  function currentSnapshot() {
    return JSON.stringify({ links: links.value, categories: categories.value })
  }

  function markSavedTemporarily() {
    syncStatus.value = 'saved'
    if (syncIdleTimer) window.clearTimeout(syncIdleTimer)
    syncIdleTimer = window.setTimeout(() => (syncStatus.value = 'idle'), 1200)
  }

  async function enqueueSnapshot(payload: string) {
    try {
      const response = await fetchWithTimeout('/api/storage', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: payload,
      })
      if (!response.ok) {
        if (response.status === 401) invalidateToken()
        throw new Error(`HTTP ${response.status}`)
      }
      lastSentSnapshot = payload
      markSavedTemporarily()
    } catch {
      syncStatus.value = 'error'
    }
  }

  async function runFlush() {
    debounceTimer = undefined
    if (pendingSnapshot == null) return
    const payload = pendingSnapshot
    pendingSnapshot = null
    // 登录态丢失后不再上报；数据已持久化到本地缓存。
    if (!token.value) return
    // 快照与上次成功上报一致（例如修改后又撤销），无需再 POST。
    if (payload === lastSentSnapshot) {
      markSavedTemporarily()
      return
    }
    syncStatus.value = 'saving'
    // 串行化：即便防抖窗口被后续动作重置，也保证上报有序、后写覆盖先写。
    flushChain = flushChain.then(() => enqueueSnapshot(payload))
    await flushChain
  }

  function persist(): Promise<void> {
    saveLocal()
    pendingSnapshot = currentSnapshot()
    if (!token.value) return Promise.resolve()
    if (debounceTimer != null) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => void runFlush(), SYNC_DEBOUNCE)
    return flushChain
  }

  /** 立即上报（关键操作，如备份恢复、退出前），跳过防抖窗口。 */
  async function flushNow(): Promise<void> {
    if (debounceTimer != null) {
      window.clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
    await runFlush()
    await flushChain
  }

  async function login(password: string) {
    const response = await fetchWithTimeout('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!response.ok) return false
    const data = await response.json().catch(() => ({}))
    if (!data.success) return false
    token.value = 'session'
    localStorage.removeItem(AUTH_KEY)
    try {
      const configResponse = await fetchWithTimeout('/api/storage?getConfig=all')
      if (configResponse.ok) applyConfig(await configResponse.json())
    } catch {
      // Authentication remains valid even if private config refresh fails.
    }
    return true
  }

  function logout() {
    token.value = ''
    localStorage.removeItem(AUTH_KEY)
    config.ai.apiKey = ''
    if (config.ai.providers) {
      for (const provider of Object.values(config.ai.providers)) {
        if (provider) provider.apiKey = ''
      }
    }
    void fetchWithTimeout('/api/auth', { method: 'DELETE' }).catch(() => {})
  }

  function saveLink(link: Partial<LinkItem>) {
    const prepared = { ...link }
    const id = prepared.id || crypto.randomUUID()
    if (prepared.id) {
      links.value = links.value.map(item =>
        item.id === prepared.id ? ({ ...item, ...prepared } as LinkItem) : item
      )
    } else {
      links.value.unshift({
        ...prepared,
        id,
        createdAt: Date.now(),
      } as LinkItem)
    }
    persist()

    if (!prepared.icon && prepared.url) {
      void getIconUrl(prepared.url, config.icon)
        .then(icon => {
          const current = links.value.find(item => item.id === id)
          if (!current || current.icon || !icon) return
          links.value = links.value.map(item => (item.id === id ? { ...item, icon } : item))
          persist()
        })
        .catch(() => {
          /* The card keeps using its runtime favicon fallback. */
        })
    }
  }

  async function removeLink(id: string) {
    links.value = links.value.filter(item => item.id !== id)
    await persist()
  }

  async function togglePin(id: string) {
    links.value = links.value.map(item =>
      item.id === id ? { ...item, pinned: !item.pinned } : item
    )
    await persist()
  }

  async function saveCategory(category: Partial<Category>) {
    const parentId =
      category.parentId &&
      category.parentId !== category.id &&
      categories.value.some(item => item.id === category.parentId && !item.parentId)
        ? category.parentId
        : undefined
    // 支持“⭐ 常用推荐”式命名：前导 emoji 自动作为图标
    const { icon: emojiIcon, name } = splitCategoryIcon(category.name || '')
    const icon = emojiIcon || category.icon || 'Folder'
    const prepared = { ...category, name, icon, parentId, isSubcategory: Boolean(parentId) }
    if (category.id && categories.value.some(item => item.id === category.id)) {
      categories.value = categories.value.map(item =>
        item.id === category.id ? ({ ...item, ...prepared } as Category) : item
      )
    } else {
      categories.value.push({
        ...prepared,
        id: category.id || crypto.randomUUID(),
      } as Category)
    }
    await persist()
  }

  async function reorderCategories(orderedIds: string[]) {
    const positions = new Map(orderedIds.map((id, index) => [id, index]))
    categories.value = [...categories.value].sort(
      (a, b) =>
        (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    )
    await persist()
  }

  async function reorderLinks(categoryId: string, orderedIds: string[]) {
    const position = new Map(orderedIds.map((id, index) => [id, index]))
    const others: LinkItem[] = []
    const categoryLinks: LinkItem[] = []
    for (const link of links.value) {
      ;(link.categoryId === categoryId ? categoryLinks : others).push(link)
    }
    categoryLinks.sort((a, b) => {
      const pa = position.get(a.id)
      const pb = position.get(b.id)
      if (pa === undefined && pb === undefined) return 0
      if (pa === undefined) return 1
      if (pb === undefined) return -1
      return pa - pb
    })
    links.value = [...others, ...categoryLinks]
    await persist()
  }

  async function removeCategory(id: string) {
    if (id === 'common') return
    links.value = links.value.map(link =>
      link.categoryId === id ? { ...link, categoryId: 'common' } : link
    )
    categories.value = categories.value.filter(item => item.id !== id)
    await persist()
  }

  async function saveConfig(section: string, value: unknown) {
    if (!token.value) throw new Error('请先登录')
    const response = await fetchWithTimeout('/api/storage', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ saveConfig: section, config: value }),
    })
    if (!response.ok) {
      if (response.status === 401) invalidateToken()
      throw new Error(`配置保存失败（${response.status}）`)
    }
  }

  async function saveConfigBatch(configs: Record<string, unknown>) {
    if (!token.value) throw new Error('请先登录')
    const response = await fetchWithTimeout('/api/storage', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ saveConfig: 'batch', configs }),
    })
    if (!response.ok) {
      if (response.status === 401) invalidateToken()
      throw new Error(`Config save failed (${response.status})`)
    }
  }

  const pinnedLinks = computed(() => links.value.filter(item => item.pinned))

  return {
    links,
    categories,
    pinnedLinks,
    token,
    loading,
    syncStatus,
    authRequired,
    resetAuthRequired,
    config,
    init,
    login,
    logout,
    saveLink,
    removeLink,
    togglePin,
    saveCategory,
    reorderCategories,
    reorderLinks,
    removeCategory,
    persist,
    flushNow,
    saveConfig,
    saveConfigBatch,
  }
}

import { computed, reactive, ref } from 'vue'
import type { Category, LinkItem } from '../../types'
import { DEFAULT_CATEGORIES, INITIAL_LINKS } from '../../types'
import type { AIConfig, IconConfig, WebDavConfig } from '../../types'
import { DEFAULT_ICON_CONFIG, getIconUrl } from '../services/iconService'

const DATA_KEY = 'cloudnav_data_cache'
const AUTH_KEY = 'cloudnav_auth_token'
const REQUEST_TIMEOUT = 6500

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

export function useCloudNav() {
  const links = ref<LinkItem[]>([])
  const categories = ref<Category[]>([])
  const token = ref(localStorage.getItem(AUTH_KEY) || '')
  const loading = ref(true)
  const syncStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  let syncPromise: Promise<void> | null = null
  let syncRevision = 0
  let syncedRevision = 0
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
  })

  function normalize(data: { links?: LinkItem[]; categories?: Category[] }) {
    const nextCategories = data.categories?.length
      ? data.categories.map(category => ({ ...category }))
      : DEFAULT_CATEGORIES.map(category => ({ ...category }))
    if (!nextCategories.some(item => item.id === 'common')) {
      nextCategories.unshift({ id: 'common', name: '常用推荐', icon: 'Star' })
    }
    const categoryIds = new Set(nextCategories.map(item => item.id))
    for (const category of nextCategories) {
      if (
        !category.parentId ||
        category.parentId === category.id ||
        !categoryIds.has(category.parentId)
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
    loading.value = false
    try {
      const authHeaders = token.value ? { 'x-auth-password': token.value } : undefined
      const [dataResponse, configResponse] = await Promise.all([
        fetchWithTimeout('/api/storage?getConfig=true&readOnly=true'),
        fetchWithTimeout('/api/storage?getConfig=all', { headers: authHeaders }),
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

  function persist(): Promise<void> | undefined {
    saveLocal()
    if (!token.value) return undefined
    syncRevision += 1
    syncStatus.value = 'saving'
    if (syncPromise) return syncPromise

    syncPromise = (async () => {
      try {
        while (syncedRevision < syncRevision) {
          const revision = syncRevision
          const response = await fetchWithTimeout('/api/storage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-password': token.value },
            body: JSON.stringify({ links: links.value, categories: categories.value }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          syncedRevision = revision
        }
        syncStatus.value = 'saved'
        if (syncIdleTimer) window.clearTimeout(syncIdleTimer)
        syncIdleTimer = window.setTimeout(() => (syncStatus.value = 'idle'), 1800)
      } catch {
        syncStatus.value = 'error'
      } finally {
        syncPromise = null
      }
    })()
    return syncPromise
  }

  async function login(password: string) {
    const response = await fetchWithTimeout('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!response.ok) return false
    const data = await response.json()
    if (!data.success || !data.token) return false
    token.value = data.token
    localStorage.setItem(AUTH_KEY, data.token)
    try {
      const configResponse = await fetchWithTimeout('/api/storage?getConfig=all', {
        headers: { 'x-auth-password': data.token },
      })
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
    const prepared = { ...category, parentId, isSubcategory: Boolean(parentId) }
    if (category.id && categories.value.some(item => item.id === category.id)) {
      categories.value = categories.value.map(item =>
        item.id === category.id ? ({ ...item, ...prepared } as Category) : item
      )
    } else {
      categories.value.push({
        ...prepared,
        id: category.id || crypto.randomUUID(),
        icon: category.icon || 'Folder',
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
      headers: { 'Content-Type': 'application/json', 'x-auth-password': token.value },
      body: JSON.stringify({ saveConfig: section, config: value }),
    })
    if (!response.ok) throw new Error(`配置保存失败（${response.status}）`)
  }

  async function saveConfigBatch(configs: Record<string, unknown>) {
    if (!token.value) throw new Error('请先登录')
    const response = await fetchWithTimeout('/api/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-password': token.value },
      body: JSON.stringify({ saveConfig: 'batch', configs }),
    })
    if (!response.ok) throw new Error(`Config save failed (${response.status})`)
  }

  const pinnedLinks = computed(() => links.value.filter(item => item.pinned))

  return {
    links,
    categories,
    pinnedLinks,
    token,
    loading,
    syncStatus,
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
    saveConfig,
    saveConfigBatch,
  }
}

import { computed, reactive, ref } from 'vue'
import type { Category, LinkItem } from '../../types'
import { DEFAULT_CATEGORIES, INITIAL_LINKS } from '../../types'

const DATA_KEY = 'cloudnav_data_cache'
const AUTH_KEY = 'cloudnav_auth_token'

export function useCloudNav() {
  const links = ref<LinkItem[]>([])
  const categories = ref<Category[]>([])
  const token = ref(localStorage.getItem(AUTH_KEY) || '')
  const loading = ref(true)
  const syncStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const config = reactive({
    title: '落花流水个人导航',
    navigationName: 'CloudNav',
    showPinned: true,
  })

  function normalize(data: { links?: LinkItem[]; categories?: Category[] }) {
    const nextCategories = data.categories?.length ? [...data.categories] : [...DEFAULT_CATEGORIES]
    if (!nextCategories.some((item) => item.id === 'common')) {
      nextCategories.unshift({ id: 'common', name: '常用推荐', icon: 'Star' })
    }
    const validIds = new Set(nextCategories.map((item) => item.id))
    return {
      categories: nextCategories,
      links: (data.links?.length ? data.links : INITIAL_LINKS).map((link) =>
        validIds.has(link.categoryId) ? link : { ...link, categoryId: 'common' },
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
      const [dataResponse, aiResponse] = await Promise.all([
        fetch('/api/storage?getConfig=true&readOnly=true'),
        fetch('/api/storage?getConfig=ai'),
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
      if (aiResponse.ok) {
        const ai = await aiResponse.json()
        config.title = ai.websiteTitle || config.title
        config.navigationName = ai.navigationName || config.navigationName
        document.title = config.title
      }
    } catch (error) {
      console.info('Cloud data is unavailable; using the local cache.', error)
    } finally {
      loading.value = false
    }
  }

  function saveLocal() {
    localStorage.setItem(DATA_KEY, JSON.stringify({ links: links.value, categories: categories.value }))
  }

  async function persist() {
    saveLocal()
    if (!token.value) return
    syncStatus.value = 'saving'
    try {
      const response = await fetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-password': token.value },
        body: JSON.stringify({ links: links.value, categories: categories.value }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      syncStatus.value = 'saved'
      window.setTimeout(() => (syncStatus.value = 'idle'), 1800)
    } catch {
      syncStatus.value = 'error'
    }
  }

  async function login(password: string) {
    const response = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!response.ok) return false
    const data = await response.json()
    if (!data.success || !data.token) return false
    token.value = data.token
    localStorage.setItem(AUTH_KEY, data.token)
    return true
  }

  function logout() {
    token.value = ''
    localStorage.removeItem(AUTH_KEY)
  }

  async function saveLink(link: Partial<LinkItem>) {
    if (link.id) {
      links.value = links.value.map((item) => item.id === link.id ? { ...item, ...link } as LinkItem : item)
    } else {
      links.value.unshift({ ...link, id: crypto.randomUUID(), createdAt: Date.now() } as LinkItem)
    }
    await persist()
  }

  async function removeLink(id: string) {
    links.value = links.value.filter((item) => item.id !== id)
    await persist()
  }

  async function togglePin(id: string) {
    links.value = links.value.map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item)
    await persist()
  }

  async function saveCategory(category: Partial<Category>) {
    if (category.id && categories.value.some((item) => item.id === category.id)) {
      categories.value = categories.value.map((item) => item.id === category.id ? { ...item, ...category } as Category : item)
    } else {
      categories.value.push({ ...category, id: category.id || crypto.randomUUID(), icon: category.icon || 'Folder' } as Category)
    }
    await persist()
  }

  async function removeCategory(id: string) {
    if (id === 'common') return
    links.value = links.value.map((link) => link.categoryId === id ? { ...link, categoryId: 'common' } : link)
    categories.value = categories.value.filter((item) => item.id !== id)
    await persist()
  }

  const pinnedLinks = computed(() => links.value.filter((item) => item.pinned))

  return {
    links, categories, pinnedLinks, token, loading, syncStatus, config,
    init, login, logout, saveLink, removeLink, togglePin, saveCategory, removeCategory, persist,
  }
}

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Bookmark,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Grid2X2,
  LayoutList,
  LogIn,
  LogOut,
  Menu,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Star,
  Sparkles,
  Sun,
  Upload,
  Image,
  X,
} from 'lucide-vue-next'
import type { Category, LinkItem } from '../types'
import { useCloudNav } from './composables/useCloudNav'
import { useRandomBackground } from './composables/useRandomBackground'
import SettingsPanel from './components/SettingsPanel.vue'
import LinkGrid from './components/LinkGrid.vue'
import { favicon, handleFaviconError } from './composables/useFavicon'
import { safeTargetUrl } from './utils/url'
import { generateLinkDescription, suggestCategory } from './services/aiService'

const nav = useCloudNav()
const background = useRandomBackground()
const searchQuery = ref('')
const externalSearch = ref(false)
const sidebarOpen = ref(false)
const sidebarCollapsed = ref(localStorage.getItem('cloudnav_sidebar_collapsed') === '1')
const dark = ref(localStorage.getItem('cloudnav_theme_preference') === 'dark')
const savedViewMode = localStorage.getItem('cloudnav_view_mode')
const hasSavedViewMode = savedViewMode === 'compact' || savedViewMode === 'detailed'
const compact = ref(savedViewMode === 'compact')
const linkModalOpen = ref(false)
const authModalOpen = ref(false)
const settingsOpen = ref(false)
const hideTools = ref(localStorage.getItem('cloudnav_hide_tools') === '1')
const editingLink = ref<Partial<LinkItem>>({})
const iconUploading = ref(false)
const iconError = ref('')
const splashIconBroken = ref(false)
const splashIconSrc = computed(() => nav.config.ai.faviconUrl || '/favicon.ico')
const password = ref('')
const authError = ref('')
const showPassword = ref(false)
const loggingIn = ref(false)
const aiBusy = ref(false)
const aiError = ref('')
const searchInput = ref<HTMLInputElement>()
const activeCategoryId = ref('')
const LONG_PRESS_MS = 450
const PRESS_MOVE_TOLERANCE = 12
const dragCategoryId = ref<string | null>(null)
const dragHoverId = ref<string | null>(null)
let pressedCategoryId: string | null = null
let pressTimer: number | undefined
let pressStartX = 0
let pressStartY = 0
let suppressCategoryClick = false
const collapsedCategoryIds = ref<Set<string>>(loadCollapsedCategoryIds())
const searchTextCache = new WeakMap<LinkItem, string>()

const categoryMap = computed(
  () => new Map(nav.categories.value.map(category => [category.id, category]))
)
const topLevelCategories = computed(() =>
  nav.categories.value.filter(
    category => !category.parentId || !categoryMap.value.has(category.parentId)
  )
)
const childCategories = computed(() => {
  const grouped = new Map<string, Category[]>()
  for (const category of nav.categories.value) {
    if (!category.parentId || !categoryMap.value.has(category.parentId)) continue
    const children = grouped.get(category.parentId)
    if (children) children.push(category)
    else grouped.set(category.parentId, [category])
  }
  return grouped
})

// Keep the content order identical to the sidebar order. Categories are stored
// as a flat array for backwards compatibility, so the view needs to rebuild
// the parent -> child blocks before rendering them.
const orderedCategories = computed(() => {
  const ordered: Category[] = []
  const seen = new Set<string>()
  for (const parent of topLevelCategories.value) {
    ordered.push(parent)
    seen.add(parent.id)
    for (const child of categoryChildren(parent.id)) {
      ordered.push(child)
      seen.add(child.id)
    }
  }
  // Preserve malformed/legacy records instead of silently hiding them.
  for (const category of nav.categories.value) {
    if (!seen.has(category.id)) ordered.push(category)
  }
  return ordered
})

function categoryChildren(categoryId: string) {
  return childCategories.value.get(categoryId) || []
}

function loadCollapsedCategoryIds() {
  try {
    const value = JSON.parse(localStorage.getItem('cloudnav_collapsed_categories') || '[]')
    return new Set<string>(Array.isArray(value) ? value : [])
  } catch {
    return new Set<string>()
  }
}

function isCategoryExpanded(categoryId: string) {
  return !collapsedCategoryIds.value.has(categoryId)
}

function toggleCategoryExpanded(event: Event, categoryId: string) {
  event.stopPropagation()
  const next = new Set(collapsedCategoryIds.value)
  if (next.has(categoryId)) next.delete(categoryId)
  else next.add(categoryId)
  collapsedCategoryIds.value = next
  localStorage.setItem('cloudnav_collapsed_categories', JSON.stringify([...next]))
}

function handleCategoryClick(event: MouseEvent, category: Category) {
  if (suppressCategoryClick) {
    suppressCategoryClick = false
    return
  }
  if (categoryChildren(category.id).length) {
    toggleCategoryExpanded(event, category.id)
    return
  }
  jumpTo(category.id)
}

const visibleLinks = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query || externalSearch.value) return nav.links.value
  return nav.links.value.filter(link => searchableText(link).includes(query))
})

function searchableText(link: LinkItem) {
  const cached = searchTextCache.get(link)
  if (cached) return cached
  const text = `${link.title} ${link.description || ''} ${link.url}`.toLowerCase()
  searchTextCache.set(link, text)
  return text
}

const linksByCategory = computed(() => {
  const grouped = new Map<string, LinkItem[]>()
  for (const link of visibleLinks.value) {
    const items = grouped.get(link.categoryId)
    if (items) items.push(link)
    else grouped.set(link.categoryId, [link])
  }
  for (const items of grouped.values()) {
    items.sort(
      (a, b) => (a.weight ?? Infinity) - (b.weight ?? Infinity) || (a.order ?? 0) - (b.order ?? 0)
    )
  }
  return grouped
})

function categoryLinks(categoryId: string) {
  return linksByCategory.value.get(categoryId) || []
}

function categoryCount(category: Category) {
  const direct = categoryLinks(category.id).length
  if (category.parentId) return direct
  return (
    direct +
    categoryChildren(category.id).reduce((total, child) => {
      return total + categoryLinks(child.id).length
    }, 0)
  )
}

function applyTheme() {
  document.documentElement.classList.toggle('dark', dark.value)
  localStorage.setItem('cloudnav_theme_preference', dark.value ? 'dark' : 'light')
}

function toggleTheme() {
  dark.value = !dark.value
  applyTheme()
}

function toggleView() {
  compact.value = !compact.value
  localStorage.setItem('cloudnav_view_mode', compact.value ? 'compact' : 'detailed')
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('cloudnav_sidebar_collapsed', sidebarCollapsed.value ? '1' : '0')
}

function toggleHideTools() {
  hideTools.value = !hideTools.value
  localStorage.setItem('cloudnav_hide_tools', hideTools.value ? '1' : '0')
}

// 登录凭据过期（401）时自动弹出登录框，替代静默的“保存失败”。
watch(
  () => nav.authRequired.value,
  required => {
    if (required) {
      authModalOpen.value = true
      password.value = ''
      authError.value = '登录已过期，请重新登录'
      void nextTick(() => nav.resetAuthRequired())
    }
  }
)

function submitSearch() {
  const query = searchQuery.value.trim()
  if (!query || !externalSearch.value) return
  window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank', 'noopener')
}

function jumpTo(id: string) {
  const target = document.getElementById(`category-${id}`)
  if (!target) return

  activeCategoryId.value = id
  const headerOffset = 84
  const top = target.getBoundingClientRect().top + window.scrollY - headerOffset
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  sidebarOpen.value = false
}

function startCategoryPress(event: PointerEvent, category: Category) {
  if (dragCategoryId.value) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  pressedCategoryId = category.id
  pressStartX = event.clientX
  pressStartY = event.clientY
  suppressCategoryClick = false
  clearPressTimer()
  pressTimer = window.setTimeout(() => activateCategoryDrag(category.id), LONG_PRESS_MS)
  window.addEventListener('pointermove', cancelPressOnMove)
  window.addEventListener('pointerup', cancelCategoryPress)
  window.addEventListener('pointercancel', cancelCategoryPress)
}

function activateCategoryDrag(id: string) {
  clearPressTimer()
  if (!pressedCategoryId) return
  window.removeEventListener('pointermove', cancelPressOnMove)
  dragCategoryId.value = id
  dragHoverId.value = null
  suppressCategoryClick = true
  document.body.classList.add('sorting-categories')
  window.addEventListener('pointermove', updateCategoryDragHover)
  window.addEventListener('pointerup', finishCategoryDrag)
  window.addEventListener('pointercancel', cancelCategoryDragSession)
  window.addEventListener('blur', cancelCategoryDragSession)
}

function cancelPressOnMove(event: PointerEvent) {
  if (!pressedCategoryId) return
  const distance = Math.hypot(event.clientX - pressStartX, event.clientY - pressStartY)
  if (distance > PRESS_MOVE_TOLERANCE) cancelCategoryPress()
}

function cancelCategoryPress() {
  clearPressTimer()
  pressedCategoryId = null
  window.removeEventListener('pointermove', cancelPressOnMove)
  window.removeEventListener('pointerup', cancelCategoryPress)
  window.removeEventListener('pointercancel', cancelCategoryPress)
}

function updateCategoryDragHover(event: PointerEvent) {
  const element = document.elementFromPoint(event.clientX, event.clientY)
  const dropTarget = element?.closest('[data-sort-category]') as HTMLElement | null
  const candidate = dropTarget?.dataset.sortCategory ?? null
  if (!candidate || !dragCategoryId.value || candidate === dragCategoryId.value) {
    dragHoverId.value = null
    return
  }
  const dragged = categoryMap.value.get(dragCategoryId.value)
  const target = categoryMap.value.get(candidate)
  const valid = dragged && target && (dragged.parentId || '') === (target.parentId || '')
  dragHoverId.value = valid ? candidate : null
}

async function finishCategoryDrag(event: PointerEvent) {
  const draggedId = dragCategoryId.value
  cancelCategoryDragSession()
  if (!draggedId) return
  const element = document.elementFromPoint(event.clientX, event.clientY)
  const dropTarget = element?.closest('[data-sort-category]') as HTMLElement | null
  const targetId = dropTarget?.dataset.sortCategory
  if (!targetId || targetId === draggedId) return
  const orderedIds = reorderCategoryLevel(draggedId, targetId)
  if (orderedIds) await nav.reorderCategories(orderedIds)
}

function cancelCategoryDragSession() {
  cancelCategoryPress()
  if (!dragCategoryId.value) return
  dragCategoryId.value = null
  dragHoverId.value = null
  document.body.classList.remove('sorting-categories')
  window.removeEventListener('pointermove', updateCategoryDragHover)
  window.removeEventListener('pointerup', finishCategoryDrag)
  window.removeEventListener('pointercancel', cancelCategoryDragSession)
  window.removeEventListener('blur', cancelCategoryDragSession)
}

function clearPressTimer() {
  if (pressTimer) {
    window.clearTimeout(pressTimer)
    pressTimer = undefined
  }
}

function reorderCategoryLevel(draggedId: string, targetId: string) {
  const dragged = categoryMap.value.get(draggedId)
  const target = categoryMap.value.get(targetId)
  if (!dragged || !target) return null

  const parentId = dragged.parentId || ''
  if ((target.parentId || '') !== parentId) return null

  const siblings = parentId ? [...categoryChildren(parentId)] : [...topLevelCategories.value]
  const from = siblings.findIndex(category => category.id === draggedId)
  const to = siblings.findIndex(category => category.id === targetId)
  if (from < 0 || to < 0) return null
  const [moved] = siblings.splice(from, 1)
  siblings.splice(to, 0, moved)

  const ordered: string[] = []
  const seen = new Set<string>()
  for (const top of parentId ? topLevelCategories.value : siblings) {
    ordered.push(top.id)
    seen.add(top.id)
    const children = top.id === parentId ? siblings : categoryChildren(top.id)
    for (const child of children) {
      ordered.push(child.id)
      seen.add(child.id)
    }
  }
  for (const category of nav.categories.value) {
    if (!seen.has(category.id)) ordered.push(category.id)
  }
  return ordered
}

function openLinkModal(link?: LinkItem) {
  editingLink.value = link ? { ...link } : { categoryId: nav.categories.value[0]?.id || 'common' }
  iconUploading.value = false
  iconError.value = ''
  linkModalOpen.value = true
}

function openLinkModalForCategory(categoryId: string) {
  editingLink.value = { categoryId }
  iconUploading.value = false
  iconError.value = ''
  linkModalOpen.value = true
}

/** 上传图标（文件或远程 URL）到 EdgeOne Blob，返回可用的图标地址 */
async function uploadIcon(form: FormData) {
  const response = await fetch('/api/upload', { method: 'POST', body: form })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.url) throw new Error(data.error || '上传失败')
  return data.url as string
}

async function onPickIconFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  iconUploading.value = true
  iconError.value = ''
  const form = new FormData()
  form.append('file', file)
  form.append('categoryName', editingLink.value.categoryId || 'common')
  try {
    editingLink.value.icon = await uploadIcon(form)
  } catch (e) {
    iconError.value = e instanceof Error ? e.message : '上传失败'
  } finally {
    iconUploading.value = false
  }
}

/** 把输入框里的图标 URL 抓取并存入 Blob，避免外链失效 */
async function onFetchIconUrl() {
  const raw = editingLink.value.icon?.trim() || ''
  if (!raw) {
    iconError.value = '请先在上方输入图标 URL'
    return
  }
  if (raw.startsWith('/api/favicon?key=')) return
  if (!/^https?:\/\//i.test(raw)) {
    iconError.value = '请输入以 http(s):// 开头的图片地址'
    return
  }
  iconUploading.value = true
  iconError.value = ''
  const form = new FormData()
  form.append('url', raw)
  form.append('categoryName', editingLink.value.categoryId || 'common')
  try {
    editingLink.value.icon = await uploadIcon(form)
  } catch (e) {
    iconError.value = e instanceof Error ? e.message : '抓取失败'
  } finally {
    iconUploading.value = false
  }
}

async function submitLink() {
  if (!editingLink.value.title?.trim() || !editingLink.value.url?.trim()) return
  let url = editingLink.value.url.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  await nav.saveLink({ ...editingLink.value, title: editingLink.value.title.trim(), url })
  linkModalOpen.value = false
}

async function generateWithAI() {
  if (!editingLink.value.title?.trim() || !editingLink.value.url?.trim()) {
    aiError.value = '请先填写名称和网址'
    return
  }
  aiBusy.value = true
  aiError.value = ''
  try {
    const [description, categoryId] = await Promise.all([
      generateLinkDescription(editingLink.value.title, editingLink.value.url, nav.config.ai),
      suggestCategory(
        editingLink.value.title,
        editingLink.value.url,
        nav.categories.value,
        nav.config.ai
      ),
    ])
    if (description) editingLink.value.description = description
    if (categoryId) editingLink.value.categoryId = categoryId
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : 'AI 请求失败'
  } finally {
    aiBusy.value = false
  }
}

async function deleteLink(link: LinkItem) {
  if (confirm(`确定删除“${link.title}”吗？`)) await nav.removeLink(link.id)
}

async function submitLogin() {
  if (loggingIn.value) return
  authError.value = ''
  loggingIn.value = true
  try {
    if (await nav.login(password.value)) {
      authModalOpen.value = false
      password.value = ''
    } else authError.value = '密码不正确'
  } catch {
    authError.value = '暂时无法登录，请稍后重试'
  } finally {
    loggingIn.value = false
  }
}

/** 生成 WebDAV 备份数据 */
function buildBackupData() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    app: 'CloudNav',
    links: nav.links.value,
    categories: nav.categories.value,
  }
}

/** 从 WebDAV 备份恢复数据并持久化 */
async function restoreBackupData(data: Record<string, unknown>) {
  if (Array.isArray(data.links)) nav.links.value = data.links as LinkItem[]
  if (Array.isArray(data.categories)) nav.categories.value = data.categories as Category[]
  await nav.persist()
}

function onSettingsSaved(settings: {
  ai: typeof nav.config.ai
  icon: typeof nav.config.icon
  webdav: typeof nav.config.webdav
  background: typeof nav.config.background
  websiteTitle: string
  navigationName: string
  showPinned: boolean
  defaultViewMode: 'compact' | 'detailed'
}) {
  Object.assign(nav.config.ai, settings.ai)
  Object.assign(nav.config.icon, settings.icon)
  Object.assign(nav.config.webdav, settings.webdav)
  Object.assign(nav.config.background, settings.background)
  nav.config.title = settings.websiteTitle || nav.config.title
  nav.config.navigationName = settings.navigationName
  nav.config.showPinned = settings.showPinned
  nav.config.defaultViewMode = settings.defaultViewMode
  document.title = nav.config.title
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
    event.preventDefault()
    void nextTick(() => searchInput.value?.focus())
  }
  if (event.key === 'Escape') searchQuery.value = ''
}

/** 随机背景层的图片样式（含模糊） */
const bgStyle = computed(() => {
  if (!background.imageUrl.value) return {}
  const blur = Number(nav.config.background.blur) || 0
  return {
    backgroundImage: `url("${background.imageUrl.value}")`,
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
  }
})

/** 暗色遮罩，保证前景可读 */
const bgOverlayColor = computed(
  () => `rgba(18, 27, 42, ${Math.min(0.85, Math.max(0, Number(nav.config.background.overlay) || 0))})`
)

watch(
  () => JSON.parse(JSON.stringify(nav.config.background)),
  cfg => background.apply(cfg),
  { deep: true }
)

onMounted(async () => {
  applyTheme()
  await nav.init()
  background.apply(nav.config.background)
  if (!hasSavedViewMode) compact.value = nav.config.defaultViewMode === 'compact'
  const params = new URLSearchParams(location.search)
  const addUrl = params.get('add_url')
  if (addUrl) {
    editingLink.value = { url: addUrl, title: params.get('add_title') || '', categoryId: 'common' }
    linkModalOpen.value = true
    history.replaceState({}, '', location.pathname)
  }
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  cancelCategoryDragSession()
  background.stopAuto()
})
</script>

<template>
  <div class="app-shell" :class="{ 'has-bg': Boolean(background.imageUrl.value) }">
    <Transition name="splash">
      <div v-if="nav.loading.value" class="brand-splash" aria-busy="true">
        <div class="splash-mark">
          <img
            v-if="!splashIconBroken"
            class="splash-logo"
            :src="splashIconSrc"
            alt=""
            @error="splashIconBroken = true"
          />
          <Bookmark v-else :size="34" />
        </div>
        <strong class="splash-name">{{ nav.config.navigationName || 'CloudNav' }}</strong>
        <div class="splash-spinner" aria-hidden="true" />
      </div>
    </Transition>
    <div v-if="background.imageUrl.value" class="bg-layer">
      <div class="bg-image" :style="bgStyle" />
      <div class="bg-overlay" :style="{ background: bgOverlayColor }" />
    </div>
    <div v-if="sidebarOpen" class="sidebar-mask" @click="sidebarOpen = false" />
    <aside class="sidebar" :class="{ open: sidebarOpen, collapsed: sidebarCollapsed }">
      <div class="brand">
        <div class="brand-mark"><Bookmark :size="20" /></div>
        <strong>{{ nav.config.navigationName }}</strong
        ><button class="icon-button mobile-only" @click="sidebarOpen = false"><X /></button>
      </div>
      <nav class="category-nav">
        <div class="category-section-label">分类目录</div>
        <template v-for="category in topLevelCategories" :key="category.id">
          <div class="category-nav-item">
            <button
              type="button"
              :data-sort-category="category.id"
              :aria-current="activeCategoryId === category.id ? 'location' : undefined"
              :aria-expanded="
                categoryChildren(category.id).length ? isCategoryExpanded(category.id) : undefined
              "
              :title="'长按拖动可调整分类顺序'"
              :class="{
                active: activeCategoryId === category.id,
                dragging: dragCategoryId === category.id,
                'drag-hover':
                  dragHoverId === category.id &&
                  dragCategoryId !== null &&
                  dragCategoryId !== category.id,
              }"
              @contextmenu.prevent
              @pointerdown="startCategoryPress($event, category)"
              @pointerup="cancelCategoryPress"
              @pointercancel="cancelCategoryPress"
              @click="handleCategoryClick($event, category)"
            >
              <Folder :size="17" /><span class="category-name">{{ category.name }}</span
              ><span
                v-if="categoryChildren(category.id).length"
                class="category-toggle"
                role="button"
                tabindex="0"
                :aria-label="isCategoryExpanded(category.id) ? '收起二级分类' : '展开二级分类'"
                @pointerdown.stop
                @click.stop="toggleCategoryExpanded($event, category.id)"
                @keydown.enter.stop="toggleCategoryExpanded($event, category.id)"
                @keydown.space.prevent.stop="toggleCategoryExpanded($event, category.id)"
                ><ChevronRight
                  :size="15"
                  :class="{ expanded: isCategoryExpanded(category.id) }" /></span
              >
            </button>
          </div>
          <template v-for="child in categoryChildren(category.id)" :key="child.id">
            <div v-if="isCategoryExpanded(category.id)" class="category-nav-item">
              <button
                type="button"
                class="subcategory"
                :data-sort-category="child.id"
                :aria-current="activeCategoryId === child.id ? 'location' : undefined"
                :title="'长按拖动可调整分类顺序'"
                :class="{
                  active: activeCategoryId === child.id,
                  dragging: dragCategoryId === child.id,
                  'drag-hover':
                    dragHoverId === child.id &&
                    dragCategoryId !== null &&
                    dragCategoryId !== child.id,
                }"
                @contextmenu.prevent
                @pointerdown="startCategoryPress($event, child)"
                @pointerup="cancelCategoryPress"
                @pointercancel="cancelCategoryPress"
                @click="jumpTo(child.id)"
              >
                <Folder :size="16" /><span>{{ child.name }}</span
                ><ChevronRight :size="15" />
              </button>
            </div>
          </template>
        </template>
      </nav>
      <div class="sidebar-footer">
        <button v-if="nav.token.value" @click="nav.logout()"><LogOut :size="16" /> 退出管理</button>
        <button v-else @click="authModalOpen = true"><LogIn :size="16" /> 管理登录</button>
      </div>
    </aside>

    <main class="main-area" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
      <header class="header">
        <button class="icon-button mobile-only" aria-label="打开菜单" @click="sidebarOpen = true">
          <Menu />
        </button>
        <button
          class="icon-button desktop-only sidebar-toggle"
          :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          @click="toggleSidebar"
        >
          <PanelLeft :size="20" />
        </button>
        <form class="search-box" @submit.prevent="submitSearch">
          <Search :size="18" />
          <input
            ref="searchInput"
            v-model="searchQuery"
            :placeholder="externalSearch ? '搜索互联网…' : '搜索收藏…（按 / 聚焦）'"
          />
          <button v-if="searchQuery" type="button" class="clear-search" @click="searchQuery = ''">
            <X :size="16" />
          </button>
        </form>
        <label class="search-switch"
          ><input v-model="externalSearch" type="checkbox" /><span>{{
            externalSearch ? 'Google' : '站内'
          }}</span></label
        >
        <div class="header-actions">
          <span
            v-if="nav.syncStatus.value !== 'idle'"
            class="sync-status"
            :class="nav.syncStatus.value"
            >{{
              nav.syncStatus.value === 'saving'
                ? '保存中'
                : nav.syncStatus.value === 'saved'
                  ? '已保存'
                  : '保存失败'
            }}</span
          >
          <button
            class="icon-button"
            :title="compact ? '详细视图' : '紧凑视图'"
            @click="toggleView"
          >
            <LayoutList v-if="compact" /><Grid2X2 v-else />
          </button>
          <button
            v-if="nav.token.value"
            class="icon-button"
            :title="hideTools ? '显示编辑/删除工具' : '隐藏编辑/删除工具'"
            :aria-pressed="hideTools"
            @click="toggleHideTools"
          >
            <EyeOff v-if="hideTools" /><Eye v-else />
          </button>
          <button class="icon-button" title="切换主题" @click="toggleTheme">
            <Sun v-if="dark" /><Moon v-else />
          </button>
          <button
            v-if="nav.token.value"
            class="icon-button"
            title="设置"
            @click="settingsOpen = true"
          >
            <Settings />
          </button>
          <button v-if="nav.token.value" class="primary-button" @click="openLinkModal()">
            <Plus :size="18" /><span>添加网站</span>
          </button>
          <button v-else class="icon-button" title="管理登录" @click="authModalOpen = true">
            <Settings />
          </button>
        </div>
      </header>

      <div class="content">
        <div v-if="nav.loading.value" class="loading-grid">
          <div v-for="n in 10" :key="n" class="skeleton" />
        </div>
        <template v-else>
          <section
            v-if="
              nav.config.showPinned &&
              nav.pinnedLinks.value.length &&
              !searchQuery
            "
            class="category-section pinned-section"
          >
            <h2>
              <Star :size="20" fill="currentColor" /> 置顶网站
              <span>{{ nav.pinnedLinks.value.length }}</span>
            </h2>
            <div class="link-grid" :class="{ compact }">
              <a
                v-for="link in nav.pinnedLinks.value"
                :key="link.id"
                v-memo="[
                  link.id,
                  link.title,
                  link.description,
                  link.url,
                  link.icon,
                  link.pinned,
                  compact,
                ]"
                class="link-card"
                :href="safeTargetUrl(link.url)"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  :src="favicon(link)"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width="39"
                  height="39"
                  @error="handleFaviconError($event, link)"
                />
                <div>
                  <strong>{{ link.title }}</strong>
                  <p v-if="!compact">{{ link.description || link.url }}</p>
                </div>
              </a>
            </div>
          </section>

          <template v-for="category in orderedCategories" :key="category.id">
            <section
              v-if="
                (!category.parentId ||
                  isCategoryExpanded(category.parentId) ||
                  searchQuery.trim()) &&
                (!searchQuery.trim() || categoryLinks(category.id).length)
              "
              :id="`category-${category.id}`"
              class="category-section"
              :class="{
                'is-active': activeCategoryId === category.id,
                'subcategory-section': Boolean(category.parentId),
              }"
            >
              <div class="section-title">
                <h2>
                  <Folder :size="20" /> {{ category.name }}
                  <span>{{ categoryCount(category) }}</span>
                </h2>
              </div>
              <LinkGrid
                v-if="categoryLinks(category.id).length"
                :links="categoryLinks(category.id)"
                :compact="compact"
                :can-manage="Boolean(nav.token.value)"
                :hide-tools="hideTools"
                @pin="nav.togglePin"
                @edit="openLinkModal"
                @delete="deleteLink"
                @reorder="orderedIds => nav.reorderLinks(category.id, orderedIds)"
              />
              <button
                v-else-if="nav.token.value"
                class="empty-state"
                @click="openLinkModalForCategory(category.id)"
              >
                <Plus /> 向此分类添加网站
              </button>
            </section>
          </template>
          <div v-if="searchQuery && !visibleLinks.length" class="no-results">
            <Search />
            <h2>没有找到相关网站</h2>
            <p>试试更短的关键词，或切换到互联网搜索。</p>
          </div>
        </template>
      </div>
    </main>

    <div v-if="linkModalOpen" class="modal-backdrop" @click.self="linkModalOpen = false">
      <form class="modal" @submit.prevent="submitLink">
        <div class="modal-title">
          <div>
            <h2>{{ editingLink.id ? '编辑网站' : '添加网站' }}</h2>
            <p>保存后将同步到本地和云端。</p>
          </div>
          <button type="button" class="icon-button" @click="linkModalOpen = false"><X /></button>
        </div>
        <label
          >名称<input
            v-model="editingLink.title"
            required
            maxlength="100"
            placeholder="例如 GitHub"
        /></label>
        <label
          >网址<input
            v-model="editingLink.url"
            required
            maxlength="2048"
            placeholder="https://example.com"
        /></label>
        <label
          >描述<textarea
            v-model="editingLink.description"
            rows="3"
            placeholder="一句话介绍这个网站"
          />
        </label>
        <div class="ai-link-actions">
          <button type="button" class="secondary-button" :disabled="aiBusy" @click="generateWithAI">
            <Sparkles :size="15" />{{ aiBusy ? 'AI 处理中…' : 'AI 生成描述并分类' }}
          </button>
          <span v-if="aiError" class="form-error">{{ aiError }}</span>
        </div>
        <div class="form-group">
          <span class="field-label">图标</span>
          <div class="icon-picker">
            <img
              v-if="editingLink.icon"
              :src="editingLink.icon"
              class="icon-preview"
              alt="图标预览"
              @error="(e) => (e.target as HTMLImageElement).src = ''"
            />
            <div v-else class="icon-preview icon-preview-empty"><Image :size="22" /></div>
            <div class="icon-picker-actions">
              <label class="secondary-button small">
                <Upload :size="14" />{{ iconUploading ? '处理中…' : '上传图片' }}
                <input
                  type="file"
                  accept="image/*"
                  class="hidden-input"
                  :disabled="iconUploading"
                  @change="onPickIconFile"
                />
              </label>
              <button
                type="button"
                class="secondary-button small"
                :disabled="iconUploading || !editingLink.icon"
                @click="onFetchIconUrl"
              >
                存入本云
              </button>
              <button
                type="button"
                class="secondary-button small"
                :disabled="iconUploading"
                @click="editingLink.icon = ''"
              >
                使用默认
              </button>
            </div>
          </div>
          <input
            v-model="editingLink.icon"
            class="field-input"
            placeholder="或直接粘贴图标 URL，留空自动获取网站 favicon"
          />
          <span v-if="iconError" class="form-error">{{ iconError }}</span>
          <p class="form-hint">不上传图标时，将自动使用该网址自身的 favicon。</p>
        </div>
        <label
          >分类<select v-model="editingLink.categoryId">
            <option
              v-for="category in nav.categories.value"
              :key="category.id"
              :value="category.id"
            >
              {{ category.name }}
            </option>
          </select></label
        >
        <div class="modal-actions">
          <button type="button" class="secondary-button" @click="linkModalOpen = false">取消</button
          ><button class="primary-button"><Check :size="17" />保存</button>
        </div>
      </form>
    </div>

    <div v-if="authModalOpen" class="modal-backdrop" @click.self="authModalOpen = false">
      <form class="login-card" @submit.prevent="submitLogin">
        <button type="button" class="login-close" aria-label="关闭" @click="authModalOpen = false">
          <X />
        </button>
        <div class="login-badge"><LogIn :size="22" /></div>
        <h2 class="login-title">管理登录</h2>
        <p class="login-sub">输入管理密码以编辑分类、网站与设置</p>
        <label class="login-field">
          <span>管理密码</span>
          <div class="login-input">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              required
              autofocus
              autocomplete="current-password"
              placeholder="请输入管理密码"
            />
            <button
              type="button"
              class="login-eye"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <Eye v-if="!showPassword" :size="18" /><EyeOff v-else :size="18" />
            </button>
          </div>
        </label>
        <transition name="fade">
          <p v-if="authError" class="form-error login-error">{{ authError }}</p>
        </transition>
        <button class="primary-button full-button" :disabled="loggingIn" type="submit">
          <LogIn :size="17" />{{ loggingIn ? '登录中…' : '登录' }}
        </button>
      </form>
    </div>

    <SettingsPanel
      :open="settingsOpen"
      :config="{
        ai: nav.config.ai,
        icon: nav.config.icon,
        webdav: nav.config.webdav,
        background: nav.config.background,
        websiteTitle: nav.config.title,
        navigationName: nav.config.navigationName,
        showPinned: nav.config.showPinned,
        defaultViewMode: nav.config.defaultViewMode,
      }"
      :token="nav.token.value"
      :categories="orderedCategories"
      :save-config-batch="nav.saveConfigBatch"
      :reorder-categories="nav.reorderCategories"
      :build-backup="buildBackupData"
      :restore-backup="restoreBackupData"
      :save-category="nav.saveCategory"
      :remove-category="nav.removeCategory"
      @close="settingsOpen = false"
      @saved="onSettingsSaved"
    />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: #eef1f9;
  color: #182230;
  background-image:
    radial-gradient(circle at 8% 6%, rgba(127, 156, 255, 0.34), transparent 34%),
    radial-gradient(circle at 30% 110%, rgba(182, 140, 255, 0.28), transparent 42%),
    radial-gradient(circle at 88% 12%, rgba(255, 176, 190, 0.22), transparent 30%),
    linear-gradient(160deg, #eef2ff 0%, #f5f0ff 48%, #eaf1fb 100%);
}
/* ===== 首开整页品牌过渡 ===== */
.brand-splash {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background:
    radial-gradient(circle at 18% 12%, rgba(113, 145, 255, 0.5), transparent 36%),
    radial-gradient(circle at 84% 30%, rgba(193, 130, 255, 0.38), transparent 32%),
    linear-gradient(150deg, #eef3ff, #f7f2ff);
  color: #182230;
}
.brand-splash::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    radial-gradient(circle at 12% 85%, rgba(113, 145, 255, 0.4), transparent 30%),
    radial-gradient(circle at 90% 90%, rgba(193, 130, 255, 0.32), transparent 26%);
}
.splash-mark {
  width: 76px;
  height: 76px;
  border-radius: 22px;
  background: linear-gradient(135deg, #4f7cff, #7758ee);
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 18px 44px rgba(79, 124, 255, 0.4);
}
.splash-logo {
  width: 44px;
  height: 44px;
  object-fit: contain;
}
.splash-name {
  font-size: 22px;
  letter-spacing: 0.4px;
}
.splash-spinner {
  margin-top: 6px;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid rgba(79, 124, 255, 0.18);
  border-top-color: #4f7cff;
  animation: splash-rotate 0.8s linear infinite;
}
@keyframes splash-rotate {
  to {
    transform: rotate(360deg);
  }
}
.splash-enter-active {
  transition: opacity 0.4s ease;
}
.splash-leave-active {
  transition: opacity 0.5s ease;
}
.splash-enter-from,
.splash-leave-to {
  opacity: 0;
}
html.dark .brand-splash {
  background:
    radial-gradient(circle at 18% 12%, rgba(71, 102, 190, 0.7), transparent 36%),
    radial-gradient(circle at 84% 30%, rgba(135, 78, 174, 0.55), transparent 32%),
    linear-gradient(150deg, #171c23, #20242e);
  color: #d5dbe3;
}
/* ===== 随机背景层 ===== */
.bg-layer {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: #f6f8fb;
}
.bg-image {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  transform: scale(1.06); /* 放大以隐藏模糊产生的边缘空白 */
}
.bg-overlay {
  position: absolute;
  inset: 0;
}
/* ===== 启用背景时的半透明覆盖（精简 backdrop-filter 以保性能）===== */
.app-shell.has-bg .header {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom-color: rgba(255, 255, 255, 0.45);
}
.app-shell.has-bg .sidebar {
  background: linear-gradient(155deg, rgba(255, 255, 255, 0.6), rgba(246, 249, 255, 0.48));
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
  border-right-color: rgba(255, 255, 255, 0.4);
}
.app-shell.has-bg .brand {
  border-bottom-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.1);
}
.app-shell.has-bg .sidebar-footer {
  border-top-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.1);
}
/* 网站卡片：纯半透明（不用 backdrop-filter，避免集成显卡多卡片卡顿） */
.app-shell.has-bg :deep(.link-card) {
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(255, 255, 255, 0.55);
  box-shadow: 0 4px 18px rgba(20, 30, 52, 0.14);
}
.app-shell.has-bg :deep(.link-card:hover) {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(255, 255, 255, 0.85);
  box-shadow: 0 10px 30px rgba(30, 44, 74, 0.22);
}
.app-shell.has-bg :deep(.link-card img) {
  background: rgba(255, 255, 255, 0.5);
}
.app-shell.has-bg :deep(.card-actions) {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.7);
}
html.dark .app-shell.has-bg .header {
  background: rgba(32, 40, 51, 0.72);
  border-bottom-color: rgba(255, 255, 255, 0.1);
}
html.dark .app-shell.has-bg .sidebar {
  background: linear-gradient(155deg, rgba(32, 40, 51, 0.62), rgba(24, 30, 38, 0.52));
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  border-right-color: rgba(255, 255, 255, 0.08);
}
html.dark .app-shell.has-bg .brand {
  border-bottom-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}
html.dark .app-shell.has-bg .sidebar-footer {
  border-top-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}
html.dark .app-shell.has-bg :deep(.link-card) {
  background: rgba(34, 41, 51, 0.72);
  border-color: rgba(255, 255, 255, 0.12);
}
html.dark .app-shell.has-bg :deep(.link-card:hover) {
  background: rgba(34, 41, 51, 0.85);
  border-color: rgba(255, 255, 255, 0.2);
}
html.dark .app-shell.has-bg :deep(.link-card img) {
  background: rgba(20, 26, 33, 0.5);
}
html.dark .app-shell.has-bg :deep(.card-actions) {
  background: rgba(34, 41, 51, 0.9);
  border-color: rgba(255, 255, 255, 0.12);
}
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 250px;
  background: rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(22px) saturate(1.7);
  -webkit-backdrop-filter: blur(22px) saturate(1.7);
  border-right: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow:
    2px 0 24px rgba(58, 78, 122, 0.08),
    12px 0 38px rgba(48, 65, 104, 0.08),
    inset -1px 0 rgba(255, 255, 255, 0.32);
  display: flex;
  flex-direction: column;
  z-index: 40;
  isolation: isolate;
  overflow: hidden;
  contain: layout paint;
  will-change: transform;
}
.sidebar::before,
.sidebar::after {
  content: '';
  position: absolute;
  border-radius: 999px;
  filter: blur(2px);
  pointer-events: none;
  z-index: -1;
}
.sidebar::before {
  width: 180px;
  height: 180px;
  top: -70px;
  right: -65px;
  background: rgba(134, 157, 255, 0.22);
}
.sidebar::after {
  width: 150px;
  height: 150px;
  bottom: 80px;
  left: -85px;
  background: rgba(210, 157, 255, 0.17);
}
.brand {
  height: 68px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.14);
}
.brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #4f7cff, #7758ee);
  color: white;
  display: grid;
  place-items: center;
  box-shadow: 0 7px 18px rgba(79, 124, 255, 0.3);
}
.brand strong {
  font-size: 17px;
  flex: 1;
  font-weight: 800;
  letter-spacing: 0.2px;
  background: linear-gradient(120deg, #6a5cff 0%, #a94fe8 55%, #ec4d9c 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
.category-nav {
  padding: 12px 10px;
  overflow: auto;
  flex: 1;
  overscroll-behavior: contain;
}
.category-section-label {
  margin: 2px 10px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(74, 85, 104, 0.6);
}
.category-nav-item {
  display: flex;
  align-items: stretch;
}
.category-nav-item > button:first-child {
  width: 100%;
  min-width: 0;
}
.category-nav button,
.sidebar-footer button {
  width: 100%;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.18);
  color: #596579;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 9px;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease,
    box-shadow 0.18s ease;
}
.category-nav button:hover,
.sidebar-footer button:hover {
  background: rgba(255, 255, 255, 0.4);
  border-color: rgba(255, 255, 255, 0.7);
  color: #315ed5;
  box-shadow: 0 5px 15px rgba(63, 84, 133, 0.08);
  transform: translateX(2px);
}
.category-nav button.active {
  background: linear-gradient(120deg, rgba(107, 95, 255, 0.16), rgba(210, 90, 230, 0.12));
  border-color: rgba(122, 102, 255, 0.32);
  color: #5b4bff;
  box-shadow: 0 6px 18px rgba(80, 70, 180, 0.1);
}
.category-nav button > span.category-name {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.category-nav button.subcategory {
  margin-left: 14px;
  width: calc(100% - 14px);
  padding-left: 18px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 12px;
}
.category-nav button.dragging {
  opacity: 0.5;
}
.category-nav button.drag-hover {
  border-color: rgba(79, 124, 255, 0.7);
  box-shadow:
    inset 0 2px 0 #4f7cff,
    0 0 0 1px rgba(79, 124, 255, 0.35);
}
.category-nav,
.category-nav button {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  touch-action: manipulation;
}
:global(body.sorting-categories) {
  -webkit-user-select: none;
  user-select: none;
  cursor: grabbing;
}
:global(body.sorting-categories) * {
  cursor: grabbing;
}
:global(body.sorting-links) {
  cursor: grabbing;
}
:global(body.sorting-links) * {
  cursor: grabbing;
}
.category-toggle {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 6px;
  cursor: pointer;
}
.category-toggle:hover {
  background: rgba(79, 124, 255, 0.12);
}
.category-toggle svg {
  transition: transform 0.15s ease;
}
.category-toggle svg.expanded {
  transform: rotate(90deg);
}
.sidebar-footer {
  padding: 12px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.12);
}
.main-area {
  margin-left: 250px;
  min-height: 100vh;
  position: relative;
  z-index: 1;
}
.header {
  height: 68px;
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.96);
  border-bottom: 1px solid #e7eaf0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 28px;
}
.search-box {
  height: 40px;
  max-width: 560px;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  background: #f2f4f8;
  border: 1px solid transparent;
  padding: 0 13px;
  border-radius: 12px;
  color: #738096;
}
.search-box:focus-within {
  background: #fff;
  border-color: #7b9cff;
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.12);
}
.search-box input {
  border: 0;
  outline: 0;
  background: transparent;
  width: 100%;
  font: inherit;
  color: inherit;
}
.clear-search {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.search-switch {
  font-size: 12px;
  color: #647087;
  display: flex;
  gap: 6px;
  align-items: center;
  white-space: nowrap;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.icon-button {
  width: 38px;
  height: 38px;
  border: 1px solid #e2e6ed;
  background: #fff;
  color: #5b687d;
  border-radius: 10px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.icon-button svg {
  width: 19px;
}
.icon-button:hover {
  background: #f3f6fb;
  color: #315ed5;
}
.icon-button.small {
  width: 30px;
  height: 30px;
}
.icon-button.small svg {
  width: 14px;
}
.icon-button.danger:hover {
  color: #dc3545;
}
.primary-button,
.secondary-button {
  height: 40px;
  border-radius: 10px;
  padding: 0 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 0;
  font-weight: 650;
  cursor: pointer;
}
.primary-button {
  background: #426be3;
  color: white;
  box-shadow: 0 5px 12px rgba(66, 107, 227, 0.2);
}
.primary-button:hover {
  background: #315bd3;
}
.secondary-button {
  background: #eef1f6;
  color: #526076;
}
.content {
  max-width: 1600px;
  margin: auto;
  padding: 30px 32px 80px;
}
.category-section {
  scroll-margin-top: 84px;
  margin-bottom: 35px;
  border-radius: 16px;
  transition:
    background-color 0.25s ease,
    box-shadow 0.25s ease;
}
.category-section.is-active {
  background: rgba(123, 156, 255, 0.07);
  box-shadow: 0 0 0 1px rgba(123, 156, 255, 0.18);
}
.category-section h2 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 18px;
  margin: 0 0 14px;
}
.category-section h2 span {
  font-size: 11px;
  background: #e9edf4;
  color: #748096;
  padding: 2px 7px;
  border-radius: 20px;
}
.pinned-section {
  margin-inline: -8px;
  padding: 27px 28px 29px;
  border-radius: 20px;
  background: linear-gradient(135deg, #eef3ff, #f6f2ff);
  border: 1px solid #dfe7ff;
}
.pinned-section h2 {
  margin-bottom: 18px;
}
.pinned-section .link-grid {
  gap: 16px;
}
.pinned-section .link-card {
  min-height: clamp(84px, 9vw, 116px);
  padding: clamp(15px, 2vw, 24px);
  gap: clamp(14px, 1.6vw, 20px);
}
.pinned-section .link-grid.compact .link-card {
  min-height: 64px;
  padding: 11px 14px;
}
.subcategory-section {
  margin-left: 22px;
  padding-left: 18px;
  border-left: 2px solid rgba(123, 156, 255, 0.18);
  margin-bottom: 22px;
}
.subcategory-section h2 {
  font-size: 15px;
  margin: 0 0 12px;
}
.subcategory-section h2 span {
  font-size: 10px;
}
.subcategory-section:last-child {
  margin-bottom: 0;
}
.pinned-section h2 {
  color: #4968ca;
}
.section-title {
  display: flex;
  align-items: center;
}
.section-title h2 {
  flex: 1;
}
.section-actions {
  display: flex;
  gap: 5px;
}
.link-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: clamp(12px, 1.4vw, 18px);
}
/* 网格项最小宽度归零，避免内容撑开卡片导致异常拉长 */
.link-grid > * {
  min-width: 0;
}
.link-grid.compact {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
  gap: 10px;
}
.link-card-wrap {
  position: relative;
  /* Keep layout containment without clipping the hover transform. */
  contain: layout;
}
.link-card {
  min-height: 82px;
  padding: 14px;
  display: flex;
  align-items: center;
  gap: 13px;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 13px;
  text-decoration: none;
  color: inherit;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
  box-shadow: 0 2px 5px rgba(28, 39, 60, 0.025);
}
.compact .link-card {
  min-height: 56px;
  padding: 9px 11px;
}
.link-card:hover {
  transform: translateY(-2px);
  border-color: #aabcf2;
  box-shadow: 0 8px 24px rgba(42, 60, 100, 0.1);
}
.link-card img {
  width: clamp(40px, 4.5vw, 52px);
  height: clamp(40px, 4.5vw, 52px);
  object-fit: contain;
  border-radius: 10px;
  background: #f4f6f9;
  padding: 6px;
}
.compact .link-card img {
  width: 32px;
  height: 32px;
}
.link-card div {
  min-width: 0;
}
.link-card strong {
  font-size: clamp(14px, 1.5vw, 17px);
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.link-card p {
  font-size: clamp(12px, 1.15vw, 13.5px);
  color: #7a8699;
  margin: 5px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-actions {
  position: absolute;
  right: 7px;
  top: 7px;
  display: none;
  background: #fff;
  border: 1px solid #e5e8ed;
  border-radius: 8px;
  padding: 2px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
}
.link-card-wrap:hover .card-actions {
  display: flex;
}
.card-actions button {
  width: 27px;
  height: 27px;
  border: 0;
  background: transparent;
  color: #718096;
  border-radius: 6px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.card-actions button:hover {
  background: #edf2ff;
  color: #315ed5;
}
.empty-state {
  width: 100%;
  padding: 22px;
  border: 1px dashed #cdd4df;
  border-radius: 12px;
  background: transparent;
  color: #8792a3;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.loading-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.skeleton {
  height: 82px;
  border-radius: 13px;
  background: linear-gradient(90deg, #e9edf2 25%, #f5f6f8 50%, #e9edf2 75%);
  background-size: 200% 100%;
  animation: shine 1.5s infinite;
  border: 1px solid rgba(210, 218, 231, 0.8);
}
.no-results {
  text-align: center;
  padding: 100px 20px;
  color: #8490a3;
}
.no-results svg {
  width: 42px;
  height: 42px;
}
.no-results h2 {
  color: #465166;
}
.sync-status {
  font-size: 11px;
  color: #6e7b8e;
}
.sync-status.saved {
  color: #208c58;
}
.sync-status.error,
.form-error {
  color: #d64242;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(18, 27, 42, 0.48);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 100;
  padding: 20px;
}
.modal {
  width: min(540px, 100%);
  max-height: calc(100vh - 40px);
  overflow: auto;
  background: #fff;
  border-radius: 18px;
  padding: 23px;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.25);
}
.small-modal {
  width: min(420px, 100%);
}
.modal-title {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}
.modal-title > div {
  flex: 1;
}
.modal-title h2 {
  margin: 0 0 4px;
  font-size: 20px;
}
.modal-title p {
  margin: 0;
  color: #8590a1;
  font-size: 13px;
}
.modal label {
  font-size: 13px;
  font-weight: 600;
  color: #4d596a;
  display: block;
  margin: 13px 0;
}
.modal-help {
  margin: -4px 0 0;
  color: #8490a3;
  font-size: 12px;
}
/* ===== 链接表单：图标上传 ===== */
.form-group {
  margin: 15px 0;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  color: #4d596a;
}
.icon-picker {
  display: flex;
  align-items: center;
  gap: 13px;
  margin: 8px 0 11px;
}
.icon-preview {
  width: 50px;
  height: 50px;
  object-fit: contain;
  border-radius: 11px;
  background: #f4f6f9;
  border: 1px solid #e6e9ef;
  padding: 6px;
  flex: 0 0 auto;
}
.icon-preview-empty {
  display: grid;
  place-items: center;
  color: #94a0b4;
  border: 1px dashed #cdd4df;
}
.icon-picker-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.icon-picker-actions .secondary-button {
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}
.form-hint {
  margin: 6px 0 0;
  color: #8490a3;
  font-size: 12px;
}
.form-error {
  color: #e04f4d;
  font-size: 12px;
  margin-top: 6px;
  display: block;
}
.modal input,
.modal textarea,
.modal select {
  width: 100%;
  box-sizing: border-box;
  margin-top: 7px;
  border: 1px solid #dce1e8;
  border-radius: 9px;
  padding: 10px 11px;
  background: #fff;
  color: inherit;
  font: inherit;
  outline: 0;
}
.modal input:focus,
.modal textarea:focus,
.modal select:focus {
  border-color: #6284e8;
  box-shadow: 0 0 0 3px rgba(78, 119, 231, 0.1);
}
.modal-actions {
  margin-top: 22px;
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
.full-button {
  width: 100%;
  margin-top: 12px;
}
/* ===== 登录卡片 ===== */
.login-card {
  position: relative;
  width: min(380px, 100%);
  background: #fff;
  border-radius: 20px;
  padding: 30px 26px 26px;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.28);
  text-align: center;
}
html.dark .login-card {
  background: #202833;
  border: 1px solid #343d49;
}
.login-close {
  position: absolute;
  right: 14px;
  top: 14px;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #8490a1;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.login-close:hover {
  background: rgba(120, 130, 150, 0.12);
  color: #315ed5;
}
.login-badge {
  width: 54px;
  height: 54px;
  margin: 2px auto 14px;
  border-radius: 16px;
  background: linear-gradient(135deg, #4f7cff, #7758ee);
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 10px 24px rgba(79, 124, 255, 0.34);
}
.login-title {
  margin: 0 0 6px;
  font-size: 21px;
  color: #182230;
}
html.dark .login-title {
  color: #dce4ef;
}
.login-sub {
  margin: 0 0 20px;
  font-size: 13px;
  color: #8692a3;
}
.login-field {
  display: block;
  text-align: left;
  font-size: 13px;
  font-weight: 650;
  color: #4d596a;
}
html.dark .login-field {
  color: #c3ccd8;
}
.login-field span {
  display: block;
  margin-bottom: 7px;
}
.login-input {
  position: relative;
  display: flex;
  align-items: center;
}
.login-input input {
  width: 100%;
  box-sizing: border-box;
  height: 46px;
  padding: 0 44px 0 13px;
  border: 1px solid #dce1e8;
  border-radius: 11px;
  background: #fff;
  color: inherit;
  font: inherit;
  outline: 0;
}
.login-input input:focus {
  border-color: #6284e8;
  box-shadow: 0 0 0 3px rgba(78, 119, 231, 0.12);
}
html.dark .login-input input {
  background: #171d25;
  border-color: #414a57;
  color: #dbe1e8;
}
.login-eye {
  position: absolute;
  right: 6px;
  width: 34px;
  height: 34px;
  border: 0;
  background: transparent;
  color: #8a95a7;
  border-radius: 8px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.login-eye:hover {
  color: #315ed5;
}
.login-error {
  margin: 12px 0 0;
}
html.dark .login-card .primary-button:disabled {
  opacity: 0.6;
  cursor: wait;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.sidebar-mask,
.mobile-only {
  display: none;
}
.desktop-only {
  display: none;
}
/* 桌面端显示侧栏切换按钮 */
@media (min-width: 851px) {
  .desktop-only {
    display: grid;
  }
  /* 侧栏收起状态 */
  .sidebar {
    transition:
      transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .sidebar.collapsed {
    transform: translateX(-250px);
    width: 0;
  }
  .main-area {
    transition: margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .main-area.sidebar-collapsed {
    margin-left: 0;
  }
  .sidebar-toggle {
    flex: 0 0 auto;
  }
  .sidebar-toggle svg {
    transition: transform 0.2s ease;
  }
  .main-area:not(.sidebar-collapsed) .sidebar-toggle svg {
    transform: none;
  }
}
@keyframes shine {
  to {
    background-position: -200% 0;
  }
}
html.dark .app-shell {
  background: #171c23;
  color: #d5dbe3;
  background-image:
    radial-gradient(circle at 10% 2%, rgba(71, 102, 190, 0.24), transparent 30%),
    radial-gradient(circle at 88% 18%, rgba(135, 78, 174, 0.18), transparent 26%);
}
html.dark .sidebar {
  background: rgba(24, 31, 41, 0.55);
  backdrop-filter: blur(22px) saturate(1.2);
  -webkit-backdrop-filter: blur(22px) saturate(1.2);
  border-color: rgba(172, 194, 230, 0.14);
  box-shadow:
    2px 0 24px rgba(0, 0, 0, 0.18),
    inset -1px 0 rgba(255, 255, 255, 0.05);
}
html.dark .category-section-label {
  color: rgba(190, 200, 216, 0.5);
}
html.dark .sidebar::before {
  background: rgba(71, 105, 204, 0.2);
}
html.dark .sidebar::after {
  background: rgba(141, 85, 185, 0.15);
}
html.dark .header,
html.dark .modal,
html.dark .link-card,
html.dark .icon-button,
html.dark .card-actions {
  background: #222933;
  border-color: #343d49;
}
html.dark .header {
  background: rgba(34, 41, 51, 0.96);
  border-color: rgba(172, 194, 230, 0.14);
}
html.dark .search-box {
  background: #181e26;
}
html.dark .category-nav button,
html.dark .sidebar-footer button,
html.dark .link-card p {
  color: #9ba7b7;
}
html.dark .category-nav button,
html.dark .sidebar-footer button {
  background: rgba(255, 255, 255, 0.035);
  border-color: transparent;
}
html.dark .category-nav button:hover,
html.dark .sidebar-footer button:hover {
  background: rgba(115, 145, 224, 0.18);
  border-color: rgba(145, 171, 246, 0.25);
  color: #c9d8ff;
}
html.dark .category-nav button.active {
  background: rgba(115, 145, 224, 0.24);
  border-color: rgba(145, 171, 246, 0.38);
  color: #d8e3ff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
}
html.dark .brand,
html.dark .sidebar-footer {
  border-color: rgba(172, 194, 230, 0.16);
  background: rgba(255, 255, 255, 0.035);
}
html.dark .pinned-section {
  background: linear-gradient(135deg, #202a3f, #29243a);
  border-color: #35415e;
}
html.dark .category-nav button.subcategory {
  background: rgba(255, 255, 255, 0.025);
}
html.dark .subcategory-section {
  border-left-color: rgba(145, 171, 246, 0.24);
}
html.dark .skeleton {
  background: linear-gradient(90deg, #222b38 25%, #303b4b 50%, #222b38 75%);
  border-color: #364355;
}
html.dark .category-section.is-active {
  background: rgba(115, 145, 224, 0.1);
  box-shadow: 0 0 0 1px rgba(145, 171, 246, 0.22);
}
html.dark .modal input,
html.dark .modal textarea,
html.dark .modal select {
  background: #171d25;
  border-color: #414a57;
  color: #dbe1e8;
}
html.dark .brand,
html.dark .sidebar-footer {
  border-color: #343d49;
}
html.dark .secondary-button {
  background: #343d49;
  color: #d1d8e2;
}
@media (max-width: 850px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.2s;
  }
  .sidebar.open {
    transform: translateX(0);
  }
  .sidebar-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 35;
  }
  .main-area {
    margin-left: 0;
  }
  .mobile-only {
    display: grid;
  }
  .header {
    padding: 0 12px;
  }
  .search-switch {
    display: none;
  }
  .primary-button span {
    display: none;
  }
  .primary-button {
    width: 40px;
    padding: 0;
  }
  .content {
    padding: 22px 16px 70px;
  }
  .link-grid {
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  }
  .link-card {
    min-height: 76px;
    padding: 13px;
  }
  .link-card img {
    width: 38px;
    height: 38px;
  }
  .link-card p {
    /* 移动端展示两行描述，替代原来的隐藏 */
    display: -webkit-box;
    white-space: normal;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.35;
  }
  .card-actions {
    display: flex;
  }
  .category-section {
    margin-bottom: 28px;
  }
}

/* 手机端固定双列卡片，左右并排展示 */
@media (max-width: 640px) {
  .content {
    padding: 16px 12px 60px;
  }
  .category-section h2 {
    font-size: 16px;
  }
  .link-grid,
  .link-grid.compact,
  .pinned-section .link-grid,
  .pinned-section .link-grid.compact,
  .loading-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .link-card {
    min-height: 84px;
    padding: 11px;
    gap: 9px;
    border-radius: 12px;
  }
  .pinned-section {
    margin-inline: 0;
    padding: 18px 14px 20px;
  }
  .link-card img {
    width: 34px;
    height: 34px;
    padding: 5px;
  }
  .link-card strong {
    font-size: 13.5px;
  }
  .link-card p {
    font-size: 11px;
    margin-top: 4px;
    -webkit-line-clamp: 2;
  }
  .compact .link-card {
    min-height: 62px;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 10px;
  }
  .compact .link-card p {
    display: -webkit-box;
    -webkit-line-clamp: 2;
  }
}
</style>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import type { Component } from 'vue'
import {
  ArrowUpRight,
  Banknote,
  Bookmark,
  BookOpen,
  Box,
  Briefcase,
  Building2,
  Calendar,
  Camera,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock,
  Cloud,
  CloudSun,
  Code,
  Coffee,
  Compass,
  Cpu,
  CreditCard,
  Database,
  Dumbbell,
  Eye,
  EyeOff,
  FileText,
  Folder,
  Gamepad2,
  Gift,
  Github,
  Globe,
  Globe2,
  GraduationCap,
  Grid2X2,
  Heart,
  Home,
  Image,
  Landmark,
  Layers,
  LayoutList,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Moon,
  Music,
  Newspaper,
  Palette,
  PanelLeft,
  PenTool,
  PieChart,
  Plane,
  Plus,
  Rocket,
  Search,
  Server,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Slack,
  Sparkles,
  Star,
  Stethoscope,
  Sun,
  Target,
  TrendingUp,
  Tv,
  Users,
  Wifi,
  Wrench,
  X,
  Zap,
} from 'lucide-vue-next'
import type { Category, LinkItem } from '../types'
import { useCloudNav } from './composables/useCloudNav'
import { useRandomBackground } from './composables/useRandomBackground'
import { useWeather } from './composables/useWeather'
import { useTicker } from './composables/useTicker'
import LinkGrid from './components/LinkGrid.vue'
import { favicon, handleFaviconError } from './composables/useFavicon'
import { isEmojiIcon } from './services/categoryIconUtil'
import { safeTargetUrl } from './utils/url'
import { generateLinkDescription, suggestCategory } from './services/aiService'
import { fetchSiteMetadata } from './services/siteMetadataService'

const SettingsPanel = defineAsyncComponent(() => import('./components/SettingsPanel.vue'))

const nav = useCloudNav()
const background = useRandomBackground()
const { data: weatherData, refresh: refreshWeather, stopAll: stopWeather } = useWeather(nav.config)
const { items: tickerItems } = useTicker(nav.config)
const searchQuery = ref('')
// '' 表示站内搜索，否则为所选中外部搜索引擎的 id
const searchMode = ref('')
const searchModeMenuOpen = ref(false)
const searchModePicker = ref<HTMLElement | null>(null)
const externalSearch = computed(() => searchMode.value !== '')
const externalSources = computed(() =>
  (nav.config.search?.externalSources || []).filter(source => source.enabled && source.url)
)
const activeSearchSource = computed(
  () => externalSources.value.find(source => source.id === searchMode.value) || null
)

// ===== 命令面板（Ctrl+K）=====
const commandOpen = ref(false)
const commandQuery = ref('')
const commandIndex = ref(0)
const commandInput = ref<HTMLInputElement | null>(null)

type CommandItem = {
  key: string
  kind: 'action' | 'link' | 'category'
  label: string
  hint: string
  icon?: Component
  exec: () => void
}

const commandActions = computed<Array<CommandItem & { match: string[] }>>(() => [
  {
    key: 'settings',
    kind: 'action',
    label: '打开设置',
    hint: '外观 · 背景 · 分类 · AI · 同步',
    icon: Settings,
    match: ['设置', 'settings', '配置', 'option'],
    exec: () => {
      closeCommand()
      settingsOpen.value = true
    },
  },
  {
    key: 'theme',
    kind: 'action',
    label: dark.value ? '切换为浅色主题' : '切换为深色主题',
    hint: '当前：' + (dark.value ? '深色' : '浅色'),
    icon: dark.value ? Sun : Moon,
    match: ['主题', 'theme', '深色', '浅色', 'dark', 'light', '模式'],
    exec: () => {
      closeCommand()
      toggleTheme()
    },
  },
])

const commandItems = computed<CommandItem[]>(() => {
  const q = commandQuery.value.trim().toLowerCase()
  const items: CommandItem[] = []
  // 操作（始终在列，空查询也展示常用操作）
  for (const action of commandActions.value) {
    if (
      !q ||
      action.label.toLowerCase().includes(q) ||
      action.match.some(term => term.toLowerCase().includes(q))
    ) {
      items.push({
        key: action.key,
        kind: action.kind,
        label: action.label,
        hint: action.hint,
        icon: action.icon,
        exec: action.exec,
      })
    }
  }
  if (!q) return items
  // 链接
  for (const link of nav.links.value) {
    const title = link.title.toLowerCase()
    const url = link.url.toLowerCase()
    if (title.includes(q) || url.includes(q)) {
      items.push({
        key: `link-${link.id}`,
        kind: 'link',
        label: link.title,
        hint: link.url,
        exec: () => {
          closeCommand()
          window.open(safeTargetUrl(link.url), '_blank', 'noopener')
        },
      })
    }
  }
  // 分类（含二级）
  for (const category of orderedCategories.value) {
    if (category.name.toLowerCase().includes(q)) {
      items.push({
        key: `cat-${category.id}`,
        kind: 'category',
        label: category.name,
        hint: category.parentId ? '二级分类' : '分类',
        exec: () => {
          closeCommand()
          jumpTo(category.id)
        },
      })
    }
  }
  return items
})

watch(commandQuery, () => {
  commandIndex.value = 0
})

function openCommand() {
  commandQuery.value = ''
  commandIndex.value = 0
  commandOpen.value = true
  nextTick(() => commandInput.value?.focus())
}
function closeCommand() {
  commandOpen.value = false
}
function moveCommand(delta: number) {
  const len = commandItems.value.length
  if (!len) return
  commandIndex.value = (commandIndex.value + delta + len) % len
}
function runCommand() {
  const item = commandItems.value[commandIndex.value]
  if (item) item.exec()
}
function onCommandKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    openCommand()
    return
  }
  if (!commandOpen.value) return
  if (event.key === 'Escape') {
    closeCommand()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveCommand(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveCommand(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    runCommand()
  }
}
const sidebarOpen = ref(false)
// 默认收起侧栏：除非用户之前显式保存了展开状态（'0'），否则始终为收起态。
const sidebarCollapsed = ref(localStorage.getItem('cloudnav_sidebar_collapsed') !== '0')
const dark = ref(localStorage.getItem('cloudnav_theme_preference') === 'dark')
const savedViewMode = localStorage.getItem('cloudnav_view_mode')
const hasSavedViewMode = savedViewMode === 'compact' || savedViewMode === 'detailed'
const compact = ref(savedViewMode === 'compact')
const linkModalOpen = ref(false)
const categoryPickerOpen = ref(false)
const categoryPickerExpandedIds = ref<Set<string>>(new Set())
const authModalOpen = ref(false)
const settingsOpen = ref(false)
const hideTools = ref(localStorage.getItem('cloudnav_hide_tools') === '1')
const editingLink = ref<Partial<LinkItem>>({})
const iconError = ref('')
// 编辑弹窗内实时预览该网址自身的 favicon（如图标被覆盖则优先显示自定义图标）
const editingFaviconPreview = computed<string>(() => {
  if (editingLink.value.icon) return editingLink.value.icon
  const raw = editingLink.value.url?.trim() || ''
  if (!raw) return ''
  try {
    const hostname = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
    return `/api/favicon?domain=${encodeURIComponent(hostname)}`
  } catch {
    return ''
  }
})
const splashIconBroken = ref(false)
const splashIconSrc = computed(() => nav.config.ai.faviconUrl || '/favicon.ico')
const password = ref('')
const authError = ref('')
const showPassword = ref(false)
const loggingIn = ref(false)
const aiBusy = ref(false)
const aiError = ref('')
const metadataBusy = ref(false)
const metadataStatus = ref('')
let metadataTimer: number | undefined
let metadataController: AbortController | undefined
let lastEnrichedUrl = ''
let lastAutoTitle = ''
let lastAutoDescription = ''
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

const pageOverlayOpen = computed(
  () => linkModalOpen.value || authModalOpen.value || settingsOpen.value || commandOpen.value
)

function setPageScrollLocked(locked: boolean) {
  document.documentElement.classList.toggle('overlay-scroll-locked', locked)
  document.body.classList.toggle('overlay-scroll-locked', locked)
}

watch(pageOverlayOpen, setPageScrollLocked, { immediate: true })

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

const selectedCategoryDetails = computed(() => {
  const category = categoryMap.value.get(editingLink.value.categoryId || '')
  if (!category) return null
  const parent = category.parentId ? categoryMap.value.get(category.parentId) : undefined
  return {
    category,
    parent,
    childCount: categoryChildren(category.id).length,
  }
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

function prepareCategoryPicker(categoryId?: string) {
  const category = categoryMap.value.get(categoryId || '')
  const parentId =
    category?.parentId || (category && categoryChildren(category.id).length ? category.id : '')
  categoryPickerExpandedIds.value = parentId ? new Set([parentId]) : new Set()
  categoryPickerOpen.value = false
}

function toggleCategoryPickerGroup(categoryId: string) {
  const next = new Set(categoryPickerExpandedIds.value)
  if (next.has(categoryId)) next.delete(categoryId)
  else next.add(categoryId)
  categoryPickerExpandedIds.value = next
}

function selectLinkCategory(categoryId: string) {
  editingLink.value.categoryId = categoryId
  categoryPickerOpen.value = false
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
  // 点击分类本体始终导航过去。若该分类含二级且当前处于折叠状态，先把二级展开，
  // 让二级分类浮现，用户随后即可直接进入任意二级分类。
  if (categoryChildren(category.id).length && !isCategoryExpanded(category.id)) {
    const next = new Set(collapsedCategoryIds.value)
    next.delete(category.id)
    collapsedCategoryIds.value = next
    localStorage.setItem('cloudnav_collapsed_categories', JSON.stringify([...next]))
  }
  jumpTo(category.id)
}

const visibleLinks = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query || externalSearch.value) return nav.links.value
  return nav.links.value.filter(link => linkSearchHit(link, query))
})

// 网站是否命中搜索：严格按名称／网址／描述匹配，不按分类名整类带出。
function linkSearchHit(link: LinkItem, query: string): boolean {
  return searchableText(link).includes(query)
}

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
    // 主归属
    pushToGroup(grouped, link.categoryId, link)
    // 叠加显示到「常用推荐」
    if (link.alsoInCommon && link.categoryId !== 'common') pushToGroup(grouped, 'common', link)
  }
  for (const items of grouped.values()) {
    items.sort(
      (a, b) => (a.weight ?? Infinity) - (b.weight ?? Infinity) || (a.order ?? 0) - (b.order ?? 0)
    )
  }
  return grouped
})

function pushToGroup(grouped: Map<string, LinkItem[]>, categoryId: string, link: LinkItem) {
  const items = grouped.get(categoryId)
  if (items) items.push(link)
  else grouped.set(categoryId, [link])
}

function categoryLinks(categoryId: string) {
  return linksByCategory.value.get(categoryId) || []
}

// 搜索态命中的目录（含二级）：仅当该目录下存在“命中”的网站（自身名称/网址/描述
// 命中）时才作为一个区块展示；否则直接隐藏，不显示空态。
const matchingCategories = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query || externalSearch.value) return []
  const result: Array<{ category: Category; children: Category[] }> = []
  for (const category of topLevelCategories.value) {
    const children = categoryChildren(category.id).filter(
      child => categoryLinks(child.id).length > 0
    )
    if (categoryLinks(category.id).length > 0 || children.length) {
      result.push({ category, children })
    }
  }
  return result
})

// 搜索态底部需要以“正常分类区块”形态展示命中的目录；一级分区的所有子分区
//（一级命中名 / 二级命中名）一律按完整区块列出，父后接子，浏览观感与正常一致。
const matchedCategoryIds = computed(() => {
  const ids = new Set<string>()
  for (const { category, children } of matchingCategories.value) {
    ids.add(category.id)
    for (const child of children) ids.add(child.id)
  }
  return ids
})

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

/** 分类专属图标：根据分类 icon 字段渲染对应 Lucide 图标，未匹配时回退到文件夹。 */
const CATEGORY_ICON_MAP: Record<string, Component> = {
  Banknote,
  Bookmark,
  BookOpen,
  Box,
  Briefcase,
  Building2,
  Calendar,
  Camera,
  Car,
  Clapperboard,
  Clock,
  Cloud,
  Code,
  Coffee,
  Compass,
  Cpu,
  CreditCard,
  Database,
  Dumbbell,
  FileText,
  Folder,
  Gamepad2,
  Gift,
  Github,
  Globe,
  Globe2,
  GraduationCap,
  Grid2X2,
  Heart,
  Home,
  Image,
  Landmark,
  Layers,
  LayoutList,
  Mail,
  MapPin,
  MessageCircle,
  Music,
  Newspaper,
  Palette,
  PenTool,
  PieChart,
  Plane,
  Rocket,
  Server,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Slack,
  Sparkles,
  Star,
  Stethoscope,
  Target,
  TrendingUp,
  Tv,
  Users,
  Wifi,
  Wrench,
  Zap,
}

function getCategoryIcon(name?: string): Component {
  return (name && CATEGORY_ICON_MAP[name]) || Folder
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
  const source = externalSources.value.find(s => s.id === searchMode.value)
  if (!source) return
  let url = source?.url || ''
  const encoded = encodeURIComponent(query)
  if (url.includes('{query}')) url = url.replace(/\{query\}/g, encoded)
  else if (url.includes('%s')) url = url.replace(/%s/g, encoded)
  else url = url.replace(/[?&]$/, '') + (url.includes('?') ? '&' : '?') + 'q=' + encoded
  window.open(url, '_blank', 'noopener')
  searchQuery.value = ''
}

function selectSearchMode(mode: string) {
  searchMode.value = mode
  searchModeMenuOpen.value = false
  void nextTick(() => searchInput.value?.focus())
}

function closeSearchModeMenuOnOutsideClick(event: PointerEvent) {
  if (!searchModeMenuOpen.value) return
  if (!searchModePicker.value?.contains(event.target as Node)) searchModeMenuOpen.value = false
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
  lastEnrichedUrl = link?.url || ''
  lastAutoTitle = ''
  lastAutoDescription = ''
  metadataStatus.value = ''
  aiError.value = ''
  prepareCategoryPicker(editingLink.value.categoryId)
  iconError.value = ''
  linkModalOpen.value = true
}

function openLinkModalForCategory(categoryId: string) {
  editingLink.value = { categoryId }
  lastEnrichedUrl = ''
  lastAutoTitle = ''
  lastAutoDescription = ''
  metadataStatus.value = ''
  aiError.value = ''
  prepareCategoryPicker(categoryId)
  iconError.value = ''
  linkModalOpen.value = true
}

function normalizeWebsiteUrl(value?: string) {
  const raw = value?.trim() || ''
  if (!raw) return ''
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes('.')
      ? parsed.toString()
      : ''
  } catch {
    return ''
  }
}

async function enrichWebsite(force = false) {
  const requestedUrl = normalizeWebsiteUrl(editingLink.value.url)
  if (!requestedUrl || (!force && requestedUrl === lastEnrichedUrl)) return

  metadataController?.abort()
  metadataController = new AbortController()
  const controller = metadataController
  metadataBusy.value = true
  metadataStatus.value = '正在识别网站名称与图标…'
  aiError.value = ''

  try {
    const metadata = await fetchSiteMetadata(requestedUrl, controller.signal)
    if (controller.signal.aborted || normalizeWebsiteUrl(editingLink.value.url) !== requestedUrl)
      return

    if (!editingLink.value.title?.trim() || editingLink.value.title === lastAutoTitle) {
      editingLink.value.title = metadata.title
      lastAutoTitle = metadata.title
    }
    if (!editingLink.value.icon || editingLink.value.icon.startsWith('/api/favicon?domain=')) {
      editingLink.value.icon = metadata.icon
    }
    lastEnrichedUrl = requestedUrl
    metadataStatus.value = '名称和图标已识别，正在生成 AI 描述…'

    const title = editingLink.value.title?.trim()
    if (!title) {
      metadataStatus.value = '名称和图标已识别'
      return
    }

    aiBusy.value = true
    const tasks: Promise<unknown>[] = [generateLinkDescription(title, requestedUrl)]
    const canSuggestCategory = !editingLink.value.id
    if (canSuggestCategory) {
      tasks.push(suggestCategory(title, requestedUrl, nav.categories.value))
    }
    const results = await Promise.allSettled(tasks)
    if (controller.signal.aborted || normalizeWebsiteUrl(editingLink.value.url) !== requestedUrl)
      return

    const descriptionResult = results[0]
    if (descriptionResult.status === 'fulfilled' && typeof descriptionResult.value === 'string') {
      if (
        !editingLink.value.description?.trim() ||
        editingLink.value.description === lastAutoDescription
      ) {
        editingLink.value.description = descriptionResult.value
        lastAutoDescription = descriptionResult.value
      }
    }
    const categoryResult = results[1]
    if (categoryResult?.status === 'fulfilled' && typeof categoryResult.value === 'string') {
      editingLink.value.categoryId = categoryResult.value
      prepareCategoryPicker(categoryResult.value)
    }
    if (descriptionResult.status === 'rejected') {
      aiError.value =
        descriptionResult.reason instanceof Error
          ? `名称和图标已识别；${descriptionResult.reason.message}`
          : '名称和图标已识别；AI 描述生成失败'
      metadataStatus.value = ''
    } else {
      metadataStatus.value = '网站信息已自动补全，你仍可手动修改'
    }
  } catch (error) {
    if (controller.signal.aborted) return
    metadataStatus.value = ''
    aiError.value = error instanceof Error ? error.message : '无法识别该网站，请手动填写'
  } finally {
    if (metadataController === controller) {
      metadataController = undefined
      metadataBusy.value = false
      aiBusy.value = false
    }
  }
}

async function submitLink() {
  if (!editingLink.value.title?.trim() || !editingLink.value.url?.trim()) return
  let url = editingLink.value.url.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  // 主分类已是「常用推荐」时，叠加开关无意义，归一化掉。
  const payload = { ...editingLink.value }
  if (payload.categoryId === 'common') payload.alsoInCommon = false
  await nav.saveLink({ ...payload, title: editingLink.value.title.trim(), url })
  linkModalOpen.value = false
}

async function generateWithAI() {
  if (!normalizeWebsiteUrl(editingLink.value.url)) {
    aiError.value = '请先填写有效的网址'
    return
  }
  if (!editingLink.value.title?.trim()) {
    await enrichWebsite(true)
    return
  }
  aiBusy.value = true
  aiError.value = ''
  try {
    const [description, categoryId] = await Promise.all([
      generateLinkDescription(editingLink.value.title, editingLink.value.url),
      suggestCategory(editingLink.value.title, editingLink.value.url, nav.categories.value),
    ])
    if (description) editingLink.value.description = description
    if (categoryId) editingLink.value.categoryId = categoryId
  } catch (error) {
    aiError.value = error instanceof Error ? error.message : 'AI 请求失败'
  } finally {
    aiBusy.value = false
  }
}

watch(
  () => editingLink.value.url,
  value => {
    if (!linkModalOpen.value) return
    if (metadataTimer) window.clearTimeout(metadataTimer)
    metadataStatus.value = ''
    const normalized = normalizeWebsiteUrl(value)
    if (!normalized || normalized === lastEnrichedUrl) return
    metadataTimer = window.setTimeout(() => void enrichWebsite(), 700)
  }
)

watch(linkModalOpen, open => {
  if (open) return
  if (metadataTimer) window.clearTimeout(metadataTimer)
  metadataTimer = undefined
  metadataController?.abort()
  metadataController = undefined
  metadataBusy.value = false
  aiBusy.value = false
})

watch(externalSources, sources => {
  if (searchMode.value && !sources.some(source => source.id === searchMode.value)) {
    searchMode.value = ''
  }
})

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
  // 恢复属于关键操作：跳过防抖立即上报云端。
  await nav.flushNow()
}

function onSettingsSaved(settings: {
  ai: typeof nav.config.ai
  icon: typeof nav.config.icon
  webdav: typeof nav.config.webdav
  background: typeof nav.config.background
  weather: typeof nav.config.weather
  ticker: typeof nav.config.ticker
  websiteTitle: string
  navigationName: string
  showPinned: boolean
  defaultViewMode: 'compact' | 'detailed'
}) {
  Object.assign(nav.config.ai, settings.ai)
  Object.assign(nav.config.icon, settings.icon)
  Object.assign(nav.config.webdav, settings.webdav)
  Object.assign(nav.config.background, settings.background)
  Object.assign(nav.config.weather, settings.weather)
  Object.assign(nav.config.ticker, settings.ticker)
  nav.config.title = settings.websiteTitle || nav.config.title
  nav.config.navigationName = settings.navigationName
  nav.config.showPinned = settings.showPinned
  nav.config.defaultViewMode = settings.defaultViewMode
  document.title = nav.config.title
}

function handleGlobalKeydown(event: KeyboardEvent) {
  const active = document.activeElement as HTMLElement | null
  const isEditing =
    active?.matches('input, textarea, select, [contenteditable="true"]') ||
    active?.isContentEditable
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditing) {
    event.preventDefault()
    void nextTick(() => searchInput.value?.focus())
  }
  if (event.key === 'Escape') searchQuery.value = ''
}

/** 随机背景图层的样式（含模糊）。深色模式/透明底时保留放大以隐藏模糊边缘。 */
const bgStyle = computed(() => {
  const blur = Number(nav.config.background.blur) || 0
  return {
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
  }
})

/** 暗色遮罩，保证前景可读 */
const bgOverlayColor = computed(
  () =>
    `rgba(18, 27, 42, ${Math.min(0.85, Math.max(0, Number(nav.config.background.overlay) || 0))})`
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
    lastEnrichedUrl = ''
    linkModalOpen.value = true
    history.replaceState({}, '', location.pathname)
  }
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('keydown', onCommandKeydown)
  document.addEventListener('pointerdown', closeSearchModeMenuOnOutsideClick)
})

onBeforeUnmount(() => {
  setPageScrollLocked(false)
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('keydown', onCommandKeydown)
  document.removeEventListener('pointerdown', closeSearchModeMenuOnOutsideClick)
  if (metadataTimer) window.clearTimeout(metadataTimer)
  metadataController?.abort()
  cancelCategoryDragSession()
  stopWeather()
  background.stopAll()
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
      <img
        :key="background.imageUrl.value"
        class="bg-image"
        :src="background.imageUrl.value"
        :style="bgStyle"
        alt=""
        aria-hidden="true"
        loading="eager"
        decoding="async"
      />
      <div class="bg-overlay" :style="{ background: bgOverlayColor }" />
    </div>
    <div v-if="sidebarOpen" class="sidebar-mask" @click="sidebarOpen = false" />
    <aside class="sidebar" :class="{ open: sidebarOpen, collapsed: sidebarCollapsed }">
      <div class="brand">
        <div
          class="brand-mark"
          role="button"
          tabindex="0"
          :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          :aria-pressed="!sidebarCollapsed"
          :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
          @click="toggleSidebar"
          @keydown.enter.prevent="toggleSidebar"
          @keydown.space.prevent="toggleSidebar"
        >
          <Bookmark :size="20" />
        </div>
        <strong>{{ nav.config.navigationName }}</strong
        ><button
          class="icon-button mobile-only"
          aria-label="关闭分类目录"
          @click="sidebarOpen = false"
        >
          <X />
        </button>
      </div>
      <nav class="category-nav">
        <div class="category-section-label">分类目录</div>
        <template v-for="category in topLevelCategories" :key="category.id">
          <div class="category-nav-item">
            <button
              type="button"
              :data-sort-category="category.id"
              :aria-label="`${category.name}，${categoryCount(category)} 个网站`"
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
              <template v-if="isEmojiIcon(category.icon)">
                <span class="emoji-icon">{{ category.icon }}</span>
              </template>
              <component v-else :is="getCategoryIcon(category.icon)" :size="17" /><span
                class="category-name"
                >{{ category.name }}</span
              ><span class="category-count">{{ categoryCount(category) }}</span
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
                ><ChevronRight :size="15" :class="{ expanded: isCategoryExpanded(category.id) }"
              /></span>
            </button>
            <div
              v-if="sidebarCollapsed"
              class="flyout"
              :class="{ 'flyout--bare': !categoryChildren(category.id).length }"
            >
              <div class="flyout-title">
                <template v-if="isEmojiIcon(category.icon)">
                  <span class="emoji-icon">{{ category.icon }}</span>
                </template>
                <component v-else :is="getCategoryIcon(category.icon)" :size="14" />
                <span class="flyout-name">{{ category.name }}</span>
              </div>
              <template v-if="categoryChildren(category.id).length">
                <button
                  v-for="child in categoryChildren(category.id)"
                  :key="child.id"
                  type="button"
                  class="flyout-item"
                  :data-sort-category="child.id"
                  @click="jumpTo(child.id)"
                >
                  <template v-if="isEmojiIcon(child.icon)">
                    <span class="emoji-icon">{{ child.icon }}</span>
                  </template>
                  <component v-else :is="getCategoryIcon(child.icon)" :size="14" />
                  <span>{{ child.name }}</span>
                  <span class="flyout-count">{{ categoryCount(child) }}</span>
                </button>
              </template>
            </div>
          </div>
          <transition-group name="subcat" tag="div" class="subcat-group">
            <template v-for="child in categoryChildren(category.id)" :key="child.id">
              <div v-if="isCategoryExpanded(category.id)" :key="child.id" class="category-nav-item">
                <button
                  type="button"
                  class="subcategory"
                  :aria-label="`${child.name}，${categoryCount(child)} 个网站`"
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
                  <template v-if="isEmojiIcon(child.icon)">
                    <span class="emoji-icon">{{ child.icon }}</span>
                  </template>
                  <component v-else :is="getCategoryIcon(child.icon)" :size="16" /><span>{{
                    child.name
                  }}</span
                  ><span class="category-count">{{ categoryCount(child) }}</span>
                </button>
              </div>
            </template>
          </transition-group>
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
          <button
            v-if="externalSearch && searchQuery"
            type="submit"
            class="internet-search-submit"
            :aria-label="`使用 ${activeSearchSource?.name || '互联网'} 搜索`"
          >
            <span>搜索</span><ArrowUpRight :size="14" />
          </button>
        </form>
        <div v-if="externalSources.length" ref="searchModePicker" class="search-mode-picker">
          <button
            type="button"
            class="search-mode-trigger"
            :class="{ external: externalSearch, open: searchModeMenuOpen }"
            aria-haspopup="listbox"
            aria-controls="search-mode-menu"
            :aria-expanded="searchModeMenuOpen"
            @click="searchModeMenuOpen = !searchModeMenuOpen"
          >
            <Globe2 v-if="externalSearch" :size="15" />
            <Bookmark v-else :size="15" />
            <span>{{ activeSearchSource?.name || '站内' }}</span>
            <ChevronDown :size="15" />
          </button>
          <Transition name="search-menu">
            <div
              v-if="searchModeMenuOpen"
              id="search-mode-menu"
              class="search-mode-menu"
              role="listbox"
              aria-label="选择搜索范围"
              @keydown.esc.stop="searchModeMenuOpen = false"
            >
              <div class="search-mode-menu-label">搜索范围</div>
              <button
                type="button"
                class="search-mode-option"
                :class="{ active: !searchMode }"
                role="option"
                :aria-selected="!searchMode"
                @click="selectSearchMode('')"
              >
                <span class="search-mode-option-icon"><Bookmark :size="16" /></span>
                <span><strong>站内收藏</strong><small>即时筛选已保存的网站</small></span>
                <Check v-if="!searchMode" :size="16" />
              </button>
              <div class="search-mode-divider"><span>互联网搜索</span></div>
              <button
                v-for="source in externalSources"
                :key="source.id"
                type="button"
                class="search-mode-option"
                :class="{ active: searchMode === source.id }"
                role="option"
                :aria-selected="searchMode === source.id"
                @click="selectSearchMode(source.id)"
              >
                <span class="search-mode-option-icon"><Globe2 :size="16" /></span>
                <span
                  ><strong>{{ source.name || '外部搜索' }}</strong
                  ><small>在新标签页打开，搜索后自动清空</small></span
                >
                <Check v-if="searchMode === source.id" :size="16" />
              </button>
            </div>
          </Transition>
        </div>
        <div class="header-actions">
          <button
            v-if="weatherData.enabled && weatherData.temp != null"
            class="weather-widget"
            :title="weatherData.text || weatherData.location || '天气'"
            @click="refreshWeather()"
          >
            <CloudSun :size="16" />
            <span class="weather-temp">{{ Math.round(weatherData.temp) }}°</span>
            <span v-if="weatherData.text" class="weather-desc">{{ weatherData.text }}</span>
          </button>
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
          <button
            class="icon-button"
            :title="dark ? '切换为浅色主题' : '切换为深色主题'"
            :aria-label="dark ? '切换为浅色主题' : '切换为深色主题'"
            :aria-pressed="dark"
            @click="toggleTheme"
          >
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

      <aside v-if="tickerItems.length" class="ticker-bar" aria-label="动态速递">
        <span class="ticker-label">
          <span class="ticker-live-dot" aria-hidden="true"></span>
          <Sparkles :size="14" />
          <span>动态速递</span>
        </span>
        <div class="ticker-viewport">
          <div class="ticker-track" :class="{ single: tickerItems.length === 1 }">
            <span v-for="(item, index) in tickerItems" :key="index" class="ticker-item">
              <span class="ticker-item-dot" aria-hidden="true"></span>{{ item }}
            </span>
          </div>
        </div>
        <span class="ticker-pause-hint">悬停暂停</span>
      </aside>

      <div class="content">
        <div v-if="nav.loading.value" class="loading-grid">
          <div v-for="n in 10" :key="n" class="skeleton" />
        </div>
        <template v-else>
          <section
            v-if="nav.config.showPinned && nav.pinnedLinks.value.length && !searchQuery"
            class="category-section pinned-section"
          >
            <div class="pinned-head">
              <div class="pinned-title">
                <span class="pinned-icon"
                  ><Star :size="16" :stroke-width="2.4" fill="currentColor"
                /></span>
                <h2>置顶网站</h2>
              </div>
              <span class="pinned-count">{{ nav.pinnedLinks.value.length }}</span>
            </div>
            <div class="link-grid pinned-grid" :class="{ compact }">
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
                class="link-card pinned-card"
                :href="safeTargetUrl(link.url)"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  :src="favicon(link)"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width="46"
                  height="46"
                  @error="handleFaviconError($event, link)"
                />
                <div>
                  <strong>{{ link.title }}</strong>
                  <p v-if="!compact">{{ link.description || link.url }}</p>
                </div>
                <ArrowUpRight :size="16" class="pinned-open" />
              </a>
            </div>
          </section>

          <!-- 非站内搜索态：按分类分组浏览 -->
          <template v-if="!searchQuery || externalSearch">
            <template v-for="category in orderedCategories" :key="category.id">
              <section
                v-if="
                  (!category.parentId ||
                    isCategoryExpanded(category.parentId) ||
                    searchQuery.trim()) &&
                  (!searchQuery.trim() || categoryLinks(category.id).length)
                "
                :id="`category-${category.id}`"
                data-category-section
                class="category-section"
                :class="{
                  'is-active': activeCategoryId === category.id,
                  'subcategory-section': Boolean(category.parentId),
                }"
              >
                <div class="section-title">
                  <h2>
                    <template v-if="isEmojiIcon(category.icon)">
                      <span class="emoji-icon">{{ category.icon }}</span>
                    </template>
                    <component v-else :is="getCategoryIcon(category.icon)" :size="20" />
                    {{ category.name }}
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
          </template>

          <!-- 站内搜索态：按目录展示命中结果，避免同一网站在汇总区重复出现 -->
          <template v-else>
            <!-- 命中的目录：结构与正常浏览时一致，父分区链接子分区 -->
            <template v-for="category in orderedCategories" :key="category.id">
              <section
                v-if="matchedCategoryIds.has(category.id)"
                :id="`category-${category.id}`"
                data-category-section
                class="category-section"
                :class="{
                  'is-active': activeCategoryId === category.id,
                  'subcategory-section': Boolean(category.parentId),
                }"
              >
                <div class="section-title">
                  <h2>
                    <template v-if="isEmojiIcon(category.icon)">
                      <span class="emoji-icon">{{ category.icon }}</span>
                    </template>
                    <component v-else :is="getCategoryIcon(category.icon)" :size="20" />
                    {{ category.name }}
                    <span class="section-count">{{ categoryCount(category) }}</span>
                  </h2>
                </div>
                <LinkGrid
                  :links="categoryLinks(category.id)"
                  :compact="compact"
                  :can-manage="Boolean(nav.token.value)"
                  :hide-tools="hideTools"
                  @pin="nav.togglePin"
                  @edit="openLinkModal"
                  @delete="deleteLink"
                />
              </section>
            </template>
          </template>

          <div
            v-if="
              searchQuery && !externalSearch && !visibleLinks.length && !matchingCategories.length
            "
            class="no-results"
          >
            <Search />
            <h2>没有找到相关网站或目录</h2>
            <p>试试更短的关键词，或切换到互联网搜索。</p>
          </div>
        </template>
      </div>
    </main>

    <div
      v-if="linkModalOpen"
      class="modal-backdrop"
      @click.self="linkModalOpen = false"
      @wheel.self.prevent
    >
      <form
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-modal-title"
        @submit.prevent="submitLink"
      >
        <div class="modal-title">
          <div>
            <h2 id="link-modal-title">{{ editingLink.id ? '编辑网站' : '添加网站' }}</h2>
            <p>保存后将同步到本地和云端。</p>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="关闭"
            @click="linkModalOpen = false"
          >
            <X />
          </button>
        </div>
        <label class="website-url-field"
          ><span class="field-label-row"
            ><span>网址</span><span class="auto-field-badge">第一步 · 自动识别</span></span
          ><input
            v-model="editingLink.url"
            required
            maxlength="2048"
            placeholder="https://example.com"
        /></label>
        <div
          class="website-enrich-status"
          :class="{ busy: metadataBusy || aiBusy }"
          aria-live="polite"
        >
          <span class="website-enrich-icon">
            <Sparkles v-if="!metadataBusy && !aiBusy" :size="16" />
            <span v-else class="mini-spinner" aria-hidden="true"></span>
          </span>
          <span>
            <strong>{{ metadataBusy || aiBusy ? '正在自动补全' : '自动识别网站信息' }}</strong>
            <small>{{
              metadataStatus || '输入网址后，将获取名称和图标，并调用 AI 生成描述。'
            }}</small>
          </span>
          <button
            type="button"
            :disabled="metadataBusy || aiBusy || !editingLink.url"
            @click="enrichWebsite(true)"
          >
            重新识别
          </button>
        </div>
        <label
          >名称<input
            v-model="editingLink.title"
            required
            maxlength="100"
            placeholder="将根据网址自动填写，也可手动修改"
        /></label>
        <label
          ><span class="field-label-row"
            ><span>描述</span
            ><span class="ai-field-badge"><Sparkles :size="12" /> AI 自动生成</span></span
          ><textarea
            v-model="editingLink.description"
            rows="3"
            placeholder="输入网址后自动生成，也可手动修改"
          />
        </label>
        <div class="ai-link-actions">
          <button type="button" class="secondary-button" :disabled="aiBusy" @click="generateWithAI">
            <Sparkles :size="15" />{{ aiBusy ? 'AI 处理中…' : '重新生成 AI 描述并分类' }}
          </button>
          <span v-if="aiError" class="form-error">{{ aiError }}</span>
        </div>
        <div class="form-group">
          <span class="field-label">图标</span>
          <div class="icon-picker">
            <img
              v-if="editingFaviconPreview"
              :src="editingFaviconPreview"
              class="icon-preview"
              alt="图标预览"
              @error="e => ((e.target as HTMLImageElement).src = '')"
            />
            <div v-else class="icon-preview icon-preview-empty"><Image :size="22" /></div>
            <p class="icon-picker-hint">优先读取网站官方图标，并通过 EdgeOne 缓存加速。</p>
          </div>
          <input
            v-model="editingLink.icon"
            class="field-input"
            placeholder="留空自动获取网站 favicon；也可粘贴自定义图标 URL 覆盖"
          />
          <span v-if="iconError" class="form-error">{{ iconError }}</span>
          <p class="form-hint">一般无需填写；仅在需要覆盖自动结果时粘贴自定义图标 URL。</p>
        </div>
        <div class="category-picker">
          <span class="field-label">保存到分类</span>
          <button
            type="button"
            class="category-picker-trigger"
            :class="{ open: categoryPickerOpen }"
            aria-controls="link-category-tree"
            :aria-expanded="categoryPickerOpen"
            @click="categoryPickerOpen = !categoryPickerOpen"
          >
            <span v-if="selectedCategoryDetails" class="category-path-icon">
              <template v-if="isEmojiIcon(selectedCategoryDetails.category.icon)">
                {{ selectedCategoryDetails.category.icon }}
              </template>
              <component
                v-else
                :is="getCategoryIcon(selectedCategoryDetails.category.icon)"
                :size="17"
              />
            </span>
            <span v-if="selectedCategoryDetails" class="category-path-text">
              <span v-if="selectedCategoryDetails.parent" class="category-path-parent">
                {{ selectedCategoryDetails.parent.name }}
                <ChevronRight :size="13" />
              </span>
              <strong>{{ selectedCategoryDetails.category.name }}</strong>
            </span>
            <span v-else class="category-picker-placeholder">选择一个分类</span>
            <span v-if="selectedCategoryDetails" class="category-level-pill">
              {{ selectedCategoryDetails.parent ? '二级' : '主分类' }}
            </span>
            <ChevronDown class="category-trigger-chevron" :size="18" />
          </button>

          <div
            v-if="categoryPickerOpen"
            id="link-category-tree"
            class="category-tree"
            role="listbox"
            aria-label="选择网站分类"
            @keydown.esc.stop="categoryPickerOpen = false"
          >
            <div class="category-tree-head">
              <div>
                <strong>选择目录</strong>
                <span>二级分类会收纳在所属主分类下</span>
              </div>
              <span>{{ topLevelCategories.length }} 个主分类</span>
            </div>
            <div class="category-tree-groups">
              <div
                v-for="parent in topLevelCategories"
                :key="parent.id"
                class="category-tree-group"
                :class="{
                  active: editingLink.categoryId === parent.id,
                  expanded: categoryPickerExpandedIds.has(parent.id),
                }"
              >
                <div class="category-parent-row">
                  <button
                    type="button"
                    class="category-tree-option category-parent-option"
                    role="option"
                    :aria-selected="editingLink.categoryId === parent.id"
                    @click="selectLinkCategory(parent.id)"
                  >
                    <span class="category-option-icon">
                      <template v-if="isEmojiIcon(parent.icon)">{{ parent.icon }}</template>
                      <component v-else :is="getCategoryIcon(parent.icon)" :size="17" />
                    </span>
                    <span class="category-option-copy">
                      <strong>{{ parent.name }}</strong>
                      <small>
                        {{
                          categoryChildren(parent.id).length
                            ? `${categoryChildren(parent.id).length} 个二级分类`
                            : '主分类'
                        }}
                      </small>
                    </span>
                    <Check
                      v-if="editingLink.categoryId === parent.id"
                      class="category-option-check"
                      :size="17"
                    />
                  </button>
                  <button
                    v-if="categoryChildren(parent.id).length"
                    type="button"
                    class="category-expand-button"
                    :class="{ expanded: categoryPickerExpandedIds.has(parent.id) }"
                    :aria-label="`${categoryPickerExpandedIds.has(parent.id) ? '收起' : '展开'}${parent.name}的二级分类`"
                    :aria-expanded="categoryPickerExpandedIds.has(parent.id)"
                    @click.stop="toggleCategoryPickerGroup(parent.id)"
                  >
                    <ChevronDown :size="17" />
                  </button>
                </div>
                <div
                  v-if="
                    categoryChildren(parent.id).length && categoryPickerExpandedIds.has(parent.id)
                  "
                  class="category-child-list"
                >
                  <button
                    v-for="child in categoryChildren(parent.id)"
                    :key="child.id"
                    type="button"
                    class="category-tree-option category-child-option"
                    :class="{ active: editingLink.categoryId === child.id }"
                    role="option"
                    :aria-selected="editingLink.categoryId === child.id"
                    @click="selectLinkCategory(child.id)"
                  >
                    <span class="category-child-branch" aria-hidden="true"></span>
                    <span class="category-option-icon small">
                      <template v-if="isEmojiIcon(child.icon)">{{ child.icon }}</template>
                      <component v-else :is="getCategoryIcon(child.icon)" :size="15" />
                    </span>
                    <span class="category-option-copy"
                      ><strong>{{ child.name }}</strong></span
                    >
                    <Check
                      v-if="editingLink.categoryId === child.id"
                      class="category-option-check"
                      :size="16"
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <p v-if="selectedCategoryDetails?.childCount" class="category-picker-help">
            当前保存到主分类；其下 {{ selectedCategoryDetails.childCount }} 个二级分类仍会独立展示。
          </p>
        </div>
        <button
          v-if="editingLink.categoryId !== 'common'"
          type="button"
          class="common-feature-toggle"
          :class="{ active: editingLink.alsoInCommon }"
          role="switch"
          :aria-checked="Boolean(editingLink.alsoInCommon)"
          @click="editingLink.alsoInCommon = !editingLink.alsoInCommon"
        >
          <span class="common-feature-icon"><Star :size="18" /></span>
          <span class="common-feature-copy">
            <strong>同时展示在常用推荐</strong>
            <small>保留当前分类，并额外出现在首页常用推荐中</small>
          </span>
          <span class="switch-track" aria-hidden="true"><span></span></span>
        </button>
        <div class="modal-actions">
          <button type="button" class="secondary-button" @click="linkModalOpen = false">取消</button
          ><button class="primary-button" :disabled="metadataBusy || aiBusy">
            <Check :size="17" />保存
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="authModalOpen"
      class="modal-backdrop"
      @click.self="authModalOpen = false"
      @wheel.self.prevent
    >
      <form
        class="login-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
        @submit.prevent="submitLogin"
      >
        <button type="button" class="login-close" aria-label="关闭" @click="authModalOpen = false">
          <X />
        </button>
        <div class="login-badge"><LogIn :size="22" /></div>
        <h2 id="login-dialog-title" class="login-title">管理登录</h2>
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
      v-if="settingsOpen"
      :open="settingsOpen"
      :config="{
        ai: nav.config.ai,
        icon: nav.config.icon,
        webdav: nav.config.webdav,
        background: nav.config.background,
        search: nav.config.search,
        weather: nav.config.weather,
        ticker: nav.config.ticker,
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

    <!-- 命令面板（Ctrl+K） -->
    <Transition name="palette">
      <div
        v-if="commandOpen"
        class="command-overlay"
        @mousedown.self="closeCommand"
        @wheel.self.prevent
      >
        <div class="command-panel" role="dialog" aria-modal="true" aria-label="命令面板">
          <div class="command-input-wrap">
            <Search :size="18" />
            <input
              ref="commandInput"
              v-model="commandQuery"
              class="command-input"
              placeholder="搜索网站、分类或执行命令…"
              aria-label="命令搜索"
            />
            <kbd class="command-kbd">ESC</kbd>
          </div>
          <ul class="command-list">
            <li
              v-for="(item, index) in commandItems"
              :key="item.key"
              class="command-item"
              :class="{ selected: index === commandIndex }"
              @mousemove="commandIndex = index"
              @click="item.exec()"
            >
              <span class="command-item-icon">
                <component v-if="item.icon" :is="item.icon" :size="16" />
                <Globe v-else-if="item.kind === 'link'" :size="16" />
                <Folder v-else :size="16" />
              </span>
              <span class="command-item-label">{{ item.label }}</span>
              <span class="command-item-hint">{{ item.hint }}</span>
              <kbd v-if="item.kind !== 'action'" class="command-kbd small">↵</kbd>
            </li>
            <li v-if="!commandItems.length" class="command-empty">没有匹配的结果</li>
          </ul>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
:global(html.overlay-scroll-locked),
:global(body.overlay-scroll-locked) {
  overflow: hidden;
  overscroll-behavior: none;
}
.app-shell {
  min-height: 100vh;
  background: #eef1f9;
  color: #182230;
  background-image:
    radial-gradient(1100px 640px at 4% -4%, rgba(126, 152, 255, 0.6), transparent 58%),
    radial-gradient(980px 900px at -8% 106%, rgba(198, 142, 255, 0.55), transparent 58%),
    radial-gradient(900px 700px at 96% -6%, rgba(255, 176, 192, 0.5), transparent 58%),
    radial-gradient(760px 720px at 92% 110%, rgba(118, 196, 255, 0.46), transparent 56%),
    linear-gradient(160deg, #eef2ff 0%, #f7f1ff 50%, #ecf2fb 100%);
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
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transform: scale(1.06); /* 放大以隐藏模糊产生的边缘空白 */
  animation: bg-fade 0.6s ease both;
  will-change: transform, opacity;
}
@keyframes bg-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .bg-image {
    animation: none;
  }
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
  background: linear-gradient(165deg, rgba(255, 255, 255, 0.62), rgba(246, 249, 255, 0.42));
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border-right-color: rgba(255, 255, 255, 0.5);
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
  background: linear-gradient(165deg, rgba(34, 42, 54, 0.64), rgba(24, 30, 38, 0.48));
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border-right-color: rgba(255, 255, 255, 0.1);
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
  background: linear-gradient(165deg, rgba(255, 255, 255, 0.58) 0%, rgba(245, 248, 255, 0.4) 100%);
  backdrop-filter: blur(18px) saturate(1.9);
  -webkit-backdrop-filter: blur(18px) saturate(1.9);
  border-right: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow:
    2px 0 16px rgba(58, 78, 122, 0.05),
    14px 0 44px rgba(48, 65, 104, 0.1),
    inset -1px 0 rgba(255, 255, 255, 0.42);
  display: flex;
  flex-direction: column;
  z-index: 40;
  isolation: isolate;
  overflow: hidden;
}
.sidebar::before,
.sidebar::after {
  content: '';
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
  z-index: -1;
}
.sidebar::before {
  width: 210px;
  height: 210px;
  top: -60px;
  right: -70px;
  background: rgba(134, 157, 255, 0.34);
}
.sidebar::after {
  width: 190px;
  height: 190px;
  bottom: 60px;
  left: -95px;
  background: rgba(210, 157, 255, 0.3);
}
.brand {
  height: 68px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.6);
  background: transparent;
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
  cursor: pointer;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}
.brand-mark:hover {
  transform: scale(1.05);
  box-shadow: 0 8px 20px rgba(79, 124, 255, 0.42);
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
.sidebar-collapse-toggle {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  margin-left: auto;
  border-radius: 8px;
  background: transparent;
  border-color: transparent;
  color: #5f6c81;
}
.sidebar-collapse-toggle svg {
  width: 15px;
  height: 15px;
}
.sidebar-collapse-toggle:hover {
  background: rgba(79, 124, 255, 0.12);
  color: #315ed5;
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
  background: transparent;
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
  background: rgba(124, 110, 255, 0.05);
  border-color: rgba(122, 102, 255, 0.18);
  color: #315ed5;
  box-shadow: none;
  transform: translateX(2px);
}
.category-nav button.active {
  background: transparent;
  border-color: transparent;
  color: #5b4bff;
  box-shadow: inset 3px 0 0 0 var(--scheme-accent, #6a5cff);
}
.category-nav button > span.category-name {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.category-nav button .category-count {
  flex: 0 0 auto;
  margin-left: auto;
  min-width: 19px;
  height: 19px;
  padding: 0 6px;
  border-radius: 10px;
  background: rgba(120, 130, 150, 0.16);
  color: #677389;
  font-size: 11px;
  font-weight: 650;
  display: grid;
  place-items: center;
  line-height: 1;
  box-sizing: border-box;
}
.category-nav button.active .category-count {
  background: rgba(91, 75, 255, 0.16);
  color: #5b4bff;
}
.category-nav button.subcategory {
  margin-left: 14px;
  width: calc(100% - 14px);
  padding-left: 18px;
  background: transparent;
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
/* 二级分类列表展开/收起过渡 */
.subcat-group {
  display: block;
}
.subcat-group .category-nav-item {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.subcat-enter-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.subcat-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.subcat-enter-from,
.subcat-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.subcat-move {
  transition: transform 0.18s ease;
}
/* 窄栏(收起态)悬浮二级面板 */
.flyout {
  position: absolute;
  top: 0;
  left: 100%;
  margin-left: 8px;
  z-index: 60;
  display: none;
  min-width: 176px;
  max-width: 240px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(14px) saturate(1.4);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  box-shadow: 0 12px 30px rgba(30, 44, 74, 0.16);
}
.flyout-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 9px;
  font-size: 12px;
  font-weight: 650;
  color: #39465c;
  border-bottom: 1px solid rgba(120, 130, 150, 0.14);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
}
.flyout-name {
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 无二级目录的分类：折叠态 hover 仅展示图标+名称，去掉空列表分隔线 */
.flyout--bare .flyout-title {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 2px;
}
.flyout-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: #596579;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}
.flyout-item:hover {
  background: rgba(124, 110, 255, 0.1);
  color: #5b4bff;
}
.flyout-item .emoji-icon {
  font-size: 15px;
}
.flyout-count {
  margin-left: auto;
  flex: 0 0 auto;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(120, 130, 150, 0.16);
  color: #677389;
  font-size: 10px;
  display: grid;
  place-items: center;
}
html.dark .flyout {
  background: rgba(34, 41, 51, 0.94);
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
}
html.dark .flyout-title {
  color: #d5dbe3;
  border-bottom-color: rgba(255, 255, 255, 0.1);
}
html.dark .flyout-item {
  color: #c3cad6;
}
html.dark .flyout-item:hover {
  background: rgba(124, 110, 255, 0.16);
  color: #a5b4ff;
}
.sidebar-footer {
  padding: 12px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.6);
  background: transparent;
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
  background-color: #fff;
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
.internet-search-submit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: #466de0;
  color: #fff;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.internet-search-submit:hover {
  background: #315ed5;
}
.search-mode-picker {
  position: relative;
  flex: 0 0 auto;
}
.search-mode-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  max-width: 170px;
  padding: 0 11px;
  border: 1px solid #e1e6ee;
  border-radius: 11px;
  background: #fff;
  color: #59667a;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
}
.search-mode-trigger span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-mode-trigger > svg:last-child {
  transition: transform 0.16s ease;
}
.search-mode-trigger.open > svg:last-child {
  transform: rotate(180deg);
}
.search-mode-trigger:hover,
.search-mode-trigger.open {
  border-color: #9cafe9;
  background: #f7f9ff;
  color: #315ed5;
}
.search-mode-trigger.external {
  border-color: rgba(70, 109, 224, 0.28);
  background: rgba(70, 109, 224, 0.08);
  color: #315ed5;
}
.search-mode-menu {
  position: absolute;
  top: calc(100% + 9px);
  right: 0;
  z-index: 60;
  width: min(310px, calc(100vw - 24px));
  padding: 9px;
  border: 1px solid #e2e7ef;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 48px rgba(25, 38, 67, 0.18);
  backdrop-filter: blur(16px);
}
.search-mode-menu-label {
  padding: 4px 8px 8px;
  color: #8b96a8;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.search-mode-option {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 54px;
  padding: 8px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: #46536a;
  cursor: pointer;
  text-align: left;
}
.search-mode-option:hover {
  background: #f3f6fb;
}
.search-mode-option.active {
  background: #eef3ff;
  color: #315ed5;
}
.search-mode-option-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #f0f3f8;
  color: #65738a;
}
.search-mode-option.active .search-mode-option-icon {
  background: #fff;
  color: #315ed5;
  box-shadow: 0 3px 12px rgba(49, 94, 213, 0.12);
}
.search-mode-option strong,
.search-mode-option small {
  display: block;
}
.search-mode-option strong {
  margin-bottom: 3px;
  font-size: 13px;
}
.search-mode-option small {
  overflow: hidden;
  color: #8a95a7;
  font-size: 11px;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-mode-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 8px 3px;
  color: #9ba5b4;
  font-size: 10px;
}
.search-mode-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #edf0f4;
}
.search-menu-enter-active,
.search-menu-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.14s ease;
}
.search-menu-enter-from,
.search-menu-leave-to {
  opacity: 0;
  transform: translateY(-5px) scale(0.98);
}
html.dark .search-mode-trigger {
  border-color: #343d49;
  background: #222933;
  color: #cdd5e0;
}
html.dark .search-mode-trigger:hover,
html.dark .search-mode-trigger.open,
html.dark .search-mode-trigger.external {
  border-color: #536cae;
  background: #293554;
  color: #cbd7ff;
}
html.dark .search-mode-menu {
  border-color: #343d49;
  background: rgba(31, 37, 47, 0.98);
}
html.dark .search-mode-option {
  color: #d3dae5;
}
html.dark .search-mode-option:hover {
  background: #29313d;
}
html.dark .search-mode-option.active {
  background: #293554;
  color: #cbd7ff;
}
html.dark .search-mode-option-icon {
  background: #2b333f;
}
html.dark .search-mode-option.active .search-mode-option-icon {
  background: #344264;
}
html.dark .search-mode-divider::after {
  background: #343d49;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.weather-widget {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid #e2e6ed;
  background: #fff;
  color: #5b687d;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.weather-widget svg {
  color: #f5a623;
}
.weather-widget .weather-temp {
  font-weight: 700;
  color: #1f2633;
}
.weather-widget:hover {
  background: #f3f6fb;
  color: #315ed5;
}
.ticker-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 42px;
  margin: 10px 18px 0;
  padding: 0 12px;
  border: 1px solid #e4eaf4;
  border-radius: 13px;
  background: linear-gradient(110deg, #f5f7ff 0%, #fbfcff 58%, #f7fbff 100%);
  box-shadow: 0 5px 18px rgba(57, 75, 128, 0.06);
  overflow: hidden;
  white-space: nowrap;
}
.ticker-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 5px 9px;
  border-radius: 8px;
  background: rgba(94, 94, 230, 0.09);
  font-size: 11px;
  font-weight: 750;
  color: #5964d9;
  letter-spacing: 0.02em;
}
.ticker-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #42bd83;
  box-shadow: 0 0 0 3px rgba(66, 189, 131, 0.14);
}
.ticker-viewport {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.ticker-viewport::before,
.ticker-viewport::after {
  content: '';
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  width: 24px;
  pointer-events: none;
}
.ticker-viewport::before {
  left: 0;
  background: linear-gradient(90deg, #fbfcff, transparent);
}
.ticker-viewport::after {
  right: 0;
  background: linear-gradient(270deg, #f8fbff, transparent);
}
.ticker-track {
  display: flex;
  align-items: center;
  gap: 44px;
  width: max-content;
  padding-left: 100%;
  will-change: transform;
  animation: ticker-scroll 30s linear infinite;
  animation-delay: -8s;
}
.ticker-bar:hover .ticker-track {
  animation-play-state: paused;
}
.ticker-item {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: #566176;
  flex: none;
}
.ticker-item-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #a5afd0;
}
.ticker-pause-hint {
  flex: none;
  color: #9aa4b6;
  font-size: 10px;
}
@keyframes ticker-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-100%);
  }
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
  padding: 24px 26px 26px;
  border-radius: 22px;
  background: linear-gradient(135deg, rgba(238, 243, 255, 0.82), rgba(246, 242, 255, 0.82));
  border: 1px solid rgba(223, 231, 255, 0.9);
  box-shadow: 0 10px 30px rgba(80, 100, 180, 0.08);
  backdrop-filter: blur(16px) saturate(1.3);
  -webkit-backdrop-filter: blur(16px) saturate(1.3);
}
.pinned-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.pinned-title {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.pinned-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  color: #fff;
  background: linear-gradient(135deg, #6a5cff, #8b5cf6);
  box-shadow: 0 5px 14px rgba(106, 92, 255, 0.35);
}
.pinned-section h2 {
  margin: 0;
}
.pinned-count {
  font-size: 12px;
  font-weight: 600;
  color: #5b6b94;
  background: rgba(106, 92, 255, 0.1);
  border: 1px solid rgba(106, 92, 255, 0.22);
  padding: 3px 11px;
  border-radius: 20px;
}
.pinned-grid {
  gap: 16px;
}
.pinned-card {
  position: relative;
  min-height: clamp(90px, 9vw, 120px);
  padding: clamp(16px, 2vw, 24px) 46px clamp(16px, 2vw, 24px) clamp(16px, 2vw, 24px);
  gap: clamp(14px, 1.6vw, 18px);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(223, 231, 255, 0.95);
  box-shadow: 0 2px 8px rgba(42, 60, 100, 0.04);
}
.pinned-card:hover {
  transform: translateY(-3px);
  border-color: #a8baf7;
  background: #fff;
  box-shadow: 0 16px 38px rgba(42, 60, 100, 0.16);
}
.pinned-card img {
  width: clamp(46px, 5vw, 56px);
  height: clamp(46px, 5vw, 56px);
  border-radius: 14px;
  padding: 8px;
  background: #fff;
  border: 1px solid #eef1f7;
}
.pinned-open {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: #6a5cff;
  background: rgba(106, 92, 255, 0.12);
  opacity: 0;
  transition:
    opacity 0.15s ease,
    transform 0.2s ease;
}
.pinned-card:hover .pinned-open {
  opacity: 1;
}
.pinned-card:hover .pinned-open:hover {
  transform: translateY(-50%) translate(1px, -1px);
}
.pinned-grid.compact .pinned-card {
  min-height: 66px;
  padding: 11px 42px 11px 14px;
  gap: 12px;
  border-radius: 13px;
}
.pinned-grid.compact .pinned-card img {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  padding: 6px;
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
  color: #3a3f5c;
}
.section-title {
  display: flex;
  align-items: center;
}
.section-title h2 {
  flex: 1;
}
.section-count {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 500;
  color: #7a8699;
}
/* ===== 命令面板（Ctrl+K） ===== */
.command-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(15, 20, 34, 0.38);
  backdrop-filter: blur(3px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 16vh;
}
.command-panel {
  width: min(560px, calc(100vw - 32px));
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(20, 28, 54, 0.28);
  overflow: hidden;
}
.command-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  color: #8a95a8;
  border-bottom: 1px solid #eef1f7;
}
.command-input {
  flex: 1;
  border: 0;
  outline: none;
  font-size: 15px;
  background: transparent;
  color: inherit;
}
.command-kbd {
  font-size: 11px;
  color: #8a95a8;
  background: #f0f2f7;
  border: 1px solid #e0e4ec;
  border-radius: 5px;
  padding: 2px 6px;
  font-family: inherit;
  white-space: nowrap;
}
.command-kbd.small {
  margin-left: auto;
}
.command-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 46vh;
  overflow-y: auto;
}
.command-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 9px;
  cursor: pointer;
}
.command-item.selected {
  background: #6a5cff;
  color: #fff;
}
.command-item-icon {
  display: inline-flex;
  flex: 0 0 auto;
  color: #6a5cff;
}
.command-item.selected .command-item-icon {
  color: #fff;
}
.command-item-label {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.command-item-hint {
  font-size: 12px;
  color: #8a95a8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.command-item.selected .command-item-hint {
  color: rgba(255, 255, 255, 0.8);
}
.command-empty {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: #8a95a8;
}
.palette-enter-active,
.palette-leave-active {
  transition: opacity 0.16s ease;
}
.palette-enter-active .command-panel,
.palette-leave-active .command-panel {
  transition:
    transform 0.16s ease,
    opacity 0.16s ease;
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
.palette-enter-from .command-panel,
.palette-leave-to .command-panel {
  transform: translateY(-8px);
  opacity: 0;
}
html.dark .command-panel {
  background: #1c232f;
}
html.dark .command-input-wrap {
  border-bottom-color: #2b3542;
}
html.dark .command-kbd {
  background: #2a3441;
  border-color: #3a4656;
}
html.dark .command-item-hint {
  color: #8390a3;
}
html.dark .command-empty {
  color: #8390a3;
}
.category-picker {
  margin: 16px 0 13px;
}
.category-picker > .field-label {
  display: block;
  margin-bottom: 7px;
}
.category-picker-trigger {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 50px;
  padding: 8px 10px;
  border: 1px solid #dbe2ee;
  border-radius: 12px;
  background: #fff;
  color: #344054;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    background 0.18s ease;
}
.category-picker-trigger:hover,
.category-picker-trigger.open {
  border-color: #9daaf1;
  background: #fafbff;
  box-shadow: 0 0 0 3px rgba(100, 98, 230, 0.1);
}
.category-path-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #fff;
  color: #5d6fe8;
  box-shadow: 0 2px 8px rgba(50, 67, 112, 0.1);
}
.category-path-text {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: #344054;
}
.category-path-text strong,
.category-path-parent {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.category-path-parent {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: #7a8699;
  font-weight: 500;
}
.category-level-pill {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(93, 111, 232, 0.1);
  color: #5365d8;
  font-size: 11px;
  font-weight: 700;
}
.category-picker-placeholder {
  flex: 1;
  color: #98a2b3;
}
.category-trigger-chevron {
  flex: none;
  color: #8691a4;
  transition: transform 0.18s ease;
}
.category-picker-trigger.open .category-trigger-chevron {
  transform: rotate(180deg);
}
.category-tree {
  margin-top: 8px;
  border: 1px solid #dfe5ef;
  border-radius: 13px;
  background: #fff;
  box-shadow: 0 14px 36px rgba(30, 43, 74, 0.12);
  overflow: hidden;
}
.category-tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 13px;
  border-bottom: 1px solid #edf0f5;
  background: #f8f9fc;
}
.category-tree-head > div {
  display: grid;
  gap: 2px;
}
.category-tree-head strong {
  color: #344054;
  font-size: 12px;
}
.category-tree-head span {
  color: #8b96a8;
  font-size: 10px;
}
.category-tree-head > span {
  padding: 3px 7px;
  border-radius: 999px;
  background: #eceffd;
  color: #6672d9;
  font-weight: 700;
  white-space: nowrap;
}
.category-tree-groups {
  padding: 6px;
}
.category-tree-group + .category-tree-group {
  margin-top: 3px;
}
.category-parent-row {
  display: flex;
  align-items: stretch;
  gap: 4px;
}
.category-tree-option {
  border: 0;
  background: transparent;
  color: #344054;
  cursor: pointer;
  text-align: left;
}
.category-parent-option {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 48px;
  padding: 7px 9px;
  border-radius: 9px;
}
.category-parent-option:hover,
.category-tree-group.active .category-parent-option {
  background: #f1f3ff;
}
.category-option-icon {
  display: grid;
  place-items: center;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #f0f2fb;
  color: #6470db;
  font-size: 16px;
}
.category-option-icon.small {
  flex-basis: 26px;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  font-size: 14px;
}
.category-option-copy {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}
.category-option-copy strong {
  overflow: hidden;
  color: inherit;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.category-option-copy small {
  color: #919bad;
  font-size: 10px;
}
.category-option-check {
  flex: none;
  color: #5967dc;
}
.category-expand-button {
  display: grid;
  place-items: center;
  flex: 0 0 40px;
  width: 40px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #8d98aa;
  cursor: pointer;
}
.category-expand-button:hover {
  background: #f2f4f8;
  color: #5967dc;
}
.category-expand-button svg {
  transition: transform 0.18s ease;
}
.category-expand-button.expanded svg {
  transform: rotate(180deg);
}
.category-child-list {
  position: relative;
  display: grid;
  gap: 2px;
  margin: 1px 0 4px 23px;
  padding-left: 15px;
}
.category-child-list::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 9px;
  left: 0;
  width: 1px;
  background: #dfe4f0;
}
.category-child-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 39px;
  padding: 5px 9px;
  border-radius: 8px;
}
.category-child-option:hover,
.category-child-option.active {
  background: #f4f5ff;
  color: #505fd1;
}
.category-child-branch {
  position: absolute;
  top: 50%;
  left: -15px;
  width: 12px;
  height: 1px;
  background: #dfe4f0;
}
.category-picker-help {
  margin: 7px 2px 0;
  color: #7f8a9d;
  font-size: 12px;
  line-height: 1.5;
}
.common-feature-toggle {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  margin: 4px 0 15px;
  padding: 11px 12px;
  border: 1px solid #e0e5ee;
  border-radius: 13px;
  background: #fafbfc;
  color: #465166;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}
.common-feature-toggle:hover {
  border-color: #bbc4e9;
  background: #f8f9ff;
}
.common-feature-toggle.active {
  border-color: #a9b4ef;
  background: linear-gradient(110deg, #f4f5ff, #f9f8ff);
  box-shadow: 0 5px 16px rgba(87, 91, 198, 0.09);
}
.common-feature-icon {
  display: grid;
  place-items: center;
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #eceff5;
  color: #7b8799;
}
.common-feature-toggle.active .common-feature-icon {
  background: #fff1c8;
  color: #d59618;
}
.common-feature-copy {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 3px;
}
.common-feature-copy strong {
  color: #3d485c;
  font-size: 13px;
}
.common-feature-copy small {
  color: #8a95a8;
  font-size: 11px;
  line-height: 1.45;
}
.switch-track {
  position: relative;
  flex: 0 0 38px;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: #c8ced8;
  transition: background 0.18s ease;
}
.switch-track span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 5px rgba(31, 42, 60, 0.22);
  transition: transform 0.18s ease;
}
.common-feature-toggle.active .switch-track {
  background: #6569dd;
}
.common-feature-toggle.active .switch-track span {
  transform: translateX(16px);
}
.emoji-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  font-size: 17px;
  min-width: 17px;
  /* 强制透明，不继承任何白底 */
  background: transparent !important;
  background-color: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
  padding: 0;
  margin: 0;
  border-radius: 0;
}
.section-title .emoji-icon {
  font-size: 20px;
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
  display: grid;
  place-items: center;
  z-index: 100;
  padding: 20px;
}
.modal {
  width: min(540px, 100%);
  max-height: calc(100vh - 40px);
  overflow: auto;
  overscroll-behavior: contain;
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
.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.auto-field-badge,
.ai-field-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 7px;
  border-radius: 999px;
  color: #4568ce;
  background: rgba(78, 119, 231, 0.1);
  font-size: 10px;
  font-weight: 650;
}
.website-enrich-status {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin: -2px 0 15px;
  padding: 10px 11px;
  border: 1px solid #e4e8ef;
  border-radius: 12px;
  background: #f8fafc;
  color: #536177;
}
.website-enrich-status.busy {
  border-color: rgba(78, 119, 231, 0.3);
  background: rgba(78, 119, 231, 0.06);
}
.website-enrich-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #fff;
  color: #466de0;
  box-shadow: 0 4px 14px rgba(31, 50, 90, 0.08);
}
.website-enrich-status strong,
.website-enrich-status small {
  display: block;
}
.website-enrich-status strong {
  margin-bottom: 2px;
  color: #46536a;
  font-size: 12px;
}
.website-enrich-status small {
  color: #8994a6;
  font-size: 11px;
  line-height: 1.45;
}
.website-enrich-status > button {
  min-height: 32px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: #eef3ff;
  color: #3f65d0;
  cursor: pointer;
  font-size: 11px;
  font-weight: 650;
}
.website-enrich-status > button:disabled {
  cursor: default;
  opacity: 0.5;
}
.mini-spinner {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(70, 109, 224, 0.22);
  border-top-color: #466de0;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
html.dark .website-enrich-status {
  border-color: #343d49;
  background: #222933;
}
html.dark .website-enrich-status.busy {
  border-color: #5067a6;
  background: #293554;
}
html.dark .website-enrich-icon,
html.dark .website-enrich-status > button {
  background: #303a4b;
}
html.dark .website-enrich-status strong {
  color: #d3dae5;
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
.icon-picker-hint {
  flex: 1;
  font-size: 12px;
  line-height: 1.6;
  color: #8a94a6;
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
  background-color: #fff;
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
  /* 侧栏收起态：窄图标栏，鼠标悬停自动临时展开 */
  .sidebar {
    transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .sidebar.collapsed {
    transform: none;
    width: 78px;
    overflow: visible;
  }
  /* 收起态：仅保留图标，隐藏文字/徽标/小节标签/子项/底部 */
  .sidebar.collapsed .brand strong,
  .sidebar.collapsed .category-section-label,
  .sidebar.collapsed .category-name,
  .sidebar.collapsed .category-count,
  .sidebar.collapsed .category-toggle,
  .sidebar.collapsed .sidebar-footer {
    display: none;
  }
  .sidebar.collapsed .category-nav button.subcategory {
    display: none;
  }
  .sidebar.collapsed .brand {
    padding: 0 10px;
    gap: 0;
  }
  .sidebar.collapsed .category-nav {
    padding: 12px 9px;
    overflow: visible;
  }
  .sidebar.collapsed .category-nav button {
    padding: 10px 0;
    justify-content: center;
  }
  .sidebar.collapsed .sidebar-collapse-toggle {
    width: 24px;
    height: 24px;
  }
  /* 收起态 hover 一级项：右侧弹出二级悬浮面板，整栏保持 78px 不跳动 */
  .sidebar.collapsed .category-nav-item {
    position: relative;
  }
  .sidebar.collapsed .category-nav-item:hover .flyout,
  .sidebar.collapsed .category-nav-item:focus-within .flyout {
    display: block;
    animation: flyoutIn 0.18s ease;
  }
  @keyframes flyoutIn {
    from {
      opacity: 0;
      transform: translateX(-6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .main-area {
    transition: margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .main-area.sidebar-collapsed {
    margin-left: 78px;
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
    radial-gradient(1100px 640px at 4% -4%, rgba(84, 118, 214, 0.42), transparent 58%),
    radial-gradient(980px 900px at -8% 106%, rgba(148, 84, 194, 0.4), transparent 58%),
    radial-gradient(760px 720px at 92% 110%, rgba(74, 132, 186, 0.34), transparent 56%);
}
html.dark .sidebar {
  background: linear-gradient(165deg, rgba(38, 46, 60, 0.62) 0%, rgba(28, 35, 45, 0.46) 100%);
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
  border-color: rgba(172, 194, 230, 0.16);
  box-shadow:
    2px 0 16px rgba(0, 0, 0, 0.2),
    12px 0 40px rgba(0, 0, 0, 0.22),
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
html.dark .weather-widget {
  background: #181e26;
  border-color: #343d49;
  color: #cdd5e0;
}
html.dark .weather-widget .weather-temp {
  color: #e8edf5;
}
html.dark .weather-widget:hover {
  background: #222933;
  color: #c9d8ff;
}
html.dark .ticker-bar {
  background: linear-gradient(110deg, #1c2330, #1a2029 58%, #1a242b);
  border-color: rgba(172, 194, 230, 0.16);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.12);
}
html.dark .ticker-item {
  color: #9ba7b7;
}
html.dark .ticker-label {
  background: rgba(126, 136, 255, 0.14);
  color: #b8c1ff;
}
html.dark .ticker-viewport::before {
  background: linear-gradient(90deg, #1b222d, transparent);
}
html.dark .ticker-viewport::after {
  background: linear-gradient(270deg, #1b232c, transparent);
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
  background: transparent;
  border-color: transparent;
}
html.dark .category-nav button:hover,
html.dark .sidebar-footer button:hover {
  background: rgba(115, 145, 224, 0.2);
  border-color: rgba(145, 171, 246, 0.26);
  color: #c9d8ff;
}
html.dark .category-nav button.active {
  background: linear-gradient(120deg, rgba(124, 110, 255, 0.26), rgba(198, 96, 234, 0.2));
  border-color: rgba(145, 171, 246, 0.4);
  color: #d8e3ff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2);
}
html.dark .category-nav button .category-count {
  background: rgba(200, 210, 226, 0.12);
  color: #a9b4c4;
}
html.dark .category-nav button.active .category-count {
  background: rgba(145, 171, 246, 0.24);
  color: #d8e3ff;
}
html.dark .sidebar-collapse-toggle:hover {
  background: rgba(115, 145, 224, 0.2);
  color: #c9d8ff;
}
html.dark .brand,
html.dark .sidebar-footer {
  border-color: rgba(172, 194, 230, 0.16);
  background: transparent;
}
html.dark .pinned-section {
  background: linear-gradient(135deg, rgba(32, 42, 63, 0.85), rgba(41, 36, 58, 0.85));
  border-color: rgba(64, 80, 115, 0.8);
}
html.dark .pinned-section h2 {
  color: #e8ebf5;
}
html.dark .pinned-count {
  color: #c3cef2;
  background: rgba(134, 120, 255, 0.16);
  border-color: rgba(134, 120, 255, 0.3);
}
html.dark .pinned-icon {
  background: linear-gradient(135deg, #7a6cff, #a06df6);
}
html.dark .pinned-card {
  background: rgba(31, 39, 58, 0.66);
  border-color: rgba(64, 80, 115, 0.7);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}
html.dark .pinned-card:hover {
  background: #273049;
  border-color: #5a70a8;
  box-shadow: 0 16px 38px rgba(0, 0, 0, 0.42);
}
html.dark .pinned-card img {
  background: #fff;
  border-color: #3a4f7a;
}
html.dark .pinned-open {
  color: #b0a5ff;
  background: rgba(134, 120, 255, 0.18);
}
html.dark .category-nav button.subcategory {
  background: transparent;
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
html.dark .category-picker-trigger {
  border-color: #3a4656;
  background: #171d25;
  color: #e4e9f1;
}
html.dark .category-picker-trigger:hover,
html.dark .category-picker-trigger.open {
  border-color: #6674c9;
  background: #1c2430;
}
html.dark .category-path-icon {
  color: #aebaff;
  background: #2a3441;
  box-shadow: none;
}
html.dark .category-path-text {
  color: #e4e9f1;
}
html.dark .category-path-parent,
html.dark .category-picker-help {
  color: #91a0b5;
}
html.dark .category-level-pill {
  color: #bcc6ff;
  background: rgba(145, 158, 255, 0.16);
}
html.dark .category-tree {
  border-color: #384353;
  background: #1c232d;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.28);
}
html.dark .category-tree-head {
  border-color: #323c49;
  background: #202833;
}
html.dark .category-tree-head strong,
html.dark .category-tree-option,
html.dark .category-option-copy strong {
  color: #e4e9f1;
}
html.dark .category-tree-head > span {
  background: rgba(126, 136, 255, 0.15);
  color: #bdc5ff;
}
html.dark .category-parent-option:hover,
html.dark .category-tree-group.active .category-parent-option,
html.dark .category-child-option:hover,
html.dark .category-child-option.active {
  background: rgba(119, 128, 238, 0.13);
}
html.dark .category-option-icon {
  background: #293342;
  color: #b7c0ff;
}
html.dark .category-expand-button:hover {
  background: #29313d;
}
html.dark .category-child-list::before,
html.dark .category-child-branch {
  background: #3a4555;
}
html.dark .common-feature-toggle {
  border-color: #394452;
  background: #1c232c;
  color: #dce2eb;
}
html.dark .common-feature-toggle:hover,
html.dark .common-feature-toggle.active {
  border-color: #5966ad;
  background: #222a38;
}
html.dark .common-feature-icon {
  background: #2b3542;
}
html.dark .common-feature-toggle.active .common-feature-icon {
  background: rgba(226, 167, 44, 0.16);
}
html.dark .common-feature-copy strong {
  color: #e4e9f1;
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
  .ticker-bar {
    margin: 8px 10px 0;
  }
  .search-mode-trigger {
    width: 38px;
    padding: 0;
    justify-content: center;
  }
  .search-mode-trigger span,
  .search-mode-trigger > svg:last-child {
    display: none;
  }
  .search-mode-menu {
    position: fixed;
    top: 68px;
    right: 10px;
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
  .ticker-bar {
    height: 38px;
    gap: 9px;
    padding: 0 9px;
    border-radius: 11px;
  }
  .ticker-label {
    padding: 5px 7px;
  }
  .ticker-label > span:last-child,
  .ticker-pause-hint {
    display: none;
  }
  .category-tree-groups {
    padding-inline: 4px;
  }
  .category-level-pill {
    display: none;
  }
  .common-feature-toggle {
    align-items: flex-start;
  }
  .switch-track {
    margin-top: 6px;
  }
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
  .pinned-head {
    margin-bottom: 14px;
  }
  .pinned-icon {
    width: 28px;
    height: 28px;
    border-radius: 9px;
  }
  .pinned-card {
    padding-right: 14px;
    border-radius: 13px;
  }
  .pinned-open {
    display: none;
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

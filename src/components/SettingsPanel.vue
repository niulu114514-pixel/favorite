<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowUp,
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
  Clapperboard,
  Clock,
  Cloud,
  CloudUpload,
  Code,
  Coffee,
  Compass,
  Copy,
  Cpu,
  CreditCard,
  Database,
  Download,
  Dumbbell,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
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
  KeyRound,
  Landmark,
  Layers,
  LayoutList,
  Mail,
  MapPin,
  MessageCircle,
  Music,
  Newspaper,
  Palette,
  Pencil,
  PenTool,
  PieChart,
  Plane,
  RefreshCw,
  Rocket,
  Save,
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
  Trash2,
  TrendingUp,
  Tv,
  Users,
  Wifi,
  Wrench,
  X,
  Zap,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import type {
  AIConfig,
  BackgroundConfig,
  Category,
  IconConfig,
  SearchConfig,
  TickerConfig,
  WebDavBackupItem,
  WeatherConfig,
  WebDavConfig,
} from '../../types'
import { DEFAULT_BACKGROUND_CONFIG } from '../../types'
import { DEFAULT_ICON_CONFIG } from '../services/iconService'
import { testAIConfig } from '../services/aiService'
import { isEmojiIcon, splitCategoryIcon } from '../services/categoryIconUtil'

type SettingsDraft = {
  ai: AIConfig
  icon: IconConfig
  webdav: WebDavConfig
  background: BackgroundConfig
  search: SearchConfig
  weather: WeatherConfig
  ticker: TickerConfig
  websiteTitle: string
  navigationName: string
  showPinned: boolean
  defaultViewMode: 'compact' | 'detailed'
}

const props = defineProps<{
  open: boolean
  config: SettingsDraft
  token: string
  categories: Category[]
  saveConfigBatch: (configs: Record<string, unknown>) => Promise<void>
  reorderCategories: (orderedIds: string[]) => Promise<void>
  buildBackup: () => Record<string, unknown>
  restoreBackup: (data: Record<string, unknown>) => Promise<void>
  saveCategory: (category: Partial<Category>) => Promise<void>
  removeCategory: (id: string) => Promise<void>
}>()
const emit = defineEmits<{ close: []; saved: [settings: SettingsDraft] }>()
const draft = reactive<SettingsDraft>(createDraft(props.config))

const tickerCustomText = computed<string>({
  get: () => (draft.ticker.customItems || []).join('\n'),
  set: value => {
    draft.ticker.customItems = value
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  },
})
const saving = ref(false)
const testingAI = ref(false)
const aiMessage = ref('')
const webdavMessage = ref('')
const webdavBusy = ref(false)
const saveError = ref('')
const copied = ref(false)
const mcpToken = ref('')
const mcpTokenBusy = ref(false)
const mcpTokenMessage = ref('')
const settingsContent = ref<HTMLElement>()
const activeSection = ref('appearance')
const settingsTabs = [
  { id: 'appearance', label: '外观与视图', icon: Palette },
  { id: 'background', label: '随机背景', icon: Image },
  { id: 'categories', label: '分类排序', icon: Folder },
  { id: 'icons', label: '图标获取', icon: ExternalLink },
  { id: 'search', label: '搜索引擎', icon: Globe2 },
  { id: 'weather', label: '天气', icon: Cloud },
  { id: 'ticker', label: '滚动信息', icon: TrendingUp },
  { id: 'ai', label: 'AI 助手', icon: Sparkles },
  { id: 'mcp', label: 'MCP 客户端', icon: KeyRound },
  { id: 'webdav', label: 'WebDAV 备份', icon: Cloud },
]
const mcpEndpoint = `${window.location.origin}/api/mcp`
const mcpTools = [
  'list_links · search_links · list_categories · get_stats · get_category',
  'get_link · get_config · list_recent_links · update_config',
  'add_link · update_link · delete_link · bulk_add_links · reorder_links',
  'add_category · update_category · delete_category · reorder_categories',
]
const mcpToolCount = 18
const mcpClientConfig = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        cloudnav: {
          url: mcpEndpoint,
          headers: { Authorization: `Bearer ${mcpToken.value || 'YOUR_MCP_TOKEN'}` },
        },
      },
    },
    null,
    2
  )
)

function createDraft(source: SettingsDraft): SettingsDraft {
  return {
    ai: {
      ...source.ai,
      providers: source.ai.providers ? JSON.parse(JSON.stringify(source.ai.providers)) : undefined,
    },
    icon: { ...DEFAULT_ICON_CONFIG, ...source.icon },
    webdav: { url: '', username: '', password: '', enabled: false, ...source.webdav },
    background: { ...DEFAULT_BACKGROUND_CONFIG, ...source.background },
    search: {
      mode: source.search?.mode || 'internal',
      externalSources: source.search?.externalSources
        ? JSON.parse(JSON.stringify(source.search.externalSources))
        : [],
      defaultEngine: source.search?.defaultEngine,
      customEngineUrl: source.search?.customEngineUrl,
      customEngineIcon: source.search?.customEngineIcon,
    },
    weather: {
      enabled: false,
      provider: 'qweather',
      unit: 'celsius',
      ...source.weather,
    },
    ticker: {
      enabled: false,
      source: 'custom',
      customItems: source.ticker?.customItems ? [...source.ticker.customItems] : [],
      ...source.ticker,
    },
    websiteTitle: source.websiteTitle || source.ai.websiteTitle || '',
    navigationName: source.navigationName || source.ai.navigationName || '',
    showPinned: source.showPinned,
    defaultViewMode: source.defaultViewMode,
  }
}

watch(
  () => props.open,
  open => {
    if (!open) return
    Object.assign(draft, createDraft(props.config))
    aiMessage.value = ''
    saveError.value = ''
    webdavMessage.value = ''
    backups.value = []
    webdavBackupsLoaded.value = false
    categoryModalOpen.value = false
    bgPreviewUrl.value = ''
    mcpToken.value = ''
    mcpTokenMessage.value = ''
  }
)

// ===== 随机背景预览 =====
const bgPreviewUrl = ref('')
const bgDocsOpen = ref(false)

// 切换到 Jinghuashang 时，若地址仍是默认的 LoliApi，则自动填入其默认地址。
watch(
  () => draft.background.source,
  source => {
    if (
      source === 'jinghuashang' &&
      (!draft.background.apiUrl || draft.background.apiUrl === DEFAULT_BACKGROUND_CONFIG.apiUrl)
    ) {
      draft.background.apiUrl = 'https://imgapi.jinghuashang.cn/random'
    }
  }
)

function buildBgPreviewUrl() {
  let url =
    draft.background.source !== 'custom' || !draft.background.customUrl?.trim()
      ? draft.background.apiUrl.trim()
      : draft.background.customUrl.trim()
  if (
    draft.background.source === 'loli' &&
    draft.background.id &&
    /^\d{1,6}$/.test(draft.background.id)
  ) {
    url += url.includes('?') ? '&' : '?'
    url += 'id=' + draft.background.id
  }
  if (
    draft.background.source === 'jinghuashang' &&
    draft.background.sort &&
    /^[a-zA-Z]{1,20}$/.test(draft.background.sort)
  ) {
    url += url.includes('?') ? '&' : '?'
    url += 'sort=' + draft.background.sort
  }
  url += url.includes('?') ? '&' : '?'
  url += 't=' + Date.now()
  return url
}

function previewBg() {
  bgPreviewUrl.value = buildBgPreviewUrl()
}

// ===== 搜索引擎：外部源管理 =====
function addSearchSource() {
  draft.search.externalSources.push({
    id: `src-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: '',
    url: '',
    enabled: true,
    createdAt: Date.now(),
  })
}
function removeSearchSource(index: number) {
  draft.search.externalSources.splice(index, 1)
}

function sectionValue(name: keyof SettingsDraft) {
  const d = draft
  switch (name) {
    case 'ai':
      return { ...d.ai, websiteTitle: d.websiteTitle, navigationName: d.navigationName }
    case 'background':
      return d.background
    case 'icon':
      return d.icon
    case 'webdav':
      return d.webdav
    case 'search':
      return d.search
    case 'weather':
      return d.weather
    case 'ticker':
      return d.ticker
    default:
      return d[name]
  }
}

/** 原始配置中该分区的取值（用于与草稿比对，只提交发生变更的分区） */
// 可提交的配置分区：`ui`/`view` 在 SettingsDraft 上不存在独立字段，
// 保存时被映射到 `showPinned` / `defaultViewMode`。
type SettingsSection =
  | 'ai'
  | 'background'
  | 'icon'
  | 'webdav'
  | 'search'
  | 'weather'
  | 'ticker'
  | 'ui'
  | 'view'

function originalSectionValue(name: SettingsSection, source: SettingsDraft) {
  switch (name) {
    case 'ai':
      return {
        ...source.ai,
        websiteTitle: source.websiteTitle || source.ai.websiteTitle || '',
        navigationName: source.navigationName || source.ai.navigationName || '',
      }
    case 'background':
      return source.background
    case 'icon':
      return source.icon
    case 'webdav':
      return source.webdav
    case 'search':
      return {
        mode: source.search?.mode || 'internal',
        externalSources: source.search?.externalSources || [],
        defaultEngine: source.search?.defaultEngine,
        customEngineUrl: source.search?.customEngineUrl,
        customEngineIcon: source.search?.customEngineIcon,
      }
    case 'weather':
      return {
        enabled: false,
        provider: 'qweather',
        unit: 'celsius',
        ...source.weather,
      }
    case 'ticker':
      return {
        enabled: false,
        source: 'custom',
        customItems: source.ticker?.customItems || [],
        ...source.ticker,
      }
    case 'ui':
      // props.config 上不存在独立的 `ui` 字段，需映射到 `showPinned`。
      return { showPinnedWebsites: source.showPinned }
    case 'view':
      // props.config 上不存在独立的 `view` 字段，需映射到 `defaultViewMode`。
      return { defaultMode: source.defaultViewMode }
    default:
      return source[name]
  }
}

async function save() {
  saving.value = true
  saveError.value = ''
  const configs: Record<string, unknown> = {}
  const sections: Array<[string, unknown]> = []
  ;(['ai', 'background', 'icon', 'webdav', 'search', 'weather', 'ticker'] as const).forEach(
    name => {
      sections.push([name, sectionValue(name)])
    }
  )
  sections.push(['ui', { showPinnedWebsites: draft.showPinned }])
  sections.push(['view', { defaultMode: draft.defaultViewMode }])
  try {
    for (const [section, value] of sections) {
      const key = section as SettingsSection
      if (JSON.stringify(value) !== JSON.stringify(originalSectionValue(key, props.config))) {
        configs[key] = value
      }
    }
    // 至少提交一项，避免“未改动却整体覆写”的无效请求。
    if (Object.keys(configs).length) {
      await props.saveConfigBatch(configs)
    }
    emit('saved', {
      ...draft,
      ai: { ...draft.ai, websiteTitle: draft.websiteTitle, navigationName: draft.navigationName },
    })
    emit('close')
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function testWebDav() {
  webdavBusy.value = true
  webdavMessage.value = ''
  try {
    const response = await fetch('/api/webdav', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(props.token && props.token !== 'session' ? { 'x-auth-password': props.token } : {}),
      },
      body: JSON.stringify({ operation: 'check', config: draft.webdav }),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`)
    webdavMessage.value = '连接成功，可以进行备份'
  } catch (error) {
    webdavMessage.value = error instanceof Error ? error.message : '连接失败，请检查地址和账号'
  } finally {
    webdavBusy.value = false
  }
}

// ===== WebDAV 备份 / 恢复 / 列表 =====
const backups = ref<WebDavBackupItem[]>([])
const webdavBackupsLoaded = ref(false)

const webdavConfigured = computed(() => !!draft.webdav.url && !!draft.webdav.username)

function runWebDav<T>(operation: string, payload?: unknown): Promise<T> {
  return fetch('/api/webdav', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(props.token && props.token !== 'session' ? { 'x-auth-password': props.token } : {}),
    },
    body: JSON.stringify({ operation, config: draft.webdav, payload }),
  }).then<T>(async response => {
    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.success === false) {
      throw new Error(result.error || `HTTP ${response.status}`)
    }
    return result as T
  })
}

async function listBackups() {
  webdavBusy.value = true
  webdavMessage.value = ''
  try {
    const result = await runWebDav<{ items?: WebDavBackupItem[] }>('list')
    backups.value = result.items || []
    webdavBackupsLoaded.value = true
    if (!backups.value.length) webdavMessage.value = '该目录暂没有备份文件'
  } catch (error) {
    webdavMessage.value = error instanceof Error ? error.message : '获取备份列表失败'
  } finally {
    webdavBusy.value = false
  }
}

async function backupNow() {
  webdavBusy.value = true
  webdavMessage.value = ''
  try {
    const filename = `cloudnav_backup_${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)}.json`
    await runWebDav('backup', { filename, data: props.buildBackup() })
    webdavMessage.value = '备份成功，已保存到 WebDAV'
    await listBackups()
  } catch (error) {
    webdavMessage.value = error instanceof Error ? error.message : '备份失败'
  } finally {
    webdavBusy.value = false
  }
}

async function restoreNow(filename: string) {
  if (!window.confirm(`从“${filename}”恢复？当前数据将被备份文件覆盖。`)) return
  webdavBusy.value = true
  webdavMessage.value = ''
  try {
    const data = await runWebDav<Record<string, unknown>>('restore', { filename })
    await props.restoreBackup(data)
    webdavMessage.value = '恢复成功'
  } catch (error) {
    webdavMessage.value = error instanceof Error ? error.message : '恢复失败'
  } finally {
    webdavBusy.value = false
  }
}

// ===== 分类创建 / 编辑（弹窗）=====
const categoryModalOpen = ref(false)
const savingCategory = ref(false)

type CategoryModal = { id: string | null; name: string; parentId: string; icon: string }
const categoryModal = ref<CategoryModal>({
  id: null,
  name: '',
  parentId: '',
  icon: 'Folder',
})

/** 可选分类图标（需与 App.vue 中的 CATEGORY_ICON_MAP 保持一致） */
const categoryIconOptions: { name: string; icon: Component }[] = [
  { name: 'Star', icon: Star },
  { name: 'Folder', icon: Folder },
  { name: 'Target', icon: Target },
  { name: 'Wifi', icon: Wifi },
  { name: 'Bookmark', icon: Bookmark },
  { name: 'BookOpen', icon: BookOpen },
  { name: 'Box', icon: Box },
  { name: 'Briefcase', icon: Briefcase },
  { name: 'Clapperboard', icon: Clapperboard },
  { name: 'Cloud', icon: Cloud },
  { name: 'Code', icon: Code },
  { name: 'Compass', icon: Compass },
  { name: 'Database', icon: Database },
  { name: 'Dumbbell', icon: Dumbbell },
  { name: 'FileText', icon: FileText },
  { name: 'Gamepad2', icon: Gamepad2 },
  { name: 'Globe', icon: Globe },
  { name: 'Globe2', icon: Globe2 },
  { name: 'Github', icon: Github },
  { name: 'Slack', icon: Slack },
  { name: 'Mail', icon: Mail },
  { name: 'MessageCircle', icon: MessageCircle },
  { name: 'GraduationCap', icon: GraduationCap },
  { name: 'Grid2X2', icon: Grid2X2 },
  { name: 'Image', icon: Image },
  { name: 'Layers', icon: Layers },
  { name: 'LayoutList', icon: LayoutList },
  { name: 'Music', icon: Music },
  { name: 'Newspaper', icon: Newspaper },
  { name: 'Palette', icon: Palette },
  { name: 'PenTool', icon: PenTool },
  { name: 'Server', icon: Server },
  { name: 'Settings', icon: Settings },
  { name: 'ShoppingBag', icon: ShoppingBag },
  { name: 'ShoppingCart', icon: ShoppingCart },
  { name: 'Sparkles', icon: Sparkles },
  { name: 'TrendingUp', icon: TrendingUp },
  { name: 'Users', icon: Users },
  { name: 'Wrench', icon: Wrench },
  { name: 'Heart', icon: Heart },
  { name: 'Home', icon: Home },
  { name: 'Rocket', icon: Rocket },
  { name: 'Zap', icon: Zap },
  { name: 'Banknote', icon: Banknote },
  { name: 'Building2', icon: Building2 },
  { name: 'Landmark', icon: Landmark },
  { name: 'CreditCard', icon: CreditCard },
  { name: 'Camera', icon: Camera },
  { name: 'Car', icon: Car },
  { name: 'Plane', icon: Plane },
  { name: 'MapPin', icon: MapPin },
  { name: 'Calendar', icon: Calendar },
  { name: 'Clock', icon: Clock },
  { name: 'Tv', icon: Tv },
  { name: 'PieChart', icon: PieChart },
  { name: 'Shield', icon: Shield },
  { name: 'Cpu', icon: Cpu },
  { name: 'Coffee', icon: Coffee },
  { name: 'Stethoscope', icon: Stethoscope },
  { name: 'Gift', icon: Gift },
]

/** 常用 emoji 图标选项：既可从面板点选，也可在分类名称前直接输入 emoji 作为图标 */
const emojiIconOptions = [
  '⭐',
  '🔥',
  '🚀',
  '📁',
  '📚',
  '💡',
  '❤️',
  '🎯',
  '🛠️',
  '🧰',
  '🗂️',
  '📝',
  '🎨',
  '🎮',
  '🎬',
  '📰',
  '💰',
  '🛒',
  '☁️',
  '🖥️',
  '📱',
  '🔗',
  '⚙️',
  '🌐',
  '✉️',
  '👥',
  '🏠',
  '🗺️',
]

const categoryIconByName = new Map(categoryIconOptions.map(option => [option.name, option.icon]))
function categoryIcon(name?: string): Component {
  return categoryIconByName.get(name || 'Folder') || Folder
}

/** 可作为父级的分类（一级分类，即没有 parentId） */
const parentCategoryOptions = computed(() => {
  const parents = new Set<string>()
  for (const item of props.categories) {
    if (!item.parentId || !props.categories.some(c => c.id === item.parentId)) parents.add(item.id)
  }
  return props.categories.filter(item => parents.has(item.id))
})

/** 一级分类，按当前顺序排列 */
const topRows = computed(() =>
  props.categories.filter(c => !c.parentId || !props.categories.some(p => p.id === c.parentId))
)

/** 某个一级分类下的二级分类 */
function childrenOf(parentId: string) {
  return props.categories.filter(c => c.parentId === parentId)
}

function openNewCategory() {
  categoryModal.value = { id: null, name: '', parentId: '', icon: 'Folder' }
  categoryModalOpen.value = true
}

/** 直接给指定一级分类添加二级分类，默认选中该父级 */
function openAddChild(parent: Category) {
  categoryModal.value = { id: null, name: '', parentId: parent.id, icon: 'Folder' }
  categoryModalOpen.value = true
}

function openEditCategory(category: Category) {
  categoryModal.value = {
    id: category.id,
    name: category.name,
    parentId: category.parentId || '',
    icon: category.icon || 'Folder',
  }
  categoryModalOpen.value = true
}

function closeCategoryForm() {
  categoryModalOpen.value = false
}

async function submitCategoryForm() {
  if (!categoryModal.value.name.trim()) return
  savingCategory.value = true
  try {
    await props.saveCategory({
      id: categoryModal.value.id || undefined,
      name: categoryModal.value.name.trim(),
      parentId: categoryModal.value.parentId || undefined,
      icon: categoryModal.value.icon || 'Folder',
    })
    categoryModalOpen.value = false
  } finally {
    savingCategory.value = false
  }
}

function confirmRemoveCategory(category: Category) {
  if (
    !window.confirm(`删除“${category.name}”？该分类下的网站将移到常用推荐，二级分类也会一并删除。`)
  )
    return
  void props.removeCategory(category.id)
}

/**
 * 分类排序：仅在同一层级内移动（一级在一级之间、二级在同一个父级之下）。
 * 一级分类移动时会连同其二级子分类一起移动，从而保证层级不被破坏。
 * parentId 为 null 表示移动一级分类；否则表示在 parentId 下的二级分类中移动。
 */
async function moveRow(parentId: string | null, index: number, offset: number) {
  const members = parentId ? childrenOf(parentId) : topRows.value
  const to = index + offset
  if (to < 0 || to >= members.length) return
  const ids = members.map(item => item.id)
  ids.splice(to, 0, ids.splice(index, 1)[0])
  await props.reorderCategories(rebuildOrder(parentId, ids))
}

/** 根据同层级的期望顺序，重建所有分类的整体顺序（一级在前、其二级紧跟其后） */
function rebuildOrder(parentId: string | null, reorderedLevelIds: string[]): string[] {
  const ordered: string[] = []
  if (parentId === null) {
    for (const topId of reorderedLevelIds) {
      ordered.push(topId)
      for (const child of childrenOf(topId)) ordered.push(child.id)
    }
  } else {
    for (const top of topRows.value) {
      ordered.push(top.id)
      const children =
        top.id === parentId ? reorderedLevelIds : childrenOf(top.id).map(child => child.id)
      for (const childId of children) ordered.push(childId)
    }
  }
  return ordered
}

async function testAI() {
  testingAI.value = true
  aiMessage.value = ''
  try {
    aiMessage.value =
      (await testAIConfig('GitHub', 'https://github.com', draft.ai)) || 'AI 没有返回内容'
  } catch (error) {
    aiMessage.value = error instanceof Error ? error.message : 'AI 测试失败'
  } finally {
    testingAI.value = false
  }
}

async function copyMcp(value: string) {
  await navigator.clipboard.writeText(value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1600)
}

async function generateMcpToken() {
  mcpTokenBusy.value = true
  mcpTokenMessage.value = ''
  try {
    const response = await fetch('/api/mcp-token', {
      method: 'POST',
      credentials: 'include',
      headers:
        props.token && props.token !== 'session' ? { 'x-auth-password': props.token } : undefined,
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.token) throw new Error(result.error || `HTTP ${response.status}`)
    mcpToken.value = result.token
    mcpTokenMessage.value = '新令牌已生成，旧 MCP 令牌已自动失效。请立即复制并妥善保存。'
  } catch (error) {
    mcpTokenMessage.value = error instanceof Error ? error.message : '生成令牌失败'
  } finally {
    mcpTokenBusy.value = false
  }
}

async function revokeMcpToken() {
  mcpTokenBusy.value = true
  try {
    const response = await fetch('/api/mcp-token', {
      method: 'DELETE',
      credentials: 'include',
      headers:
        props.token && props.token !== 'session' ? { 'x-auth-password': props.token } : undefined,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    mcpToken.value = ''
    mcpTokenMessage.value = 'MCP 令牌已撤销。'
  } catch (error) {
    mcpTokenMessage.value = error instanceof Error ? error.message : '撤销令牌失败'
  } finally {
    mcpTokenBusy.value = false
  }
}

function scrollToSection(id: string) {
  activeSection.value = id
  settingsContent.value?.scrollTo({ top: 0 })
}

function formatSize(bytes: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div v-if="open" class="settings-backdrop" @click.self="emit('close')">
    <div class="settings-modal" role="dialog" aria-modal="true" aria-label="设置">
      <header class="settings-header">
        <div>
          <h2><Settings :size="19" /> 设置</h2>
          <p>配置网站、图标、AI 和 EdgeOne MCP。</p>
        </div>
        <button class="settings-close" aria-label="关闭设置" @click="emit('close')"><X /></button>
      </header>
      <div class="settings-body">
        <aside class="settings-nav" aria-label="设置分类">
          <p class="settings-nav-label">配置中心</p>
          <button
            v-for="tab in settingsTabs"
            :key="tab.id"
            :class="{ active: activeSection === tab.id }"
            :aria-current="activeSection === tab.id ? 'page' : undefined"
            @click="scrollToSection(tab.id)"
          >
            <component :is="tab.icon" :size="16" />
            <span>{{ tab.label }}</span>
          </button>
          <div class="settings-nav-tip">修改后点击底部“保存设置”同步到云端</div>
        </aside>
        <div ref="settingsContent" class="settings-content">
          <section
            id="settings-appearance"
            v-if="activeSection === 'appearance'"
            class="settings-section settings-card"
          >
            <h3><Palette :size="17" /> 网站外观</h3>
            <div class="settings-grid">
              <label
                >浏览器标题<input v-model="draft.websiteTitle" placeholder="落花流水个人导航"
              /></label>
              <label>导航名称<input v-model="draft.navigationName" placeholder="CloudNav" /></label>
            </div>
            <div class="settings-grid">
              <label
                >默认视图<select v-model="draft.defaultViewMode">
                  <option value="detailed">详细</option>
                  <option value="compact">紧凑</option>
                </select></label
              >
              <label class="settings-check"
                ><input v-model="draft.showPinned" type="checkbox" />显示置顶区域</label
              >
            </div>
          </section>

          <section
            id="settings-background"
            v-if="activeSection === 'background'"
            class="settings-section settings-card"
          >
            <h3><Image :size="17" /> 随机背景图片</h3>
            <p class="settings-help">
              可将站点背景替换为随机二次元图片（默认接入
              LoliApi），访问时会返回适合当前设备的图片。启用后在管理端出现，访客同样生效。
            </p>
            <label class="settings-check"
              ><input v-model="draft.background.enabled" type="checkbox" />启用随机背景</label
            >
            <div class="settings-grid">
              <label
                >图片来源<select v-model="draft.background.source">
                  <option value="loli">LoliApi（二次元随机图）</option>
                  <option value="jinghuashang">Jinghuashang（二次元随机图）</option>
                  <option value="custom">自定义图片</option>
                </select></label
              >
              <label v-if="draft.background.source === 'loli'"
                >LoliApi 地址<input
                  v-model="draft.background.apiUrl"
                  placeholder="https://www.loliapi.com/acg/"
              /></label>
              <label v-else-if="draft.background.source === 'jinghuashang'"
                >API 地址<input
                  v-model="draft.background.apiUrl"
                  placeholder="https://imgapi.jinghuashang.cn/random"
              /></label>
              <label v-else
                >图片 URL<input
                  v-model="draft.background.customUrl"
                  placeholder="https://example.com/random.jpg"
              /></label>
            </div>
            <div class="settings-grid">
              <label v-if="draft.background.source === 'loli'"
                >指定图片 id（可选）<input
                  v-model="draft.background.id"
                  placeholder="留空则随机" /></label
              ><label v-else-if="draft.background.source === 'jinghuashang'"
                >图片集<select v-model="draft.background.sort">
                  <option value="random">random（全部图片）</option>
                  <option value="hp">hp（横屏壁纸）</option>
                  <option value="sp">sp（竖屏壁纸）</option>
                  <option value="huaming">huaming（花铭老师，暂关闭）</option>
                </select></label
              ><label
                >自动轮换（分钟）<input
                  v-model.number="draft.background.autoRefreshMin"
                  type="number"
                  min="0"
                  max="1440"
                  placeholder="0 = 不自动轮换"
              /></label>
            </div>
            <div class="settings-grid">
              <label class="settings-range"
                >暗色遮罩
                <input
                  v-model.number="draft.background.overlay"
                  type="range"
                  min="0"
                  max="0.85"
                  step="0.05"
                /><span>{{ Math.round(draft.background.overlay * 100) }}%</span></label
              >
              <label class="settings-range"
                >模糊
                <input
                  v-model.number="draft.background.blur"
                  type="range"
                  min="0"
                  max="24"
                  step="1"
                /><span>{{ draft.background.blur }}px</span></label
              >
            </div>
            <div class="settings-inline no-gap">
              <button class="settings-secondary" @click="previewBg">
                <Image :size="15" />预览 / 换一张
              </button>
              <span v-if="bgPreviewUrl" class="bg-preview-hint"
                >预览仅本地查看，保存后站点生效。</span
              >
            </div>
            <div v-if="bgPreviewUrl" class="bg-preview" :style="{ backgroundColor: '#0e1520' }">
              <img
                :src="bgPreviewUrl"
                alt="随机背景预览"
                loading="lazy"
                style="width: 100%; height: 100%; object-fit: cover; object-position: center"
              />
            </div>
            <button
              v-if="draft.background.source === 'jinghuashang'"
              class="settings-link"
              type="button"
              @click="bgDocsOpen = !bgDocsOpen"
            >
              <BookOpen :size="15" />{{ bgDocsOpen ? '收起' : '查看' }} Jinghuashang 随机图 API
              食用说明
            </button>
            <div v-if="bgDocsOpen" class="bg-docs">
              <div class="bg-docs-line">
                <strong>随机图 API 地址</strong><code>https://imgapi.jinghuashang.cn/random</code>
              </div>
              <div class="bg-docs-line"><strong>调用方法</strong><code>GET</code></div>
              <p class="bg-docs-p">
                接口返回的是一张会实时重定向的随机二次元图片，本站已将其接入为网页背景；保存并启用后，
                访问者每次进入或按“自动轮换”间隔都会自动换一张。不支持直接取回一张图片用于其它用途。
              </p>
              <div class="bg-docs-line"><strong>常用参数（直接拼在地址后）</strong></div>
              <ul class="bg-docs-list">
                <li>
                  <code>sort</code> — 图片集：<code>random</code>（全部）/ <code>hp</code>（横屏）/
                  <code>sp</code>（竖屏）/
                  <code>huaming</code>（花铭老师，暂关闭）。不传默认随机全部。
                </li>
                <li>
                  <code>type</code> — 输出方式：<code>text</code>（输出图片 URL）/
                  <code>json</code>（输出 JSON）。不传默认重定向。
                </li>
                <li><code>num</code> — 一次返回图片数量（≤100 正整数，非 1 时强制 JSON）。</li>
                <li><code>only_check</code> — 传入任意真值即检查剩余额度，其它参数失效。</li>
              </ul>
              <div class="bg-docs-line">
                <strong>轮播背景（备选接入方式）</strong
                ><code>https://imgapi.jinghuashang.cn/player?time=10</code>
              </div>
              <div class="bg-docs-line"><strong>注意事项</strong></div>
              <ul class="bg-docs-list">
                <li>图片来自互联网，版权不确定，侵删。</li>
                <li>接口与图床均不保障可用性与稳定性，建议自备备用来源。</li>
                <li>绿色健康（不完全），请勿用于不适合的公共场合。</li>
              </ul>
            </div>
          </section>

          <section
            id="settings-categories"
            v-if="activeSection === 'categories'"
            class="settings-section settings-card"
          >
            <h3><Folder :size="17" /> 分类排序</h3>
            <p class="settings-help">
              一级分类可上下移动并连同其二级子分类一起调整；二级仅能在所在父级内移动。渲染顺序与侧栏、首页一致。
            </p>
            <div class="settings-inline no-gap">
              <button class="settings-primary" @click="openNewCategory">
                <FolderPlus :size="15" />新建分类
              </button>
            </div>

            <div v-if="topRows.length" class="category-sort-list">
              <template v-for="(parent, pIndex) in topRows" :key="parent.id">
                <div
                  class="category-sort-row"
                  :class="{ 'has-children': childrenOf(parent.id).length }"
                >
                  <template v-if="isEmojiIcon(parent.icon)">
                    <span class="emoji-icon">{{ parent.icon }}</span>
                  </template>
                  <component v-else :is="categoryIcon(parent.icon)" :size="15" />
                  <span class="category-sort-name">{{ parent.name }}</span>
                  <div class="category-sort-actions">
                    <button
                      v-if="parent.id !== 'common'"
                      :title="'添加二级分类'"
                      @click="openAddChild(parent)"
                    >
                      <FolderPlus :size="14" />
                    </button>
                    <button :title="'编辑'" @click="openEditCategory(parent)">
                      <Pencil :size="14" />
                    </button>
                    <button
                      v-if="parent.id !== 'common'"
                      :title="'删除'"
                      class="danger"
                      @click="confirmRemoveCategory(parent)"
                    >
                      <Trash2 :size="14" />
                    </button>
                    <button
                      :disabled="pIndex === 0"
                      :title="'上移'"
                      @click="moveRow(null, pIndex, -1)"
                    >
                      <ArrowUp :size="14" />
                    </button>
                    <button
                      :disabled="pIndex === topRows.length - 1"
                      :title="'下移'"
                      @click="moveRow(null, pIndex, 1)"
                    >
                      <ArrowDown :size="14" />
                    </button>
                  </div>
                </div>
                <div
                  v-for="(child, cIndex) in childrenOf(parent.id)"
                  :key="child.id"
                  class="category-sort-row is-child"
                >
                  <span class="child-branch">
                    <template v-if="isEmojiIcon(child.icon)">
                      <span class="emoji-icon">{{ child.icon }}</span>
                    </template>
                    <component v-else :is="categoryIcon(child.icon)" :size="15" />
                  </span>
                  <span class="category-sort-name">{{ child.name }}</span>
                  <div class="category-sort-actions">
                    <button :title="'编辑'" @click="openEditCategory(child)">
                      <Pencil :size="14" />
                    </button>
                    <button
                      v-if="child.id !== 'common'"
                      :title="'删除'"
                      class="danger"
                      @click="confirmRemoveCategory(child)"
                    >
                      <Trash2 :size="14" />
                    </button>
                    <button
                      :disabled="cIndex === 0"
                      :title="'上移'"
                      @click="moveRow(parent.id, cIndex, -1)"
                    >
                      <ArrowUp :size="14" />
                    </button>
                    <button
                      :disabled="cIndex === childrenOf(parent.id).length - 1"
                      :title="'下移'"
                      @click="moveRow(parent.id, cIndex, 1)"
                    >
                      <ArrowDown :size="14" />
                    </button>
                  </div>
                </div>
              </template>
            </div>
          </section>

          <section
            id="settings-icons"
            v-if="activeSection === 'icons'"
            class="settings-section settings-card"
          >
            <h3><ExternalLink :size="17" /> 图标自动获取</h3>
            <p class="settings-help">
              新增网站时自动生成图标；启用边缘缓存后由 `/api/favicon` 抓取并缓存到 EdgeOne Pages
              Blob。
            </p>
            <label
              >图标来源<select v-model="draft.icon.source">
                <option value="google">EdgeOne 缓存（推荐）</option>
                <option value="faviconextractor">FaviconExtractor</option>
                <option value="customurl">自定义 URL 模板</option>
                <option value="customapi">自定义 API</option>
              </select></label
            >
            <label class="settings-check"
              ><input v-model="draft.icon.cacheEnabled" type="checkbox" />启用边缘抓取缓存</label
            >
            <label v-if="draft.icon.source === 'customurl'"
              >URL 模板<input
                v-model="draft.icon.customurl!.url"
                placeholder="https://example.com/icon?domain={domain}"
            /></label>
            <label v-if="draft.icon.source === 'customapi'"
              >API 地址<input
                v-model="draft.icon.customapi!.url"
                placeholder="https://example.com/icon"
            /></label>
          </section>

          <section
            id="settings-search"
            v-if="activeSection === 'search'"
            class="settings-section settings-card"
          >
            <h3><Globe2 :size="17" /> 搜索引擎</h3>
            <p class="settings-help">
              在顶栏搜索框可切换到外部搜索。下方维护外部搜索引擎列表；每个源的 URL 支持用
              <code>{query}</code> 占位符表示关键词（例如
              <code>https://www.google.com/search?q={query}</code>）。未含占位符时，关键词会作为
              <code>?q=</code> 参数追加。
            </p>
            <div class="search-source-list" v-if="draft.search.externalSources.length">
              <div
                v-for="(source, index) in draft.search.externalSources"
                :key="source.id"
                class="search-source-row"
              >
                <label class="settings-check search-source-enable"
                  ><input v-model="source.enabled" type="checkbox"
                /></label>
                <label class="search-source-field"
                  >名称<input v-model="source.name" placeholder="Google"
                /></label>
                <label class="search-source-field search-source-url"
                  >URL 模板<input
                    v-model="source.url"
                    placeholder="https://www.google.com/search?q={query}"
                /></label>
                <button
                  type="button"
                  class="icon-button"
                  title="删除该搜索引擎"
                  @click="removeSearchSource(index)"
                >
                  <Trash2 :size="15" />
                </button>
              </div>
            </div>
            <button type="button" class="secondary-button" @click="addSearchSource">
              <Plus :size="15" />添加搜索引擎
            </button>
            <p v-if="!draft.search.externalSources.length" class="settings-help">
              尚未添加外部搜索引擎。添加后即可在搜索框右侧切换使用。
            </p>
          </section>

          <section
            id="settings-weather"
            v-if="activeSection === 'weather'"
            class="settings-section settings-card"
          >
            <h3><Cloud :size="17" /> 天气</h3>
            <p class="settings-help">
              在顶栏显示当前天气。API Key 仅保存在服务端 KV 配置中，浏览器不会接触到密钥。当前支持
              QWeather、OpenWeather 与 Visual Crossing。
            </p>
            <label class="settings-check"
              ><input v-model="draft.weather.enabled" type="checkbox" />显示天气挂件</label
            >
            <div class="settings-grid">
              <label
                >数据源<select v-model="draft.weather.provider">
                  <option value="qweather">QWeather（和风天气）</option>
                  <option value="openweather">OpenWeather</option>
                  <option value="visualcrossing">Visual Crossing</option>
                </select></label
              >
              <label
                >温度单位<select v-model="draft.weather.unit">
                  <option value="celsius">摄氏度</option>
                  <option value="fahrenheit">华氏度</option>
                </select></label
              >
            </div>
            <template v-if="draft.weather.provider === 'qweather'">
              <label
                >API Key<input
                  v-model="draft.weather.qweatherApiKey"
                  type="password"
                  autocomplete="off"
                  placeholder="QWeather 的 API Key"
              /></label>
              <div class="settings-grid">
                <label
                  >地点（LocationID）<input
                    v-model="draft.weather.qweatherLocation"
                    placeholder="例如 101010100"
                /></label>
                <label
                  >Host（可选）<input
                    v-model="draft.weather.qweatherHost"
                    placeholder="https://devapi.qweather.com"
                /></label>
              </div>
            </template>
            <template v-else-if="draft.weather.provider === 'openweather'">
              <label
                >API Key<input
                  v-model="draft.weather.openweatherApiKey"
                  type="password"
                  autocomplete="off"
                  placeholder="OpenWeather 的 API Key"
              /></label>
              <label
                >城市<input v-model="draft.weather.openweatherCity" placeholder="例如 Shanghai"
              /></label>
            </template>
            <template v-else>
              <label
                >API Key<input
                  v-model="draft.weather.visualcrossingApiKey"
                  type="password"
                  autocomplete="off"
                  placeholder="Visual Crossing 的 API Key"
              /></label>
              <label
                >地点<input
                  v-model="draft.weather.visualcrossingLocation"
                  placeholder="例如 Beijing,China"
              /></label>
            </template>
          </section>

          <section
            id="settings-ticker"
            v-if="activeSection === 'ticker'"
            class="settings-section settings-card"
          >
            <h3><TrendingUp :size="17" /> 滚动信息条</h3>
            <p class="settings-help">
              在顶栏下方显示一条可滚动的信息条，可接入 Mastodon、Memos 的动态，或自定义若干条文本。
            </p>
            <label class="settings-check"
              ><input v-model="draft.ticker.enabled" type="checkbox" />显示滚动信息条</label
            >
            <div class="settings-grid">
              <label
                >数据源<select v-model="draft.ticker.source">
                  <option value="mastodon">Mastodon</option>
                  <option value="memos">Memos</option>
                  <option value="yiyan">每日一言（随机一言）</option>
                  <option value="custom">自定义内容</option>
                </select></label
              >
            </div>
            <p v-if="draft.ticker.source === 'yiyan'" class="settings-help">
              每条随机从一言官方接口获取并滚动展示，无需额外配置。
            </p>
            <template v-if="draft.ticker.source === 'mastodon'">
              <div class="settings-grid">
                <label
                  >实例地址<input
                    v-model="draft.ticker.mastodonInstance"
                    placeholder="https://mastodon.social"
                /></label>
                <label
                  >用户账号<input
                    v-model="draft.ticker.mastodonUsername"
                    placeholder="例如 @username 或全 URL"
                /></label>
              </div>
              <div class="settings-grid">
                <label
                  >条数<select v-model.number="draft.ticker.mastodonLimit">
                    <option :value="5">5</option>
                    <option :value="10">10</option>
                    <option :value="20">20</option>
                  </select></label
                >
              </div>
            </template>
            <template v-else-if="draft.ticker.source === 'memos'">
              <div class="settings-grid">
                <label
                  >Host<input
                    v-model="draft.ticker.memosHost"
                    placeholder="https://memos.example.com"
                /></label>
                <label
                  >Creator（可选）<input
                    v-model="draft.ticker.memosCreator"
                    placeholder="用户 ID 或用户名"
                /></label>
              </div>
              <div class="settings-grid">
                <label
                  >条数<select v-model.number="draft.ticker.memosLimit">
                    <option :value="5">5</option>
                    <option :value="10">10</option>
                    <option :value="20">20</option>
                  </select></label
                >
                <label
                  >可见性<select v-model="draft.ticker.memosVisibility">
                    <option value="PUBLIC">PUBLIC</option>
                    <option value="PROTECTED">PROTECTED</option>
                    <option value="PRIVATE">PRIVATE</option>
                  </select></label
                >
              </div>
              <label
                >访问 Token（可选）<input
                  v-model="draft.ticker.memosToken"
                  type="password"
                  autocomplete="off"
              /></label>
            </template>
            <template v-else>
              <label
                >自定义内容（每行一条）<textarea
                  v-model="tickerCustomText"
                  rows="5"
                  placeholder="每条信息占一行"
                ></textarea>
              </label>
            </template>
          </section>

          <section
            id="settings-ai"
            v-if="activeSection === 'ai'"
            class="settings-section settings-card"
          >
            <h3><Sparkles :size="17" /> AI 功能</h3>
            <p class="settings-help">
              在添加网站时自动生成中文描述，也可根据分类列表给出分类建议。请求由服务端代理，API Key
              不会发送给第三方前端脚本；留空会保留已保存的密钥。
            </p>
            <div class="settings-grid">
              <label
                >提供商<select v-model="draft.ai.provider">
                  <option value="google">Google Gemini</option>
                  <option value="openai">OpenAI 兼容 API</option>
                  <option value="claude">Claude</option>
                </select></label
              >
              <label>模型<input v-model="draft.ai.model" placeholder="gemini-2.0-flash" /></label>
            </div>
            <label
              >API Key<input
                v-model="draft.ai.apiKey"
                type="password"
                autocomplete="off"
                placeholder="留空保留服务端已保存的密钥"
            /></label>
            <label
              >Base URL<input v-model="draft.ai.baseUrl" placeholder="https://api.openai.com/v1"
            /></label>
            <div class="settings-inline">
              <button class="settings-secondary" :disabled="testingAI" @click="testAI">
                <Sparkles :size="15" />{{ testingAI ? '测试中…' : '测试 AI 配置' }}</button
              ><span v-if="aiMessage" class="settings-result">{{ aiMessage }}</span>
            </div>
          </section>

          <section
            id="settings-webdav"
            v-if="activeSection === 'webdav'"
            class="settings-section settings-card"
          >
            <h3><Cloud :size="17" /> WebDAV 备份</h3>
            <p class="settings-help">
              可连接 Nextcloud、坚果云或 NAS 的 WebDAV 目录进行备份。CloudNav 会在服务端保存
              <code>cloudnav_backup_*.json</code>，仅用于备份与恢复，不影响日常收藏浏览。
            </p>
            <label class="settings-check">
              <input v-model="draft.webdav.enabled" type="checkbox" />启用 WebDAV 备份
            </label>
            <div class="settings-grid">
              <label
                >WebDAV 地址<input
                  v-model="draft.webdav.url"
                  placeholder="https://dav.example.com/remote.php/dav/files/user/"
                  autocomplete="url"
              /></label>
              <label
                >备份文件夹（可选）<input
                  v-model="draft.webdav.folder"
                  placeholder="cloudnav/backups"
                  autocomplete="off"
              /></label>
            </div>
            <div class="settings-grid">
              <label>用户名<input v-model="draft.webdav.username" autocomplete="username" /></label>
              <label
                >密码或应用专用密码<input
                  v-model="draft.webdav.password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="留空保留服务端已保存的密码"
              /></label>
            </div>

            <div class="settings-inline no-gap">
              <button
                class="settings-secondary"
                :disabled="webdavBusy || !webdavConfigured"
                @click="testWebDav"
              >
                <Cloud :size="15" />{{ webdavBusy ? '操作中…' : '测试连接' }}
              </button>
              <button
                class="settings-primary"
                :disabled="webdavBusy || !webdavConfigured"
                @click="backupNow"
              >
                <CloudUpload :size="15" />立即备份
              </button>
              <button
                class="settings-secondary"
                :disabled="webdavBusy || !webdavConfigured"
                @click="listBackups"
              >
                <RefreshCw :size="15" />查看备份
              </button>
            </div>
            <span
              v-if="webdavMessage"
              class="settings-result"
              :class="{
                error: !webdavMessage.includes('成功') && !webdavMessage.includes('暂没有'),
              }"
              >{{ webdavMessage }}</span
            >

            <div v-if="webdavBackupsLoaded" class="backup-list">
              <div class="backup-list-title">已备份的文件（{{ backups.length }}）</div>
              <div v-if="!backups.length" class="backup-list-empty">
                还没有备份，点击“立即备份”创建。
              </div>
              <div v-for="item in backups" :key="item.name" class="backup-row">
                <div class="backup-meta">
                  <span class="backup-name">{{ item.name }}</span>
                  <span v-if="item.modified" class="backup-date">{{ item.modified }}</span>
                  <span v-if="item.size" class="backup-size">{{ formatSize(item.size) }}</span>
                </div>
                <button
                  class="backup-restore"
                  :disabled="webdavBusy"
                  @click="restoreNow(item.name)"
                >
                  <Download :size="14" />恢复
                </button>
              </div>
            </div>
          </section>

          <section
            id="settings-mcp"
            v-if="activeSection === 'mcp'"
            class="settings-section settings-card"
          >
            <h3><KeyRound :size="17" /> MCP / EdgeOne 部署</h3>
            <p class="settings-help">
              这是 CloudNav 的远程 MCP 服务端（Streamable HTTP，协议
              <code>2025-06-18</code>）。已提供 <b>{{ mcpToolCount }}</b> 个工具，
              支持结构化的读取结果，接入后可由 AI 客户端直接读写你的导航数据。
            </p>
            <p class="settings-help mcp-server-help">
              只读工具（list_links、search_links、list_categories、get_stats、get_link、
              get_category、list_recent_links）无需认证即可访问；写入工具需要携带管理令牌
              （Authorization Bearer）。下方可生成与网页登录会话分离、可随时撤销的 MCP 令牌。
            </p>
            <p class="settings-help mcp-server-help">
              分类图标约定：add_category / update_category 的名称（name）带前导 emoji 时（如 “⭐
              常用推荐”）会被自动提取为图标，否则使用 lucide 图标名（如 Folder、Star）。
            </p>
            <div class="settings-inline">
              <button class="settings-primary" :disabled="mcpTokenBusy" @click="generateMcpToken">
                <KeyRound :size="15" />{{ mcpTokenBusy ? '处理中…' : '生成独立 MCP 令牌' }}
              </button>
              <button class="settings-secondary" :disabled="mcpTokenBusy" @click="revokeMcpToken">
                撤销现有令牌
              </button>
            </div>
            <p v-if="mcpTokenMessage" class="settings-result">{{ mcpTokenMessage }}</p>
            <div v-if="mcpToken" class="mcp-command mcp-token-value">
              <code>{{ mcpToken }}</code>
              <button @click="copyMcp(mcpToken)" title="复制 MCP 令牌"><Copy :size="15" /></button>
            </div>
            <div class="mcp-command">
              <code>{{ mcpEndpoint }}</code
              ><button @click="copyMcp(mcpEndpoint)" :title="copied ? '已复制' : '复制 MCP 地址'">
                <Check v-if="copied" :size="15" /><Copy v-else :size="15" />
              </button>
            </div>
            <div class="mcp-config">
              <div class="mcp-config-title">
                客户端配置（Claude Desktop / Cursor / Cherry Studio）
              </div>
              <pre><code>{{ mcpClientConfig }}</code></pre>
              <button class="mcp-copy-config" @click="copyMcp(mcpClientConfig)">
                <Copy :size="14" />复制配置
              </button>
            </div>
            <details class="mcp-tools-list">
              <summary>查看可用工具清单</summary>
              <ul>
                <li v-for="tool in mcpTools" :key="tool">{{ tool }}</li>
              </ul>
            </details>
            <a
              class="mcp-link"
              href="https://edgeone.cloud.tencent.com/pages/document/173172415568367616"
              target="_blank"
              rel="noreferrer"
              >查看 EdgeOne Pages MCP 文档 <ExternalLink :size="14"
            /></a>
          </section>
        </div>
      </div>
      <footer class="settings-footer">
        <span v-if="saveError" class="settings-error">{{ saveError }}</span
        ><button class="settings-secondary" @click="emit('close')">取消</button
        ><button class="settings-primary" :disabled="saving" @click="save">
          <Save :size="16" />{{ saving ? '保存中…' : '保存设置' }}
        </button>
      </footer>
    </div>
  </div>

  <div
    v-if="categoryModalOpen"
    class="settings-backdrop category-modal-wrap"
    @click.self="closeCategoryForm"
  >
    <div class="category-modal" role="dialog" aria-modal="true">
      <div class="category-modal-header">
        <h3><Folder :size="18" />{{ categoryModal.id ? '编辑分类' : '新建分类' }}</h3>
        <button class="settings-close" type="button" @click="closeCategoryForm"><X /></button>
      </div>
      <form @submit.prevent="submitCategoryForm">
        <label
          >分类名称
          <input
            v-model="categoryModal.name"
            type="text"
            required
            maxlength="40"
            placeholder="例如：开发工具"
            autofocus
          />
        </label>
        <label>
          上级分类
          <select v-model="categoryModal.parentId">
            <option value="">一级分类（默认，顶层）</option>
            <option
              v-for="parent in parentCategoryOptions.filter(item => item.id !== categoryModal.id)"
              :key="parent.id"
              :value="parent.id"
            >
              二级分类 · {{ parent.name }}
            </option>
          </select>
        </label>
        <p class="modal-help">默认新建为一级分类；选择上级分类后即为二级，支持两级分类。</p>
        <div class="category-field-label">图标</div>
        <p class="modal-help">
          名称前输入 emoji（如“⭐ 常用推荐”）会自动作为图标；也可在下方选择。
        </p>
        <div class="category-icon-picker">
          <button
            v-for="option in categoryIconOptions"
            :key="option.name"
            type="button"
            class="category-icon-option"
            :class="{ active: categoryModal.icon === option.name }"
            :title="option.name"
            :aria-pressed="categoryModal.icon === option.name"
            @click="categoryModal.icon = option.name"
          >
            <component :is="option.icon" :size="18" />
          </button>
          <button
            v-for="emoji in emojiIconOptions"
            :key="emoji"
            type="button"
            class="category-icon-option emoji"
            :class="{ active: categoryModal.icon === emoji }"
            :title="emoji"
            :aria-pressed="categoryModal.icon === emoji"
            @click="categoryModal.icon = emoji"
          >
            {{ emoji }}
          </button>
        </div>
        <div class="category-form-actions">
          <button type="button" class="settings-secondary" @click="closeCategoryForm">取消</button>
          <button type="submit" class="settings-primary" :disabled="savingCategory">
            <Save :size="15" />{{ savingCategory ? '保存中…' : '保存' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* ===== Theme tokens ===== */
.settings-backdrop {
  --c-bg: #ffffff;
  --c-surface: #f5f7fb;
  --c-nav-bg: #eef2f8;
  --c-border: #e4e9f1;
  --c-border-strong: #d7deeb;
  --c-text: #1b2534;
  --c-muted: #71809a;
  --c-faint: #8d99ad;
  --c-primary: #426be3;
  --c-primary-text: #ffffff;
  --c-header-grad: linear-gradient(135deg, #edf3ff 0%, #f8faff 58%, #f4efff 100%);
  --c-nav-active: #ffffff;
  --c-input-bg: #ffffff;
  --c-card-shadow: 0 8px 24px rgba(41, 57, 89, 0.05);
  --c-overlay: rgba(18, 27, 42, 0.5);
}
html.dark .settings-backdrop {
  --c-bg: #202833;
  --c-surface: #1c232d;
  --c-nav-bg: #1b222c;
  --c-border: #354253;
  --c-border-strong: #3f4d5e;
  --c-text: #dce4ef;
  --c-muted: #9aa6b6;
  --c-faint: #7c8999;
  --c-primary: #5a7ff0;
  --c-primary-text: #ffffff;
  --c-header-grad: linear-gradient(135deg, #263652 0%, #222933 58%, #302b45 100%);
  --c-nav-active: #2c394b;
  --c-input-bg: #171d25;
  --c-card-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  --c-overlay: rgba(0, 0, 0, 0.6);
}

.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--c-overlay);
  backdrop-filter: blur(3px);
}
.settings-modal {
  width: min(980px, 100%);
  max-height: min(820px, calc(100vh - 32px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 20px;
  box-shadow: 0 28px 90px rgba(27, 40, 72, 0.28);
}
.settings-header {
  display: flex;
  align-items: flex-start;
  gap: 15px;
  padding: 22px 26px 18px;
  border-bottom: 1px solid var(--c-border);
  background: var(--c-header-grad);
}
.settings-header > div {
  flex: 1;
  min-width: 0;
}
.settings-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px;
  font-size: 19px;
  color: var(--c-text);
}
.settings-header h2 svg {
  color: var(--c-primary);
}
.settings-header p {
  margin: 0;
  color: var(--c-muted);
  font-size: 12px;
}
.settings-close {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.6);
  color: var(--c-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.settings-close:hover {
  color: var(--c-primary);
}

.settings-body {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 22px 14px;
  border-right: 1px solid var(--c-border);
  background: var(--c-nav-bg);
}
.settings-nav-label {
  margin: 0 10px 9px;
  color: var(--c-faint);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.settings-nav button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 10px 13px;
  background: transparent;
  color: var(--c-muted);
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  font-weight: 650;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease;
}
.settings-nav button:hover {
  color: var(--c-primary);
}
.settings-nav button.active {
  background: var(--c-nav-active);
  border-color: var(--c-border-strong);
  color: var(--c-primary);
  box-shadow: var(--c-card-shadow);
}
.settings-nav-tip {
  margin: auto 8px 0;
  color: var(--c-faint);
  font-size: 11px;
  line-height: 1.5;
}

.settings-content {
  min-width: 0;
  overflow-y: auto;
  padding: 18px 22px 24px;
  overscroll-behavior: contain;
}
.settings-section.settings-card {
  margin: 0 0 14px;
  padding: 20px;
  border: 1px solid var(--c-border);
  border-radius: 16px;
  background: var(--c-bg);
  box-shadow: var(--c-card-shadow);
}
.settings-section.settings-card:last-child {
  margin-bottom: 0;
}
.settings-section h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 12px;
  font-size: 15px;
  color: var(--c-text);
}
.settings-section h3 svg {
  color: var(--c-primary);
}
.settings-help {
  font-size: 12px;
  color: var(--c-muted);
  line-height: 1.55;
  margin: 0 0 13px;
  max-width: 680px;
}
.settings-section label {
  display: block;
  color: var(--c-text);
  font-size: 13px;
  font-weight: 650;
  margin: 11px 0;
}
.settings-section input:not([type='checkbox']),
.settings-section select {
  width: 100%;
  box-sizing: border-box;
  min-height: 40px;
  margin-top: 6px;
  padding: 9px 11px;
  border: 1px solid var(--c-border-strong);
  border-radius: 10px;
  background-color: var(--c-input-bg);
  color: var(--c-text);
  font: inherit;
  font-weight: 400;
  outline: 0;
}
.settings-section input:not([type='checkbox']):focus,
.settings-section select:focus {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px rgba(89, 124, 226, 0.18);
}
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px;
}
.settings-range {
  display: flex !important;
  align-items: center;
  gap: 10px;
}
.settings-range input[type='range'] {
  margin-top: 0;
  flex: 1;
  accent-color: var(--c-primary);
}
.settings-range span {
  width: 44px;
  color: var(--c-muted);
  font-size: 12px;
  font-weight: 600;
  text-align: right;
  flex: 0 0 auto;
}
.bg-preview {
  position: relative;
  margin-top: 12px;
  height: 180px;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--c-card-shadow);
}
.bg-preview-hint {
  font-size: 12px;
  color: var(--c-faint);
}
.settings-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--c-primary);
  font-size: 13px;
  cursor: pointer;
}
.bg-docs {
  margin-top: 10px;
  padding: 12px 14px;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: var(--c-bg-soft);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-faint);
}
.bg-docs-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 4px 0;
}
.bg-docs-p {
  margin: 4px 0;
}
.bg-docs code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(127, 127, 159, 0.12);
  color: var(--c-text);
  word-break: break-all;
}
.bg-docs-list {
  margin: 4px 0 6px;
  padding-left: 18px;
  display: grid;
  gap: 2px;
}
.bg-docs-list li {
  margin: 0;
}
.settings-check {
  display: flex !important;
  align-items: center;
  gap: 8px;
  margin-top: 18px !important;
  font-weight: 500 !important;
}
.settings-check input {
  width: 17px;
  height: 17px;
  accent-color: var(--c-primary);
}
.search-source-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
}
.search-source-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid #e2e6ed;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.5);
}
.search-source-row .search-source-enable {
  flex: 0 0 auto;
  margin: 0 !important;
}
.search-source-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.search-source-field input {
  font-size: 13px;
}
html.dark .search-source-row {
  background: rgba(34, 41, 51, 0.6);
  border-color: #343d49;
}
.settings-inline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 13px;
}
.settings-secondary,
.settings-primary {
  height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  cursor: pointer;
  font-weight: 650;
}
.settings-secondary {
  background: #edf1f6;
  color: #59687c;
}
html.dark .settings-secondary {
  background: #343d49;
  color: #d3dbe8;
}
.settings-secondary:disabled,
.settings-primary:disabled {
  opacity: 0.6;
  cursor: wait;
}
.settings-primary {
  background: var(--c-primary);
  color: var(--c-primary-text);
  box-shadow: 0 5px 12px rgba(66, 107, 227, 0.25);
}
.settings-result {
  font-size: 12px;
  color: #278458;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* ===== 分类排序 ===== */
.category-sort-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.category-sort-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--c-border);
  border-radius: 11px;
  background: var(--c-surface);
  color: var(--c-muted);
}
.category-sort-row.is-child {
  margin-left: 26px;
  background: color-mix(in srgb, var(--c-surface) 70%, transparent);
  border-style: dashed;
}
.category-sort-row.has-children {
  border-left: 3px solid var(--c-primary);
}
.category-sort-row .child-branch {
  color: var(--c-faint);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}
.category-sort-row > svg {
  color: var(--c-primary);
  flex: 0 0 auto;
}
.category-sort-row > .emoji-icon {
  font-size: 16px;
  line-height: 1;
  display: inline-flex;
}
.category-sort-row .child-branch .emoji-icon {
  font-size: 15px;
  line-height: 1;
  display: inline-flex;
}
.category-sort-name {
  flex: 1;
  font-size: 13px;
  font-weight: 650;
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.category-sort-actions {
  display: flex;
  gap: 4px;
}
.category-sort-actions button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--c-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.category-sort-actions button:hover:not(:disabled) {
  background: rgba(89, 124, 226, 0.14);
  color: var(--c-primary);
}
.category-sort-actions button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.category-sort-actions button.danger:hover {
  background: rgba(220, 53, 69, 0.12);
  color: #dc3545;
}
.settings-inline.no-gap {
  margin-top: 4px;
}
/* ===== 分类新建/编辑表单 ===== */
.category-form {
  margin-top: 14px;
  padding: 16px;
  border: 1px dashed var(--c-border-strong);
  border-radius: 12px;
  background: var(--c-surface);
}
.category-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 14px;
}
.category-field-label {
  margin: 14px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}
.category-icon-picker {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 8px;
}
.category-icon-option {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-border);
  border-radius: 9px;
  background: var(--c-bg-soft);
  color: var(--c-text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}
.category-icon-option:hover {
  border-color: var(--c-accent, #6a5cff);
  color: var(--c-accent, #6a5cff);
}
.category-icon-option.active {
  background: var(--c-accent, #6a5cff);
  border-color: var(--c-accent, #6a5cff);
  color: #fff;
}
.category-icon-option.emoji {
  font-size: 17px;
  line-height: 1;
}
.category-icon-option.emoji.active {
  background: transparent;
  border-color: var(--c-accent, #6a5cff);
  box-shadow: inset 0 0 0 2px var(--c-accent, #6a5cff);
}
@media (max-width: 560px) {
  .category-icon-picker {
    grid-template-columns: repeat(6, 1fr);
  }
}
/* ===== 分类新建/编辑弹窗 ===== */
.category-modal-wrap {
  /* 必须高于设置面板（.settings-backdrop 为 100），否则分类弹窗会叠在设置弹窗下方无法点击 */
  z-index: 120;
}
.category-modal {
  width: min(92vw, 420px);
  max-height: 85vh;
  overflow: auto;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(18, 27, 42, 0.25);
  padding: 22px;
}
.category-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.category-modal-header h3 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  color: var(--c-text);
}
.category-modal form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 13px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-muted);
}
.category-modal form input,
.category-modal form select {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--c-border-strong);
  border-radius: 9px;
  background-color: var(--c-input-bg);
  color: var(--c-text);
  font-size: 14px;
  outline: none;
}
.category-modal form input:focus,
.category-modal form select:focus {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px rgba(89, 124, 226, 0.15);
}
.category-modal .modal-help {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--c-faint);
  line-height: 1.6;
}
/* ===== WebDAV 备份列表 ===== */
.backup-list {
  margin-top: 16px;
  border-top: 1px solid var(--c-border);
  padding-top: 12px;
}
.backup-list-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--c-muted);
  margin-bottom: 8px;
}
.backup-list-empty {
  font-size: 12px;
  color: var(--c-faint);
  padding: 8px 0;
}
.backup-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: var(--c-surface);
  margin-bottom: 7px;
}
.backup-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.backup-name {
  font-size: 12px;
  font-weight: 650;
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.backup-date,
.backup-size {
  font-size: 11px;
  color: var(--c-faint);
}
.backup-restore {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: rgba(89, 124, 226, 0.14);
  color: var(--c-primary);
  font-size: 12px;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  flex: 0 0 auto;
}
.backup-restore:hover:not(:disabled) {
  background: rgba(89, 124, 226, 0.24);
}
.backup-restore:disabled {
  opacity: 0.6;
  cursor: wait;
}
.settings-result.error,
.settings-error {
  color: #cf4141;
}
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  padding: 14px 26px;
  border-top: 1px solid var(--c-border);
  background: var(--c-bg);
}
.settings-error {
  font-size: 12px;
  flex: 1;
}
.settings-footer .settings-secondary {
  background: transparent;
}
.settings-footer .settings-secondary:hover {
  background: #edf1f6;
}
html.dark .settings-footer .settings-secondary:hover {
  background: #343d49;
}

.mcp-command {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
  border-radius: 9px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
}
.mcp-command code {
  font-size: 12px;
  flex: 1;
  overflow: auto;
}
.mcp-command button {
  border: 0;
  background: transparent;
  color: var(--c-primary);
  cursor: pointer;
}
.mcp-config {
  position: relative;
  margin-top: 12px;
  padding: 11px;
  border: 1px solid var(--c-border);
  border-radius: 9px;
  background: var(--c-surface);
}
.mcp-config-title {
  margin-bottom: 7px;
  color: var(--c-muted);
  font-size: 12px;
}
.mcp-config pre {
  max-height: 150px;
  margin: 0;
  overflow: auto;
  white-space: pre;
}
.mcp-config code {
  color: var(--c-text);
  font:
    11px/1.5 ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace;
}
.mcp-copy-config {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  border: 0;
  border-radius: 7px;
  padding: 6px 9px;
  background: rgba(89, 124, 226, 0.14);
  color: var(--c-primary);
  cursor: pointer;
  font-size: 12px;
}
.mcp-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  color: var(--c-primary);
  font-size: 12px;
  text-decoration: none;
}

.mcp-tools-list {
  margin: 12px 0;
  padding: 8px 12px;
  border: 1px solid var(--c-border);
  border-radius: 8px;
  background: var(--c-bg-soft);
}
.mcp-tools-list summary {
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}
.mcp-tools-list ul {
  margin: 8px 0 0;
  padding-left: 20px;
  font-size: 12px;
  color: var(--c-text-muted);
}
.mcp-tools-list li {
  margin: 4px 0;
  line-height: 1.5;
}

/* ===== Mobile: horizontal tab bar + stacked body ===== */
@media (max-width: 680px) {
  .settings-backdrop {
    padding: 8px;
    place-items: stretch;
  }
  .settings-modal {
    width: 100%;
    max-height: calc(100dvh - 16px);
    border-radius: 18px;
  }
  .settings-header {
    padding: 16px;
  }
  .settings-header h2 {
    font-size: 18px;
  }
  .settings-close {
    width: 38px;
    height: 38px;
  }
  .settings-body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .settings-nav {
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    gap: 8px;
    padding: 10px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--c-border);
    scrollbar-width: none;
  }
  .settings-nav::-webkit-scrollbar {
    display: none;
  }
  .settings-nav-label,
  .settings-nav-tip {
    display: none;
  }
  .settings-nav button {
    flex: 0 0 auto;
    width: auto;
    min-width: 106px;
    min-height: 44px;
    justify-content: flex-start;
    padding: 10px 12px;
    font-size: 12px;
    white-space: nowrap;
  }
  .settings-content {
    flex: 1;
    min-height: 0;
    padding: 12px;
    overflow-y: auto;
  }
  .settings-section.settings-card {
    margin-bottom: 12px;
    padding: 16px;
  }
  .settings-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .settings-section input:not([type='checkbox']),
  .settings-section select {
    min-height: 44px;
    font-size: 16px;
  }
  .settings-inline {
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }
  .settings-inline .settings-secondary {
    width: 100%;
    min-height: 44px;
  }
  .mcp-command {
    align-items: stretch;
    flex-direction: column;
    gap: 7px;
  }
  .mcp-command code {
    max-width: 100%;
    overflow-x: auto;
    white-space: nowrap;
  }
  .mcp-command button {
    align-self: flex-end;
    min-height: 36px;
    padding: 0 8px;
  }
  .settings-footer {
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
  }
  .settings-footer .settings-secondary,
  .settings-footer .settings-primary {
    flex: 1 1 130px;
    min-height: 44px;
  }
  .settings-error {
    flex: 0 0 100%;
    order: -1;
  }
}
</style>

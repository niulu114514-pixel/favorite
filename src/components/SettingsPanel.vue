<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Cloud,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Folder,
  FolderPlus,
  Image,
  KeyRound,
  Palette,
  Pencil,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-vue-next'
import type {
  AIConfig,
  BackgroundConfig,
  Category,
  IconConfig,
  WebDavBackupItem,
  WebDavConfig,
} from '../../types'
import { DEFAULT_BACKGROUND_CONFIG } from '../../types'
import { DEFAULT_ICON_CONFIG } from '../services/iconService'
import { generateLinkDescription } from '../services/aiService'

type SettingsDraft = {
  ai: AIConfig
  icon: IconConfig
  webdav: WebDavConfig
  background: BackgroundConfig
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
const saving = ref(false)
const testingAI = ref(false)
const aiMessage = ref('')
const webdavMessage = ref('')
const webdavBusy = ref(false)
const saveError = ref('')
const copied = ref(false)
const settingsContent = ref<HTMLElement>()
const activeSection = ref('appearance')
const settingsTabs = [
  { id: 'appearance', label: '外观与视图', icon: Palette },
  { id: 'background', label: '随机背景', icon: Image },
  { id: 'categories', label: '分类排序', icon: Folder },
  { id: 'icons', label: '图标获取', icon: ExternalLink },
  { id: 'ai', label: 'AI 助手', icon: Sparkles },
  { id: 'mcp', label: 'MCP 客户端', icon: KeyRound },
  { id: 'webdav', label: 'WebDAV 备份', icon: Cloud },
]
const mcpEndpoint = `${window.location.origin}/api/mcp`
const mcpClientConfig = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        cloudnav: {
          url: mcpEndpoint,
          headers: { Authorization: 'Bearer YOUR_ADMIN_TOKEN' },
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
  }
)

// ===== 随机背景预览 =====
const bgPreviewUrl = ref('')

function buildBgPreviewUrl() {
  let url =
    draft.background.source === 'custom' && draft.background.customUrl?.trim()
      ? draft.background.customUrl.trim()
      : draft.background.apiUrl.trim()
  if (draft.background.source === 'loli' && draft.background.id && /^\d{1,6}$/.test(draft.background.id)) {
    url += url.includes('?') ? '&' : '?'
    url += 'id=' + draft.background.id
  }
  url += url.includes('?') ? '&' : '?'
  url += 't=' + Date.now()
  return url
}

function previewBg() {
  bgPreviewUrl.value = buildBgPreviewUrl()
}

async function save() {
  saving.value = true
  saveError.value = ''
  const ai = { ...draft.ai, websiteTitle: draft.websiteTitle, navigationName: draft.navigationName }
  try {
    await props.saveConfigBatch({
      ai,
      icon: draft.icon,
      webdav: draft.webdav,
      background: draft.background,
      ui: { showPinnedWebsites: draft.showPinned },
      view: { defaultMode: draft.defaultViewMode },
    })
    emit('saved', { ...draft, ai })
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

const webdavConfigured = computed(
  () => !!draft.webdav.url && !!draft.webdav.username && !!draft.webdav.password
)

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
const categoryModal = ref<{ id: string | null; name: string; parentId: string }>({
  id: null,
  name: '',
  parentId: '',
})

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
  categoryModal.value = { id: null, name: '', parentId: '' }
  categoryModalOpen.value = true
}

/** 直接给指定一级分类添加二级分类，默认选中该父级 */
function openAddChild(parent: Category) {
  categoryModal.value = { id: null, name: '', parentId: parent.id }
  categoryModalOpen.value = true
}

function openEditCategory(category: Category) {
  categoryModal.value = { id: category.id, name: category.name, parentId: category.parentId || '' }
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
    })
    categoryModalOpen.value = false
  } finally {
    savingCategory.value = false
  }
}

function confirmRemoveCategory(category: Category) {
  if (!window.confirm(`删除“${category.name}”？该分类下的网站将移到常用推荐，二级分类也会一并删除。`))
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
      (await generateLinkDescription('GitHub', 'https://github.com', draft.ai)) || 'AI 没有返回内容'
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
        <button class="settings-close" @click="emit('close')"><X /></button>
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
                  <option value="custom">自定义图片</option>
                </select></label
              >
              <label v-if="draft.background.source === 'loli'"
                >LoliApi 地址<input v-model="draft.background.apiUrl" placeholder="https://www.loliapi.com/acg/"
              /></label>
              <label v-else
                >图片 URL<input
                  v-model="draft.background.customUrl"
                  placeholder="https://example.com/random.jpg"
              /></label>
            </div>
            <div class="settings-grid">
              <label v-if="draft.background.source === 'loli'"
                >指定图片 id（可选）<input v-model="draft.background.id" placeholder="留空则随机" /></label
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
              <span v-if="bgPreviewUrl" class="bg-preview-hint">预览仅本地查看，保存后站点生效。</span>
            </div>
            <div v-if="bgPreviewUrl" class="bg-preview" :style="{ backgroundColor: '#0e1520' }">
              <img
                :src="bgPreviewUrl"
                alt="随机背景预览"
                loading="lazy"
                style="
                  width: 100%;
                  height: 100%;
                  object-fit: cover;
                  object-position: center;
                "
              />
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
                <div class="category-sort-row" :class="{ 'has-children': childrenOf(parent.id).length }">
                  <Folder :size="15" />
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
                  <span class="child-branch"><Folder :size="15" /></span>
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
            id="settings-ai"
            v-if="activeSection === 'ai'"
            class="settings-section settings-card"
          >
            <h3><Sparkles :size="17" /> AI 功能</h3>
            <p class="settings-help">
              在添加网站时自动生成中文描述，也可根据分类列表给出分类建议。API Key 仅保存在你的 KV
              配置中。
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
              >API Key<input v-model="draft.ai.apiKey" type="password" autocomplete="off"
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
              :class="{ error: !webdavMessage.includes('成功') && !webdavMessage.includes('暂没有') }"
              >{{ webdavMessage }}</span
            >

            <div v-if="webdavBackupsLoaded" class="backup-list">
              <div class="backup-list-title">
                已备份的文件（{{ backups.length }}）
              </div>
              <div v-if="!backups.length" class="backup-list-empty">还没有备份，点击“立即备份”创建。</div>
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
              仓库根目录的 `.mcp.json` 已配置 EdgeOne Pages Deploy MCP，可在支持 MCP
              的客户端中直接部署和持续迭代。
            </p>
            <p class="settings-help mcp-server-help">
              这是 CloudNav 的远程 MCP 服务端地址，可直接粘贴到支持 Streamable HTTP
              的客户端。读取工具无需认证，写入工具请在配置中填入管理令牌。
            </p>
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
        <div class="category-form-actions">
          <button type="button" class="settings-secondary" @click="closeCategoryForm">
            取消
          </button>
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
  background: var(--c-input-bg);
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
  background: var(--c-input-bg);
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
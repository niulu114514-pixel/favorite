<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import {
  Bookmark,
  Check,
  ChevronRight,
  Folder,
  Grid2X2,
  LayoutList,
  LogIn,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Star,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-vue-next'
import type { Category, LinkItem } from '../types'
import { useCloudNav } from './composables/useCloudNav'
import SettingsPanel from './components/SettingsPanel.vue'
import { fallbackIconUrl } from './services/iconService'
import { generateLinkDescription, suggestCategory } from './services/aiService'

const nav = useCloudNav()
const searchQuery = ref('')
const externalSearch = ref(false)
const sidebarOpen = ref(false)
const dark = ref(localStorage.getItem('cloudnav_theme_preference') === 'dark')
const compact = ref(localStorage.getItem('cloudnav_view_mode') === 'compact')
const linkModalOpen = ref(false)
const authModalOpen = ref(false)
const categoryModalOpen = ref(false)
const settingsOpen = ref(false)
const editingLink = ref<Partial<LinkItem>>({})
const editingCategory = ref<Partial<Category>>({})
const password = ref('')
const authError = ref('')
const aiBusy = ref(false)
const aiError = ref('')
const searchInput = ref<HTMLInputElement>()
const activeCategoryId = ref('')

const visibleLinks = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (!query || externalSearch.value) return nav.links.value
  return nav.links.value.filter(link =>
    `${link.title} ${link.description || ''} ${link.url}`.toLocaleLowerCase().includes(query)
  )
})

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

function openLinkModal(link?: LinkItem) {
  editingLink.value = link ? { ...link } : { categoryId: nav.categories.value[0]?.id || 'common' }
  linkModalOpen.value = true
}

function openLinkModalForCategory(categoryId: string) {
  editingLink.value = { categoryId }
  linkModalOpen.value = true
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

async function deleteCategory(category: Category) {
  if (window.confirm(`删除“${category.name}”？该分类的网站将移到常用推荐。`)) {
    await nav.removeCategory(category.id)
  }
}

async function submitLogin() {
  authError.value = ''
  try {
    if (await nav.login(password.value)) {
      authModalOpen.value = false
      password.value = ''
    } else authError.value = '密码不正确'
  } catch {
    authError.value = '暂时无法登录，请稍后重试'
  }
}

function openCategoryModal(category?: Category) {
  editingCategory.value = category ? { ...category } : { name: '', icon: 'Folder' }
  categoryModalOpen.value = true
}

async function submitCategory() {
  if (!editingCategory.value.name?.trim()) return
  await nav.saveCategory({ ...editingCategory.value, name: editingCategory.value.name.trim() })
  categoryModalOpen.value = false
}

function favicon(link: LinkItem) {
  if (link.icon) return link.icon
  try {
    return `/api/favicon?domain=${encodeURIComponent(new URL(link.url).hostname)}`
  } catch {
    return '/favicon.ico'
  }
}

function fallbackIcon(event: Event, link: LinkItem) {
  const image = event.target as HTMLImageElement
  const fallback = fallbackIconUrl(link.url)
  if (image.src !== new URL(fallback, window.location.origin).href) image.src = fallback
}

function onSettingsSaved(settings: {
  ai: typeof nav.config.ai
  icon: typeof nav.config.icon
  websiteTitle: string
  navigationName: string
  showPinned: boolean
  defaultViewMode: 'compact' | 'detailed'
}) {
  Object.assign(nav.config.ai, settings.ai)
  Object.assign(nav.config.icon, settings.icon)
  nav.config.title = settings.websiteTitle || nav.config.title
  nav.config.navigationName = settings.navigationName
  nav.config.showPinned = settings.showPinned
  nav.config.defaultViewMode = settings.defaultViewMode
  document.title = nav.config.title
}

onMounted(async () => {
  applyTheme()
  await nav.init()
  const params = new URLSearchParams(location.search)
  const addUrl = params.get('add_url')
  if (addUrl) {
    editingLink.value = { url: addUrl, title: params.get('add_title') || '', categoryId: 'common' }
    linkModalOpen.value = true
    history.replaceState({}, '', location.pathname)
  }
  window.addEventListener('keydown', async event => {
    if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault()
      await nextTick()
      searchInput.value?.focus()
    }
    if (event.key === 'Escape') searchQuery.value = ''
  })
})
</script>

<template>
  <div class="app-shell">
    <div v-if="sidebarOpen" class="sidebar-mask" @click="sidebarOpen = false" />
    <aside class="sidebar" :class="{ open: sidebarOpen }">
      <div class="brand">
        <div class="brand-mark"><Bookmark :size="20" /></div>
        <strong>{{ nav.config.navigationName }}</strong
        ><button class="icon-button mobile-only" @click="sidebarOpen = false"><X /></button>
      </div>
      <nav class="category-nav">
        <button
          v-for="category in nav.categories.value"
          :key="category.id"
          type="button"
          :class="{ active: activeCategoryId === category.id }"
          :aria-current="activeCategoryId === category.id ? 'location' : undefined"
          @click.prevent="jumpTo(category.id)"
        >
          <Folder :size="17" /><span>{{ category.name }}</span
          ><ChevronRight :size="15" />
        </button>
      </nav>
      <div class="sidebar-footer">
        <button v-if="nav.token.value" @click="openCategoryModal()">
          <Plus :size="16" /> 新建分类
        </button>
        <button v-if="nav.token.value" @click="nav.logout()"><LogOut :size="16" /> 退出管理</button>
        <button v-else @click="authModalOpen = true"><LogIn :size="16" /> 管理登录</button>
      </div>
    </aside>

    <main class="main-area">
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
            v-if="nav.config.showPinned && nav.pinnedLinks.value.length && !searchQuery"
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
                class="link-card"
                :href="link.url"
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
                  @error="fallbackIcon($event, link)"
                />
                <div>
                  <strong>{{ link.title }}</strong>
                  <p v-if="!compact">{{ link.description || link.url }}</p>
                </div>
              </a>
            </div>
          </section>

          <section
            v-for="category in nav.categories.value"
            :id="`category-${category.id}`"
            :key="category.id"
            class="category-section"
            :class="{ 'is-active': activeCategoryId === category.id }"
          >
            <div class="section-title">
              <h2>
                <Folder :size="20" /> {{ category.name }}
                <span>{{ categoryLinks(category.id).length }}</span>
              </h2>
              <div v-if="nav.token.value" class="section-actions">
                <button
                  class="icon-button small"
                  title="编辑分类"
                  @click="openCategoryModal(category)"
                >
                  <Pencil />
                </button>
                <button
                  v-if="category.id !== 'common'"
                  class="icon-button small danger"
                  title="删除分类"
                  @click="deleteCategory(category)"
                >
                  <Trash2 />
                </button>
              </div>
            </div>
            <div v-if="categoryLinks(category.id).length" class="link-grid" :class="{ compact }">
              <article
                v-for="link in categoryLinks(category.id)"
                :key="link.id"
                class="link-card-wrap"
              >
                <a class="link-card" :href="link.url" target="_blank" rel="noopener noreferrer">
                  <img
                    :src="favicon(link)"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width="39"
                    height="39"
                    @error="fallbackIcon($event, link)"
                  />
                  <div>
                    <strong>{{ link.title }}</strong>
                    <p v-if="!compact">{{ link.description || link.url }}</p>
                  </div>
                </a>
                <div v-if="nav.token.value" class="card-actions">
                  <button
                    :title="link.pinned ? '取消置顶' : '置顶'"
                    @click="nav.togglePin(link.id)"
                  >
                    <Pin :size="15" :fill="link.pinned ? 'currentColor' : 'none'" />
                  </button>
                  <button title="编辑" @click="openLinkModal(link)"><Pencil :size="15" /></button>
                  <button title="删除" @click="deleteLink(link)"><Trash2 :size="15" /></button>
                </div>
              </article>
            </div>
            <button
              v-else-if="nav.token.value"
              class="empty-state"
              @click="openLinkModalForCategory(category.id)"
            >
              <Plus /> 向此分类添加网站
            </button>
          </section>
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
        <label
          >图标网址<input v-model="editingLink.icon" placeholder="留空将自动获取 favicon"
        /></label>
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
      <form class="modal small-modal" @submit.prevent="submitLogin">
        <div class="modal-title">
          <div>
            <h2>管理登录</h2>
            <p>登录后可编辑分类和网站。</p>
          </div>
          <button type="button" class="icon-button" @click="authModalOpen = false"><X /></button>
        </div>
        <label
          >管理密码<input
            v-model="password"
            type="password"
            required
            autofocus
            autocomplete="current-password"
        /></label>
        <p v-if="authError" class="form-error">{{ authError }}</p>
        <button class="primary-button full-button"><LogIn :size="17" />登录</button>
      </form>
    </div>

    <div v-if="categoryModalOpen" class="modal-backdrop" @click.self="categoryModalOpen = false">
      <form class="modal small-modal" @submit.prevent="submitCategory">
        <div class="modal-title">
          <div>
            <h2>{{ editingCategory.id ? '编辑分类' : '新建分类' }}</h2>
            <p>分类会显示在侧栏和首页。</p>
          </div>
          <button type="button" class="icon-button" @click="categoryModalOpen = false">
            <X />
          </button>
        </div>
        <label
          >分类名称<input
            v-model="editingCategory.name"
            required
            maxlength="40"
            placeholder="例如：开发工具"
        /></label>
        <div class="modal-actions">
          <button type="button" class="secondary-button" @click="categoryModalOpen = false">
            取消</button
          ><button class="primary-button"><Check :size="17" />保存</button>
        </div>
      </form>
    </div>

    <SettingsPanel
      :open="settingsOpen"
      :config="{
        ai: nav.config.ai,
        icon: nav.config.icon,
        websiteTitle: nav.config.title,
        navigationName: nav.config.navigationName,
        showPinned: nav.config.showPinned,
        defaultViewMode: nav.config.defaultViewMode,
      }"
      :save-config="nav.saveConfig"
      @close="settingsOpen = false"
      @saved="onSettingsSaved"
    />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  background: #f6f8fb;
  color: #182230;
  background-image:
    radial-gradient(circle at 12% 4%, rgba(113, 145, 255, 0.18), transparent 28%),
    radial-gradient(circle at 88% 18%, rgba(193, 130, 255, 0.14), transparent 24%);
}
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 250px;
  background: linear-gradient(155deg, rgba(255, 255, 255, 0.72), rgba(246, 249, 255, 0.54));
  border-right: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow:
    12px 0 38px rgba(48, 65, 104, 0.1),
    inset -1px 0 rgba(255, 255, 255, 0.38);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
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
}
.category-nav {
  padding: 16px 10px;
  overflow: auto;
  flex: 1;
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
  transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease,
    color 0.18s ease, box-shadow 0.18s ease;
}
.category-nav button:hover,
.sidebar-footer button:hover {
  background: rgba(255, 255, 255, 0.58);
  border-color: rgba(255, 255, 255, 0.75);
  color: #315ed5;
  box-shadow: 0 5px 15px rgba(63, 84, 133, 0.09);
  transform: translateX(2px);
}
.category-nav button.active {
  background: rgba(255, 255, 255, 0.62);
  border-color: rgba(123, 156, 255, 0.42);
  color: #315ed5;
  box-shadow: 0 6px 18px rgba(63, 84, 133, 0.12);
}
.category-nav button span {
  flex: 1;
}
.sidebar-footer {
  padding: 12px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.12);
}
.main-area {
  margin-left: 250px;
  min-height: 100vh;
}
.header {
  height: 68px;
  position: sticky;
  top: 0;
  z-index: 30;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
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
  max-width: 1480px;
  margin: auto;
  padding: 30px 32px 80px;
}
.category-section {
  scroll-margin-top: 84px;
  margin-bottom: 35px;
  border-radius: 16px;
  transition: background-color 0.25s ease, box-shadow 0.25s ease;
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
  padding: 20px;
  border-radius: 18px;
  background: linear-gradient(135deg, #eef3ff, #f6f2ff);
  border: 1px solid #dfe7ff;
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
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.link-grid.compact {
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 9px;
}
.link-card-wrap {
  position: relative;
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
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
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
  width: 39px;
  height: 39px;
  object-fit: contain;
  border-radius: 9px;
  background: #f4f6f9;
  padding: 5px;
}
.compact .link-card img {
  width: 31px;
  height: 31px;
}
.link-card div {
  min-width: 0;
}
.link-card strong {
  font-size: 14px;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.link-card p {
  font-size: 12px;
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
.sidebar-mask,
.mobile-only {
  display: none;
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
  background: linear-gradient(155deg, rgba(33, 42, 55, 0.76), rgba(24, 31, 41, 0.64));
  border-color: rgba(172, 194, 230, 0.16);
  box-shadow:
    12px 0 42px rgba(0, 0, 0, 0.25),
    inset -1px 0 rgba(255, 255, 255, 0.06);
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
  background: rgba(34, 41, 51, 0.76);
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
    grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
  }
  .link-card {
    min-height: 68px;
    padding: 11px;
  }
  .link-card img {
    width: 34px;
    height: 34px;
  }
  .link-card p {
    display: none;
  }
  .card-actions {
    display: flex;
  }
  .category-section {
    margin-bottom: 28px;
  }
}
</style>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Palette,
  Save,
  Settings,
  Sparkles,
  X,
} from 'lucide-vue-next'
import type { AIConfig, IconConfig } from '../../types'
import { DEFAULT_ICON_CONFIG } from '../services/iconService'
import { generateLinkDescription } from '../services/aiService'

type SettingsDraft = {
  ai: AIConfig
  icon: IconConfig
  websiteTitle: string
  navigationName: string
  showPinned: boolean
  defaultViewMode: 'compact' | 'detailed'
}

const props = defineProps<{
  open: boolean
  config: SettingsDraft
  saveConfigBatch: (configs: Record<string, unknown>) => Promise<void>
}>()
const emit = defineEmits<{ close: []; saved: [settings: SettingsDraft] }>()
const draft = reactive<SettingsDraft>(createDraft(props.config))
const saving = ref(false)
const testingAI = ref(false)
const aiMessage = ref('')
const saveError = ref('')
const copied = ref(false)
const settingsContent = ref<HTMLElement>()
const activeSection = ref('appearance')
const settingsTabs = [
  { id: 'appearance', label: '外观与视图', icon: Palette },
  { id: 'icons', label: '图标获取', icon: ExternalLink },
  { id: 'ai', label: 'AI 助手', icon: Sparkles },
  { id: 'mcp', label: 'MCP 客户端', icon: KeyRound },
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
  }
)

async function save() {
  saving.value = true
  saveError.value = ''
  const ai = { ...draft.ai, websiteTitle: draft.websiteTitle, navigationName: draft.navigationName }
  try {
    await props.saveConfigBatch({
      ai,
      icon: draft.icon,
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
  settingsContent.value?.querySelector(`#settings-${id}`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
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
          <section id="settings-appearance" class="settings-section settings-card">
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

          <section id="settings-icons" class="settings-section settings-card">
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

          <section id="settings-ai" class="settings-section settings-card">
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

          <section id="settings-mcp" class="settings-section settings-card">
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
</template>

<style>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(18, 27, 42, 0.5);
  backdrop-filter: blur(5px);
}
.settings-modal {
  width: min(680px, 100%);
  max-height: min(900px, calc(100vh - 40px));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.93);
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 20px;
  box-shadow: 0 28px 90px rgba(27, 40, 72, 0.28);
}
.settings-header {
  display: flex;
  align-items: flex-start;
  gap: 15px;
  padding: 22px 24px 17px;
  border-bottom: 1px solid #e9edf4;
}
.settings-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px;
  font-size: 19px;
}
.settings-header p {
  margin: 0;
  color: #8490a3;
  font-size: 12px;
}
.settings-header > div {
  flex: 1;
}
.settings-close {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 9px;
  background: #f0f3f8;
  color: #68758a;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.settings-content {
  overflow: auto;
  padding: 4px 24px 18px;
}
.settings-section {
  padding: 19px 0;
  border-bottom: 1px solid #edf0f5;
}
.settings-section:last-child {
  border-bottom: 0;
}
.settings-section h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  font-size: 14px;
}
.settings-help {
  font-size: 12px;
  color: #8390a2;
  line-height: 1.55;
  margin: 0 0 13px;
}
.settings-section label {
  display: block;
  color: #556277;
  font-size: 12px;
  font-weight: 650;
  margin: 10px 0;
}
.settings-section input:not([type='checkbox']),
.settings-section select {
  width: 100%;
  box-sizing: border-box;
  margin-top: 6px;
  padding: 9px 10px;
  border: 1px solid #dce2eb;
  border-radius: 9px;
  background: #fff;
  color: #283448;
  font: inherit;
  font-weight: 400;
  outline: 0;
}
.settings-section input:not([type='checkbox']):focus,
.settings-section select:focus {
  border-color: #7090e8;
  box-shadow: 0 0 0 3px rgba(89, 124, 226, 0.12);
}
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px;
}
.settings-check {
  display: flex !important;
  align-items: center;
  gap: 8px;
  margin-top: 20px !important;
  font-weight: 500 !important;
}
.settings-check input {
  width: 17px;
  height: 17px;
  accent-color: #496fe0;
}
.settings-inline {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 13px;
}
.settings-secondary,
.settings-primary {
  height: 38px;
  padding: 0 13px;
  border: 0;
  border-radius: 9px;
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
.settings-secondary:disabled,
.settings-primary:disabled {
  opacity: 0.6;
  cursor: wait;
}
.settings-primary {
  background: #426be3;
  color: white;
  box-shadow: 0 5px 12px rgba(66, 107, 227, 0.2);
}
.settings-result {
  font-size: 12px;
  color: #278458;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mcp-command {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
  border-radius: 9px;
  background: #f0f3f8;
  border: 1px solid #e1e6ef;
}
.mcp-command code {
  font-size: 12px;
  flex: 1;
  overflow: auto;
}
.mcp-command button {
  border: 0;
  background: transparent;
  color: #526aab;
  cursor: pointer;
}
.mcp-config {
  position: relative;
  margin-top: 12px;
  padding: 11px;
  border: 1px solid #e1e6ef;
  border-radius: 9px;
  background: #f7f9fc;
}
.mcp-config-title {
  margin-bottom: 7px;
  color: #637087;
  font-size: 12px;
}
.mcp-config pre {
  max-height: 150px;
  margin: 0;
  overflow: auto;
  white-space: pre;
}
.mcp-config code {
  color: #3f4e67;
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
  background: #e8eefc;
  color: #315ed5;
  cursor: pointer;
  font-size: 12px;
}
.mcp-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  color: #426be3;
  font-size: 12px;
  text-decoration: none;
}
.settings-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  padding: 14px 24px;
  border-top: 1px solid #e9edf4;
  background: #f8f9fb;
}
.settings-error {
  color: #cf4141;
  font-size: 12px;
  flex: 1;
}
.settings-footer .settings-secondary {
  background: transparent;
}
.settings-footer .settings-secondary:hover {
  background: #edf1f6;
}
@media (max-width: 600px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
  .settings-content {
    padding-left: 17px;
    padding-right: 17px;
  }
  .settings-header,
  .settings-footer {
    padding-left: 17px;
    padding-right: 17px;
  }
}
html.dark .settings-modal {
  background: rgba(34, 41, 51, 0.95);
  border-color: rgba(162, 184, 224, 0.18);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.45);
}
html.dark .settings-header,
html.dark .settings-footer,
html.dark .settings-section {
  border-color: #343d49;
}
html.dark .settings-footer {
  background: rgba(25, 31, 40, 0.85);
}
html.dark .settings-close,
html.dark .settings-secondary {
  background: #343d49;
  color: #d3dbe8;
}
html.dark .settings-section label,
html.dark .settings-header h2 {
  color: #dbe3ef;
}
html.dark .settings-section input:not([type='checkbox']),
html.dark .settings-section select {
  background: #171d25;
  border-color: #414b5a;
  color: #dbe3e9;
}
html.dark .settings-help {
  color: #9ba7b7;
}
html.dark .mcp-command {
  background: #171d25;
  border-color: #414b5a;
}
html.dark .mcp-config {
  background: #171d25;
  border-color: #414b5a;
}
html.dark .mcp-config-title,
html.dark .mcp-config code {
  color: #b7c2d2;
}
html.dark .mcp-copy-config {
  background: #2d416f;
  color: #d8e3ff;
}
html.dark .settings-footer .settings-secondary {
  background: transparent;
}

/* Redesigned settings workspace */
.settings-modal {
  width: min(900px, 100%);
  max-height: min(760px, calc(100vh - 28px));
  border-radius: 24px;
}
.settings-header {
  padding: 22px 26px 18px;
  background: linear-gradient(135deg, rgba(244, 247, 255, 0.96), rgba(255, 255, 255, 0.88));
}
.settings-header h2 {
  font-size: 20px;
  letter-spacing: -0.02em;
}
.settings-header h2 svg {
  color: #426be3;
}
.settings-body {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 20px 12px;
  border-right: 1px solid #e9edf4;
  background: rgba(246, 248, 252, 0.78);
}
.settings-nav-label {
  margin: 0 10px 9px;
  color: #8a96a8;
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
  border-radius: 10px;
  padding: 10px 11px;
  background: transparent;
  color: #68758a;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
  transition:
    background-color 0.18s ease,
    color 0.18s ease,
    border-color 0.18s ease;
}
.settings-nav button:hover {
  background: #eef2fb;
  color: #315ed5;
}
.settings-nav button.active {
  border-color: #d7e1ff;
  background: #e8efff;
  color: #315ed5;
  box-shadow: 0 4px 12px rgba(66, 107, 227, 0.1);
}
.settings-nav-tip {
  margin: auto 8px 0;
  color: #9aa5b5;
  font-size: 11px;
  line-height: 1.5;
}
.settings-content {
  min-width: 0;
  max-height: 490px;
  padding: 16px 20px 22px;
  scroll-behavior: smooth;
  overscroll-behavior: contain;
}
.settings-section.settings-card {
  margin: 0 0 13px;
  padding: 18px;
  border: 1px solid #e7ebf3;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 5px 18px rgba(36, 51, 83, 0.04);
}
.settings-section.settings-card:last-child {
  margin-bottom: 0;
}
.settings-section.settings-card h3 {
  margin-bottom: 8px;
  color: #273650;
  font-size: 14px;
}
.settings-section.settings-card h3 svg {
  color: #5579e4;
}
.settings-card .settings-help {
  max-width: 680px;
}
html.dark .settings-header {
  background: linear-gradient(135deg, rgba(38, 48, 64, 0.96), rgba(34, 41, 51, 0.9));
}
html.dark .settings-nav {
  border-color: #343d49;
  background: rgba(25, 31, 40, 0.78);
}
html.dark .settings-nav button {
  color: #aab5c5;
}
html.dark .settings-nav button:hover {
  background: #2a3852;
  color: #d8e3ff;
}
html.dark .settings-nav button.active {
  border-color: #405582;
  background: #2d416f;
  color: #d8e3ff;
}
html.dark .settings-nav-tip {
  color: #7f8b9b;
}
html.dark .settings-section.settings-card {
  border-color: #343d49;
  background: rgba(32, 40, 51, 0.72);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.14);
}
html.dark .settings-section.settings-card h3 {
  color: #dbe3ef;
}
@media (max-width: 680px) {
  .settings-body {
    display: block;
  }
  .settings-nav {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 5px;
    padding: 10px 12px;
    border-right: 0;
    border-bottom: 1px solid #e9edf4;
  }
  .settings-nav-label,
  .settings-nav-tip {
    display: none;
  }
  .settings-nav button {
    justify-content: center;
    padding: 9px 4px;
    font-size: 11px;
  }
  .settings-nav button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .settings-content {
    max-height: calc(100vh - 240px);
    padding: 12px;
  }
  .settings-section.settings-card {
    padding: 14px;
  }
  html.dark .settings-nav {
    border-bottom-color: #343d49;
  }
}
</style>

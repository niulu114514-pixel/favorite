export interface LinkItem {
  id: string
  title: string
  url: string
  icon?: string
  description?: string
  categoryId: string
  /** 是否同时显示在「常用推荐」里（主归属仍为 categoryId，仅叠加显示） */
  alsoInCommon?: boolean
  createdAt: number
  pinned?: boolean
  pinnedOrder?: number
  order?: number
  weight?: number
  iconType?: string
  iconConfig?: Record<string, unknown>
  customIconUrl?: string
  edgeoneBlobUrl?: string
}

export interface Category {
  id: string
  name: string
  icon: string
  password?: string
  parentId?: string
  isSubcategory?: boolean
  weight?: number
}

export interface AppState {
  links: LinkItem[]
  categories: Category[]
  darkMode: boolean
}

export interface WebDavConfig {
  url: string
  username: string
  password: string
  enabled: boolean
  folder?: string
}

export interface WebDavBackupItem {
  name: string
  size: number
  modified: string
}

export type AIProvider = 'google' | 'claude' | 'openai' | 'custom'

export interface AIProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  baseUrl: string
  model: string
  providers?: Partial<Record<AIProvider, AIProviderConfig>>
  websiteTitle?: string
  faviconUrl?: string
  navigationName?: string
  sidebarNavigationName?: string
  defaultViewMode?: 'compact' | 'detailed'
}

// 图标获取方式类型
export type IconSourceType =
  | 'faviconextractor'
  | 'google'
  | 'customapi'
  | 'customurl'
  | 'upload-edgeone'

// 图标配置
export interface IconConfig {
  source: IconSourceType
  cacheEnabled?: boolean
  faviconextractor?: {
    enabled: boolean
  }
  google?: {
    enabled: boolean
    apiKey?: string
  }
  customapi?: {
    enabled: boolean
    url: string
    headers?: Record<string, string>
  }
  customurl?: {
    enabled: boolean
    url: string
  }
}

// 密码过期时间单位
export type PasswordExpiryUnit = 'day' | 'week' | 'month' | 'year' | 'permanent'

// 密码过期时间配置
export interface PasswordExpiryConfig {
  value: number // 数值
  unit: PasswordExpiryUnit // 单位
}

// 网站配置
export interface WebsiteConfig {
  passwordExpiry: PasswordExpiryConfig
}

// 搜索模式类型
export type SearchMode = 'internal' | 'external'

// 外部搜索源配置
export interface ExternalSearchSource {
  id: string
  name: string
  url: string
  icon?: string
  enabled: boolean
  createdAt: number
}

// 搜索配置
export interface SearchConfig {
  mode: SearchMode
  externalSources: ExternalSearchSource[]
  selectedSource?: ExternalSearchSource | null // 选中的搜索源
  defaultEngine?: string // 默认搜索引擎 ID
  customEngineUrl?: string // 自定义搜索引擎 URL
  customEngineIcon?: string // 自定义搜索引擎 Logo (URL 或 SVG 代码)
}

// 滚动 Ticker 来源类型
export type TickerSource = 'mastodon' | 'memos' | 'yiyan' | 'custom'

// 滚动 Ticker 配置
export interface TickerConfig {
  enabled: boolean
  source: TickerSource
  // Mastodon
  mastodonInstance?: string
  mastodonUsername?: string
  mastodonLimit?: number
  mastodonExcludeReplies?: boolean
  mastodonExcludeReblogs?: boolean
  // Memos
  memosHost?: string
  memosToken?: string
  memosLimit?: number
  memosCreator?: string
  memosVisibility?: 'PUBLIC' | 'PROTECTED' | 'PRIVATE'
  // Custom
  customItems?: string[]
}

// 天气 API 类型
export type WeatherProvider =
  | 'jinrishici'
  | 'qweather'
  | 'openweather'
  | 'visualcrossing'
  | 'accuweather'

// 天气配置
export interface WeatherConfig {
  enabled: boolean
  provider: WeatherProvider
  // QWeather
  qweatherHost?: string
  qweatherApiKey?: string
  qweatherLocation?: string
  // OpenWeather
  openweatherApiKey?: string
  openweatherCity?: string
  // Visual Crossing
  visualcrossingApiKey?: string
  visualcrossingLocation?: string
  // AccuWeather
  accuweatherApiKey?: string
  accuweatherLocationKey?: string
  // Common
  unit?: 'celsius' | 'fahrenheit'
}

// 随机背景图片来源类型
export type BackgroundSource = 'loli' | 'jinghuashang' | 'custom'

// 随机背景配置
export interface BackgroundConfig {
  enabled: boolean
  source: BackgroundSource
  // 图片接口地址（source 为 loli / jinghuashang 时使用）
  apiUrl: string
  // LoliApi 可选：指定图片 id
  id?: string
  // Jinghuashang 可选：拾取的图片集（random / hp / sp / huaming）
  sort?: string
  // 自定义图片直链或随机图接口（source 为 custom 时使用）
  customUrl?: string
  // 自动轮换间隔（分钟），0 表示不自动轮换，仅在重新进入时换图
  autoRefreshMin: number
  // 暗色遮罩不透明度（0-1），保证前景文字可读
  overlay: number
  // 背景模糊程度（px，0-24）
  blur: number
}

export const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  enabled: false,
  source: 'loli',
  apiUrl: 'https://www.loliapi.com/acg/',
  autoRefreshMin: 0,
  overlay: 0.3,
  blur: 0,
}

// 完全统一的应用配置（包含所有配置）
export interface AppConfig {
  // AI 配置
  ai?: AIConfig

  // 网站配置
  website?: WebsiteConfig

  // WebDAV 配置
  webdav?: WebDavConfig

  // 搜索配置
  search?: SearchConfig

  // 滚动 Ticker 配置
  ticker?: TickerConfig

  // 天气配置
  weather?: WeatherConfig

  // 图标配置
  icon?: IconConfig

  // 随机背景配置
  background?: BackgroundConfig

  // 视图配置
  view?: {
    mode: 'compact' | 'detailed' // 用户个人视图偏好
    defaultMode?: 'compact' | 'detailed' // 管理员设置的默认视图模式
  }

  // 界面配置
  ui?: {
    showPinnedWebsites: boolean // 是否显示置顶网站
    darkMode?: boolean // 深色模式偏好（可选，主要使用系统级主题）
  }

  // 其他用户偏好设置
  preferences?: {
    [key: string]: any
  }
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'common', name: '常用推荐', icon: 'Star' },
  { id: 'tools', name: '工具', icon: 'Folder', isSubcategory: false },
  { id: 'life', name: '生活工具', icon: 'Target', parentId: 'tools', isSubcategory: true },
  { id: 'network', name: '网络工具', icon: 'Wifi', parentId: 'tools', isSubcategory: true },
]

export const INITIAL_LINKS: LinkItem[] = [
  {
    id: 'init1',
    title: 'X',
    url: 'https://x.com/',
    icon: '/favicons/x.svg',
    description: 'Blaze your glory!',
    categoryId: 'common',
    createdAt: Date.now(),
  },
  {
    id: 'init2',
    title: 'GitHub',
    url: 'https://github.com',
    icon: '/favicons/github.svg',
    description: 'Build and ship software on a single, collaborative platform',
    categoryId: 'common',
    createdAt: Date.now(),
  },
  {
    id: 'init3',
    title: 'Cloudflare',
    url: 'https://dash.cloudflare.com/',
    icon: '/favicons/cloudflare.svg',
    description: 'Connect, protect, and build everywhere',
    categoryId: 'common',
    createdAt: Date.now(),
  },
]

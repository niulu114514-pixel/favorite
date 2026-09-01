# 落花流水个人导航 (CloudNav)

> [!WARNING]
> **本项目完全基于 AI 构建，作者对项目中的代码不免责。如有 Bug 或功能需求请 Fork 后自行处理。**

> [!NOTE]
> **完全基于 EdgeOne Pages 开发并部署。**

**一个现代化云端导航 / 书签管理页面。**

![CloudNav Screenshot](screenshots/preview.png)

## ✨ 特性

- **全分类锚点页面**：所有分类同屏展示，侧边栏一键跳转
- **前端可视化编辑**：右键菜单 / 拖拽排序 / 批量操作 / 分类管理
- **访客模式**：普通用户可正常浏览，登录后获得管理权限
- **KV 按分类存储**：链接按 `links:{category_id}` 拆分存储，读取时自动聚合
- **KV 云端存储**：数据持久化，localStorage 缓存 + KV 双向同步
- **图标自托管与缓存**：抓取网站图标并缓存到 EdgeOne Pages Blob，可上传自定义图标
- **AI 辅助**：集成 Gemini / OpenAI 兼容 API，自动填充链接描述、智能分类建议
- **数据导入导出**：Chrome 书签 HTML / JSON 备份 / WebDAV 云同步
- **丰富小组件**：Mastodon / Memos 动态滚动条、实时天气（和风天气）
- **个性化**：深色/浅色模式（自动检测系统偏好）、紧凑/详细视图、自定义图标
- **卡片动效**：从图标提取主色调，hover 时显示彩色边框和光晕
- **骨架屏加载**：加载时显示骨架屏占位，卡片交错淡入动画
- **移动端适配**：针对手机 / 平板进行响应式布局优化，离线可用

## 🏗️ 技术架构

#### 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS 4

#### Serverless / Storage

- **EdgeOne Pages**: Edge Functions + EdgeOne KV + EdgeOne Pages Blob

```
┌──────────────────────────────────────────────┐
│               Browser (Client)               │
│                                              │
│  React 19 + TypeScript + Tailwind CSS 4      │
│  State: Context + useReducer                 │
│  DnD: @dnd-kit                               │
│  Icons: lucide-react                         │
│                                              │
│  Data: localStorage (cache) + KV (persist)   │
└──────────────────┬───────────────────────────┘
                   │ HTTP API
┌──────────────────┴───────────────────────────┐
│              EdgeOne Pages Backend           │
│                                              │
│  Edge Functions + EdgeOne KV 业务逻辑         │
│  EdgeOne Pages Blob 图标自托管与缓存           │
│  认证：安全随机 Token + 自动清理旧 Token       │
└──────────────────────────────────────────────┘
```

## 🚀 部署指南

### EdgeOne Pages (推荐)

1. Fork 或克隆本仓库：`git clone https://github.com/niulu114514-pixel/favorite.git`
2. 在 EdgeOne 控制台创建 Pages 项目，并接入 GitHub 仓库（或手动上传）。
3. 构建设置：
   - 框架预设：`Vite`
   - 输出目录：`./dist`
   - 安装命令：`pnpm install`
   - 编译命令：`pnpm build`
4. 绑定 KV：创建 KV 命名空间，变量名称设为 `CLOUDNAV_KV`。
5. 环境变量：设置 `PASSWORD`（管理密码）。
6. 自定义域名：在 EdgeOne 控制台绑定你的域名（例如 `s.312522.xyz`）。
7. 图标自托管与缓存：
   - 本项目使用 **EdgeOne Pages Blob** 实现网站图标缓存及自定义上传。
   - **无需手动配置/创建存储空间**，EdgeOne Pages Blob 由 SDK 首次调用时**自动创建**（命名空间归属于当前项目）。
   - 支持在控制面板的“图标自托管与缓存”中开启/关闭自动抓取缓存（免费用户若担心存储空间超限可以关闭该选项，关闭后仅服务已上传的自定义图标与实时抓取而不写入缓存）。

## ⚙️ 环境变量

| 变量 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `PASSWORD` | 管理后台登录密码 | 是 | - |
| `ALLOWED_ORIGIN` | CORS 允许的域名 | 否 | `*` |

> 其它业务相关配置（如天气、AI 接口、WebDAV 等）均在控制面板「设置」中可视化配置，无需设置环境变量。

## 🔌 通过 MCP 部署

本项目仓库内置 [`/.mcp.json`](.mcp.json)，开箱即用支持 EdgeOne 官方提供的 **Pages Deploy MCP**，可直接在支持 MCP 的 AI 客户端（Cursor、VSCode、Windsurf、ChatWise 等）中通过自然语言把本项目部署到 EdgeOne Pages 并持续迭代。

```json
{
  "mcpServers": {
    "edgeone-pages-mcp-server": {
      "command": "npx",
      "args": ["edgeone-pages-mcp-fullstack", "--region", "china"]
    }
  }
}
```

> 如需部署到腾讯云国际站，删除 `--region china` 参数即可。

其它可选部署方式：

- **分享 HTML 内容（免登录）**：在支持远程 MCP 的客户端中配置 `"url": "https://mcp-on-edge.edgeone.site/mcp-server"`，可将纯 HTML 内容秒级部署生成公开链接。
- **自托管 MCP Server**：使用 EdgeOne 官方 [Self Hosted Pages MCP 模板](https://console.cloud.tencent.com/edgeone/pages/new?from=github&template=self-hosted-pages-mcp) 部署自己的 /mcp-server，绑定自己域名后配置 `"url": "https://你的自定义域名/mcp-server"`。

更多信息请查阅 [EdgeOne Pages MCP 官方文档](https://edgeone.cloud.tencent.com/pages/document/173172415568367616)。

## 🛠️ 本地开发

```bash
# 安装依赖
pnpm install

# 1. 启动 Vite 开发服务器 (localhost:3000，仅前端)
pnpm dev

# 2. 模拟 EdgeOne 环境 (需安装 edgeone cli)
pnpm build
edgeone pages link
edgeone pages dev
```

### 数据存储说明

- **KV Key 结构**：链接按分类拆分存储，key 格式为 `links:{category_id}`。
- **本地模拟**：EdgeOne 使用 CLI 模拟 KV；无 CLI 时前端回退到 `kvMock.ts` 本地模拟存储。
- **首次部署**：系统会使用 `types.ts` 中的 `INITIAL_LINKS` 作为初始演示数据（内置 X / GitHub / Cloudflare）。

## 📁 项目结构

```
├── functions/api/             # EdgeOne Pages Functions (JavaScript)
│   ├── _kvAdapter.js          # EdgeOne KV 接口抽象
│   ├── link.js                # 链接 CRUD API
│   ├── category.js            # 分类管理 API
│   ├── auth.js                # 登录鉴权 API
│   ├── favicon.js             # 图标缓存 API (EdgeOne Pages Blob)
│   ├── upload.js              # 自定义图标上传 API
│   ├── storage.js             # 存储工具
│   ├── webdav.js              # WebDAV 云同步 API
│   └── debug.js               # 调试 API
├── components/                # 通用 UI 组件 (Modal, Toast, ErrorBoundary, 小组件等)
├── services/                  # 前端业务逻辑 (AI, 书签解析, 导出, WebDAV 等)
├── src/
│   ├── components/            # 核心业务组件 (layout, category, link)
│   ├── contexts/              # React Context 状态管理 (Auth, Links, Categories, Config)
│   ├── hooks/                 # 自定义 Hooks (Search, DragSort, DataSync)
│   ├── utils/                 # 工具函数 (Config, Security, ColorExtractor)
│   └── constants/             # 常量定义
├── public/                    # 静态资源 (favicon, sitemap, manifest 等)
├── App.tsx                    # 应用入口
├── types.ts                   # 类型定义 & 初始数据
├── edgeone.json               # EdgeOne Pages 配置
└── package.json               # 项目依赖
```

## 📄 License

本项目采用 [GLWTPL（Good Luck With That）许可证](https://github.com/me-shaon/GLWTPL) 开源。

```
GLWT（Good Luck With That，祝你好运）公共许可证
            版权所有© 除作者外的所有人

任何人都被允许复制、分发、修改、合并、销售、出版、再授权
或任何其它行为，但风险自负。

                祝你好运公共许可证
            复制、分发和修改的条款和条件

  0. 只要你永远不要留下任何可以追踪到原作者的线索，
你就可以随心所欲地做任何事，因此，不能因此责怪或追究
原作者的责任。
```

## 🤝 参与贡献

欢迎 Fork、提 Issue 或提交 Pull Request 以改进本项目。
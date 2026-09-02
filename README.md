# CloudNav

一个基于 Vue 3 的云端导航与书签管理页面，适合部署到 EdgeOne Pages。

## 特性

* Vue 3 + TypeScript + Vite，使用 Composition API 与组件化架构管理状态

* 8分类侧栏与锚点导航，支持分类排序与分类内网站卡片拖拽排序

* 响应式卡片布局：网站卡片与分类卡片按设备尺寸自适应放大

* 站内搜索，也可一键跳转 Google 互联网搜索

* 网站卡片支持置顶、添加、编辑、删除和排序

* 新增网站时自动获取 favicon，支持 EdgeOne Blob 缓存、Google、FaviconExtractor、自定义 URL/API

* 管理登录与权限控制，登录状态保存在浏览器本地

* localStorage 快速缓存，登录后自动同步 EdgeOne KV

* 明暗主题、紧凑/详细视图、书签小程序参数预填

* 重构后的设置面板，完整适配移动端（抽屉式导航、分组表单、主题令牌）

* AI 辅助生成网站描述与分类建议，支持 Gemini、OpenAI 兼容 API、Claude

* 保留 EdgeOne Pages Functions：认证、KV 存储、favicon 和上传接口，并提供升级后的 MCP Server

## 技术栈

* 前端：Vue 3、TypeScript、Vite、Tailwind CSS 4

* 图标：lucide-vue-next

* 后端：EdgeOne Pages Functions、EdgeOne KV、Pages Blob

## 本地开发

```bash
pnpm install
pnpm dev
```

开发服务器默认监听 `http://localhost:3000`。

## 检查与构建

```bash
pnpm type-check   # Vue/TypeScript 类型检查
pnpm lint        # ESLint 检查
pnpm build       # 生产构建，输出到 dist/
pnpm preview     # 本地预览生产构建
```

## EdgeOne Pages 部署

构建设置使用：

* 框架预设：Vite

* 安装命令：`pnpm install`

* 构建命令：`pnpm build`

* 输出目录：`dist`

后端需要绑定名为 `CLOUDNAV_KV` 的 KV 命名空间，并设置 `PASSWORD` 环境变量作为管理密码。可选设置 `ALLOWED_ORIGIN` 限制跨域来源。

## MCP 部署

仓库根目录的 `.mcp.json` 已预置 EdgeOne Pages Deploy MCP。将仓库添加到支持 MCP 的客户端后，可以直接运行：

```bash
npx edgeone-pages-mcp-fullstack --region china
```

也可以在登录后的「设置 → MCP / EdgeOne 部署」中复制命令和打开官方文档。

## 项目结构

```text
functions/api/          EdgeOne Pages API（认证、KV 存储、favicon、上传、MCP）
src/App.vue             Vue 应用入口界面
src/components/         可复用 Vue 组件（设置面板、链接卡片网格等）
src/composables/        Vue Composition API 状态与云端同步
src/services/           服务层（AI、图标）
src/utils/              URL 等工具函数
src/index.css           全局样式与主题令牌
src/main.ts             应用入口
types.ts                链接、分类和配置类型及初始数据
public/                 favicon、manifest 等静态资源
vite.config.ts          Vite 配置
```

## 分类与排序

* 侧栏中拖动分类（或使用上下按钮）即可调整分类顺序，顺序会同步到云端。

* 登录后，网站卡片右上角提供拖动把手和上下箭头，可调整该分类下卡片的排列顺序。

* 排序结果持久化到 KV，多设备登录后自动保持一致。

## 远程 MCP Server

CloudNav 在 `/api/mcp` 暴露远程 MCP 端点。部署后使用：

```text
https://YOUR_DOMAIN/api/mcp
```

端点支持 MCP Streamable HTTP/SDK，并实现以下工具：

* 读取（公开）：`list_links`、`search_links`、`list_categories`、`get_config`

* 链接写入（需认证）：`add_link`、`update_link`、`delete_link`、`reorder_links`

* 分类写入（需认证）：`add_category`、`update_category`、`delete_category`、`reorder_categories`

* 配置写入（需认证）：`update_config`

并暴露两个结构化资源：`cloudnav://categories` 与 `cloudnav://links`，可由客户端通过 `resources/list` 与 `resources/read` 读取。

读操作公开可用；写操作需要在 `Authorization: Bearer <密码>` 头（或 `x-auth-password`）中携带站点管理密码。登录后的「设置 → MCP / EdgeOne 部署」面板提供了可直接复制的客户端配置（Claude Desktop、Cursor、Cherry Studio）。

## 许可证

本项目使用 [GLWTPL](https://github.com/me-shaon/GLWTPL) 许可证。

## Security notes

* Public configuration responses redact API keys, passwords, tokens, credentials, and custom headers.

* Generic KV reads are not exposed; administrative reads and writes require authentication.

* WebDAV and icon import requests require authentication, public HTTPS URLs, timeouts, and size limits.

* Login attempts are rate-limited per client address.

## WebDAV backup API

`/api/webdav` is an optional server-side backup bridge. An authenticated client can
check a WebDAV directory, upload `cloudnav_backup.json`, or download it for restore.
It is not required for normal bookmark browsing; disable or remove the endpoint if you
do not use WebDAV backups.

After signing in, open `Settings > WebDAV backup` to enter the WebDAV HTTPS URL,
username, and password (an app-specific password is recommended). Use `Test connection`
to verify the remote directory before saving. The endpoint only accepts public HTTPS
WebDAV servers; local/private addresses are rejected for security.

## Nested categories

Categories support one parent level. Create or edit a category and choose an optional
top-level parent; child categories are indented in the sidebar and in the content area.

# CloudNav

一个基于 Vue 3 的云端导航与书签管理页面，适合部署到 EdgeOne Pages。

## 特性

- Vue 3 + TypeScript + Vite，使用 Composition API 管理状态
- 分类侧栏与锚点导航，响应式适配桌面和移动端
- 站内搜索，也可一键跳转 Google 互联网搜索
- 网站卡片支持置顶、添加、编辑和删除
- 新增网站时自动获取 favicon，支持 EdgeOne Blob 缓存、Google、FaviconExtractor、自定义 URL/API
- 管理登录与权限控制，登录状态保存在浏览器本地
- localStorage 快速缓存，登录后自动同步 EdgeOne KV
- 明暗主题、紧凑/详细视图、书签小程序参数预填
- 设置面板支持网站标题、图标策略、默认视图和置顶区域配置
- AI 辅助生成网站描述与分类建议，支持 Gemini、OpenAI 兼容 API、Claude
- 保留 EdgeOne Pages Functions：认证、KV 存储、favicon 和上传接口

## 技术栈

- 前端：Vue 3、TypeScript、Vite、Tailwind CSS 4
- 图标：lucide-vue-next
- 后端：EdgeOne Pages Functions、EdgeOne KV、Pages Blob

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

- 框架预设：Vite
- 安装命令：`pnpm install`
- 构建命令：`pnpm build`
- 输出目录：`dist`

后端需要绑定名为 `CLOUDNAV_KV` 的 KV 命名空间，并设置 `PASSWORD` 环境变量作为管理密码。可选设置 `ALLOWED_ORIGIN` 限制跨域来源。

## MCP 部署

仓库根目录的 `.mcp.json` 已预置 EdgeOne Pages Deploy MCP。将仓库添加到支持 MCP 的客户端后，可以直接运行：

```bash
npx edgeone-pages-mcp-fullstack --region china
```

也可以在登录后的「设置 → MCP / EdgeOne 部署」中复制命令和打开官方文档。

## 项目结构

```text
functions/api/          EdgeOne Pages API
src/App.vue             Vue 应用界面
src/composables/        Vue Composition API 状态与云端同步
src/index.css           全局样式
src/main.ts             应用入口
types.ts                链接、分类和配置类型及初始数据
public/                 favicon、manifest 等静态资源
vite.config.ts          Vite 配置
```

## 许可证

本项目使用 [GLWTPL](https://github.com/me-shaon/GLWTPL) 许可证。

## Remote MCP server

CloudNav exposes a remote MCP endpoint at `/api/mcp`. After deploying the site, use:

```text
https://YOUR_DOMAIN/api/mcp
```

The endpoint supports MCP Streamable HTTP and provides `list_links`, `search_links`,
`list_categories`, `add_link`, `update_link`, and `delete_link`. Read operations are public;
write operations require the site admin password or auth token in an `Authorization: Bearer ...`
header. The Settings panel contains a ready-to-copy client configuration for Claude Desktop,
Cursor, and Cherry Studio.

## Security notes

- Public configuration responses redact API keys, passwords, tokens, credentials, and custom headers.
- Generic KV reads are not exposed; administrative reads and writes require authentication.
- WebDAV and icon import requests require authentication, public HTTPS URLs, timeouts, and size limits.
- Login attempts are rate-limited per client address.

## WebDAV backup API

`/api/webdav` is an optional server-side backup bridge. An authenticated client can
check a WebDAV directory, upload `cloudnav_backup.json`, or download it for restore.
It is not required for normal bookmark browsing; disable or remove the endpoint if you
do not use WebDAV backups.

// CloudNav MCP Server (refactored)
// Supports: read/write navigation data, category ordering, link ordering,
// config access, and MCP resources — backed by EdgeOne KV through _kvAdapter.
//
// This implementation shares the exact storage schema used by `storage.js`:
//   - categories -> key `cate_config`          (array order = sidebar order)
//   - per-category links -> key `links:<catId>` (array order = card order)
//   - config sections -> key `config:<section>`

import {
  getCorsHeaders,
  getKV,
  isAllowedRequestOrigin,
  isHttpUrl,
  jsonResponse,
  mergeSecretConfig,
  sanitizePublicConfig,
  verifyMcpRequestAuth,
} from './_kvAdapter.js'

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'CloudNav MCP', version: '1.3.0' }

// Allowed config sections (kept in sync with storage.js CONFIG_SECTIONS).
const CONFIG_SECTIONS = [
  'ai',
  'website',
  'mastodon',
  'weather',
  'search',
  'icon',
  'view',
  'ui',
  'webdav',
  'background',
]

const TOOLS = [
  // ---------- Read tools ----------
  {
    name: 'list_links',
    description: 'List saved links, optionally filtered by category.',
    inputSchema: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'Category id to filter by.' },
      },
    },
  },
  {
    name: 'search_links',
    description: 'Search saved links by title, URL, or description.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Text to search for.' } },
      required: ['query'],
    },
  },
  {
    name: 'list_categories',
    description: 'List all navigation categories in their current display order.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_config',
    description:
      'Read a configuration section with passwords, tokens, API keys, and custom headers redacted.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: CONFIG_SECTIONS,
          description: 'Configuration section name.',
        },
      },
      required: ['section'],
    },
  },
  {
    name: 'get_stats',
    description:
      'Get navigation statistics: total links, total categories, and per-category link counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_link',
    description: 'Get a single saved link by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'get_category',
    description: 'Get a single category by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'list_recent_links',
    description: 'List the most recently added links, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Maximum number of results (default 20).' },
      },
    },
  },

  // ---------- Auth write tools: links ----------
  {
    name: 'add_link',
    description:
      'Add a saved link to the navigation. Requires authentication. ' +
      'The card shows the website favicon automatically: leave `icon` empty and do NOT provide emoji — ' +
      'only supply `icon` as an image URL (http(s) or data:image) when a custom favicon is required.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        url: { type: 'string' },
        description: { type: 'string' },
        categoryId: { type: 'string' },
        icon: {
          type: 'string',
          description:
            'Optional image URL override. Leave empty for auto favicon; emoji is ignored.',
        },
        pinned: { type: 'boolean' },
      },
      required: ['title', 'url'],
    },
  },
  {
    name: 'update_link',
    description:
      'Update a saved link by id. Requires authentication. ' +
      'Same icon rule as add_link: leave `icon` empty (or an image URL) — emoji is ignored.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        url: { type: 'string' },
        description: { type: 'string' },
        categoryId: { type: 'string' },
        icon: {
          type: 'string',
          description:
            'Optional image URL override. Leave empty for auto favicon; emoji is ignored.',
        },
        pinned: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_link',
    description: 'Delete a saved link by id. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'bulk_add_links',
    description: 'Add multiple links in a single call. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        links: {
          type: 'array',
          description: 'Links to add.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              description: { type: 'string' },
              categoryId: { type: 'string' },
              icon: {
                type: 'string',
                description:
                  'Optional image URL override. Leave empty for auto favicon; emoji is ignored.',
              },
              pinned: { type: 'boolean' },
            },
            required: ['title', 'url'],
          },
        },
      },
      required: ['links'],
    },
  },
  {
    name: 'reorder_links',
    description: 'Set the display order of links inside a category. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'Target category id.' },
        orderedIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Link ids in the desired order.',
        },
      },
      required: ['categoryId', 'orderedIds'],
    },
  },

  // ---------- Auth write tools: categories ----------
  {
    name: 'add_category',
    description:
      'Create a navigation category. Requires authentication. ' +
      'Icon convention: a leading emoji in `name` (e.g. "⭐ 常用推荐") is auto-extracted as the folder icon; ' +
      'otherwise the lucide `icon` name (e.g. Folder) is used.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Category name. A leading emoji (e.g. "⭐ 常用推荐") becomes the icon automatically.',
        },
        icon: {
          type: 'string',
          description: 'Optional lucide icon name, e.g. Folder, Star, Rocket.',
        },
        parentId: { type: 'string', description: 'Optional parent category id (subcategory).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_category',
    description:
      'Update a category by id (name, icon, parentId). Requires authentication. ' +
      'Same icon convention as add_category: a leading emoji in `name` becomes the icon.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string', description: 'Category name; a leading emoji becomes the icon.' },
        icon: { type: 'string', description: 'Optional lucide icon name or a bare emoji.' },
        parentId: { type: 'string', description: 'Use "" to clear the parent.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_category',
    description: 'Delete a category and move its links to "common". Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'reorder_categories',
    description: 'Set the display order of all categories. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        orderedIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'All category ids in the desired order.',
        },
      },
      required: ['orderedIds'],
    },
  },

  // ---------- Auth write tools: config ----------
  {
    name: 'update_config',
    description:
      'Write a configuration section (ai, website, icon, view, ui, webdav, ...). Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: CONFIG_SECTIONS,
          description: 'Configuration section name.',
        },
        value: { type: 'object', description: 'Section payload to save.' },
      },
      required: ['section', 'value'],
    },
  },
]

const READ_TOOLS = new Set([
  'list_links',
  'search_links',
  'list_categories',
  'get_config',
  'get_stats',
  'get_link',
  'get_category',
  'list_recent_links',
])
const DESTRUCTIVE_TOOLS = new Set(['delete_link', 'delete_category'])
for (const tool of TOOLS) {
  tool.title = tool.name
    .split('_')
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join(' ')
  tool.annotations = {
    readOnlyHint: READ_TOOLS.has(tool.name),
    destructiveHint: DESTRUCTIVE_TOOLS.has(tool.name),
    idempotentHint:
      tool.name.startsWith('get_') ||
      tool.name.startsWith('list_') ||
      tool.name.startsWith('search_') ||
      tool.name.startsWith('reorder_') ||
      tool.name.startsWith('update_'),
    openWorldHint: false,
  }
}

// MCP resources exposing the navigation as structured data.
const RESOURCES = [
  {
    uri: 'cloudnav://categories',
    name: 'Navigation categories',
    description: 'Full list of categories in display order.',
    mimeType: 'application/json',
  },
  {
    uri: 'cloudnav://links',
    name: 'All saved links',
    description: 'Every saved link across all categories.',
    mimeType: 'application/json',
  },
]

const PROMPTS = [
  {
    name: 'organize-navigation',
    description: 'Review and reorganize navigation categories and links.',
    arguments: [
      {
        name: 'goal',
        description: 'What to organize, e.g. merge duplicates or regroup links.',
      },
    ],
  },
]

function textResult(value, isError = false) {
  const isStructured =
    !isError && value !== null && typeof value === 'object' && !Array.isArray(value)
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
    ...(isStructured ? { structuredContent: value } : {}),
    ...(isError ? { isError: true } : {}),
  }
}

function structuredResource(uri, text) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(text, null, 2),
      },
    ],
  }
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

function defaultCategories() {
  return [{ id: 'common', name: '常用推荐', icon: 'Star' }]
}

async function readCategories(kv) {
  const raw = await kv.get('cate_config')
  if (!raw) return defaultCategories()
  try {
    const categories = JSON.parse(raw)
    return Array.isArray(categories) && categories.length ? categories : defaultCategories()
  } catch {
    return defaultCategories()
  }
}

async function writeCategories(kv, categories) {
  if (categories.length) await kv.put('cate_config', JSON.stringify(categories))
  else await kv.delete('cate_config')
}

async function readCategoryLinks(kv, categoryId) {
  const raw = await kv.get(`links:${categoryId}`)
  if (!raw) return []
  try {
    const links = JSON.parse(raw)
    return Array.isArray(links) ? links : []
  } catch {
    return []
  }
}

async function readAllLinks(kv, categories) {
  const ids = [...new Set(['common', ...categories.map(category => category.id)])]
  const groups = await Promise.all(ids.map(id => readCategoryLinks(kv, id)))
  return groups.flat()
}

async function writeCategoryLinks(kv, categoryId, links) {
  if (links.length) await kv.put(`links:${categoryId}`, JSON.stringify(links))
  else await kv.delete(`links:${categoryId}`)
}

function sanitizeLinkFields(args) {
  const out = {}
  if (args.title !== undefined) out.title = String(args.title).trim().slice(0, 200)
  if (args.url !== undefined) {
    const raw = String(args.url).trim().slice(0, 2048)
    if (!raw) return out
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    if (isHttpUrl(candidate)) out.url = candidate
  }
  if (args.description !== undefined) out.description = String(args.description).slice(0, 500)
  if (args.icon !== undefined) out.icon = sanitizeLinkIcon(args.icon)
  if (args.pinned !== undefined) out.pinned = Boolean(args.pinned)
  return out
}

// A link icon must be a resolvable image URL (a `/api/favicon` route, an http(s)
// URL, or a data: image). A bare emoji or any other non-URL text is invalid for
// links, so we drop it and let the frontend auto-fetch the website's real favicon.
function sanitizeLinkIcon(value) {
  if (value === undefined) return undefined
  const raw = String(value).trim()
  if (!raw) return undefined
  if (/^(https?:)?\/\//i.test(raw) || raw.startsWith('data:image')) {
    return raw.slice(0, 2000)
  }
  return undefined
}

function sanitizeCategory(category) {
  const { password, ...rest } = category
  return rest
}

// 与前端 shareCategoryIcon 方案一致：分类名带前导 emoji 时，把 emoji 提取为图标。
const EMOJI_RE = /^(\p{Extended_Pictographic})/u
function splitCategoryIcon(rawName) {
  const trimmed = (rawName || '').trim()
  const match = EMOJI_RE.exec(trimmed)
  if (match) {
    return { name: trimmed.slice(match[0].length).trim(), emoji: match[0] }
  }
  return { name: trimmed, emoji: null }
}

function makeId() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

async function isAuthenticated(request, env, kv) {
  return verifyMcpRequestAuth(request, env, kv)
}

async function readConfigSection(kv, section) {
  if (!CONFIG_SECTIONS.includes(section)) return null
  const raw = await kv.get(`config:${section}`)
  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  // Legacy fallback: look inside the merged `config` key.
  const merged = await kv.get('config')
  if (merged) {
    try {
      const parsed = JSON.parse(merged)
      return parsed[section] || null
    } catch {
      return null
    }
  }
  return null
}

async function callTool(name, args, kv, authenticated) {
  const categories = await readCategories(kv)
  const needsLinks = ![
    'list_categories',
    'get_category',
    'add_category',
    'update_category',
    'reorder_categories',
    'get_config',
    'update_config',
  ].includes(name)
  const allLinks = needsLinks ? await readAllLinks(kv, categories) : []

  // ---------- Read ----------
  if (name === 'list_categories') {
    return textResult(categories.map(sanitizeCategory))
  }

  if (name === 'list_links') {
    const links = args.categoryId
      ? allLinks.filter(link => link.categoryId === args.categoryId)
      : allLinks
    return textResult(links)
  }

  if (name === 'search_links') {
    const query = String(args.query || '')
      .trim()
      .toLocaleLowerCase()
    if (!query) return textResult([])
    return textResult(
      allLinks.filter(link =>
        `${link.title} ${link.url} ${link.description || ''}`.toLocaleLowerCase().includes(query)
      )
    )
  }

  if (name === 'get_config') {
    const loaded = await readConfigSection(kv, args.section)
    return textResult(sanitizePublicConfig(loaded ?? {}))
  }

  if (name === 'get_stats') {
    const counts = new Map()
    for (const link of allLinks) {
      counts.set(link.categoryId, (counts.get(link.categoryId) || 0) + 1)
    }
    const categoriesStats = categories.map(category => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      parentId: category.parentId,
      count: counts.get(category.id) || 0,
    }))
    return textResult({
      totalLinks: allLinks.length,
      totalCategories: categories.length,
      categories: categoriesStats,
    })
  }

  if (name === 'get_link') {
    const link = allLinks.find(link => link.id === args.id)
    if (!link) return textResult('Link not found.', true)
    return textResult(link)
  }

  if (name === 'get_category') {
    const category = categories.find(category => category.id === args.id)
    if (!category) return textResult('Category not found.', true)
    return textResult(sanitizeCategory(category))
  }

  if (name === 'list_recent_links') {
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20))
    return textResult(
      [...allLinks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit)
    )
  }

  if (!authenticated) return textResult('Authentication is required for write operations.', true)

  // ---------- Links ----------
  if (name === 'add_link') {
    const fields = sanitizeLinkFields(args)
    if (!fields.title || !fields.url) return textResult('title and url are required.', true)
    const categoryId = categories.some(category => category.id === args.categoryId)
      ? args.categoryId
      : 'common'
    const link = {
      id: makeId(),
      title: fields.title,
      url: fields.url,
      description: fields.description || '',
      categoryId,
      icon: fields.icon,
      pinned: Boolean(args.pinned),
      createdAt: Date.now(),
    }
    const current = await readCategoryLinks(kv, categoryId)
    await writeCategoryLinks(kv, categoryId, [link, ...current])
    return textResult(link)
  }

  if (name === 'update_link') {
    const current = allLinks.find(link => link.id === args.id)
    if (!current) return textResult('Link not found.', true)
    const nextCategoryId = categories.some(category => category.id === args.categoryId)
      ? args.categoryId
      : current.categoryId
    const updated = {
      ...current,
      ...sanitizeLinkFields(args),
      categoryId: nextCategoryId,
    }
    const source = await readCategoryLinks(kv, current.categoryId)
    await writeCategoryLinks(
      kv,
      current.categoryId,
      source.filter(link => link.id !== current.id)
    )
    const destination =
      current.categoryId === nextCategoryId ? source : await readCategoryLinks(kv, nextCategoryId)
    await writeCategoryLinks(kv, nextCategoryId, [
      updated,
      ...destination.filter(link => link.id !== current.id),
    ])
    return textResult(updated)
  }

  if (name === 'delete_link') {
    const current = allLinks.find(link => link.id === args.id)
    if (!current) return textResult('Link not found.', true)
    const links = await readCategoryLinks(kv, current.categoryId)
    await writeCategoryLinks(
      kv,
      current.categoryId,
      links.filter(link => link.id !== current.id)
    )
    return textResult({ deleted: true, id: current.id })
  }

  if (name === 'bulk_add_links') {
    if (!Array.isArray(args.links) || !args.links.length) {
      return textResult('links array is required.', true)
    }
    const created = []
    for (const item of args.links) {
      const fields = sanitizeLinkFields(item)
      if (!fields.title || !fields.url) continue
      const categoryId = categories.some(category => category.id === item.categoryId)
        ? item.categoryId
        : 'common'
      created.push({
        id: makeId(),
        title: fields.title,
        url: fields.url,
        description: fields.description || '',
        categoryId,
        icon: fields.icon,
        pinned: Boolean(item.pinned),
        createdAt: Date.now(),
      })
    }
    const grouped = new Map()
    for (const link of created) {
      const group = grouped.get(link.categoryId) || []
      group.push(link)
      grouped.set(link.categoryId, group)
    }
    await Promise.all(
      [...grouped.entries()].map(async ([categoryId, added]) => {
        const current = await readCategoryLinks(kv, categoryId)
        await writeCategoryLinks(kv, categoryId, [...added, ...current])
      })
    )
    return textResult({ added: created.length, links: created })
  }

  if (name === 'reorder_links') {
    const { categoryId, orderedIds } = args
    if (!categoryId || !Array.isArray(orderedIds)) {
      return textResult('categoryId and orderedIds array are required.', true)
    }
    const current = await readCategoryLinks(kv, categoryId)
    const position = new Map(orderedIds.map((id, index) => [id, index]))
    const reordered = [...current].sort((a, b) => {
      const pa = position.get(a.id)
      const pb = position.get(b.id)
      if (pa === undefined && pb === undefined) return 0
      if (pa === undefined) return 1
      if (pb === undefined) return -1
      return pa - pb
    })
    await writeCategoryLinks(kv, categoryId, reordered)
    return textResult({ reordered: true, categoryId, count: reordered.length })
  }

  // ---------- Categories ----------
  if (name === 'add_category') {
    const rawName = String(args.name || '')
      .trim()
      .slice(0, 200)
    if (!rawName) return textResult('name is required.', true)
    const { name: cleanName, emoji } = splitCategoryIcon(rawName)
    const parentId =
      args.parentId &&
      categories.some(category => category.id === args.parentId && !category.parentId)
        ? args.parentId
        : undefined
    const category = {
      id: makeId(),
      name: cleanName || '未命名',
      icon: emoji || String(args.icon || 'Folder').slice(0, 100),
      ...(parentId ? { parentId } : {}),
    }
    categories.push(category)
    await writeCategories(kv, categories)
    return textResult(category)
  }

  if (name === 'update_category') {
    const index = categories.findIndex(category => category.id === args.id)
    if (index < 0) return textResult('Category not found.', true)
    const next = { ...categories[index] }
    let emojiFromName = false
    if (args.name !== undefined) {
      const { name: cleanName, emoji } = splitCategoryIcon(String(args.name))
      next.name = cleanName.slice(0, 200)
      if (emoji) {
        next.icon = emoji
        emojiFromName = true
      }
    }
    if (args.icon !== undefined && !emojiFromName) next.icon = String(args.icon).slice(0, 100)
    if (args.parentId !== undefined) {
      if (args.parentId === '' || args.parentId === next.id) delete next.parentId
      else if (categories.some(category => category.parentId === next.id)) {
        return textResult('A category with children cannot become a subcategory.', true)
      } else if (categories.some(category => category.id === args.parentId && !category.parentId))
        next.parentId = args.parentId
      else return textResult(`Parent category not found: ${args.parentId}`, true)
    }
    categories[index] = next
    await writeCategories(kv, categories)
    return textResult({ updated: true, category: sanitizeCategory(next) })
  }

  if (name === 'delete_category') {
    if (args.id === 'common')
      return textResult('The default "common" category cannot be deleted.', true)
    const existing = categories.find(category => category.id === args.id)
    if (!existing) return textResult('Category not found.', true)
    const removedIds = new Set([
      args.id,
      ...categories.filter(category => category.parentId === args.id).map(category => category.id),
    ])
    const remaining = categories.filter(category => !removedIds.has(category.id))
    // Reassign links of the removed category subtree to "common".
    const movedGroups = await Promise.all([...removedIds].map(id => readCategoryLinks(kv, id)))
    const moved = movedGroups.flat()
    await Promise.all([...removedIds].map(id => writeCategoryLinks(kv, id, [])))
    const common = await readCategoryLinks(kv, 'common')
    await writeCategoryLinks(kv, 'common', [
      ...common,
      ...moved.map(link => ({ ...link, categoryId: 'common' })),
    ])
    await writeCategories(kv, remaining)
    return textResult({ deleted: true, ids: [...removedIds], migrated: moved.length })
  }

  if (name === 'reorder_categories') {
    const orderedIds = args.orderedIds
    if (!Array.isArray(orderedIds)) {
      return textResult('orderedIds array is required.', true)
    }
    const position = new Map(orderedIds.map((id, index) => [id, index]))
    const reordered = [...categories].sort(
      (a, b) =>
        (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    )
    await writeCategories(kv, reordered)
    return textResult({ reordered: true, count: reordered.length })
  }

  // ---------- Config ----------
  if (name === 'update_config') {
    const { section, value } = args
    if (!CONFIG_SECTIONS.includes(section)) {
      return textResult(
        `Invalid config section "${section}". Allowed: ${CONFIG_SECTIONS.join(', ')}`,
        true
      )
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return textResult('value must be an object.', true)
    }
    const previous = (await readConfigSection(kv, section)) || {}
    await kv.put(`config:${section}`, JSON.stringify(mergeSecretConfig(previous, value)))
    return textResult({ saved: true, section })
  }

  return textResult(`Unknown tool: ${name}`, true)
}

async function readResource(uri, kv, categories) {
  if (uri === 'cloudnav://categories') {
    return categories.map(sanitizeCategory)
  }
  if (uri === 'cloudnav://links') {
    return await readAllLinks(kv, categories)
  }
  return null
}

async function handleMessage(message, request, env, kv) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message?.id, -32600, 'Invalid JSON-RPC request.')
  }
  if (
    message.method === 'notifications/initialized' ||
    message.method.startsWith('notifications/')
  ) {
    return null
  }
  if (message.method === 'initialize') {
    return rpcResult(message.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
        prompts: { listChanged: false },
      },
      serverInfo: SERVER_INFO,
      instructions:
        'Provides saved links, categories, settings and statistics. ' +
        'Read tools (list_links, search_links, list_categories, get_stats, get_link, get_category, list_recent_links) are public; ' +
        'get_config always redacts secrets; write tools require an Authorization Bearer token. ' +
        'Use reorder_categories / reorder_links to persist sorting.',
    })
  }
  if (message.method === 'ping') return rpcResult(message.id, {})
  if (message.method === 'tools/list') return rpcResult(message.id, { tools: TOOLS })
  if (message.method === 'resources/list') return rpcResult(message.id, { resources: RESOURCES })
  if (message.method === 'resources/templates/list')
    return rpcResult(message.id, { resourceTemplates: [] })
  if (message.method === 'prompts/list') return rpcResult(message.id, { prompts: PROMPTS })
  if (message.method === 'prompts/get') {
    const name = message.params?.name
    const prompt = PROMPTS.find(item => item.name === name)
    if (!prompt) return rpcError(message.id, -32602, `Unknown prompt: ${name}`)
    const goal = String(message.params?.arguments?.goal || '').slice(0, 500)
    return rpcResult(message.id, {
      description: prompt.description,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              '请帮我整理我的网址导航。先调用 list_categories 和 get_stats 了解结构，',
              '再使用 search_links / list_links 检查链接，必要时用 update_category / add_category、',
              'update_link / add_link、reorder_categories / reorder_links 完成整理。',
              goal ? `整理目标：${goal}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    })
  }
  if (message.method === 'resources/read') {
    const uri = message.params?.uri
    const categories = await readCategories(kv)
    const data = await readResource(uri, kv, categories)
    if (data === null) return rpcError(message.id, -32602, `Unknown resource: ${uri}`)
    return rpcResult(message.id, structuredResource(uri, data))
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name
    if (!TOOLS.some(tool => tool.name === name))
      return rpcError(message.id, -32602, `Unknown tool: ${name}`)
    const authenticated = await isAuthenticated(request, env, kv)
    const result = await callTool(name, message.params?.arguments || {}, kv, authenticated)
    return rpcResult(message.id, result)
  }
  return rpcError(message.id, -32601, `Method not found: ${message.method}`)
}

function responseFor(payload, request, headers) {
  const accept = request.headers.get('accept') || ''
  if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
    const event = `event: message\ndata: ${JSON.stringify(payload)}\n\n`
    return new Response(event, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    })
  }
  return jsonResponse(payload, 200, headers)
}

export async function onRequest(context) {
  const { request, env } = context
  const headers = getCorsHeaders(env)
  headers['MCP-Protocol-Version'] = PROTOCOL_VERSION
  headers['Cache-Control'] = 'no-store'

  if (!isAllowedRequestOrigin(request, env)) {
    return jsonResponse({ error: 'Forbidden Origin' }, 403, headers)
  }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method === 'GET')
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST, OPTIONS' } })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method Not Allowed' }, 405, headers)

  let body
  try {
    body = await request.json()
  } catch {
    return responseFor(rpcError(null, -32700, 'Invalid JSON.'), request, headers)
  }

  const kv = getKV(env)
  if (Array.isArray(body)) {
    return responseFor(
      rpcError(null, -32600, 'JSON-RPC batching is not supported.'),
      request,
      headers
    )
  }
  const result = await handleMessage(body, request, env, kv)
  if (!result) return new Response(null, { status: 202, headers })
  return responseFor(result, request, headers)
}

// CloudNav MCP Server (refactored)
// Supports: read/write navigation data, category ordering, link ordering,
// config access, and MCP resources — backed by EdgeOne KV through _kvAdapter.
//
// This implementation shares the exact storage schema used by `storage.js`:
//   - categories -> key `cate_config`          (array order = sidebar order)
//   - per-category links -> key `links:<catId>` (array order = card order)
//   - config sections -> key `config:<section>`

import { getCorsHeaders, getKV, jsonResponse, verifyAuth } from './_kvAdapter.js';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_INFO = { name: 'CloudNav MCP', version: '1.1.0' };
const MAX_MESSAGES_PER_REQUEST = 20;

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
];

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
    description: 'Read a configuration section (ai, website, icon, view, ui, webdav, ...).',
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

  // ---------- Auth write tools: links ----------
  {
    name: 'add_link',
    description: 'Add a saved link to the navigation. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        url: { type: 'string' },
        description: { type: 'string' },
        categoryId: { type: 'string' },
        icon: { type: 'string' },
        pinned: { type: 'boolean' },
      },
      required: ['title', 'url'],
    },
  },
  {
    name: 'update_link',
    description: 'Update a saved link by id. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        url: { type: 'string' },
        description: { type: 'string' },
        categoryId: { type: 'string' },
        icon: { type: 'string' },
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
    description: 'Create a navigation category. Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        icon: { type: 'string', description: 'Optional icon name, e.g. Folder.' },
        parentId: { type: 'string', description: 'Optional parent category id (subcategory).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_category',
    description: 'Update a category by id (name, icon, parentId). Requires authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        icon: { type: 'string' },
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
    description: 'Write a configuration section (ai, website, icon, view, ui, webdav, ...). Requires authentication.',
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
];

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
];

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function structuredResource(uri, text) {
  return {
    content: [{ type: 'text', text: JSON.stringify(text, null, 2) }],
    uri,
    mimeType: 'application/json',
  };
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function defaultCategories() {
  return [{ id: 'common', name: '常用推荐', icon: 'Star' }];
}

async function readCategories(kv) {
  const raw = await kv.get('cate_config');
  if (!raw) return defaultCategories();
  try {
    const categories = JSON.parse(raw);
    return Array.isArray(categories) && categories.length ? categories : defaultCategories();
  } catch {
    return defaultCategories();
  }
}

async function writeCategories(kv, categories) {
  if (categories.length) await kv.put('cate_config', JSON.stringify(categories));
  else await kv.delete('cate_config');
}

async function readCategoryLinks(kv, categoryId) {
  const raw = await kv.get(`links:${categoryId}`);
  if (!raw) return [];
  try {
    const links = JSON.parse(raw);
    return Array.isArray(links) ? links : [];
  } catch {
    return [];
  }
}

async function readAllLinks(kv, categories) {
  const ids = [...new Set(['common', ...categories.map(category => category.id)])];
  const groups = await Promise.all(ids.map(id => readCategoryLinks(kv, id)));
  return groups.flat();
}

async function writeCategoryLinks(kv, categoryId, links) {
  if (links.length) await kv.put(`links:${categoryId}`, JSON.stringify(links));
  else await kv.delete(`links:${categoryId}`);
}

function sanitizeLinkFields(args) {
  const out = {};
  if (args.title !== undefined) out.title = String(args.title).trim().slice(0, 200);
  if (args.url !== undefined) {
    const raw = String(args.url).trim().slice(0, 2048);
    if (!raw) return out;
    out.url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }
  if (args.description !== undefined) out.description = String(args.description).slice(0, 500);
  if (args.icon !== undefined) out.icon = String(args.icon).slice(0, 1000);
  if (args.pinned !== undefined) out.pinned = Boolean(args.pinned);
  return out;
}

function sanitizeCategory(category) {
  const { password, ...rest } = category;
  return rest;
}

function makeId() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function getCredentials(request) {
  const authorization = request.headers.get('authorization') || '';
  if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim();
  return request.headers.get('x-auth-password') || '';
}

async function isAuthenticated(request, env, kv) {
  return verifyAuth({
    providedPassword: getCredentials(request),
    serverPassword: env?.PASSWORD,
    kv,
  });
}

async function readConfigSection(kv, section) {
  if (!CONFIG_SECTIONS.includes(section)) return null;
  const raw = await kv.get(`config:${section}`);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  // Legacy fallback: look inside the merged `config` key.
  const merged = await kv.get('config');
  if (merged) {
    try {
      const parsed = JSON.parse(merged);
      return parsed[section] || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function callTool(name, args, kv, authenticated) {
  const categories = await readCategories(kv);
  const allLinks = await readAllLinks(kv, categories);

  // ---------- Read ----------
  if (name === 'list_categories') {
    return textResult(categories.map(sanitizeCategory));
  }

  if (name === 'list_links') {
    const links = args.categoryId
      ? allLinks.filter(link => link.categoryId === args.categoryId)
      : allLinks;
    return textResult(links);
  }

  if (name === 'search_links') {
    const query = String(args.query || '').trim().toLocaleLowerCase();
    if (!query) return textResult([]);
    return textResult(
      allLinks.filter(link =>
        `${link.title} ${link.url} ${link.description || ''}`.toLocaleLowerCase().includes(query)
      )
    );
  }

  if (name === 'get_config') {
    const loaded = await readConfigSection(kv, args.section);
    return textResult(loaded ?? {});
  }

  if (!authenticated) return textResult('Authentication is required for write operations.', true);

  // ---------- Links ----------
  if (name === 'add_link') {
    const fields = sanitizeLinkFields(args);
    if (!fields.title || !fields.url) return textResult('title and url are required.', true);
    const categoryId = categories.some(category => category.id === args.categoryId)
      ? args.categoryId
      : 'common';
    const link = {
      id: makeId(),
      title: fields.title,
      url: fields.url,
      description: fields.description || '',
      categoryId,
      icon: fields.icon,
      pinned: Boolean(args.pinned),
      createdAt: Date.now(),
    };
    const current = await readCategoryLinks(kv, categoryId);
    await writeCategoryLinks(kv, categoryId, [link, ...current]);
    return textResult(link);
  }

  if (name === 'update_link') {
    const current = allLinks.find(link => link.id === args.id);
    if (!current) return textResult('Link not found.', true);
    const nextCategoryId = categories.some(category => category.id === args.categoryId)
      ? args.categoryId
      : current.categoryId;
    const updated = {
      ...current,
      ...sanitizeLinkFields(args),
      categoryId: nextCategoryId,
    };
    const source = await readCategoryLinks(kv, current.categoryId);
    await writeCategoryLinks(kv, current.categoryId, source.filter(link => link.id !== current.id));
    const destination =
      current.categoryId === nextCategoryId ? source : await readCategoryLinks(kv, nextCategoryId);
    await writeCategoryLinks(kv, nextCategoryId, [updated, ...destination.filter(link => link.id !== current.id)]);
    return textResult(updated);
  }

  if (name === 'delete_link') {
    const current = allLinks.find(link => link.id === args.id);
    if (!current) return textResult('Link not found.', true);
    const links = await readCategoryLinks(kv, current.categoryId);
    await writeCategoryLinks(kv, current.categoryId, links.filter(link => link.id !== current.id));
    return textResult({ deleted: true, id: current.id });
  }

  if (name === 'reorder_links') {
    const { categoryId, orderedIds } = args;
    if (!categoryId || !Array.isArray(orderedIds)) {
      return textResult('categoryId and orderedIds array are required.', true);
    }
    const current = await readCategoryLinks(kv, categoryId);
    const position = new Map(orderedIds.map((id, index) => [id, index]));
    const reordered = [...current].sort((a, b) => {
      const pa = position.get(a.id);
      const pb = position.get(b.id);
      if (pa === undefined && pb === undefined) return 0;
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return pa - pb;
    });
    await writeCategoryLinks(kv, categoryId, reordered);
    return textResult({ reordered: true, categoryId, count: reordered.length });
  }

  // ---------- Categories ----------
  if (name === 'add_category') {
    const name = String(args.name || '').trim().slice(0, 200);
    if (!name) return textResult('name is required.', true);
    const parentId =
      args.parentId && categories.some(category => category.id === args.parentId)
        ? args.parentId
        : undefined;
    const category = {
      id: makeId(),
      name,
      icon: String(args.icon || 'Folder').slice(0, 100),
      ...(parentId ? { parentId } : {}),
    };
    categories.push(category);
    await writeCategories(kv, categories);
    return textResult(category);
  }

  if (name === 'update_category') {
    const index = categories.findIndex(category => category.id === args.id);
    if (index < 0) return textResult('Category not found.', true);
    const next = { ...categories[index] };
    if (args.name !== undefined) next.name = String(args.name).trim().slice(0, 200);
    if (args.icon !== undefined) next.icon = String(args.icon).slice(0, 100);
    if (args.parentId !== undefined) {
      if (args.parentId === '' || args.parentId === next.id) delete next.parentId;
      else if (categories.some(category => category.id === args.parentId)) next.parentId = args.parentId;
      else return textResult(`Parent category not found: ${args.parentId}`, true);
    }
    categories[index] = next;
    await writeCategories(kv, categories);
    return textResult({ updated: true, category: sanitizeCategory(next) });
  }

  if (name === 'delete_category') {
    if (args.id === 'common') return textResult('The default "common" category cannot be deleted.', true);
    const existing = categories.find(category => category.id === args.id);
    if (!existing) return textResult('Category not found.', true);
    const remaining = categories.filter(category => category.id !== args.id);
    // Reassign links of the removed category to "common".
    const moved = await readCategoryLinks(kv, args.id);
    await writeCategoryLinks(kv, args.id, []);
    const common = await readCategoryLinks(kv, 'common');
    await writeCategoryLinks(
      kv,
      'common',
      [...common, ...moved.map(link => ({ ...link, categoryId: 'common' }))]
    );
    await writeCategories(kv, remaining);
    return textResult({ deleted: true, id: args.id, migrated: moved.length });
  }

  if (name === 'reorder_categories') {
    const orderedIds = args.orderedIds;
    if (!Array.isArray(orderedIds)) {
      return textResult('orderedIds array is required.', true);
    }
    const position = new Map(orderedIds.map((id, index) => [id, index]));
    const reordered = [...categories].sort(
      (a, b) =>
        (position.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
    await writeCategories(kv, reordered);
    return textResult({ reordered: true, count: reordered.length });
  }

  // ---------- Config ----------
  if (name === 'update_config') {
    const { section, value } = args;
    if (!CONFIG_SECTIONS.includes(section)) {
      return textResult(`Invalid config section "${section}". Allowed: ${CONFIG_SECTIONS.join(', ')}`, true);
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return textResult('value must be an object.', true);
    }
    await kv.put(`config:${section}`, JSON.stringify(value));
    return textResult({ saved: true, section });
  }

  return textResult(`Unknown tool: ${name}`, true);
}

async function readResource(uri, kv, categories) {
  if (uri === 'cloudnav://categories') {
    return categories.map(sanitizeCategory);
  }
  if (uri === 'cloudnav://links') {
    return await readAllLinks(kv, categories);
  }
  return null;
}

async function handleMessage(message, request, env, kv) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(message?.id, -32600, 'Invalid JSON-RPC request.');
  }
  if (message.method === 'notifications/initialized' || message.method.startsWith('notifications/')) {
    return null;
  }
  if (message.method === 'initialize') {
    return rpcResult(message.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: SERVER_INFO,
      instructions:
        'Read-only tools (list_links, search_links, list_categories, get_config) are open. ' +
        'Write tools and config updates require an Authorization Bearer token (the site admin password). ' +
        'Use reorder_categories / reorder_links to persist sorting.',
    });
  }
  if (message.method === 'ping') return rpcResult(message.id, {});
  if (message.method === 'tools/list') return rpcResult(message.id, { tools: TOOLS });
  if (message.method === 'resources/list') return rpcResult(message.id, { resources: RESOURCES });
  if (message.method === 'resources/templates/list') return rpcResult(message.id, { resourceTemplates: [] });
  if (message.method === 'resources/read') {
    const uri = message.params?.uri;
    const categories = await readCategories(kv);
    const data = await readResource(uri, kv, categories);
    if (data === null) return rpcError(message.id, -32602, `Unknown resource: ${uri}`);
    return rpcResult(message.id, structuredResource(uri, data));
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    if (!TOOLS.some(tool => tool.name === name)) return rpcError(message.id, -32602, `Unknown tool: ${name}`);
    const authenticated = await isAuthenticated(request, env, kv);
    const result = await callTool(name, message.params?.arguments || {}, kv, authenticated);
    return rpcResult(message.id, result);
  }
  return rpcError(message.id, -32601, `Method not found: ${message.method}`);
}

function responseFor(payload, request, headers) {
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
    const event = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
    return new Response(event, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }
  return jsonResponse(payload, 200, headers);
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = getCorsHeaders(env);
  headers['MCP-Protocol-Version'] = PROTOCOL_VERSION;
  headers['Cache-Control'] = 'no-store';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method === 'GET') {
    const endpoint = new URL('/api/mcp', request.url).toString();
    return new Response(`event: endpoint\ndata: ${endpoint}\n\n`, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method Not Allowed' }, 405, headers);

  let body;
  try {
    body = await request.json();
  } catch {
    return responseFor(rpcError(null, -32700, 'Invalid JSON.'), request, headers);
  }

  const kv = getKV(env);
  const messages = Array.isArray(body) ? body : [body];
  if (messages.length > MAX_MESSAGES_PER_REQUEST) {
    return responseFor(rpcError(null, -32600, 'Too many messages in one request.'), request, headers);
  }
  const results = (await Promise.all(messages.map(message => handleMessage(message, request, env, kv)))).filter(Boolean);
  if (!results.length) return new Response(null, { status: 202, headers });
  return responseFor(Array.isArray(body) ? results : results[0], request, headers);
}
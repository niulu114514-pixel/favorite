import { getCorsHeaders, getKV, jsonResponse, verifyAuth } from './_kvAdapter.js';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_INFO = { name: 'CloudNav MCP', version: '1.0.0' };

const TOOLS = [
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
    description: 'List all navigation categories.',
    inputSchema: { type: 'object', properties: {} },
  },
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
];

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
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

async function callTool(name, args, kv, authenticated) {
  const categories = await readCategories(kv);
  const allLinks = await readAllLinks(kv, categories);

  if (name === 'list_categories') {
    return textResult(categories.map(({ password, ...category }) => category));
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

  if (!authenticated) return textResult('Authentication is required for write operations.', true);

  if (name === 'add_link') {
    const title = String(args.title || '').trim();
    const url = String(args.url || '').trim();
    if (!title || !url) return textResult('title and url are required.', true);
    const categoryId = categories.some(category => category.id === args.categoryId)
      ? args.categoryId
      : 'common';
    const link = {
      id: makeId(),
      title,
      url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
      description: String(args.description || ''),
      categoryId,
      icon: args.icon || undefined,
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
      ...Object.fromEntries(
        ['title', 'url', 'description', 'icon', 'pinned'].filter(key => args[key] !== undefined).map(key => [key, args[key]])
      ),
      categoryId: nextCategoryId,
    };
    const source = await readCategoryLinks(kv, current.categoryId);
    await writeCategoryLinks(kv, current.categoryId, source.filter(link => link.id !== current.id));
    const destination = current.categoryId === nextCategoryId ? source : await readCategoryLinks(kv, nextCategoryId);
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

  return textResult(`Unknown tool: ${name}`, true);
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
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: 'Use list_links or search_links to read this navigation. Write tools require an Authorization Bearer token.',
    });
  }
  if (message.method === 'ping') return rpcResult(message.id, {});
  if (message.method === 'tools/list') return rpcResult(message.id, { tools: TOOLS });
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
  const results = (await Promise.all(messages.map(message => handleMessage(message, request, env, kv)))).filter(Boolean);
  if (!results.length) return new Response(null, { status: 202, headers });
  return responseFor(Array.isArray(body) ? results : results[0], request, headers);
}

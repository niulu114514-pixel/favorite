// 统一存储接口
// 支持 EdgeOne Pages
// 支持按分类拆分链接存储

import {
  getCorsHeaders,
  getKV,
  jsonResponse,
  normalizeDomain,
  sanitizePublicConfig,
  verifyRequestAuth,
} from './_kvAdapter.js'

const STORAGE_KEYS = {
  CONFIG_KEY: 'config',
  CATEGORIES_CONFIG_KEY: 'cate_config',
}

const MAX_POST_BODY_BYTES = 5 * 1024 * 1024
const WRITABLE_KEYS = new Set([STORAGE_KEYS.CONFIG_KEY, STORAGE_KEYS.CATEGORIES_CONFIG_KEY])
const CATEGORY_ID_PATTERN = /^[a-zA-Z0-9._-]{1,80}$/

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

function isCategoryId(value) {
  return typeof value === 'string' && CATEGORY_ID_PATTERN.test(value)
}

async function readConfigSection(kv, section) {
  const sectionStr = await kv.get(`config:${section}`)
  if (sectionStr) return JSON.parse(sectionStr)
  const configStr = await kv.get('config')
  const config = configStr ? JSON.parse(configStr) : {}
  return config[section] || null
}

async function mergeAllConfigSections(kv) {
  const merged = {}
  let hasAnyIndividual = false
  const results = await Promise.all(
    CONFIG_SECTIONS.map(async s => {
      const v = await kv.get(`config:${s}`)
      if (v) {
        hasAnyIndividual = true
        return [s, JSON.parse(v)]
      }
      return null
    })
  )
  for (const r of results) {
    if (r) merged[r[0]] = r[1]
  }
  if (hasAnyIndividual) {
    const configStr = await kv.get('config')
    if (configStr) {
      const legacy = JSON.parse(configStr)
      for (const s of CONFIG_SECTIONS) {
        if (!merged[s] && legacy[s]) merged[s] = legacy[s]
      }
    }
    return merged
  }
  const configStr = await kv.get('config')
  return configStr ? JSON.parse(configStr) : {}
}

function categoryLinksKey(categoryId) {
  return `links:${categoryId}`
}

async function readAllCategoryLinks(kv) {
  const categoriesStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY)
  const categories = categoriesStr ? JSON.parse(categoriesStr) : []

  if (categories.length === 0) return []

  const linkPromises = categories.map(async cat => {
    const data = await kv.get(categoryLinksKey(cat.id))
    return data ? JSON.parse(data) : []
  })

  const linkArrays = await Promise.all(linkPromises)
  return linkArrays.flat()
}

async function saveCategoryLinks(kv, links) {
  let allCatIds = new Set(['common'])
  try {
    const categoriesStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY)
    if (categoriesStr) {
      const categories = JSON.parse(categoriesStr)
      if (Array.isArray(categories)) {
        categories.forEach(c => {
          if (c && isCategoryId(c.id)) allCatIds.add(c.id)
        })
      }
    }
  } catch (e) {
    console.warn('Failed to read categories during saveCategoryLinks:', e)
  }

  const grouped = {}
  for (const link of links) {
    const catId = isCategoryId(link.categoryId) ? link.categoryId : 'common'
    if (!grouped[catId]) grouped[catId] = []
    grouped[catId].push(link)
  }

  Object.keys(grouped).forEach(id => allCatIds.add(id))

  const writes = Array.from(allCatIds).map(catId => {
    const catLinks = grouped[catId] || []
    if (catLinks.length === 0) {
      return kv.delete(categoryLinksKey(catId)).catch(() => {})
    }
    return kv.put(categoryLinksKey(catId), JSON.stringify(catLinks))
  })

  await Promise.all(writes)
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const kv = getKV(env)

    if (request.method === 'GET') {
      const checkAuth = url.searchParams.get('checkAuth')
      const getConfig = url.searchParams.get('getConfig')
      const key = url.searchParams.get('key')
      const category = url.searchParams.get('category')

      if (checkAuth === 'true') {
        const authenticated = await verifyRequestAuth(request, env, kv)
        return jsonResponse(
          {
            hasPassword: !!env.PASSWORD,
            requiresAuth: !!env.PASSWORD,
            authenticated,
            readOnlyAccess: true,
            capabilities: { upload: true },
          },
          200,
          corsHeaders
        )
      }

      let authenticated = false
      if (getConfig || key) {
        authenticated = await verifyRequestAuth(request, env, kv)
      }

      if (CONFIG_SECTIONS.includes(getConfig)) {
        const sectionVal = await readConfigSection(kv, getConfig)
        const defaults = {
          website: { passwordExpiry: { value: 1, unit: 'week' } },
        }
        const result = authenticated
          ? sectionVal || defaults[getConfig] || {}
          : sanitizePublicConfig(sectionVal || defaults[getConfig] || {})
        return jsonResponse(result, 200, corsHeaders)
      }

      if (getConfig === 'favicon') {
        const domain = normalizeDomain(url.searchParams.get('domain'))
        if (!domain) {
          return jsonResponse({ error: 'Domain parameter is required' }, 400, corsHeaders)
        }
        const cachedIcon = await kv.get(`favicon:${domain}`)
        return jsonResponse({ icon: cachedIcon || null, cached: !!cachedIcon }, 200, corsHeaders)
      }

      if (getConfig === 'categories') {
        const data = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY)
        const categories = data ? JSON.parse(data) : []
        const sanitized = categories.map(({ password, ...rest }) => rest)
        return jsonResponse(sanitized, 200, corsHeaders)
      }

      if (getConfig === 'links') {
        if (category) {
          if (!isCategoryId(category)) {
            return jsonResponse({ error: 'Invalid category' }, 400, corsHeaders)
          }
          const data = await kv.get(categoryLinksKey(category))
          return new Response(data || '[]', {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          })
        }

        const links = await readAllCategoryLinks(kv)
        return jsonResponse(links, 200, corsHeaders)
      }

      if (key) {
        if (key !== STORAGE_KEYS.CONFIG_KEY) {
          return jsonResponse({ error: 'Key is not publicly readable' }, 404, corsHeaders)
        }
        const merged = await mergeAllConfigSections(kv)
        const result = authenticated ? merged : sanitizePublicConfig(merged)
        return jsonResponse({ key, value: JSON.stringify(result) }, 200, corsHeaders)
      }

      if (getConfig === 'all') {
        const merged = await mergeAllConfigSections(kv)
        return jsonResponse(authenticated ? merged : sanitizePublicConfig(merged), 200, corsHeaders)
      }

      if (getConfig === 'true') {
        const categoriesData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY)
        const categories = categoriesData ? JSON.parse(categoriesData) : []
        const sanitizedCategories = categories.map(({ password, ...rest }) => rest)
        const links = await readAllCategoryLinks(kv)

        return jsonResponse(
          {
            links,
            categories: sanitizedCategories,
          },
          200,
          corsHeaders
        )
      }

      return jsonResponse({ links: [], categories: [] }, 200, corsHeaders)
    }

    if (request.method === 'POST') {
      const contentLength = Number(request.headers.get('content-length') || 0)
      if (contentLength > MAX_POST_BODY_BYTES) {
        return jsonResponse({ error: 'Payload is too large' }, 413, corsHeaders)
      }
      const body = await request.json()

      const isAuthenticated = await verifyRequestAuth(request, env, kv)
      if (!isAuthenticated) {
        return jsonResponse({ error: '管理操作需要密码验证' }, 401, corsHeaders)
      }

      if (body.authOnly) {
        await kv.put('last_auth_time', Date.now().toString())
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (body.saveConfig === 'favicon') {
        const domain = normalizeDomain(body.domain)
        if (!domain || typeof body.icon !== 'string' || body.icon.length > 4096) {
          return jsonResponse({ error: 'Domain and icon are required' }, 400, corsHeaders)
        }
        await kv.put(`favicon:${domain}`, body.icon, { expirationTtl: 30 * 24 * 60 * 60 })
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (CONFIG_SECTIONS.includes(body.saveConfig)) {
        await kv.put(`config:${body.saveConfig}`, JSON.stringify(body.config))
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (body.saveConfig === 'batch' && body.configs && typeof body.configs === 'object') {
        const entries = Object.entries(body.configs).filter(([section]) =>
          CONFIG_SECTIONS.includes(section)
        )
        if (!entries.length) {
          return jsonResponse({ error: 'Invalid configuration sections' }, 400, corsHeaders)
        }
        await Promise.all(
          entries.map(([section, value]) => kv.put(`config:${section}`, JSON.stringify(value)))
        )
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (body.saveConfig === 'categories') {
        await kv.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories))
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (body.saveConfig === 'links') {
        if (body.categoryId) {
          if (!isCategoryId(body.categoryId)) {
            return jsonResponse({ error: 'Invalid category' }, 400, corsHeaders)
          }
          await kv.put(categoryLinksKey(body.categoryId), JSON.stringify(body.links))
        } else {
          await saveCategoryLinks(kv, body.links)
        }
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (body.key === STORAGE_KEYS.CONFIG_KEY && body.value) {
        await kv.put('config', body.value)
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (body.key && body.value && WRITABLE_KEYS.has(body.key)) {
        await kv.put(body.key, body.value)
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (body.links && body.categories) {
        await saveCategoryLinks(kv, body.links)
        await kv.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories))
        return jsonResponse({ success: true }, 200, corsHeaders)
      } else if (body.links) {
        await saveCategoryLinks(kv, body.links)
        return jsonResponse({ success: true }, 200, corsHeaders)
      } else if (body.categories) {
        await kv.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories))
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      return jsonResponse({ error: 'Invalid data format' }, 400, corsHeaders)
    }

    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)
  } catch (err) {
    console.error('Storage API error:', err)
    return jsonResponse({ error: 'Failed to fetch data' }, 500, corsHeaders)
  }
}

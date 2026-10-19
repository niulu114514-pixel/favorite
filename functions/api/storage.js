// 统一存储接口
// 支持 EdgeOne Pages
// 支持按分类拆分链接存储

import {
  getCorsHeaders,
  getKV,
  jsonResponse,
  mergeSecretConfig,
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
// 聚合缓存：读侧只读这一个 key，避免每次 bootstrap 打 11 次 config:<section>。
// 写入侧负责重建，属于「读多写少」的典型取舍。
const CONFIG_AGGREGATE_KEY = 'config_all'

const CONFIG_SECTIONS = [
  'ai',
  'website',
  'mastodon',
  'weather',
  'ticker',
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

// 早期版本在分类上预留过 password 字段，但从未实现任何校验逻辑，该字段已从类型中移除。
// 这里继续剥离，是为了避免历史 KV 数据中的残留值随接口返回给前端。
function stripLegacyCategorySecret(category) {
  if (!category || typeof category !== 'object') return category
  const { password, ...rest } = category
  return rest
}

async function readConfigSection(kv, section) {
  const sectionStr = await kv.get(`config:${section}`)
  if (sectionStr) return JSON.parse(sectionStr)
  const configStr = await kv.get('config')
  const config = configStr ? JSON.parse(configStr) : {}
  return config[section] || null
}

async function mergeAllConfigSections(kv) {
  // 快路径：聚合 key 已存在时只读一次。
  const aggregated = await kv.get(CONFIG_AGGREGATE_KEY).catch(() => null)
  if (aggregated) {
    try {
      return JSON.parse(aggregated)
    } catch {
      // 聚合内容损坏时回退到逐段读取。
    }
  }

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

/** 重建聚合缓存。仅在写入路径调用，读取路径不触发。 */
async function rebuildConfigAggregate(kv) {
  try {
    const values = await Promise.all(CONFIG_SECTIONS.map(s => kv.get(`config:${s}`)))
    const merged = {}
    let hasAny = false
    values.forEach((v, i) => {
      if (!v) return
      hasAny = true
      try {
        merged[CONFIG_SECTIONS[i]] = JSON.parse(v)
      } catch {
        // 单个损毁的段不应影响整体聚合。
      }
    })
    if (!hasAny) {
      await kv.delete(CONFIG_AGGREGATE_KEY).catch(() => {})
      return
    }
    const legacyStr = await kv.get('config').catch(() => null)
    if (legacyStr) {
      try {
        const legacy = JSON.parse(legacyStr)
        for (const s of CONFIG_SECTIONS) {
          if (!merged[s] && legacy[s]) merged[s] = legacy[s]
        }
      } catch {
        // 忽略 legacy 解析失败。
      }
    }
    await kv.put(CONFIG_AGGREGATE_KEY, JSON.stringify(merged))
  } catch (e) {
    console.warn('Failed to rebuild config aggregate:', e)
  }
}

async function writeConfigSectionRaw(kv, section, value) {
  const previous = await readConfigSection(kv, section)
  const next = mergeSecretConfig(previous, value)
  await kv.put(`config:${section}`, JSON.stringify(next))
}

async function writeConfigSection(kv, section, value) {
  await writeConfigSectionRaw(kv, section, value)
  await rebuildConfigAggregate(kv)
}

function categoryLinksKey(categoryId) {
  return `links:${categoryId}`
}

async function readAllCategoryLinks(kv) {
  const categoriesStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY)
  const categories = categoriesStr ? JSON.parse(categoriesStr) : []
  const ids = [...new Set(['common', ...categories.map(category => category.id)])]
  const linkPromises = ids.map(async id => {
    const data = await kv.get(categoryLinksKey(id))
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

  const ids = Array.from(allCatIds)
  // 先读现状再决定写哪些：原本每次保存都会重写全部分类（改一个书签 = 22 次写），
  // 现在只写内容真正变化的分类。多出的读远比省下的写便宜。
  const currentValues = await Promise.all(
    ids.map(id => kv.get(categoryLinksKey(id)).catch(() => null))
  )

  const writes = ids.map((catId, index) => {
    const catLinks = grouped[catId] || []
    const current = currentValues[index]

    if (catLinks.length === 0) {
      if (current === null || current === undefined) return Promise.resolve()
      return kv.delete(categoryLinksKey(catId)).catch(() => {})
    }

    const next = JSON.stringify(catLinks)
    if (current === next) return Promise.resolve()
    return kv.put(categoryLinksKey(catId), next)
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

      if (url.searchParams.get('bootstrap') === 'true') {
        const [categoriesData, links, merged, authenticated] = await Promise.all([
          kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY),
          readAllCategoryLinks(kv),
          mergeAllConfigSections(kv),
          verifyRequestAuth(request, env, kv),
        ])
        const categories = categoriesData ? JSON.parse(categoriesData) : []
        // 前端拿不到 apiKey（已被脱敏），但仍需知道 AI 是否可用，
        // 否则每次新增链接都会先发一个注定 400 的请求，再把「请先配置」当报错显示。
        const aiConfig = (merged && merged.ai) || {}
        const aiConfigured =
          Boolean(aiConfig.apiKey) ||
          Object.values(aiConfig.providers || {}).some(
            provider => provider && typeof provider.apiKey === 'string' && provider.apiKey
          )
        return jsonResponse(
          {
            links,
            categories: categories.map(stripLegacyCategorySecret),
            config: sanitizePublicConfig(merged),
            auth: {
              authenticated,
              hasPassword: Boolean(env.PASSWORD),
            },
            aiConfigured,
          },
          200,
          { ...corsHeaders, 'Cache-Control': 'no-store' }
        )
      }

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
        const sanitized = categories.map(stripLegacyCategorySecret)
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
        const sanitizedCategories = categories.map(stripLegacyCategorySecret)
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
        await writeConfigSection(kv, body.saveConfig, body.config)
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (body.saveConfig === 'batch' && body.configs && typeof body.configs === 'object') {
        const entries = Object.entries(body.configs).filter(([section]) =>
          CONFIG_SECTIONS.includes(section)
        )
        if (!entries.length) {
          return jsonResponse({ error: 'Invalid configuration sections' }, 400, corsHeaders)
        }
        // 批量写只在末尾重建一次聚合，避免每个 section 各重建一遍。
        await Promise.all(entries.map(([section, value]) => writeConfigSectionRaw(kv, section, value)))
        await rebuildConfigAggregate(kv)
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
        await rebuildConfigAggregate(kv)
        return jsonResponse({ success: true }, 200, corsHeaders)
      }

      if (body.key && body.value && WRITABLE_KEYS.has(body.key)) {
        await kv.put(body.key, body.value)
        // cate_config 不参与配置聚合，只有整包 config 需要重建。
        if (body.key === STORAGE_KEYS.CONFIG_KEY) await rebuildConfigAggregate(kv)
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

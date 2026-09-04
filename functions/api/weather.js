// 天气代理接口
// 天气 API Key 只保存在服务端配置里，前端不接触 key；本接口负责用服务端配置取回天气并按统一结构返回。
// 支持 EdgeOne Pages

import { getCorsHeaders, getKV, jsonResponse } from './_kvAdapter.js'

const DEFAULT_UNIT = 'celsius'
// 允许的提供商 -> 校验函数，避免任意远程 URL（SSRF）
const PROVIDERS = new Set(['qweather', 'openweather', 'visualcrossing'])

async function readWeatherConfig(kv) {
  const sectionStr = await kv.get('config:weather')
  if (sectionStr) return JSON.parse(sectionStr)
  const configStr = await kv.get('config')
  const config = configStr ? JSON.parse(configStr) : {}
  return config.weather || null
}

function str(value) {
  return typeof value === 'string' ? value.trim() : ''
}

async function fetchQWeather(cfg) {
  const key = str(cfg.qweatherApiKey)
  const location = str(cfg.qweatherLocation)
  if (!key || !location) return { error: 'QWeather 未配置 API Key 或位置' }
  const host = str(cfg.qweatherHost) || 'https://devapi.qweather.com'
  const url = `${host.replace(/\/$/, '')}/v7/weather/now?location=${encodeURIComponent(
    location
  )}&key=${encodeURIComponent(key)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!data || data.code !== '200' || !data.now) {
    return { error: `QWeather 请求失败：${data?.code || res.status}` }
  }
  return {
    temp: Number(data.now.temp),
    text: data.now.text || '',
    icon: data.now.icon || '',
    unit: 'celsius',
    location: location,
    source: 'qweather',
  }
}

async function fetchOpenWeather(cfg) {
  const key = str(cfg.openweatherApiKey)
  const city = str(cfg.openweatherCity)
  if (!key || !city) return { error: 'OpenWeather 未配置 API Key 或城市' }
  const units = cfg.unit === 'fahrenheit' ? 'imperial' : 'metric'
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(
    city
  )}&units=${units}&appid=${encodeURIComponent(key)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!data || !data.main) {
    return { error: `OpenWeather 请求失败：${data?.message || res.status}` }
  }
  const description = data.weather?.[0]?.description || ''
  return {
    temp: Math.round(data.main.temp),
    text: description,
    icon: data.weather?.[0]?.icon || '',
    unit: units === 'imperial' ? 'fahrenheit' : 'celsius',
    location: city,
    source: 'openweather',
  }
}

async function fetchVisualCrossing(cfg) {
  const key = str(cfg.visualcrossingApiKey)
  const location = str(cfg.visualcrossingLocation)
  if (!key || !location) return { error: 'Visual Crossing 未配置 API Key 或位置' }
  const units = cfg.unit === 'fahrenheit' ? 'us' : 'metric'
  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(
    location
  )}?unitGroup=${units}&key=${encodeURIComponent(key)}&contentType=json`
  const res = await fetch(url)
  const data = await res.json()
  const cc = data && data.currentConditions
  if (!cc) {
    return { error: `Visual Crossing 请求失败：${res.status}` }
  }
  return {
    temp: Math.round(cc.temp),
    text: cc.conditions || '',
    icon: '',
    unit: units === 'us' ? 'fahrenheit' : 'celsius',
    location: location,
    source: 'visualcrossing',
  }
}

export async function onRequest(context) {
  const { request, env } = context
  const corsHeaders = getCorsHeaders(env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders)
  }

  try {
    const kv = getKV(env)
    const cfg = (await readWeatherConfig(kv)) || {}
    if (!cfg.enabled) {
      return jsonResponse({ enabled: false }, 200, corsHeaders)
    }
    if (!PROVIDERS.has(cfg.provider)) {
      return jsonResponse({ enabled: true, error: '该天气源暂不受支持' }, 200, corsHeaders)
    }

    let result
    if (cfg.provider === 'qweather') result = await fetchQWeather(cfg)
    else if (cfg.provider === 'openweather') result = await fetchOpenWeather(cfg)
    else result = await fetchVisualCrossing(cfg)

    result.unit = result.unit || cfg.unit || DEFAULT_UNIT
    return jsonResponse({ enabled: true, ...result }, 200, corsHeaders)
  } catch (err) {
    console.error('Weather API error:', err)
    return jsonResponse({ enabled: true, error: '天气获取失败' }, 500, corsHeaders)
  }
}
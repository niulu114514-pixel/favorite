// 链接点击统计：纯本地（localStorage），不上传、不参与同步。
const KEY = 'cloudnav_link_stats'

type LinkStat = { c: number; t: number }

let cache: Record<string, LinkStat> | null = null

function ensureLoaded(): Record<string, LinkStat> {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    cache = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    cache = {}
  }
  return cache
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // 配额满等异常静默，统计属于锦上添花
  }
}

export function recordLinkClick(id: string) {
  if (!id) return
  const store = ensureLoaded()
  const stat = store[id] || { c: 0, t: 0 }
  stat.c += 1
  stat.t = Date.now()
  store[id] = stat
  persist()
}

export function getClickCount(id: string): number {
  return ensureLoaded()[id]?.c || 0
}

export function getLastClickedAt(id: string): number {
  return ensureLoaded()[id]?.t || 0
}

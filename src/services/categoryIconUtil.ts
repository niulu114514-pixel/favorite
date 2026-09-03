// 分类图标约定
// 分类名可以带前导 emoji，例如“⭐ 常用推荐”。保存时，前导 emoji 会被提取
// 作为该分类的图标（icon 字段），其余文本作为分类名。这样既支持 Lucide 图标，
// 也支持用任意 emoji 作为文件夹图标。

// 匹配任意 emoji/象形符号（Unicode Extended_Pictographic，覆盖绝大多数常见 emoji）。
const EMOJI_RE = /^(\p{Extended_Pictographic})/u

/** 从分类名中提取前导 emoji 作为图标，返回拆分后的 “ 图标 + 名称 ”。 */
export function splitCategoryIcon(
  rawName: string
): { icon?: string; name: string } {
  const trimmed = rawName.trim()
  const match = EMOJI_RE.exec(trimmed)
  if (match) {
    return { icon: match[0], name: trimmed.slice(match[0].length).trim() }
  }
  return { icon: undefined, name: trimmed }
}

/** 判断 icon 是否为 emoji（此时应作为矢量字体/文本来渲染，而不是 Lucide 图标）。 */
export function isEmojiIcon(icon?: string): boolean {
  return Boolean(icon && EMOJI_RE.test(icon))
}
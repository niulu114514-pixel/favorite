import type { Category, LinkItem } from '../../types'

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 生成 Netscape 书签格式 —— 所有浏览器与多数导航站都能直接导入，
 * 是导航站数据自主权的底线：随时可以整体迁走。
 */
export function buildBookmarksHtml(links: LinkItem[], categories: Category[]): string {
  const byCategory = new Map<string, LinkItem[]>()
  for (const link of links) {
    const key = link.categoryId || 'common'
    if (!byCategory.has(key)) byCategory.set(key, [])
    byCategory.get(key)!.push(link)
  }

  const lines: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ]

  const emitLinks = (items: LinkItem[], indent: string) => {
    for (const link of items) {
      const title = esc(link.title || link.url)
      const added = link.createdAt ? ` ADD_DATE="${Math.floor(link.createdAt / 1000)}"` : ''
      lines.push(`${indent}<DT><A HREF="${esc(link.url)}"${added}>${title}</A>`)
    }
  }

  const seen = new Set<string>()
  for (const category of categories) {
    if (category.parentId || seen.has(category.id)) continue
    seen.add(category.id)
    const items = byCategory.get(category.id) || []
    const children = categories.filter(child => child.parentId === category.id)
    if (!items.length && !children.some(child => (byCategory.get(child.id) || []).length)) continue
    lines.push(`    <DT><H3>${esc(category.name)}</H3>`)
    lines.push('    <DL><p>')
    emitLinks(items, '        ')
    for (const child of children) {
      seen.add(child.id)
      const childItems = byCategory.get(child.id) || []
      if (!childItems.length) continue
      lines.push(`        <DT><H3>${esc(child.name)}</H3>`)
      lines.push('        <DL><p>')
      emitLinks(childItems, '            ')
      lines.push('        </DL><p>')
    }
    lines.push('    </DL><p>')
  }

  // 兜底：分类已删但链接还在的孤儿数据
  const rest = links.filter(link => !seen.has(link.categoryId || ''))
  if (rest.length) emitLinks(rest, '    ')

  lines.push('</DL><p>')
  return lines.join('\n')
}

export function downloadBookmarksHtml(
  links: LinkItem[],
  categories: Category[],
  siteName = 'CloudNav'
) {
  const html = buildBookmarksHtml(links, categories)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bookmarks-${siteName}-${new Date().toISOString().slice(0, 10)}.html`
  a.click()
  URL.revokeObjectURL(url)
}

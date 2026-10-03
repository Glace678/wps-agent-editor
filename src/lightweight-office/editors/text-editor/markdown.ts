import DOMPurify from 'dompurify'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { findTableRegions, preserveBodyNewlinesInHtml } from '../notepad-tables'

// GFM tables + soft line breaks so body text stays line-oriented like 记事本.
marked.setOptions({ gfm: true, breaks: true })

const markdownBodySerializer = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  // Turndown appends its own newline around <br>; an empty marker preserves one line break.
  br: '',
})

markdownBodySerializer.addRule('strikethrough', {
  filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.tagName),
  replacement: (content) => `~~${content}~~`,
})
markdownBodySerializer.addRule('underline', {
  filter: 'u',
  replacement: (content) => `<u>${content}</u>`,
})

function renderMarkdownBodyRegion(source: string, index: number): string {
  const raw = marked.parse(source, { async: false }) as string
  const body = preserveBodyNewlinesInHtml(raw).trim() || '<p><br></p>'
  return `<div data-notepad-markdown-region="${index}">${body}</div>`
}

export function renderNotepadMarkdown(source: string): string {
  const tables = findTableRegions(source)
  const parts: string[] = []
  let cursor = 0

  for (let index = 0; index < tables.length; index += 1) {
    const table = tables[index]
    parts.push(renderMarkdownBodyRegion(source.slice(cursor, table.start), index))
    const tableSource = source.slice(table.start, table.end)
    parts.push(/^\s*<table\b/i.test(tableSource)
      ? tableSource
      : marked.parse(tableSource, { async: false }) as string)
    cursor = table.end
  }
  parts.push(renderMarkdownBodyRegion(source.slice(cursor), tables.length))

  const withTableClass = parts.join('').replace(
    /<table(?![^>]*\bclass=)/gi,
    '<table class="notepad-md-table"',
  )
  return DOMPurify.sanitize(withTableClass)
}

export function serializeMarkdownBodyRegion(region: HTMLElement): string {
  return markdownBodySerializer.turndown(region)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

export function serializePlainTextBodyRegion(region: HTMLElement): string {
  return (region.innerText ?? region.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

export function serializeBodyRegionAtCaret(
  region: HTMLElement,
  range: Range,
  documentType: 'plain' | 'markdown',
): { source: string; offset: number } | null {
  if (!region.contains(range.startContainer)) return null

  let markerText = 'NOTEPADTABLEINSERTIONCARET'
  while (region.textContent?.includes(markerText)) markerText += 'X'
  const marker = document.createElement('span')
  marker.setAttribute('data-notepad-table-insertion-caret', 'true')
  marker.textContent = markerText

  const caret = range.cloneRange()
  caret.collapse(true)
  caret.insertNode(marker)
  const serialized = documentType === 'markdown'
    ? serializeMarkdownBodyRegion(region).trim()
    : serializePlainTextBodyRegion(region)
  marker.remove()

  const offset = serialized.indexOf(markerText)
  if (offset < 0) return null
  return {
    source: serialized.slice(0, offset) + serialized.slice(offset + markerText.length),
    offset,
  }
}

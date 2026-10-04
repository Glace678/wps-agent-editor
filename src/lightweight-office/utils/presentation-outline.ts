import {
  buildTextIndex,
  type PresentationData,
} from '@aiden0z/pptx-renderer'
import type { PresentationSlideText } from '@/types/presentation'
import { MAX_OUTLINE_SLIDES } from './presentation-viewer-constants'

interface PresentationOutlineSlide {
  title: string
  body: string
}

export function parseOutlineSlides(outline: string): PresentationSlideText[] {
  const slides: PresentationSlideText[] = []
  let current: PresentationSlideText | null = null

  for (const rawLine of outline.replace(/\r\n?/g, '\n').split('\n')) {
    if (!rawLine.trim()) continue
    const trimmed = rawLine.trim()
    const isBody = /^\s+/.test(rawLine) || /^[-*+]\s+/.test(trimmed)
    const value = trimmed.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').trim()
    if (!value) continue

    if (!isBody || !current) {
      current = { title: value, body: '' }
      slides.push(current)
      if (slides.length >= MAX_OUTLINE_SLIDES) break
    } else {
      current.body = current.body ? `${current.body}\n${value}` : value
    }
  }
  return slides
}

function normalizeOutlineText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export function buildPresentationOutline(presentation: PresentationData | null): PresentationOutlineSlide[] {
  if (!presentation) return []

  try {
    const textIndex = buildTextIndex(presentation)

    return presentation.slides.map((slide, slideIndex) => {
      const slidePathPrefix = `slides/${slideIndex}/nodes/`
      const titleNodeIds = new Set(
        slide.nodes
          .filter((node) => ['title', 'ctrTitle'].includes(node.placeholder?.type ?? ''))
          .map((node) => node.id),
      )
      const excludedNodeIds = new Set(
        slide.nodes
          .filter((node) => ['dt', 'ftr', 'sldNum'].includes(node.placeholder?.type ?? ''))
          .map((node) => node.id),
      )
      const entries = textIndex
        .filter((entry) => (
          entry.slideIndex === slideIndex
          && entry.nodePath.startsWith(slidePathPrefix)
          && !excludedNodeIds.has(entry.nodeId)
        ))
        .map((entry) => ({ ...entry, text: normalizeOutlineText(entry.text) }))
        .filter((entry) => entry.text)

      const titleEntry = entries.find((entry) => titleNodeIds.has(entry.nodeId))
      if (titleEntry) {
        return {
          title: titleEntry.text.replace(/\n+/g, ' '),
          body: entries
            .filter((entry) => entry.nodePath !== titleEntry.nodePath)
            .map((entry) => entry.text)
            .join('\n'),
        }
      }

      const [fallbackTitleEntry, ...remainingEntries] = entries
      const [title = '', ...fallbackBody] = fallbackTitleEntry?.text.split('\n') ?? []
      return {
        title,
        body: [...fallbackBody, ...remainingEntries.map((entry) => entry.text)]
          .filter(Boolean)
          .join('\n'),
      }
    })
  } catch (error) {
    console.warn('[PresentationViewer] Unable to build presentation outline:', error)
    return presentation.slides.map(() => ({ title: '', body: '' }))
  }
}

export function mainSlideElement(host: HTMLElement | null): HTMLElement | null {
  const wrapper = host?.firstElementChild
  const slide = wrapper?.firstElementChild
  return slide instanceof HTMLElement ? slide : null
}

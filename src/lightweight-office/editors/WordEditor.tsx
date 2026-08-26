import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { SuperDocEditor } from '@superdoc-dev/react'
import DOMPurify from 'dompurify'
import type { Editor, SuperDocInstance, SuperDocTransactionEvent } from '@superdoc-dev/react'
import { useEditorStore } from '@/stores/editor.store'
import { useAgentStore } from '@/stores/agent.store'
import { useDocumentZoom } from '@/components/layout/modules/DocumentZoom'
import { useTranslation } from '@/lib/i18n/runtime'
import { documentBridge } from '../agent/document-bridge'
import { getExtension, readWordBuffer, saveFileBuffer } from '../utils/file-io'
import { prepareWordBytes, resolveSavePathForWord } from '../utils/doc-compat'
import { loadSystemFontFaces, type SystemFontFace } from '../utils/system-fonts'
import { createFullWordEditorModules } from '../word-toolbar'
import { installWordToolbarTooltipLocalization } from '../word-toolbar-i18n'
import { installWordToolbarOverflowPolicy, type SuperToolbarLike } from '../word-toolbar-overflow'
import { installWordFontPickerSearch } from '../word-font-search'
import { installWordFontSizeApplyOnBlur } from '../word-font-size-input'
import {
  applyWordZoomPreview,
  cancelWordZoomPreview,
  finishWordZoomPreview,
  hasWordZoomPreview,
  holdWordZoomFrame,
  releaseWordZoomFrame,
} from '../utils/word-zoom-preview'
import { WordDocumentLayout } from '../components/WordDocumentLayout'
import { WordAgentOverlay, type WordAgentOverlayVisual } from '../components/WordAgentOverlay'
import {
  WordAlternateView,
  WordViewStatusBar,
  type WordViewMode,
  type WordViewSnapshot,
} from '../components/WordViewStatusBar'
import type { AgentUserDocumentActivity, DocumentEvent, WordPlaybackState } from '@/types/document'

interface WordEditorProps {
  filePath: string
  onReady: () => void
  onDirty: () => void
  onSaveSuccess: () => void
  onRegisterSave: (fn: (() => Promise<void>) | null) => void
}

type WordDocumentNode = ReturnType<Editor['doc']['getNodeById']>['node']
type WordHeadingNode = Extract<WordDocumentNode, { kind: 'heading' }>
type WordInlineNode = WordHeadingNode['heading']['inlines'][number]

function getWordInlineText(inline: WordInlineNode): string {
  switch (inline.kind) {
    case 'run':
      return inline.run.text
    case 'hyperlink':
      return inline.hyperlink.inlines.map(getWordInlineText).join('')
    case 'crossRef':
      return inline.crossRef.resolvedText ?? inline.crossRef.display ?? ''
    case 'citation':
      return inline.citation.displayText ?? ''
    case 'field':
      return inline.field.resultText ?? ''
    case 'tocEntry':
      return inline.tocEntry.text ?? ''
    case 'sdt':
      return inline.sdt.inlines?.map(getWordInlineText).join('') ?? ''
    case 'customXml':
      return inline.customXml.inlines?.map(getWordInlineText).join('') ?? ''
    default:
      return ''
  }
}

function getWordOutlineText(editor: Editor, nodeId: string, summary: string): string {
  if (summary.trim()) return summary
  try {
    const { node } = editor.doc.getNodeById({ nodeId })
    if (node.kind === 'heading') {
      return node.heading.inlines.map(getWordInlineText).join('').trim()
    }
  } catch {
    /* Keep the outline row stable when a stale node ID cannot be resolved. */
  }
  return ''
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function visibleWordPages(root: HTMLElement): number[] {
  const viewport = root.querySelector<HTMLElement>('.superdoc__sub-document') ?? root
  const viewportRect = viewport.getBoundingClientRect()
  return Array.from(root.querySelectorAll<HTMLElement>('.superdoc-page[data-page-index]'))
    .filter((page) => {
      const rect = page.getBoundingClientRect()
      return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
    })
    .map((page) => Number(page.dataset.pageIndex ?? 0) + 1)
    .filter((page) => Number.isFinite(page) && page > 0)
}

function semanticTextChange(before: string, after: string) {
  let start = 0
  const shared = Math.min(before.length, after.length)
  while (start < shared && before.charCodeAt(start) === after.charCodeAt(start)) start += 1
  let beforeEnd = before.length
  let afterEnd = after.length
  while (
    beforeEnd > start
    && afterEnd > start
    && before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)
  ) {
    beforeEnd -= 1
    afterEnd -= 1
  }
  return {
    before: before.slice(start, beforeEnd).slice(0, 2_000),
    after: after.slice(start, afterEnd).slice(0, 2_000),
    contextBefore: before.slice(Math.max(0, start - 120), start),
    contextAfter: before.slice(beforeEnd, Math.min(before.length, beforeEnd + 120)),
  }
}

export function WordEditor({ filePath, onReady, onDirty, onSaveSuccess, onRegisterSave }: WordEditorProps) {
  const { language, t } = useTranslation()
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile)
  const activeAgentRunId = useAgentStore((s) => s.activeRunId)
  const { zoom, settledZoom, setZoomPercent } = useDocumentZoom()
  const instanceRef = useRef<SuperDocInstance | null>(null)
  const [superdocInstance, setSuperdocInstance] = useState<SuperDocInstance | null>(null)
  const [totalPages, setTotalPages] = useState<number | null>(null)
  const savePathRef = useRef(filePath)
  const [document, setDocument] = useState<File | null>(null)
  const [error, setError] = useState<'document' | 'legacy' | null>(null)
  const [showLegacyNotice, setShowLegacyNotice] = useState(false)
  const [loadingMode, setLoadingMode] = useState<'word' | 'legacy'>('word')
  const [wordEditorModules, setWordEditorModules] = useState<ReturnType<typeof createFullWordEditorModules> | null>(null)
  const [wordFontFaces, setWordFontFaces] = useState<SystemFontFace[]>([])
  const isInitializedRef = useRef(false)
  const editorRootRef = useRef<HTMLDivElement | null>(null)
  const [agentVisual, setAgentVisual] = useState<WordAgentOverlayVisual | null>(null)
  const [wordPlayback, setWordPlayback] = useState<WordPlaybackState | null>(null)
  const playbackRef = useRef<WordPlaybackState | null>(null)
  const lastAgentTargetRef = useRef<DocumentEvent | null>(null)
  const programmaticScrollRef = useRef(false)
  const programmaticScrollTimerRef = useRef<number | null>(null)
  const userActivityTimerRef = useRef<number | null>(null)
  const viewportActivityTimerRef = useRef<number | null>(null)
  const selectionActivityTimerRef = useRef<number | null>(null)
  const typingBurstRef = useRef<{
    eventId: string
    before: string
    after: string
    surface?: string
  } | null>(null)
  const lastDocumentTextRef = useRef('')
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null)
  const [viewMode, setViewMode] = useState<WordViewMode>('page')
  const [eyeCare, setEyeCare] = useState(false)
  const [viewSnapshot, setViewSnapshot] = useState<WordViewSnapshot>({ html: '', outline: [] })

  const refreshWordViewSnapshot = useCallback((editor = editorInstance) => {
    if (!editor) return
    try {
      const info = editor.doc.info({})
      const html = DOMPurify.sanitize(editor.doc.getHtml({}), {
        FORBID_TAGS: ['script', 'style'],
      })
      setViewSnapshot({
        html,
        outline: info.outline.map((item) => ({
          level: item.level,
          text: getWordOutlineText(editor, item.nodeId, item.text),
          nodeId: item.nodeId,
        })),
      })
    } catch (err) {
      console.warn('[WordEditor] view snapshot failed:', err)
    }
  }, [editorInstance])

  useEffect(() => {
    if (viewMode !== 'page') refreshWordViewSnapshot()
  }, [refreshWordViewSnapshot, viewMode])

  const locateAgentEvent = useCallback(async (event: DocumentEvent, forceFollow = false) => {
    const root = editorRootRef.current
    const editor = editorInstance
    if (!root || !editor) return
    lastAgentTargetRef.current = event

    const from = event.range?.start.offset ?? event.position?.offset
    const to = event.range?.end?.offset ?? from
    const follows = forceFollow || (event.playback?.followAgent ?? playbackRef.current?.followAgent ?? true)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof from === 'number' && follows && editor.presentationEditor) {
      programmaticScrollRef.current = true
      if (programmaticScrollTimerRef.current !== null) clearTimeout(programmaticScrollTimerRef.current)
      await editor.presentationEditor.scrollToPositionAsync(from, {
        block: 'center',
        behavior: reducedMotion ? 'auto' : 'smooth',
        ifNeeded: false,
        suppressSelectionSyncScroll: true,
      })
      const scroller = root.querySelector<HTMLElement>('.superdoc__sub-document')
      if (scroller) scroller.scrollTop += scroller.clientHeight * 0.1
      programmaticScrollTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false
        programmaticScrollTimerRef.current = null
      }, reducedMotion ? 80 : 650)
      await nextPaint()
    } else if (typeof event.page === 'number' && follows && editor.presentationEditor) {
      programmaticScrollRef.current = true
      await editor.presentationEditor.scrollToPage(event.page, reducedMotion ? 'auto' : 'smooth')
      programmaticScrollTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false
        programmaticScrollTimerRef.current = null
      }, reducedMotion ? 80 : 650)
      await nextPaint()
    } else if (event.blockId && follows && editor.presentationEditor) {
      programmaticScrollRef.current = true
      await editor.presentationEditor.scrollToElement(event.blockId)
      programmaticScrollTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false
        programmaticScrollTimerRef.current = null
      }, reducedMotion ? 80 : 650)
      await nextPaint()
    }

    const rootRect = root.getBoundingClientRect()
    let target: WordAgentOverlayVisual['target'] | null = null
    let fineGrained = false
    if (typeof from === 'number') {
      const rangeRects = editor.presentationEditor?.getRangeRects(
        from,
        Math.max(from + 1, typeof to === 'number' ? to : from + 1),
        root,
      ) ?? []
      if (rangeRects.length > 0) {
        const left = Math.min(...rangeRects.map((rect) => rect.left))
        const top = Math.min(...rangeRects.map((rect) => rect.top))
        const right = Math.max(...rangeRects.map((rect) => rect.right))
        const bottom = Math.max(...rangeRects.map((rect) => rect.bottom))
        target = { left, top, width: Math.max(12, right - left), height: Math.max(18, bottom - top) }
        fineGrained = true
      } else {
        const coords = editor.coordsAtPos(from)
        if (coords) {
          target = {
            left: coords.left - rootRect.left,
            top: coords.top - rootRect.top,
            width: Math.max(12, coords.right - coords.left),
            height: Math.max(18, coords.bottom - coords.top),
          }
          fineGrained = true
        }
      }
    }

    if (!target) {
      const viewport = root.querySelector<HTMLElement>('.superdoc__sub-document') ?? root
      const viewportRect = viewport.getBoundingClientRect()
      const pages = Array.from(root.querySelectorAll<HTMLElement>('.superdoc-page'))
      const requestedPage = typeof event.page === 'number'
        ? root.querySelector<HTMLElement>(`.superdoc-page[data-page-index='${event.page - 1}']`)
        : null
      const page = requestedPage ?? pages
        .filter((candidate) => {
          const rect = candidate.getBoundingClientRect()
          return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
        })
        .sort((a, b) => {
          const middle = viewportRect.top + viewportRect.height * 0.4
          return Math.abs(a.getBoundingClientRect().top - middle) - Math.abs(b.getBoundingClientRect().top - middle)
        })[0]
      const pageRect = page?.getBoundingClientRect()
      target = pageRect
        ? {
            left: pageRect.left - rootRect.left + 14,
            top: pageRect.top - rootRect.top + 14,
            width: Math.max(30, pageRect.width - 28),
            height: Math.max(30, pageRect.height - 28),
          }
        : { left: root.clientWidth * 0.18, top: root.clientHeight * 0.22, width: root.clientWidth * 0.64, height: 44 }
    }

    const eventPhase = event.phase === 'before'
      || event.phase === 'commit'
      || event.phase === 'after'
      || event.phase === 'clear'
      || event.phase === 'locate'
      ? event.phase
      : event.type === 'operation-applied'
        ? 'after'
        : event.type === 'operation-prepared'
          ? 'before'
          : 'locate'
    const agent = useAgentStore.getState().agents.find((candidate) => candidate.id === event.agentId)
    const pointerLeft = Math.max(
      4,
      Math.min(Math.max(4, root.clientWidth - 174), Math.max(8, target.left + Math.min(target.width, 34))),
    )
    const pointerTop = Math.min(root.clientHeight - 48, Math.max(8, target.top + Math.min(target.height, 20)))
    const visual = event.visual ?? 'object-anchor'
    setAgentVisual({
      planId: event.planId,
      stepId: event.stepId,
      agentName: event.agentName || agent?.name || 'Agent',
      agentColor: agent?.color || '#2563eb',
      phase: eventPhase,
      visual,
      pointer: { left: pointerLeft, top: pointerTop },
      target,
      action: ['format', 'paragraph', 'table-cell', 'table-row', 'table-column', 'image', 'page-region', 'object-anchor'].includes(visual)
        ? event.action
        : undefined,
      beforeText: event.beforeText,
      afterText: event.afterText,
      fineGrained,
    })
  }, [editorInstance])

  useEffect(() => {
    const unsubscribe = documentBridge.subscribeDocumentEvents((event: DocumentEvent) => {
      if (event.engine !== 'superdoc') return
      if (event.playback) {
        playbackRef.current = event.playback
        setWordPlayback(event.playback)
      }
      if (event.type === 'playback-started') {
        setAgentVisual((current) => current?.planId === event.planId ? current : null)
      }
      const isPlanStepEvent = Boolean(event.planId && event.stepId)
      const visualEvent = isPlanStepEvent && (
        event.type === 'cursor-moved'
        || event.type === 'operation-prepared'
        || event.type === 'operation-applied'
        || (event.type === 'playback-progress' && event.phase === 'clear')
      )
      if (isPlanStepEvent && event.type === 'operation-applied' && event.visual === 'text-delete') {
        setAgentVisual((current) => current ? { ...current, phase: 'after' } : current)
      } else if (visualEvent) {
        void locateAgentEvent(event)
      }
      if (event.type === 'playback-completed' || event.type === 'run-cancelled') {
        const completedPlanId = event.planId
        window.setTimeout(() => {
          setAgentVisual((current) => current?.planId === completedPlanId ? null : current)
        }, 500)
        window.setTimeout(() => {
          if (playbackRef.current?.planId === completedPlanId) {
            playbackRef.current = null
            setWordPlayback(null)
          }
        }, 1_400)
      }
    })
    return unsubscribe
  }, [locateAgentEvent])

  const buildUserActivity = useCallback((
    kind: AgentUserDocumentActivity['kind'],
    eventId: string = crypto.randomUUID(),
  ): AgentUserDocumentActivity => {
    const root = editorRootRef.current
    const selection = editorInstance?.doc.selection.current({ includeText: true })
    const segments = selection?.target?.segments ?? []
    return {
      eventId,
      runId: useAgentStore.getState().activeRunId ?? undefined,
      documentId: savePathRef.current,
      documentRevision: documentBridge.getState().revision,
      documentApiRevision: editorInstance?.doc.info({}).revision,
      timestamp: Date.now(),
      kind,
      visiblePages: root ? visibleWordPages(root) : [],
      focusedBlockIds: [...new Set(segments.map((segment) => segment.blockId))].slice(0, 50),
      selectionText: selection?.text?.slice(0, 2_000),
      selectionTarget: selection?.target
        ? { ...selection.target, segments: segments.slice(0, 50) }
        : undefined,
    }
  }, [editorInstance])

  const scheduleSelectionActivity = useCallback(() => {
    if (selectionActivityTimerRef.current !== null) clearTimeout(selectionActivityTimerRef.current)
    selectionActivityTimerRef.current = window.setTimeout(() => {
      selectionActivityTimerRef.current = null
      documentBridge.reportUserActivity(buildUserActivity('selection'))
    }, 250)
  }, [buildUserActivity])

  useEffect(() => {
    const root = editorRootRef.current
    if (!root || !editorInstance) return
    const onScroll = () => {
      if (programmaticScrollRef.current || !useAgentStore.getState().activeRunId) return
      if (viewportActivityTimerRef.current !== null) clearTimeout(viewportActivityTimerRef.current)
      viewportActivityTimerRef.current = window.setTimeout(() => {
        viewportActivityTimerRef.current = null
        documentBridge.reportUserActivity(buildUserActivity('viewport'))
      }, 250)
    }
    const onPointerUp = () => {
      if (useAgentStore.getState().activeRunId) scheduleSelectionActivity()
    }
    root.addEventListener('scroll', onScroll, true)
    root.addEventListener('pointerup', onPointerUp, true)
    return () => {
      root.removeEventListener('scroll', onScroll, true)
      root.removeEventListener('pointerup', onPointerUp, true)
    }
  }, [buildUserActivity, editorInstance, scheduleSelectionActivity])

  useEffect(() => {
    if (!activeAgentRunId || !editorInstance) return
    const eventId = crypto.randomUUID()
    const reportViewport = () => documentBridge.reportUserActivity(buildUserActivity('viewport', eventId))
    reportViewport()
    scheduleSelectionActivity()
    const retryTimer = window.setTimeout(() => {
      if (useAgentStore.getState().activeRunId === activeAgentRunId) reportViewport()
    }, 350)
    return () => clearTimeout(retryTimer)
  }, [activeAgentRunId, buildUserActivity, editorInstance, scheduleSelectionActivity])

  useEffect(() => {
    if (activeAgentRunId || !playbackRef.current) return
    setAgentVisual(null)
    playbackRef.current = null
    setWordPlayback(null)
  }, [activeAgentRunId])

  const publishTypingBurst = useCallback((burst: NonNullable<typeof typingBurstRef.current>) => {
    const activity = buildUserActivity('edit', burst.eventId)
    documentBridge.reportUserActivity({
      ...activity,
      ...semanticTextChange(burst.before, burst.after),
    })
  }, [buildUserActivity])

  const handleWordTransaction = useCallback((event: SuperDocTransactionEvent) => {
    let nextText = lastDocumentTextRef.current
    try {
      nextText = event.editor.doc.getText({})
    } catch {
      /* The editor may be closing while a final transaction is emitted. */
    }
    if (!isInitializedRef.current) {
      lastDocumentTextRef.current = nextText
      return
    }
    if (event.transaction.selectionSet && !event.transaction.docChanged && playbackRef.current) {
      scheduleSelectionActivity()
    }
    if (!event.transaction.docChanged || documentBridge.isApplyingAgentMutation()) {
      lastDocumentTextRef.current = nextText
      return
    }

    const before = typingBurstRef.current?.before ?? lastDocumentTextRef.current
    const eventId = typingBurstRef.current?.eventId ?? crypto.randomUUID()
    const burst = { eventId, before, after: nextText, surface: event.surface }
    const isNewBurst = !typingBurstRef.current
    typingBurstRef.current = burst
    if (isNewBurst) publishTypingBurst(burst)
    if (userActivityTimerRef.current !== null) clearTimeout(userActivityTimerRef.current)
    userActivityTimerRef.current = window.setTimeout(() => {
      const completedBurst = typingBurstRef.current
      typingBurstRef.current = null
      userActivityTimerRef.current = null
      if (completedBurst) publishTypingBurst(completedBurst)
    }, 800)
    lastDocumentTextRef.current = nextText
  }, [publishTypingBurst, scheduleSelectionActivity])

  const pauseWordPlayback = useCallback(() => {
    const next = documentBridge.controlWordPlayback({ type: 'pause' })
    if (next) {
      playbackRef.current = next
      setWordPlayback(next)
    }
  }, [])

  const resumeWordPlayback = useCallback(() => {
    const next = documentBridge.controlWordPlayback({ type: 'resume' })
    if (next) {
      playbackRef.current = next
      setWordPlayback(next)
    }
  }, [])

  const locateWordPlayback = useCallback(() => {
    const next = documentBridge.controlWordPlayback({ type: 'locate' })
    if (next) {
      playbackRef.current = next
      setWordPlayback(next)
    }
    if (lastAgentTargetRef.current) void locateAgentEvent(lastAgentTargetRef.current, true)
  }, [locateAgentEvent])

  const skipWordPlaybackAnimations = useCallback(() => {
    const next = documentBridge.controlWordPlayback({ type: 'skip-animations', enabled: true })
    if (next) {
      playbackRef.current = next
      setWordPlayback(next)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadSystemFontFaces(language).then((fontFaces) => {
      if (!cancelled) {
        setWordFontFaces(fontFaces)
        setWordEditorModules(createFullWordEditorModules(fontFaces, language))
      }
    })
    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(
    () => installWordToolbarTooltipLocalization(language),
    [language],
  )

  // 字号框输入后直接点回正文也要生效(SuperDoc 原生只在 Enter/Tab 时提交)
  useEffect(() => installWordFontSizeApplyOnBlur(), [])

  useEffect(() => {
    if (!superdocInstance || wordFontFaces.length === 0) return
    return installWordFontPickerSearch({
      language,
      fontFaces: wordFontFaces,
      placeholder: t('excelEditor.fontSearchPlaceholder'),
      emptyMessage: language === 'zh-CN'
        ? '\u6ca1\u6709\u5339\u914d\u7684\u5b57\u4f53'
        : 'No matching font',
    })
  }, [language, superdocInstance, t, wordFontFaces])

  useEffect(() => {
    let cancelled = false
    setDocument(null)
    setError(null)
    setShowLegacyNotice(false)
    instanceRef.current = null
    setSuperdocInstance(null)
    setEditorInstance(null)
    setAgentVisual(null)
    setWordPlayback(null)
    playbackRef.current = null
    lastAgentTargetRef.current = null
    lastDocumentTextRef.current = ''
    setTotalPages(null)
    setViewMode('page')
    setViewSnapshot({ html: '', outline: [] })
    documentBridge.clear()
    savePathRef.current = resolveSavePathForWord(filePath)

    async function load() {
      const isLegacy = getExtension(filePath) === 'doc'
      try {
        setLoadingMode(isLegacy ? 'legacy' : 'word')
        console.log('[WordEditor] 开始加载文件:', filePath)
        const wordFile = await readWordBuffer(filePath)
        const { buffer } = wordFile
        console.log('[WordEditor] 文件读取成功:', {
          bytes: buffer.byteLength,
          convertedFromLegacy: wordFile.convertedFromLegacy,
          converter: wordFile.converter,
          nativeConversionFailed: wordFile.nativeConversionFailed,
          normalizedLegacyImageCount: wordFile.normalizedLegacyImageCount,
        })
        if (cancelled) return

        const prepared = await prepareWordBytes(filePath, buffer)
        if (cancelled) return

        savePathRef.current = resolveSavePathForWord(filePath)
        setShowLegacyNotice(prepared.fromLegacyDoc)

        const fileBytes = new Uint8Array(prepared.bytes.byteLength)
        fileBytes.set(prepared.bytes)
        setDocument(
          new File([fileBytes.buffer], prepared.displayName, {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        )
      } catch (err) {
        console.error('[WordEditor] 加载错误:', err)
        if (!cancelled) setError(isLegacy ? 'legacy' : 'document')
      }
    }

    load()
    return () => {
      cancelled = true
      if (programmaticScrollTimerRef.current !== null) clearTimeout(programmaticScrollTimerRef.current)
      if (userActivityTimerRef.current !== null) clearTimeout(userActivityTimerRef.current)
      if (viewportActivityTimerRef.current !== null) clearTimeout(viewportActivityTimerRef.current)
      if (selectionActivityTimerRef.current !== null) clearTimeout(selectionActivityTimerRef.current)
      typingBurstRef.current = null
      const inst = instanceRef.current as {
        __wordToolbarResizeCleanup?: () => void
        __wordToolbarOverflowCleanup?: () => void
      } | null
      inst?.__wordToolbarResizeCleanup?.()
      inst?.__wordToolbarOverflowCleanup?.()
      if (inst) {
        delete inst.__wordToolbarResizeCleanup
        delete inst.__wordToolbarOverflowCleanup
      }
      documentBridge.clear()
      onRegisterSave(null)
    }
  }, [filePath, onRegisterSave])

  // 缩放走 SuperDoc 原生 API：外部 CSS zoom 会破坏它的指针坐标换算（无法编辑）
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  // 仅供新实例首帧使用；对象身份保持稳定，避免 wrapper 把它当作配置变更
  const zoomConfig = useMemo(
    () => ({ initial: Math.round(zoomRef.current * 100) }),
    [filePath],
  )

  const previewCleanupFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (!superdocInstance) return
    const root = editorRootRef.current
    if (!root) return

    if (previewCleanupFrameRef.current !== null) {
      cancelAnimationFrame(previewCleanupFrameRef.current)
      previewCleanupFrameRef.current = null
    }

    // 滚轮手势进行中：zoom 与 settledZoom 不同，仅做 GPU 合成层预览
    if (Math.abs(zoom - settledZoom) >= 0.005) {
      applyWordZoomPreview(root, zoom, settledZoom)
      return
    }

    const percent = Math.round(settledZoom * 100)
    let currentSuperdocPercent = 100
    try {
      currentSuperdocPercent = Math.round(superdocInstance.getZoom())
    } catch {
      // fallback
    }
    const hadPreview = hasWordZoomPreview(root)
    const needsSetZoom = currentSuperdocPercent !== percent

    if (!needsSetZoom && !hadPreview) return

    // 即时缩放（快捷键/按钮/预设）无活跃预览时，先建立 CSS 预览桥接：
    // SuperDoc 的 setZoom 内部重排期间文档可能出现一帧空白。预览桥接在
    // 重排期间持续展示正确的视觉缩放，把空白帧遮盖住。
    if (needsSetZoom && !hadPreview) {
      applyWordZoomPreview(
        root,
        settledZoom,
        currentSuperdocPercent > 0 ? currentSuperdocPercent / 100 : settledZoom,
      )
    }

    // 把手势的最后一帧留在原生页面上方。SuperDoc/Chromium 在更换
    // transform 合成层与单双页 DOM 时可能短暂清空原图层，冻结帧
    // 会一直保留到原生页面稳定，因此黑底不会穿出。
    if (hadPreview || needsSetZoom) holdWordZoomFrame(root)

    try {
      if (needsSetZoom) {
        superdocInstance.setZoom(percent)
      }
      // 将预览同步到恒等缩放（scale = settledZoom/settledZoom = 1:1）。
      // 此时 SuperDoc 已开始以目标倍率渲染，预览几何与引擎一致。
      if (hadPreview || needsSetZoom) {
        applyWordZoomPreview(root, settledZoom, settledZoom)
      }
    } catch (err) {
      console.warn('[WordEditor] setZoom 失败:', err)
    }

    if (hadPreview || needsSetZoom) {
      // SuperDoc 的 Vue 响应式更新经微任务 + 渲染帧异步完成。三帧 rAF
      // 确保 Vue DOM 更新与浏览器绘制全部完成后，再撤除预览桥接的 CSS 变量
      // 与容器尺寸覆盖，消除「预览已撤、引擎布局未到」的闪烁空窗。
      previewCleanupFrameRef.current = requestAnimationFrame(() => {
        previewCleanupFrameRef.current = requestAnimationFrame(() => {
          previewCleanupFrameRef.current = requestAnimationFrame(() => {
            previewCleanupFrameRef.current = null
            finishWordZoomPreview(root)
          })
        })
      })
    }
  }, [superdocInstance, settledZoom, zoom])

  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return
    const onUserIntentCapture = (event: Event) => {
      if (
        (event instanceof WheelEvent || event instanceof KeyboardEvent)
        && (event.ctrlKey || event.metaKey)
      ) return
      if (previewCleanupFrameRef.current !== null) {
        cancelAnimationFrame(previewCleanupFrameRef.current)
        previewCleanupFrameRef.current = null
      }
      if (hasWordZoomPreview(root)) {
        finishWordZoomPreview(root)
      }
      releaseWordZoomFrame(root)
    }
    root.addEventListener('pointerdown', onUserIntentCapture, true)
    root.addEventListener('mousedown', onUserIntentCapture, true)
    root.addEventListener('touchstart', onUserIntentCapture, true)
    root.addEventListener('wheel', onUserIntentCapture, true)
    root.addEventListener('keydown', onUserIntentCapture, true)
    return () => {
      root.removeEventListener('pointerdown', onUserIntentCapture, true)
      root.removeEventListener('mousedown', onUserIntentCapture, true)
      root.removeEventListener('touchstart', onUserIntentCapture, true)
      root.removeEventListener('wheel', onUserIntentCapture, true)
      root.removeEventListener('keydown', onUserIntentCapture, true)
      if (previewCleanupFrameRef.current !== null) {
        cancelAnimationFrame(previewCleanupFrameRef.current)
        previewCleanupFrameRef.current = null
      }
      cancelWordZoomPreview(root)
    }
  }, [])

  useEffect(() => {
    onRegisterSave(async () => {
      const instance = instanceRef.current
      if (!instance) return
      const blob = await instance.export({ triggerDownload: false })
      const target = savePathRef.current
      await saveFileBuffer(target, await blob.arrayBuffer())
      // 从 .doc 打开后保存为 .docx，并切换当前路径
      if (target !== filePath) {
        setCurrentFile(target)
      }
      onSaveSuccess()
    })
  }, [filePath, onRegisterSave, onSaveSuccess, setCurrentFile])

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm text-destructive">
        <p className="font-medium">{t('wordEditor.cannotLoad')}</p>
        {error === 'legacy' && (
          <p className="max-w-md text-center text-muted-foreground">
            {t('wordEditor.legacyDocCorrupt')}
          </p>
        )}
      </div>
    )
  }

  if (!document || !wordEditorModules) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {document
          ? t('appShell.loadingSystemFonts')
          : t(loadingMode === 'legacy' ? 'wordEditor.parsingDoc' : 'wordEditor.loading')}
      </div>
    )
  }

  return (
    // 面板不加 transform/contain：transform 会劫持 SuperDoc fixed 定位层的
    // 包含块，contain:paint 会裁掉工具栏 ⋯ 下拉
    <div
      ref={editorRootRef}
      className="word-editor-panel relative h-full min-h-0 w-full flex-1"
      data-word-view-mode={viewMode}
      data-word-eye-care={eyeCare ? 'true' : 'false'}
    >
      {showLegacyNotice && (
        <div className="word-editor-chrome shrink-0 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">
          {t('appShell.legacyDocNotice')}
        </div>
      )}
      <WordDocumentLayout superdoc={superdocInstance} totalPages={totalPages}>
        <SuperDocEditor
          key={`${filePath}:${document.name}:${document.size}`}
          className="min-h-0 flex-1"
          style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}
          contained
          document={document}
          documentMode="editing"
          role="editor"
          // 标尺配置（当前隐藏页面上方标尺，保留代码供后续需要时恢复开启）
          rulers={false}
          zoom={zoomConfig}
          onEditorCreate={({ editor }) => {
            setEditorInstance(editor)
            try {
              lastDocumentTextRef.current = editor.doc.getText({})
            } catch {
              lastDocumentTextRef.current = ''
            }
          }}
          onPaginationUpdate={(event: { totalPages?: number }) => {
            // 构造期回调不会漏掉 onReady 前后的首轮分页事件。
            if (typeof event?.totalPages === 'number' && event.totalPages > 0) {
              setTotalPages(event.totalPages)
            }
          }}
          onZoomChange={(event: { zoom?: number }) => {
            // SuperDoc 工具栏缩放下拉等内部来源回写全局缩放状态
            if (typeof event?.zoom === 'number') setZoomPercent(event.zoom)
          }}
          user={{ name: t('wordEditor.user'), email: 'user@local' }}
          // 完整工具栏；窄宽时剩余按钮经 SuperDoc overflow「⋯」展开
          modules={wordEditorModules}
          onReady={(event) => {
            instanceRef.current = event.superdoc
            setSuperdocInstance(event.superdoc)
            documentBridge.setWord(event.superdoc, savePathRef.current)
            try {
              lastDocumentTextRef.current = (event.superdoc.activeEditor as Editor).doc.getText({})
            } catch {
              /* Initial text will be captured by the first transaction. */
            }
            onReady()
            // 延迟启用 dirty 检测，避免初始化时的更新触发
            setTimeout(() => {
              isInitializedRef.current = true
            }, 500)

            // 溢出策略：窄容器时保留左侧 UI（撤销/重做、缩放、字体字号、格式），
            // 右端项（标尺、格式标记、文档模式等）优先收进「⋯」——覆盖 SuperDoc
            // 内置的「小屏先藏字体字号」降级清单。
            const toolbar = (event.superdoc as { toolbar?: SuperToolbarLike } | null)?.toolbar
            ;(event.superdoc as { __wordToolbarOverflowCleanup?: () => void }).__wordToolbarOverflowCleanup =
              installWordToolbarOverflowPolicy(toolbar)

            // SuperDoc overflow 依赖容器宽度；侧栏收起/拖动改变中栏宽度时
            // 强制重算可见按钮与「⋯」菜单（与 Excel 三点溢出一致）。
            const root = editorRootRef.current
            if (root && toolbar?.onToolbarResize) {
              let resizeFrame: number | null = null
              const timers = new Set<number>()
              const notifyNow = () => {
                try {
                  toolbar.onToolbarResize?.()
                } catch {
                  /* ignore resize races during unmount */
                }
              }
              const scheduleNotify = () => {
                if (resizeFrame !== null) return
                resizeFrame = requestAnimationFrame(() => {
                  resizeFrame = null
                  notifyNow()
                })
              }
              // 首帧布局完成后再量一次（避免 offsetWidth 仍为 0）
              scheduleNotify()
              for (const delay of [50, 200]) {
                const timer = window.setTimeout(() => {
                  timers.delete(timer)
                  scheduleNotify()
                }, delay)
                timers.add(timer)
              }
              const ro = new ResizeObserver(scheduleNotify)
              ro.observe(root)
              // 挂到 instance 上，组件卸载时在 load effect cleanup 之外再拆
              ;(event.superdoc as { __wordToolbarResizeCleanup?: () => void }).__wordToolbarResizeCleanup = () => {
                ro.disconnect()
                if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
                for (const timer of timers) clearTimeout(timer)
                timers.clear()
              }
            }
          }}
          onEditorUpdate={() => {
            if (viewMode !== 'page') refreshWordViewSnapshot()
            if (isInitializedRef.current) {
              onDirty()
            }
          }}
          onTransaction={handleWordTransaction}
          onException={(event) => {
            console.error('[WordEditor] editor exception:', event.error)
            setError(getExtension(filePath) === 'doc' ? 'legacy' : 'document')
          }}
        />
        {viewMode !== 'page' && (
          <WordAlternateView mode={viewMode} snapshot={viewSnapshot} zoom={zoom} />
        )}
      </WordDocumentLayout>
      <WordViewStatusBar
        editorRootRef={editorRootRef}
        eyeCare={eyeCare}
        onEyeCareChange={setEyeCare}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        playback={wordPlayback}
        onPlaybackPause={pauseWordPlayback}
        onPlaybackResume={resumeWordPlayback}
        onPlaybackLocate={locateWordPlayback}
        onPlaybackSkipAnimations={skipWordPlaybackAnimations}
      />
      {viewMode === 'page' && <WordAgentOverlay visual={agentVisual} />}
    </div>
  )
}

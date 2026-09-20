import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import '../../../node_modules/superdoc/dist/style.css'
import '../word-editor.css'
import '../word-color-picker.css'
import { SuperDocEditor } from '@superdoc-dev/react'
import { MousePointer2 } from 'lucide-react'
import DOMPurify from 'dompurify'
import type { Editor, SuperDocInstance } from '@superdoc-dev/react'
import { useEditorStore } from '@/stores/editor.store'
import { useDocumentZoom } from '@/components/layout/modules/DocumentZoom'
import {
  consumeWheelZoomSteps,
  normalizeWheelZoomDelta,
} from '@/components/layout/modules/document-zoom-wheel'
import { useTranslation } from '@/lib/i18n/runtime'
import type { LanguageCode } from '@/lib/i18n'
import { WaitingText } from '@/components/ui/animated-ellipsis'
import { documentBridge } from '../agent/document-bridge'
import { getExtension, readWordBuffer, saveFileBuffer } from '../utils/file-io'
import { prepareWordBytes, resolveSavePathForWord } from '../utils/doc-compat'
import { desktopApi } from '@/platform/desktop'
import { loadSystemFontFaces, type SystemFontFace } from '../utils/system-fonts'
import { createFullWordEditorModules } from '../word-toolbar'
import { installWordToolbarTooltipLocalization } from '../word-toolbar-i18n'
import { installWordToolbarOverflowPolicy, type SuperToolbarLike } from '../word-toolbar-overflow'
import { installWordFontPickerSearch } from '../word-font-search'
import { installWordFontSizeApplyOnBlur } from '../word-font-size-input'
import { installWordTablePicker } from '../word-table-picker'
import { installWordFontColorPicker } from '../word-color-picker'
import { installWordAlignmentPolicy } from '../word-alignment-policy'
import { WordInsertTableDialog } from '../components/WordInsertTableDialog'
import { WordDocumentLayout } from '../components/WordDocumentLayout'
import { WordCaret } from '../components/WordCaret'
import {
  WordAlternateView,
  WordViewStatusBar,
  type WordViewMode,
  type WordViewSnapshot,
} from '../components/WordViewStatusBar'
import type { DocumentEvent } from '@/types/document'

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

const WORD_FONT_EMPTY_TEXTS: Record<LanguageCode, string> = {
  'zh-CN': '没有匹配的字体',
  en: 'No matching font',
  ja: '一致するフォントがありません',
  es: 'No hay fuentes coincidentes',
  pt: 'Nenhuma fonte correspondente',
  de: 'Keine passenden Schriftarten',
  fr: 'Aucune police correspondante',
  ru: 'Шрифты не найдены',
  ar: 'لا توجد خطوط مطابقة',
}

function clampWordPercent(value: number): number {
  return Math.min(500, Math.max(10, Math.round(value)))
}

function findWordScrollContainer(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null
  const subDoc = root.querySelector<HTMLElement>('.superdoc__sub-document')
  if (subDoc) return subDoc
  const pagesHost = root.querySelector<HTMLElement>('.presentation-editor__pages')
  if (pagesHost) {
    let el: HTMLElement | null = pagesHost.parentElement
    while (el && el !== root) {
      const style = window.getComputedStyle(el)
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight
      ) {
        return el
      }
      el = el.parentElement
    }
  }
  return null
}

export function WordEditor({ filePath, onReady, onDirty, onSaveSuccess, onRegisterSave }: WordEditorProps) {
  const { language, t } = useTranslation()
  const setCurrentFile = useEditorStore((s) => s.setCurrentFile)
  const { zoom, setZoomPercent } = useDocumentZoom()
  const instanceRef = useRef<SuperDocInstance | null>(null)
  const [superdocInstance, setSuperdocInstance] = useState<SuperDocInstance | null>(null)
  const [totalPages, setTotalPages] = useState<number | null>(null)
  const savePathRef = useRef(filePath)
  const [document, setDocument] = useState<File | null>(null)
  const [error, setError] = useState<'document' | 'legacy' | null>(null)
  const [errorDetail, setErrorDetail] = useState('')
  const [loadingMode, setLoadingMode] = useState<'word' | 'legacy'>('word')
  const [wordEditorModules, setWordEditorModules] = useState<ReturnType<typeof createFullWordEditorModules> | null>(null)
  const [wordFontFaces, setWordFontFaces] = useState<SystemFontFace[]>([])
  const isInitializedRef = useRef(false)
  const editorRootRef = useRef<HTMLDivElement | null>(null)
  const [agentPointer, setAgentPointer] = useState<{ label: string; left: number; top: number } | null>(null)
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null)
  const [viewMode, setViewMode] = useState<WordViewMode>('page')
  const [eyeCare, setEyeCare] = useState(false)
  const [viewSnapshot, setViewSnapshot] = useState<WordViewSnapshot>({ html: '', outline: [] })
  const [insertTableDialogOpen, setInsertTableDialogOpen] = useState(false)

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

  const locateAgentText = (text: string | undefined): { left: number; top: number } | null => {
    const root = editorRootRef.current
    if (!root || !text) return null
    const rootRect = root.getBoundingClientRect()
    const walker = globalThis.document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let current: Node | null = walker.nextNode()
    while (current) {
      const content = current.textContent ?? ''
      const index = content.indexOf(text)
      if (index >= 0) {
        const range = globalThis.document.createRange()
        range.setStart(current, index)
        range.setEnd(current, index + text.length)
        const rect = range.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          return { left: rect.left - rootRect.left, top: rect.top - rootRect.top }
        }
      }
      current = walker.nextNode()
    }
    return null
  }

  useEffect(() => {
    const unsubscribe = documentBridge.subscribeDocumentEvents((event: DocumentEvent) => {
      if (event.engine !== 'superdoc' || !event.operationId) return
      if (event.type !== 'operation-prepared' && event.type !== 'operation-applied') return
      const located = locateAgentText(event.text)
      const root = editorRootRef.current
      setAgentPointer({
        label: event.agentName || 'Agent',
        left: located?.left ?? (root ? root.clientWidth / 2 : 0),
        top: located?.top ?? (root ? root.clientHeight / 2 : 0),
      })
      window.setTimeout(() => setAgentPointer(null), 1800)
    })
    return unsubscribe
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
      emptyMessage: WORD_FONT_EMPTY_TEXTS[language as LanguageCode] ?? WORD_FONT_EMPTY_TEXTS.en,
    })
  }, [language, superdocInstance, t, wordFontFaces])

  // Word 插入表格下拉网格与“更多行列”弹窗
  useEffect(() => {
    if (!superdocInstance) return
    return installWordTablePicker({
      language,
      getEditor: () => editorInstance || (superdocInstance as { editor?: Editor })?.editor || null,
      onOpenCustomDialog: () => setInsertTableDialogOpen(true),
    })
  }, [editorInstance, language, superdocInstance])

  // Word 对齐方式下拉高对比度状态同步与消除白框
  useEffect(() => {
    if (!superdocInstance) return
    return installWordAlignmentPolicy({
      getEditor: () => editorInstance || (superdocInstance as { editor?: Editor })?.editor || null,
    })
  }, [editorInstance, superdocInstance])

  useEffect(() => {
    let cancelled = false
    setDocument(null)
    setError(null)
    setErrorDetail('')
    instanceRef.current = null
    setSuperdocInstance(null)
    setEditorInstance(null)
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
          normalizedTableCount: wordFile.normalizedTableCount,
          removedUnderlineRunCount: wordFile.removedUnderlineRunCount,
        })
        if (cancelled) return

        const prepared = await prepareWordBytes(filePath, buffer, wordFile.convertedFromLegacy)
        if (cancelled) return

        savePathRef.current = resolveSavePathForWord(filePath)
        const fileBytes = new Uint8Array(prepared.bytes.byteLength)
        fileBytes.set(prepared.bytes)
        setDocument(
          new File([fileBytes.buffer], prepared.displayName, {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        )
      } catch (err) {
        console.error('[WordEditor] 加载错误:', err)
        if (!cancelled) {
          const isMissingConverter = err instanceof Error
            && 'code' in err
            && err.code === 'dependency-missing'
          setErrorDetail(isMissingConverter && err instanceof Error ? err.message : '')
          setError(isLegacy ? 'legacy' : 'document')
        }
      }
    }

    load()
    return () => {
      cancelled = true
      const inst = instanceRef.current as {
        __wordToolbarResizeCleanup?: () => void
        __wordToolbarOverflowCleanup?: () => void
        __wordFontColorPickerCleanup?: () => void
      } | null
      inst?.__wordToolbarResizeCleanup?.()
      inst?.__wordToolbarOverflowCleanup?.()
      inst?.__wordFontColorPickerCleanup?.()
      if (inst) {
        delete inst.__wordToolbarResizeCleanup
        delete inst.__wordToolbarOverflowCleanup
        delete inst.__wordFontColorPickerCleanup
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

  const applyZoomWithAnchor = useCallback(
    (targetPercent: number, anchorCoords?: { x: number; y: number }) => {
      const nextPercent = clampWordPercent(targetPercent)
      const currentPercent = Math.round(zoomRef.current * 100)
      const inst = instanceRef.current ?? superdocInstance

      const root = editorRootRef.current
      const scrollEl = findWordScrollContainer(root)
      const oldZoom = currentPercent / 100
      const nextZoom = nextPercent / 100

      let targetScrollLeft = 0
      let targetScrollTop = 0
      let hasAnchor = false

      if (scrollEl && oldZoom > 0 && nextZoom > 0) {
        const rect = scrollEl.getBoundingClientRect()
        const anchorX = anchorCoords
          ? Math.max(0, Math.min(scrollEl.clientWidth, anchorCoords.x - rect.left))
          : scrollEl.clientWidth / 2
        const anchorY = anchorCoords
          ? Math.max(0, Math.min(scrollEl.clientHeight, anchorCoords.y - rect.top))
          : scrollEl.clientHeight / 2

        const logicalX = (scrollEl.scrollLeft + anchorX) / oldZoom
        const logicalY = (scrollEl.scrollTop + anchorY) / oldZoom

        targetScrollLeft = Math.max(0, Math.round(logicalX * nextZoom - anchorX))
        targetScrollTop = Math.max(0, Math.round(logicalY * nextZoom - anchorY))
        hasAnchor = true
      }

      if (inst) {
        try {
          if (Math.round(inst.getZoom()) !== nextPercent) {
            inst.setZoom(nextPercent)
          }
        } catch (err) {
          console.warn('[WordEditor] setZoom 失败:', err)
        }
      }

      if (hasAnchor && scrollEl) {
        scrollEl.scrollLeft = targetScrollLeft
        scrollEl.scrollTop = targetScrollTop

        // 保持滚动锚定，防止 SuperDoc 异步 selectionSync 将视口拉偏
        requestAnimationFrame(() => {
          if (scrollEl.isConnected) {
            scrollEl.scrollLeft = targetScrollLeft
            scrollEl.scrollTop = targetScrollTop
          }
        })
      }

      setZoomPercent(nextPercent)
    },
    [setZoomPercent, superdocInstance],
  )

  useEffect(() => {
    if (!superdocInstance) return
    const percent = Math.round(zoom * 100)
    if (Math.round(superdocInstance.getZoom()) !== percent) {
      applyZoomWithAnchor(percent)
    }
  }, [superdocInstance, zoom, applyZoomWithAnchor])

  // Word 自管 Ctrl+滚轮以鼠标所指位置为焦点无感缩放
  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return

    let wheelRaf: number | null = null
    let accumulatedDelta = 0
    let lastFlushAt = Number.NEGATIVE_INFINITY
    let lastClientX = 0
    let lastClientY = 0

    const flushWheel = () => {
      wheelRaf = null
      lastFlushAt = performance.now()
      const { steps, remainder } = consumeWheelZoomSteps(accumulatedDelta)
      accumulatedDelta = remainder
      if (steps === 0) return

      const currentPercent = Math.round(zoomRef.current * 100)
      const nextPercent = clampWordPercent(currentPercent - steps * 10)
      if (nextPercent !== currentPercent) {
        applyZoomWithAnchor(nextPercent, { x: lastClientX, y: lastClientY })
      }
    }

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      e.stopPropagation()

      const delta = normalizeWheelZoomDelta(e.deltaY, e.deltaMode)
      if (delta === 0) return

      lastClientX = e.clientX
      lastClientY = e.clientY
      accumulatedDelta += delta

      if (wheelRaf === null) {
        const wait = 16 - (performance.now() - lastFlushAt)
        if (wait <= 0) {
          wheelRaf = requestAnimationFrame(flushWheel)
        } else {
          wheelRaf = window.setTimeout(() => {
            wheelRaf = requestAnimationFrame(flushWheel)
          }, wait) as unknown as number
        }
      }
    }

    root.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      root.removeEventListener('wheel', onWheel)
      if (wheelRaf !== null) cancelAnimationFrame(wheelRaf)
    }
  }, [applyZoomWithAnchor])

  // Word 自管快捷键（Ctrl+=, Ctrl+-, Ctrl+0）以视口中心为焦点平稳缩放
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const isZoomIn = e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd'
      const isZoomOut = e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract'
      const isZoomReset = e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0'

      if (isZoomIn) {
        e.preventDefault()
        e.stopPropagation()
        const currentPercent = Math.round(zoomRef.current * 100)
        applyZoomWithAnchor(clampWordPercent(currentPercent + 10))
        return
      }
      if (isZoomOut) {
        e.preventDefault()
        e.stopPropagation()
        const currentPercent = Math.round(zoomRef.current * 100)
        applyZoomWithAnchor(clampWordPercent(currentPercent - 10))
        return
      }
      if (isZoomReset) {
        e.preventDefault()
        e.stopPropagation()
        applyZoomWithAnchor(100)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [applyZoomWithAnchor])

  /**
   * Word 表格拖动调整大小后的撤销/重做修复。
   *
   * SuperDoc 的 TableResizeOverlay 通过 ProseMirror transaction 提交列宽变化，
   * 理论上应自动进入历史栈。但在某些场景（表格首次调整、跨插件 transaction
   * 合并、addToHistory 元信息丢失）下 Ctrl+Z 可能无法回退列宽变化。
   *
   * 修复策略：
   *  1. 在 Word 编辑区域捕获 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z，显式调用
   *     editor.commands.undo / redo，确保快捷键能驱动真正的 PM 历史。
   *  2. 兜底：如果 editor.commands 上没有 undo（SuperDoc 版本差异），
   *     则用 document.execCommand('undo') 走 contentEditable 原生历史，
   *     保证至少粗粒度的撤销仍然可用。
   */
  useEffect(() => {
    if (!editorInstance || !superdocInstance) return

    const root = editorRootRef.current
    if (!root) return

    const isInsideEditor = (target: EventTarget | null): boolean => {
      if (!(target instanceof Node)) return false
      return root.contains(target)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (!isInsideEditor(e.target)) return

      const isUndo = e.key === 'z' || e.key === 'Z'
      const isRedo = (e.key === 'y' || e.key === 'Y')
        || ((e.key === 'z' || e.key === 'Z') && e.shiftKey)

      if (!isUndo && !isRedo) return

      const cmds = (editorInstance as { commands?: Record<string, unknown> }).commands
        ?? (superdocInstance as { editor?: { commands?: Record<string, unknown> } }).editor?.commands

      if (cmds && typeof cmds === 'object') {
        const cmdName = isUndo ? 'undo' : 'redo'
        const fn = (cmds as Record<string, unknown>)[cmdName]
        if (typeof fn === 'function') {
          e.preventDefault()
          e.stopPropagation()
          try {
            fn.call(cmds)
          } catch {
            globalThis.document.execCommand(isUndo ? 'undo' : 'redo')
          }
          return
        }
      }

      // 兜底：走原生 contentEditable undo
      e.preventDefault()
      e.stopPropagation()
      globalThis.document.execCommand(isUndo ? 'undo' : 'redo')
    }

    root.addEventListener('keydown', onKeyDown, true)
    return () => root.removeEventListener('keydown', onKeyDown, true)
  }, [editorInstance, superdocInstance])

  useEffect(() => {
    onRegisterSave(async () => {
      const instance = instanceRef.current
      if (!instance) return
      const blob = await instance.export({ triggerDownload: false })
      let target = savePathRef.current
      if (!desktopApi.files.getGrantId(target)) {
        const defaultName = target.split(/[/\\]/).pop() || 'document.docx'
        const selected = await desktopApi.files.selectSaveFile(defaultName)
        if (!selected) return
        target = selected.path
        savePathRef.current = target
      }
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
        {errorDetail && (
          <p className="max-w-md break-words text-center text-xs text-muted-foreground">
            {errorDetail}
          </p>
        )}
      </div>
    )
  }

  if (!document || !wordEditorModules) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <WaitingText
          text={
            document
              ? t('appShell.loadingSystemFonts')
              : t(loadingMode === 'legacy' ? 'wordEditor.parsingDoc' : 'wordEditor.loading')
          }
        />
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
      data-manages-document-zoom
    >
      <WordDocumentLayout superdoc={superdocInstance} totalPages={totalPages}>
        <SuperDocEditor
          key={`${filePath}:${document.name}:${document.size}`}
          className="min-h-0 flex-1"
          style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}
          contained
          document={document}
          documentMode="editing"
          role="editor"
          zoom={zoomConfig}
          onEditorCreate={({ editor }) => {
            setEditorInstance(editor)
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
            onReady()
            // 延迟启用 dirty 检测，避免初始化时的更新触发
            setTimeout(() => {
              isInitializedRef.current = true
            }, 500)

            // 溢出策略：窄容器时保留左侧 UI（撤销/重做、缩放、字体字号、格式），
            // 右端项（格式标记、文档模式等）优先收进「⋯」——覆盖 SuperDoc
            // 内置的「小屏先藏字体字号」降级清单。
            const toolbar = (event.superdoc as { toolbar?: SuperToolbarLike } | null)?.toolbar
            ;(event.superdoc as { __wordToolbarOverflowCleanup?: () => void }).__wordToolbarOverflowCleanup =
              installWordToolbarOverflowPolicy(toolbar)

            // SuperDoc 默认颜色网格只有 7 列，且色值与 Excel 不一致。
            // 将渲染选项替换为 Excel 8×8 调色盘，并沿用 SuperToolbar 的
            // emitCommand 路径，确保选区、撤销栈和修订模式保持一致。
            ;(event.superdoc as { __wordFontColorPickerCleanup?: () => void }).__wordFontColorPickerCleanup =
              installWordFontColorPicker({
                toolbar,
                root: editorRootRef.current,
                language,
                getEditor: () => editorInstance || (event.superdoc as { editor?: Editor })?.editor || null,
              })

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
              documentBridge.markUserEdit()
              onDirty()
            }
          }}
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
      />
      <WordCaret
        editorRootRef={editorRootRef}
        editor={editorInstance}
        superdoc={superdocInstance}
        viewMode={viewMode}
        zoom={zoom}
      />
      {viewMode === 'page' && agentPointer && (
        <div
          className="pointer-events-none absolute z-30"
          style={{ left: agentPointer.left, top: agentPointer.top }}
          data-testid="agent-live-word-cursor"
        >
          <MousePointer2 className="absolute -left-1 -top-1 h-4 w-4 fill-fuchsia-500 text-fuchsia-700 drop-shadow" />
          <span className="absolute left-1 top-0 whitespace-nowrap rounded bg-fuchsia-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
            {agentPointer.label}
          </span>
        </div>
      )}
      <WordInsertTableDialog
        open={insertTableDialogOpen}
        onClose={() => setInsertTableDialogOpen(false)}
        onInsert={(rows, cols) => {
          const editor = editorInstance || (superdocInstance as { editor?: Editor })?.editor
          if (editor) {
            try {
              if (typeof (editor.commands as Record<string, unknown>)?.insertTable === 'function') {
                ;(editor.commands as Record<string, (args: { rows: number; cols: number }) => boolean>).insertTable({ rows, cols })
              } else if (typeof (editor as unknown as { chain?: () => { insertTable?: (args: { rows: number; cols: number }) => { run: () => boolean } } }).chain === 'function') {
                ;(editor as unknown as { chain: () => { insertTable: (args: { rows: number; cols: number }) => { run: () => boolean } } }).chain().insertTable({ rows, cols }).run()
              }
            } catch (err) {
              console.warn('[WordEditor] insertTable failed:', err)
            }
          }
        }}
      />
    </div>
  )
}

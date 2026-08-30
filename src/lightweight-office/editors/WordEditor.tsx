import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import '../../../node_modules/superdoc/dist/style.css'
import '../word-editor.css'
import { SuperDocEditor } from '@superdoc-dev/react'
import { MousePointer2 } from 'lucide-react'
import DOMPurify from 'dompurify'
import type { Editor, SuperDocInstance } from '@superdoc-dev/react'
import { useEditorStore } from '@/stores/editor.store'
import { useDocumentZoom } from '@/components/layout/modules/DocumentZoom'
import { useTranslation } from '@/lib/i18n/runtime'
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
import { WordDocumentLayout } from '../components/WordDocumentLayout'
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
  const [isZooming, setIsZooming] = useState(false)
  const zoomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      emptyMessage: language === 'zh-CN'
        ? '\u6ca1\u6709\u5339\u914d\u7684\u5b57\u4f53'
        : 'No matching font',
    })
  }, [language, superdocInstance, t, wordFontFaces])

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

  useEffect(() => {
    if (!superdocInstance) return
    const percent = Math.round(zoom * 100)
    try {
      if (Math.round(superdocInstance.getZoom()) !== percent) {
        superdocInstance.setZoom(percent)
      }
    } catch (err) {
      console.warn('[WordEditor] setZoom 失败:', err)
    }
  }, [superdocInstance, zoom])

  // 缩放期间给页面宿主加上 will-change，缓解末尾闪烁；延迟 280ms 移除。
  useEffect(() => {
    setIsZooming(true)
    if (zoomingTimerRef.current) clearTimeout(zoomingTimerRef.current)
    zoomingTimerRef.current = setTimeout(() => setIsZooming(false), 280)
    return () => {
      if (zoomingTimerRef.current) clearTimeout(zoomingTimerRef.current)
    }
  }, [zoom])

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
      data-word-zooming={isZooming ? 'true' : 'false'}
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
    </div>
  )
}

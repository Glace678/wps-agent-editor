import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { SuperDocEditor } from '@superdoc-dev/react'
import type { SuperDocInstance } from '@superdoc-dev/react'
import { useEditorStore } from '@/stores/editor.store'
import { useDocumentZoom } from '@/components/layout/modules/DocumentZoom'
import { useTranslation } from '@/lib/i18n/runtime'
import { documentBridge } from '../agent/document-bridge'
import { getExtension, readFileBuffer, saveFileBuffer } from '../utils/file-io'
import { prepareWordBytes, resolveSavePathForWord } from '../utils/doc-compat'
import { loadSystemFontFaces } from '../utils/system-fonts'
import { createFullWordEditorModules } from '../word-toolbar'
import { installWordToolbarOverflowPolicy, type SuperToolbarLike } from '../word-toolbar-overflow'
import { WordDocumentLayout } from '../components/WordDocumentLayout'

interface WordEditorProps {
  filePath: string
  onReady: () => void
  onDirty: () => void
  onSaveSuccess: () => void
  onRegisterSave: (fn: (() => Promise<void>) | null) => void
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
  const [showLegacyNotice, setShowLegacyNotice] = useState(false)
  const [loadingMode, setLoadingMode] = useState<'word' | 'legacy'>('word')
  const [wordEditorModules, setWordEditorModules] = useState<ReturnType<typeof createFullWordEditorModules> | null>(null)
  const isInitializedRef = useRef(false)
  const editorRootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadSystemFontFaces(language).then((fontFaces) => {
      if (!cancelled) setWordEditorModules(createFullWordEditorModules(fontFaces))
    })
    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(() => {
    let cancelled = false
    setDocument(null)
    setError(null)
    setShowLegacyNotice(false)
    instanceRef.current = null
    setSuperdocInstance(null)
    setTotalPages(null)
    documentBridge.clear()
    savePathRef.current = resolveSavePathForWord(filePath)

    async function load() {
      const isLegacy = getExtension(filePath) === 'doc'
      try {
        setLoadingMode(isLegacy ? 'legacy' : 'word')
        console.log('[WordEditor] 开始加载文件:', filePath)
        const buffer = await readFileBuffer(filePath)
        console.log('[WordEditor] 文件读取成功，大小:', buffer.byteLength, 'bytes')
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
      const inst = instanceRef.current as {
        __wordToolbarResizeObserver?: ResizeObserver
        __wordToolbarOverflowCleanup?: () => void
      } | null
      inst?.__wordToolbarResizeObserver?.disconnect()
      inst?.__wordToolbarOverflowCleanup?.()
      if (inst) {
        delete inst.__wordToolbarResizeObserver
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

  // 总页数用于 WordDocumentLayout 的对开门槛（大文档不自动进对开，
  // 因为 SuperDoc 离开 vertical 后会永久关闭页面虚拟化）
  useEffect(() => {
    if (!superdocInstance) return
    const emitter = superdocInstance as unknown as {
      on?: (event: string, handler: (payload: { totalPages?: number }) => void) => void
      off?: (event: string, handler: (payload: { totalPages?: number }) => void) => void
    }
    const handler = (payload: { totalPages?: number }) => {
      if (typeof payload?.totalPages === 'number' && payload.totalPages > 0) {
        setTotalPages(payload.totalPages)
      }
    }
    emitter.on?.('pagination-update', handler)
    return () => emitter.off?.('pagination-update', handler)
  }, [superdocInstance])

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
          // 标尺默认开启，与完整 Word 编辑体验一致
          rulers
          zoom={zoomConfig}
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
            // 右端项（标尺、格式标记、文档模式等）优先收进「⋯」——覆盖 SuperDoc
            // 内置的「小屏先藏字体字号」降级清单。
            const toolbar = (event.superdoc as { toolbar?: SuperToolbarLike } | null)?.toolbar
            ;(event.superdoc as { __wordToolbarOverflowCleanup?: () => void }).__wordToolbarOverflowCleanup =
              installWordToolbarOverflowPolicy(toolbar)

            // SuperDoc overflow 依赖容器宽度；侧栏收起/拖动改变中栏宽度时
            // 强制重算可见按钮与「⋯」菜单（与 Excel 三点溢出一致）。
            const root = editorRootRef.current
            if (root && toolbar?.onToolbarResize) {
              const notify = () => {
                try {
                  toolbar.onToolbarResize?.()
                } catch {
                  /* ignore resize races during unmount */
                }
              }
              // 首帧布局完成后再量一次（避免 offsetWidth 仍为 0）
              requestAnimationFrame(() => {
                notify()
                window.setTimeout(notify, 50)
                window.setTimeout(notify, 200)
              })
              const ro = new ResizeObserver(() => notify())
              ro.observe(root)
              const toolbarEl = root.querySelector('.superdoc-toolbar-container, .superdoc-toolbar')
              if (toolbarEl instanceof HTMLElement) ro.observe(toolbarEl)
              // 挂到 instance 上，组件卸载时在 load effect cleanup 之外再拆
              ;(event.superdoc as { __wordToolbarResizeObserver?: ResizeObserver }).__wordToolbarResizeObserver = ro
            }
          }}
          onEditorUpdate={() => {
            if (isInitializedRef.current) {
              onDirty()
            }
          }}
          onException={(event) => {
            console.error('[WordEditor] editor exception:', event.error)
            setError(getExtension(filePath) === 'doc' ? 'legacy' : 'document')
          }}
        />
      </WordDocumentLayout>
    </div>
  )
}

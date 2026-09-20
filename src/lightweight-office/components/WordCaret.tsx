import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import type { Editor, SuperDocInstance } from '@superdoc-dev/react'

export interface WordCaretProps {
  editorRootRef: RefObject<HTMLElement | null>
  editor: Editor | null
  superdoc: SuperDocInstance | null
  viewMode: string
  zoom?: number
}

interface CaretRect {
  left: number
  top: number
  height: number
  visible: boolean
}

/**
 * WPS / Microsoft Word 风格的文档输入光标（纯黑、慢速持续闪烁、打字即时实心响应）。
 * 解决浏览器原生 caret 在闲置 5 秒后停止闪烁、闪烁生硬以及颜色不够纯黑的问题。
 */
export function WordCaret({
  editorRootRef,
  editor,
  superdoc,
  viewMode,
  zoom,
}: WordCaretProps) {
  const [caretRect, setCaretRect] = useState<CaretRect>({
    left: 0,
    top: 0,
    height: 0,
    visible: false,
  })
  const [isTyping, setIsTyping] = useState(false)
  const typingTimerRef = useRef<number | null>(null)
  const animKeyRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)

  const measureCaretPosition = useCallback((): CaretRect => {
    const root = editorRootRef.current
    if (!root || viewMode !== 'page') {
      return { left: 0, top: 0, height: 0, visible: false }
    }

    const proseMirror = root.querySelector<HTMLElement>('.ProseMirror')
    if (!proseMirror) {
      return { left: 0, top: 0, height: 0, visible: false }
    }

    // 检查焦点是否在编辑器内（包括 ProseMirror 自身及其子节点）
    const activeEl = document.activeElement
    const isFocused =
      proseMirror.contains(activeEl) ||
      proseMirror.classList.contains('ProseMirror-focused') ||
      activeEl?.closest('.word-editor-panel') === root

    if (!isFocused) {
      return { left: 0, top: 0, height: 0, visible: false }
    }

    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      return { left: 0, top: 0, height: 0, visible: false }
    }

    const rootRect = root.getBoundingClientRect()

    // 优先：尝试通过 ProseMirror EditorView.coordsAtPos 获取高精度字形坐标
    try {
      const view =
        (editor as unknown as { view?: { coordsAtPos?: (pos: number) => { top: number; bottom: number; left: number; right: number }; state?: { selection?: { from: number } } } })?.view ||
        (superdoc as unknown as { activeEditor?: { view?: { coordsAtPos?: (pos: number) => { top: number; bottom: number; left: number; right: number }; state?: { selection?: { from: number } } } } })?.activeEditor?.view

      const pos = view?.state?.selection?.from
      if (typeof pos === 'number' && typeof view?.coordsAtPos === 'function') {
        const coords = view.coordsAtPos(pos)
        if (
          coords &&
          Number.isFinite(coords.top) &&
          Number.isFinite(coords.left) &&
          coords.bottom > coords.top
        ) {
          const height = Math.max(14, coords.bottom - coords.top)
          return {
            left: Math.round(coords.left - rootRect.left),
            top: Math.round(coords.top - rootRect.top),
            height: Math.round(height),
            visible: true,
          }
        }
      }
    } catch {
      /* fallback to DOM Range measurement */
    }

    // 次选：通过 DOM Range getBoundingClientRect / getClientRects 测量
    try {
      const range = sel.getRangeAt(0)
      if (!proseMirror.contains(range.startContainer)) {
        return { left: 0, top: 0, height: 0, visible: false }
      }

      const rects = range.getClientRects()
      const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect()

      if (rect && rect.height > 0) {
        return {
          left: Math.round(rect.left - rootRect.left),
          top: Math.round(rect.top - rootRect.top),
          height: Math.round(rect.height),
          visible: true,
        }
      }

      // 兜底：处理空行/段落起始等 rect.height 为 0 的场景
      const container =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? (range.startContainer as HTMLElement)
          : range.startContainer.parentElement

      if (container && proseMirror.contains(container)) {
        const cRect = container.getBoundingClientRect()
        const computed = window.getComputedStyle(container)
        const fontSize = parseFloat(computed.fontSize) || 16
        const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.2
        return {
          left: Math.round((rect.left || cRect.left) - rootRect.left),
          top: Math.round((rect.top || cRect.top) - rootRect.top),
          height: Math.round(Math.max(14, lineHeight)),
          visible: true,
        }
      }
    } catch {
      /* ignore DOM measurement errors */
    }

    return { left: 0, top: 0, height: 0, visible: false }
  }, [editor, editorRootRef, superdoc, viewMode])

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current !== null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      const measured = measureCaretPosition()
      setCaretRect((prev) => {
        if (
          prev.left === measured.left &&
          prev.top === measured.top &&
          prev.height === measured.height &&
          prev.visible === measured.visible
        ) {
          return prev
        }
        return measured
      })
    })
  }, [measureCaretPosition])

  const triggerTypingState = useCallback(() => {
    setIsTyping(true)
    animKeyRef.current += 1
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current)
    }
    typingTimerRef.current = window.setTimeout(() => {
      setIsTyping(false)
      typingTimerRef.current = null
    }, 450)
    scheduleUpdate()
  }, [scheduleUpdate])

  // 监听选区、滚动、输入、焦点、点击等事件
  useEffect(() => {
    const root = editorRootRef.current
    if (!root || viewMode !== 'page') return

    const onSelectionChange = () => {
      scheduleUpdate()
    }

    const onKeyDown = () => {
      triggerTypingState()
    }

    const onInput = () => {
      triggerTypingState()
    }

    const onPointerDown = () => {
      triggerTypingState()
    }

    const onScroll = () => {
      scheduleUpdate()
    }

    const onFocus = () => {
      triggerTypingState()
    }

    const onBlur = () => {
      scheduleUpdate()
    }

    document.addEventListener('selectionchange', onSelectionChange)
    root.addEventListener('keydown', onKeyDown, { capture: true, passive: true })
    root.addEventListener('input', onInput, { capture: true, passive: true })
    root.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    root.addEventListener('focusin', onFocus, { capture: true, passive: true })
    root.addEventListener('focusout', onBlur, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', scheduleUpdate, { passive: true })

    scheduleUpdate()

    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      root.removeEventListener('keydown', onKeyDown, true)
      root.removeEventListener('input', onInput, true)
      root.removeEventListener('pointerdown', onPointerDown, true)
      root.removeEventListener('focusin', onFocus, true)
      root.removeEventListener('focusout', onBlur, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', scheduleUpdate)
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
  }, [editorRootRef, scheduleUpdate, triggerTypingState, viewMode, zoom])

  // 当自定义光标可见时，在 root 上设置 data-wps-caret-active 属性，以便 CSS 隐藏原生 caret 避免重影
  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return
    if (caretRect.visible) {
      root.setAttribute('data-wps-caret-active', 'true')
    } else {
      root.removeAttribute('data-wps-caret-active')
    }
  }, [caretRect.visible, editorRootRef])

  if (!caretRect.visible || viewMode !== 'page') {
    return null
  }

  const style: CSSProperties = {
    position: 'absolute',
    left: `${caretRect.left}px`,
    top: `${caretRect.top}px`,
    height: `${caretRect.height}px`,
    width: '1.5px',
    pointerEvents: 'none',
    zIndex: 25,
  }

  return (
    <div
      key={`wps-caret-${animKeyRef.current}`}
      className={`wps-word-caret ${isTyping ? 'wps-word-caret--typing' : ''}`}
      style={style}
      data-testid="wps-word-caret"
    />
  )
}

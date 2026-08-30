import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { APP_THEME_EVENT } from '@/lib/theme'
import { fileHoverCardBoxShadow } from './file-hover-card-styles'

export { fileHoverCardBoxShadow } from './file-hover-card-styles'

export interface FileHoverCardProps {
  /** 触发区域（通常是列表行按钮） */
  children: ReactNode
  /** 弹层内容 */
  content: ReactNode
  /** 打开延迟 ms */
  openDelay?: number
  /** 关闭延迟 ms */
  closeDelay?: number
  /** 为 true 时不弹出并立即收起（如右键菜单打开期间） */
  disabled?: boolean
  className?: string
}

interface Coords {
  top: number
  left: number
  placement: 'right' | 'left' | 'bottom' | 'top'
}

const GAP = 10
const VIEW_PAD = 8

function readDocumentIsDark(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark')
}

/**
 * 文件/文件夹悬停信息卡（浏览列表、最近列表共用）。
 *
 * 不用 Radix Tooltip / transform 定位：系统 WebView 中带 transform 的层
 * 偶发只绘出上/下半边框。这里用 position:fixed 的 top/left 像素定位，
 * 并用 box-shadow 画完整描边（比 border 在合成层上更稳）。
 * 描边颜色：白天黑、暗夜白。
 */
export function FileHoverCard({
  children,
  content,
  openDelay = 280,
  closeDelay = 80,
  disabled = false,
  className,
}: FileHoverCardProps) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardId = useId()

  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)
  const [isDark, setIsDark] = useState(readDocumentIsDark)

  const clearTimers = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const measure = useCallback(() => {
    const trigger = triggerRef.current
    const card = cardRef.current
    if (!trigger || !card) return

    const t = trigger.getBoundingClientRect()
    const c = card.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // 优先右侧；不够则左侧；再不行放下方/上方
    let placement: Coords['placement'] = 'right'
    let left = t.right + GAP
    let top = t.top + t.height / 2 - c.height / 2

    if (left + c.width + VIEW_PAD > vw) {
      placement = 'left'
      left = t.left - GAP - c.width
    }
    if (left < VIEW_PAD) {
      placement = 'bottom'
      left = Math.min(Math.max(VIEW_PAD, t.left), vw - c.width - VIEW_PAD)
      top = t.bottom + GAP
      if (top + c.height + VIEW_PAD > vh) {
        placement = 'top'
        top = t.top - GAP - c.height
      }
    }

    top = Math.min(Math.max(VIEW_PAD, top), Math.max(VIEW_PAD, vh - c.height - VIEW_PAD))
    left = Math.min(Math.max(VIEW_PAD, left), Math.max(VIEW_PAD, vw - c.width - VIEW_PAD))

    setCoords({ top, left, placement })
  }, [])

  const show = useCallback(() => {
    if (disabled) return
    clearTimers()
    openTimer.current = setTimeout(() => setOpen(true), openDelay)
  }, [clearTimers, disabled, openDelay])

  const hide = useCallback(() => {
    clearTimers()
    closeTimer.current = setTimeout(() => {
      setOpen(false)
      setCoords(null)
    }, closeDelay)
  }, [clearTimers, closeDelay])

  useLayoutEffect(() => {
    if (!open) return
    measure()
    // 下一帧再量一次，确保内容布局完成
    const id = requestAnimationFrame(() => measure())
    return () => cancelAnimationFrame(id)
  }, [open, content, measure])

  useEffect(() => {
    if (!open) return
    const onReposition = () => measure()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, measure])

  useEffect(() => () => clearTimers(), [clearTimers])

  useEffect(() => {
    if (!disabled) return
    clearTimers()
    setOpen(false)
    setCoords(null)
  }, [disabled, clearTimers])

  // Keep outline color in sync with app theme (class on <html>).
  useEffect(() => {
    const sync = () => setIsDark(readDocumentIsDark())
    sync()
    window.addEventListener(APP_THEME_EVENT, sync)
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      window.removeEventListener(APP_THEME_EVENT, sync)
      observer.disconnect()
    }
  }, [])

  const card =
    open &&
    createPortal(
      <div
        ref={cardRef}
        id={cardId}
        role="tooltip"
        data-theme={isDark ? 'dark' : 'light'}
        style={{
          position: 'fixed',
          top: coords ? coords.top : -9999,
          left: coords ? coords.left : -9999,
          // 首帧不可见测量，避免闪在 (0,0)
          visibility: coords ? 'visible' : 'hidden',
          zIndex: 2147483000,
          maxWidth: 380,
          minWidth: 180,
          padding: '12px 16px',
          borderRadius: 12,
          backgroundColor: 'hsl(var(--card))',
          color: 'hsl(var(--card-foreground))',
          // 全局 * { border-color } 可能干扰；显式关掉 CSS border
          border: 'none',
          outline: 'none',
          // 完整描边用 box-shadow（WebView 对 border+transform 半绘更稳）
          // 白天黑框 / 暗夜白框
          boxShadow: fileHoverCardBoxShadow(isDark),
          transform: 'none',
          willChange: 'auto',
          WebkitFontSmoothing: 'antialiased',
          // 纯展示弹层，指针事件穿透到底下的列表行：
          // 窗口较窄时弹层会落在下一行上方，不能挡住复选框多选/单击
          pointerEvents: 'none',
          boxSizing: 'border-box',
          overflow: 'visible',
        }}
      >
        <div style={{ fontSize: 14.5, lineHeight: 1.5, wordBreak: 'break-word' }}>
          {content}
        </div>
      </div>,
      document.body,
    )

  return (
    <>
      <div
        ref={triggerRef}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? cardId : undefined}
      >
        {children}
      </div>
      {card}
    </>
  )
}

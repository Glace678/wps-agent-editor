import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/runtime'
import { ResizeHandle } from './ResizeHandle'
import {
  COLLAPSED_PANEL_WIDTH,
  DEFAULT_LEFT_WIDTH,
  DEFAULT_RIGHT_WIDTH,
  MIN_CENTER_WIDTH,
  MIN_LEFT_WIDTH,
  MIN_RIGHT_WIDTH,
  PANEL_COLLAPSE_STORAGE_KEY,
  PANEL_STORAGE_KEY,
  RESIZE_HANDLE_WIDTH,
} from './constants'

interface PanelSizes {
  left: number
  right: number
}

interface CollapseState {
  left: boolean
  right: boolean
}

function loadSizes(): PanelSizes {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY)
    if (!raw) return { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH }
    const parsed = JSON.parse(raw) as Partial<PanelSizes>
    return {
      left: Math.max(MIN_LEFT_WIDTH, parsed.left ?? DEFAULT_LEFT_WIDTH),
      right: Math.max(MIN_RIGHT_WIDTH, parsed.right ?? DEFAULT_RIGHT_WIDTH),
    }
  } catch {
    return { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH }
  }
}

function loadCollapse(): CollapseState {
  try {
    const raw = localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY)
    if (!raw) return { left: false, right: false }
    const parsed = JSON.parse(raw) as Partial<CollapseState>
    return {
      left: Boolean(parsed.left),
      right: Boolean(parsed.right),
    }
  } catch {
    return { left: false, right: false }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export interface SidebarCollapseControls {
  collapseLeft: () => void
  collapseRight: () => void
  leftCollapsed: boolean
  rightCollapsed: boolean
}

interface ResizableThreeColumnLayoutProps {
  left: ReactNode | ((controls: SidebarCollapseControls) => ReactNode)
  center: ReactNode
  right: ReactNode | ((controls: SidebarCollapseControls) => ReactNode)
}

export function ResizableThreeColumnLayout({ left, center, right }: ResizableThreeColumnLayoutProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const leftPanelRef = useRef<HTMLElement>(null)
  const rightPanelRef = useRef<HTMLElement>(null)
  const centerPanelRef = useRef<HTMLElement>(null)
  const activeResizeCleanupRef = useRef<(() => void) | null>(null)
  const [sizes, setSizes] = useState<PanelSizes>(loadSizes)
  const [collapsed, setCollapsed] = useState<CollapseState>(loadCollapse)
  const [isAnimating, setIsAnimating] = useState(false)
  const sizesRef = useRef(sizes)
  const collapsedRef = useRef(collapsed)
  sizesRef.current = sizes
  collapsedRef.current = collapsed

  const persistSizes = useCallback((next: PanelSizes) => {
    localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(next))
  }, [])

  const persistCollapse = useCallback((next: CollapseState) => {
    localStorage.setItem(PANEL_COLLAPSE_STORAGE_KEY, JSON.stringify(next))
  }, [])

  const freezeCenterPanel = useCallback(() => {
    if (!centerPanelRef.current) return
    // 冻结中心面板的渲染，动画期间不触发 Canvas 重排
    centerPanelRef.current.style.willChange = 'transform'
    centerPanelRef.current.style.transform = 'translateZ(0)'
    centerPanelRef.current.style.backfaceVisibility = 'hidden'
    centerPanelRef.current.style.contain = 'strict'
    centerPanelRef.current.style.pointerEvents = 'none'
    centerPanelRef.current.style.transition = 'none'
  }, [])

  const unfreezeCenterPanel = useCallback(() => {
    if (!centerPanelRef.current) return
    // 解冻中心面板。必须把冻结期写入的 transform/will-change 全部清掉：
    // 任何残留的 transform 都会让该层跳过 Chromium 的设备像素对齐，
    // 在分数 DPR（如 125%/134% 缩放）下整个 Excel 画布被重采样成模糊文字。
    centerPanelRef.current.style.willChange = 'auto'
    centerPanelRef.current.style.contain = 'layout paint size'
    centerPanelRef.current.style.pointerEvents = ''
    centerPanelRef.current.style.transform = ''
    centerPanelRef.current.style.backfaceVisibility = ''
    centerPanelRef.current.style.transition = ''
  }, [])

  const collapseLeft = useCallback(() => {
    freezeCenterPanel()
    setIsAnimating(true)
    setCollapsed((prev) => {
      const next = { ...prev, left: true }
      persistCollapse(next)
      return next
    })
    // 动画结束后解冻
    setTimeout(() => {
      setIsAnimating(false)
      requestAnimationFrame(() => unfreezeCenterPanel())
    }, 160)
  }, [freezeCenterPanel, unfreezeCenterPanel, persistCollapse])

  const collapseRight = useCallback(() => {
    freezeCenterPanel()
    setIsAnimating(true)
    setCollapsed((prev) => {
      const next = { ...prev, right: true }
      persistCollapse(next)
      return next
    })
    setTimeout(() => {
      setIsAnimating(false)
      requestAnimationFrame(() => unfreezeCenterPanel())
    }, 160)
  }, [freezeCenterPanel, unfreezeCenterPanel, persistCollapse])

  const expandLeft = useCallback(() => {
    freezeCenterPanel()
    setIsAnimating(true)
    setCollapsed((prev) => {
      const next = { ...prev, left: false }
      persistCollapse(next)
      return next
    })
    setTimeout(() => {
      setIsAnimating(false)
      requestAnimationFrame(() => unfreezeCenterPanel())
    }, 160)
  }, [freezeCenterPanel, unfreezeCenterPanel, persistCollapse])

  const expandRight = useCallback(() => {
    freezeCenterPanel()
    setIsAnimating(true)
    setCollapsed((prev) => {
      const next = { ...prev, right: false }
      persistCollapse(next)
      return next
    })
    setTimeout(() => {
      setIsAnimating(false)
      requestAnimationFrame(() => unfreezeCenterPanel())
    }, 160)
  }, [freezeCenterPanel, unfreezeCenterPanel, persistCollapse])

  const controls = useMemo<SidebarCollapseControls>(() => ({
    collapseLeft,
    collapseRight,
    leftCollapsed: collapsed.left,
    rightCollapsed: collapsed.right,
  }), [collapseLeft, collapseRight, collapsed.left, collapsed.right])

  const leftContent = useMemo(
    () => (typeof left === 'function' ? left(controls) : left),
    [controls, left],
  )
  const rightContent = useMemo(
    () => (typeof right === 'function' ? right(controls) : right),
    [controls, right],
  )

  const effectiveLeft = collapsed.left ? COLLAPSED_PANEL_WIDTH : sizes.left
  const effectiveRight = collapsed.right ? COLLAPSED_PANEL_WIDTH : sizes.right

  const getLimits = useCallback(() => {
    const width = containerRef.current?.getBoundingClientRect().width ?? 0
    const rightTaken = collapsedRef.current.right
      ? COLLAPSED_PANEL_WIDTH
      : sizesRef.current.right
    const leftTaken = collapsedRef.current.left
      ? COLLAPSED_PANEL_WIDTH
      : sizesRef.current.left
    const handles =
      (collapsedRef.current.left ? 0 : RESIZE_HANDLE_WIDTH) +
      (collapsedRef.current.right ? 0 : RESIZE_HANDLE_WIDTH)

    const maxLeft = Math.max(
      MIN_LEFT_WIDTH,
      width - rightTaken - MIN_CENTER_WIDTH - handles,
    )
    const maxRight = Math.max(
      MIN_RIGHT_WIDTH,
      width - leftTaken - MIN_CENTER_WIDTH - handles,
    )
    return { maxLeft, maxRight }
  }, [])

  const startResize = useCallback(
    (side: 'left' | 'right', startX: number) => {
      if (side === 'left' && collapsedRef.current.left) return
      if (side === 'right' && collapsedRef.current.right) return

      activeResizeCleanupRef.current?.()

      const panel = side === 'left' ? leftPanelRef.current : rightPanelRef.current
      if (!panel) return

      const startSizes = { ...sizesRef.current }
      const { maxLeft, maxRight } = getLimits()
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      let latestWidth = side === 'left' ? startSizes.left : startSizes.right
      let animationFrame: number | null = null
      let finished = false

      // A transition while dragging makes the panel chase the pointer and keeps
      // the document editor in a continuous animation backlog.
      panel.style.transition = 'none'

      // Heavy editors (Excel) watch this marker to hold their expensive
      // canvas relayout until the drag ends — otherwise every mousemove costs
      // a full worksheet redraw (100-400ms) and the divider stutters.
      containerRef.current?.setAttribute('data-panel-resizing', 'true')

      const flushWidth = () => {
        animationFrame = null
        panel.style.width = `${latestWidth}px`
      }

      const onMove = (e: MouseEvent) => {
        const delta = e.clientX - startX
        const nextWidth = side === 'left'
          ? clamp(startSizes.left + delta, MIN_LEFT_WIDTH, maxLeft)
          : clamp(startSizes.right - delta, MIN_RIGHT_WIDTH, maxRight)

        if (nextWidth === latestWidth) return

        latestWidth = nextWidth
        sizesRef.current = side === 'left'
          ? { ...sizesRef.current, left: nextWidth }
          : { ...sizesRef.current, right: nextWidth }

        if (animationFrame === null) {
          animationFrame = requestAnimationFrame(flushWidth)
        }
      }

      const finishResize = (commit: boolean) => {
        if (finished) return
        finished = true

        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        window.removeEventListener('blur', onUp)

        if (animationFrame !== null) {
          cancelAnimationFrame(animationFrame)
          flushWidth()
        }

        panel.style.removeProperty('transition')
        containerRef.current?.removeAttribute('data-panel-resizing')
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        activeResizeCleanupRef.current = null

        if (commit) {
          const nextSizes = { ...sizesRef.current }
          setSizes((prev) => (
            prev.left === nextSizes.left && prev.right === nextSizes.right
              ? prev
              : nextSizes
          ))
          persistSizes(nextSizes)
        }
      }

      const onUp = () => finishResize(true)
      const cancelResize = () => finishResize(false)

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      window.addEventListener('blur', onUp)
      activeResizeCleanupRef.current = cancelResize
    },
    [getLimits, persistSizes],
  )

  useEffect(() => () => {
    activeResizeCleanupRef.current?.()
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(() => {
      if (activeResizeCleanupRef.current) return
      if (collapsedRef.current.left && collapsedRef.current.right) return
      const { maxLeft, maxRight } = getLimits()
      setSizes((prev) => {
        const next = {
          left: clamp(prev.left, MIN_LEFT_WIDTH, maxLeft),
          right: clamp(prev.right, MIN_RIGHT_WIDTH, maxRight),
        }
        if (prev.left === next.left && prev.right === next.right) return prev
        sizesRef.current = next
        return next
      })
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [getLimits, collapsed.left, collapsed.right])

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
      <section
        ref={leftPanelRef}
        className="flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-sidebar transition-[width,transform] duration-150 ease-out motion-reduce:transition-none will-change-[width]"
        style={{ width: effectiveLeft }}
        data-panel="file-manager"
        data-collapsed={collapsed.left || undefined}
      >
        {collapsed.left ? (
          <CollapsedRail
            side="left"
            onExpand={expandLeft}
            label={t('appShell.expandFileManager')}
          />
        ) : (
          leftContent
        )}
      </section>

      {!collapsed.left && (
        <ResizeHandle
          onMouseDown={(e) => {
            e.preventDefault()
            startResize('left', e.clientX)
          }}
        />
      )}

      <section
        ref={centerPanelRef}
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${isAnimating ? 'panel-animating' : ''}`}
        // 稳态下不做 transform/合成层提升：永久提升的层不参与设备像素对齐，
        // 分数 DPR 下会把 Excel 画布重采样成模糊文字。动画期间由
        // freezeCenterPanel / panel-animating 规则临时提升。
        style={{
          contain: isAnimating ? 'strict' : 'layout paint size',
          willChange: isAnimating ? 'transform' : 'auto',
        }}
        data-panel="document-editor"
        data-animating={isAnimating || undefined}
      >
        {center}
      </section>

      {!collapsed.right && (
        <ResizeHandle
          onMouseDown={(e) => {
            e.preventDefault()
            startResize('right', e.clientX)
          }}
        />
      )}

      <section
        ref={rightPanelRef}
        className="flex min-h-0 shrink-0 flex-col overflow-hidden border-l bg-sidebar transition-[width,transform] duration-150 ease-out motion-reduce:transition-none will-change-[width]"
        style={{ width: effectiveRight }}
        data-panel="agent-assistant"
        data-collapsed={collapsed.right || undefined}
      >
        {collapsed.right ? (
          <CollapsedRail
            side="right"
            onExpand={expandRight}
            label={t('appShell.expandAgentAssistant')}
          />
        ) : (
          rightContent
        )}
      </section>
    </div>
  )
}

function CollapsedRail({
  side,
  onExpand,
  label,
}: {
  side: 'left' | 'right'
  onExpand: () => void
  label: string
}) {
  return (
    <div className="flex h-full w-full flex-col items-center bg-sidebar pt-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onExpand}
        title={label}
        aria-label={label}
      >
        {side === 'left' ? (
          <PanelLeftOpen className="h-4 w-4" />
        ) : (
          <PanelRightOpen className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/runtime'
import { OPEN_AGENT_ASSISTANT_EVENT } from '@/lib/code-editor-events'
import { ResizeHandle } from './ResizeHandle'
import {
  COLLAPSED_PANEL_WIDTH,

  DEFAULT_LEFT_WIDTH,
  DEFAULT_RIGHT_WIDTH,
  LEFT_COLLAPSE_ANIMATION_MS,
  LEFT_COMPACT_RESTORE_WIDTH,
  LEFT_RESTORE_ANIMATION_MS,
  MIN_CENTER_WIDTH,
  MIN_LEFT_WIDTH,
  MIN_RIGHT_WIDTH,
  PANEL_COLLAPSE_STORAGE_KEY,
  PANEL_STORAGE_KEY,
  RESIZE_HANDLE_WIDTH,
  RIGHT_COLLAPSE_ANIMATION_MS,
  RIGHT_COMPACT_RESTORE_WIDTH,
  RIGHT_RESTORE_ANIMATION_MS,
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
    // Migrate the previous default without overwriting a user-selected width.
    const storedLeft = typeof parsed.left === 'number' ? parsed.left : null
    const left = storedLeft === 260
      ? DEFAULT_LEFT_WIDTH
      : storedLeft && storedLeft >= MIN_LEFT_WIDTH
        ? storedLeft
        : DEFAULT_LEFT_WIDTH
    return {
      left: Math.max(MIN_LEFT_WIDTH, left),
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

function mountResizeDragShield(): () => void {
  const shield = document.createElement('div')
  shield.setAttribute('data-panel-resize-shield', 'true')
  shield.setAttribute('aria-hidden', 'true')
  Object.assign(shield.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    cursor: 'col-resize',
    userSelect: 'none',
    touchAction: 'none',
  })
  document.body.appendChild(shield)
  return () => shield.remove()
}

interface PanelVisualElements {
  content: HTMLElement | null
  rail: HTMLElement | null
}

function getPanelVisualElements(panel: HTMLElement): PanelVisualElements {
  return {
    content: panel.querySelector<HTMLElement>('[data-panel-content]'),
    rail: panel.querySelector<HTMLElement>('[data-panel-collapsed-rail]'),
  }
}

function setPanelVisualTransition(
  elements: PanelVisualElements,
  durationMs: number | null,
): void {
  for (const element of [elements.content, elements.rail]) {
    if (!element) continue
    if (durationMs === null) element.style.removeProperty('transition-duration')
    else element.style.transitionDuration = `${durationMs}ms`
  }
}

function clearPanelVisualOverrides(elements: PanelVisualElements): void {
  for (const element of [elements.content, elements.rail]) {
    if (!element) continue
    element.style.removeProperty('opacity')
    element.style.removeProperty('transform')
    element.style.removeProperty('transition-duration')
  }
}

function setPanelRevealProgress(
  elements: PanelVisualElements,
  _side: 'left' | 'right',
  progress: number,
): void {
  const normalized = clamp(progress, 0, 1)
  const contentProgress = clamp((normalized - 0.05) / 0.95, 0, 1)
  const railProgress = clamp((1 - normalized) / 0.95, 0, 1)

  if (elements.content) {
    elements.content.style.opacity = contentProgress.toFixed(3)
    elements.content.style.transform = 'none'
  }

  if (elements.rail) {
    elements.rail.style.opacity = railProgress.toFixed(3)
    elements.rail.style.transform = 'none'
  }
}

function getPanelRevealProgress(width: number, minWidth: number): number {
  return clamp(
    (width - COLLAPSED_PANEL_WIDTH) / (minWidth - COLLAPSED_PANEL_WIDTH),
    0,
    1,
  )
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
  const leftAnimationTimerRef = useRef<number | null>(null)
  const rightAnimationTimerRef = useRef<number | null>(null)
  const [sizes, setSizes] = useState<PanelSizes>(loadSizes)
  const [collapsed, setCollapsed] = useState<CollapseState>(loadCollapse)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isLeftCollapsing, setIsLeftCollapsing] = useState(false)
  const [isLeftRestoring, setIsLeftRestoring] = useState(false)
  const [isRightCollapsing, setIsRightCollapsing] = useState(false)
  const [isRightRestoring, setIsRightRestoring] = useState(false)
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
    if (leftAnimationTimerRef.current !== null) {
      window.clearTimeout(leftAnimationTimerRef.current)
    }
    freezeCenterPanel()
    setIsAnimating(true)
    setIsLeftRestoring(false)
    setIsLeftCollapsing(true)
    setCollapsed((prev) => {
      const next = { ...prev, left: true }
      persistCollapse(next)
      return next
    })
    // 动画结束后解冻
    leftAnimationTimerRef.current = window.setTimeout(() => {
      leftAnimationTimerRef.current = null
      setIsLeftCollapsing(false)
      setIsAnimating(false)
      requestAnimationFrame(() => unfreezeCenterPanel())
    }, LEFT_COLLAPSE_ANIMATION_MS + 10)
  }, [freezeCenterPanel, unfreezeCenterPanel, persistCollapse])

  const collapseRight = useCallback(() => {
    if (rightAnimationTimerRef.current !== null) {
      window.clearTimeout(rightAnimationTimerRef.current)
    }
    freezeCenterPanel()
    setIsAnimating(true)
    setIsRightRestoring(false)
    setIsRightCollapsing(true)
    setCollapsed((prev) => {
      const next = { ...prev, right: true }
      persistCollapse(next)
      return next
    })
    rightAnimationTimerRef.current = window.setTimeout(() => {
      rightAnimationTimerRef.current = null
      setIsRightCollapsing(false)
      setIsAnimating(false)
      requestAnimationFrame(() => unfreezeCenterPanel())
    }, RIGHT_COLLAPSE_ANIMATION_MS + 10)
  }, [freezeCenterPanel, unfreezeCenterPanel, persistCollapse])

  const expandLeft = useCallback(() => {
    if (leftAnimationTimerRef.current !== null) {
      window.clearTimeout(leftAnimationTimerRef.current)
    }
    freezeCenterPanel()
    setIsAnimating(true)
    setIsLeftCollapsing(false)
    setIsLeftRestoring(true)
    setCollapsed((prev) => {
      const next = { ...prev, left: false }
      persistCollapse(next)
      return next
    })
    leftAnimationTimerRef.current = window.setTimeout(() => {
      leftAnimationTimerRef.current = null
      setIsLeftRestoring(false)
      setIsAnimating(false)
      requestAnimationFrame(() => unfreezeCenterPanel())
    }, LEFT_RESTORE_ANIMATION_MS + 10)
  }, [freezeCenterPanel, unfreezeCenterPanel, persistCollapse])

  const expandRight = useCallback(() => {
    if (rightAnimationTimerRef.current !== null) {
      window.clearTimeout(rightAnimationTimerRef.current)
    }
    freezeCenterPanel()
    setIsAnimating(true)
    setIsRightCollapsing(false)
    setIsRightRestoring(true)
    setCollapsed((prev) => {
      const next = { ...prev, right: false }
      persistCollapse(next)
      return next
    })
    rightAnimationTimerRef.current = window.setTimeout(() => {
      rightAnimationTimerRef.current = null
      setIsRightRestoring(false)
      setIsAnimating(false)
      requestAnimationFrame(() => unfreezeCenterPanel())
    }, RIGHT_RESTORE_ANIMATION_MS + 10)
  }, [freezeCenterPanel, unfreezeCenterPanel, persistCollapse])

  useEffect(() => {
    const handleOpenAgentAssistant = () => {
      if (collapsedRef.current.right) expandRight()
    }
    window.addEventListener(OPEN_AGENT_ASSISTANT_EVENT, handleOpenAgentAssistant)
    return () => window.removeEventListener(OPEN_AGENT_ASSISTANT_EVENT, handleOpenAgentAssistant)
  }, [expandRight])

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
    // Both handles remain mounted while collapsed so either sidebar can be
    // dragged or double-clicked back open.
    const handles = RESIZE_HANDLE_WIDTH * 2

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
      activeResizeCleanupRef.current?.()

      const panel = side === 'left' ? leftPanelRef.current : rightPanelRef.current
      if (!panel) return

      const startSizes = { ...sizesRef.current }
      const { maxLeft, maxRight } = getLimits()
      const startCollapsed = collapsedRef.current[side]
      const minWidth = side === 'left' ? MIN_LEFT_WIDTH : MIN_RIGHT_WIDTH
      const maxWidth = side === 'left' ? maxLeft : maxRight
      // 缩小/展开只在侧边栏一半位置触发；其余时候分界线 1:1 跟随指针。
      const halfWidth = minWidth / 2
      const startWidth = startCollapsed ? COLLAPSED_PANEL_WIDTH : startSizes[side]
      // 指针位置直接映射为面板宽度，拖拽全程分界线都贴着指针走，
      // 鼠标移动多快都不会出现分界线与指针脱节。
      const panelLeft = side === 'left' ? startX - startWidth : startX
      const panelRight = panelLeft + startWidth
      const visualElements = getPanelVisualElements(panel)

      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect
      let latestWidth = startWidth
      let collapsedDuringDrag = startCollapsed
      let animationFrame: number | null = null
      let finished = false
      const removeDragShield = mountResizeDragShield()

      type ResizeFinishMode = 'commit' | 'cancel' | 'collapse'

      // A transition while dragging makes the panel chase the pointer and keeps
      // the document editor in a continuous animation backlog.
      panel.style.transition = 'none'
      setPanelVisualTransition(visualElements, 0)
      setPanelRevealProgress(
        visualElements,
        side,
        getPanelRevealProgress(startWidth, minWidth),
      )

      // Heavy editors (Excel) watch this marker to hold their expensive
      // canvas relayout until the drag ends — otherwise every mousemove costs
      // a full worksheet redraw (100-400ms) and the divider stutters.
      containerRef.current?.setAttribute('data-panel-resizing', 'true')

      const flushWidth = () => {
        animationFrame = null
        panel.style.setProperty('--panel-drag-width', `${latestWidth}px`)
      }

      const setSideCollapsed = (collapsed: boolean) => {
        setCollapsed((prev) => {
          const next = { ...prev, [side]: collapsed }
          persistCollapse(next)
          return next
        })
      }

      const processMove = (clientX: number) => {
        // 指针位置 1:1 映射为面板宽度，分界线始终贴着指针。
        const rawWidth = side === 'left'
          ? clientX - panelLeft
          : panelRight - clientX

        // 缩小/展开只在侧边栏一半位置切换状态。
        const nextCollapsed = rawWidth <= halfWidth
        if (nextCollapsed !== collapsedDuringDrag) {
          collapsedDuringDrag = nextCollapsed
          setSideCollapsed(nextCollapsed)
        }

        latestWidth = clamp(rawWidth, COLLAPSED_PANEL_WIDTH, maxWidth)
        setPanelRevealProgress(
          visualElements,
          side,
          getPanelRevealProgress(latestWidth, minWidth),
        )

        if (animationFrame === null) {
          animationFrame = requestAnimationFrame(flushWidth)
        }
      }

      const onMove = (e: MouseEvent) => {
        processMove(e.clientX)
      }

      const finishResize = (mode: ResizeFinishMode) => {
        if (finished) return
        finished = true

        document.removeEventListener('mousemove', onMove, true)
        document.removeEventListener('mouseup', onUp, true)
        document.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('blur', onWindowBlur)
        removeDragShield()

        if (animationFrame !== null) {
          cancelAnimationFrame(animationFrame)
          flushWidth()
        }

        panel.style.removeProperty('transition')
        setPanelVisualTransition(visualElements, null)
        containerRef.current?.removeAttribute('data-panel-resizing')
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        activeResizeCleanupRef.current = null

        if (mode === 'commit') {
          // 在预览区间（半宽到最小宽度之间）松手时，落到最小可用宽度。
          const nextWidth = clamp(latestWidth, minWidth, maxWidth)
          const nextSizes = { ...sizesRef.current, [side]: nextWidth }
          sizesRef.current = nextSizes
          panel.style.setProperty('--panel-drag-width', `${nextWidth}px`)
          setPanelRevealProgress(visualElements, side, 1)
          setSizes((prev) => (
            prev.left === nextSizes.left && prev.right === nextSizes.right
              ? prev
              : nextSizes
          ))
          persistSizes(nextSizes)
        } else if (mode === 'collapse') {
          sizesRef.current = startSizes
          panel.style.setProperty('--panel-drag-width', `${COLLAPSED_PANEL_WIDTH}px`)
          setPanelRevealProgress(visualElements, side, 0)
        } else {
          sizesRef.current = startSizes
          setSideCollapsed(startCollapsed)
          panel.style.setProperty('--panel-drag-width', `${startWidth}px`)
          setPanelRevealProgress(
            visualElements,
            side,
            getPanelRevealProgress(startWidth, minWidth),
          )
          setSizes((prev) => (
            prev.left === startSizes.left && prev.right === startSizes.right
              ? prev
              : { ...startSizes }
          ))
        }

        // 等 React 用提交后的状态完成重渲染，再移除拖拽期的行内覆盖。
        // 如果保留 opacity，展开后的面板会恢复宽度但内容仍保持透明。
        requestAnimationFrame(() => {
          panel.style.removeProperty('--panel-drag-width')
          clearPanelVisualOverrides(visualElements)
        })
      }

      const onUp = (event: MouseEvent) => {
        if (event.button !== 0) return
        // Fold the release position into the drag: with a fast flick the
        // final pointer travel can arrive as a mousemove after mouseup (when
        // these listeners are already removed), so the collapse/expand half
        // position is checked here instead of being lost.
        processMove(event.clientX)
        finishResize(collapsedDuringDrag ? 'collapse' : 'commit')
      }
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') finishResize('cancel')
      }
      const onWindowBlur = () => finishResize('cancel')
      const cancelResize = () => finishResize('cancel')

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove, true)
      document.addEventListener('mouseup', onUp, true)
      document.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('blur', onWindowBlur)
      activeResizeCleanupRef.current = cancelResize
    },
    [getLimits, persistCollapse, persistSizes],
  )

  const setLeftCompactSize = useCallback(() => {
    const { maxLeft } = getLimits()
    const compactWidth = clamp(LEFT_COMPACT_RESTORE_WIDTH, MIN_LEFT_WIDTH, maxLeft)
    const nextSizes = { ...sizesRef.current, left: compactWidth }

    sizesRef.current = nextSizes
    setSizes(nextSizes)
    persistSizes(nextSizes)
  }, [getLimits, persistSizes])

  const setRightCompactSize = useCallback(() => {
    const { maxRight } = getLimits()
    const compactWidth = clamp(RIGHT_COMPACT_RESTORE_WIDTH, MIN_RIGHT_WIDTH, maxRight)
    const nextSizes = { ...sizesRef.current, right: compactWidth }

    sizesRef.current = nextSizes
    setSizes(nextSizes)
    persistSizes(nextSizes)
  }, [getLimits, persistSizes])

  const expandLeftCompact = useCallback(() => {
    setLeftCompactSize()
    expandLeft()
  }, [expandLeft, setLeftCompactSize])

  const expandRightCompact = useCallback(() => {
    setRightCompactSize()
    expandRight()
  }, [expandRight, setRightCompactSize])

  useEffect(() => () => {
    activeResizeCleanupRef.current?.()
    if (leftAnimationTimerRef.current !== null) {
      window.clearTimeout(leftAnimationTimerRef.current)
    }
    if (rightAnimationTimerRef.current !== null) {
      window.clearTimeout(rightAnimationTimerRef.current)
    }
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
        className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r bg-sidebar transition-[width] duration-120 ease-out motion-reduce:transition-none will-change-[width]"
        style={{
          width: `var(--panel-drag-width, ${effectiveLeft}px)`,
          transitionDuration: isLeftCollapsing
            ? `${LEFT_COLLAPSE_ANIMATION_MS}ms`
            : isLeftRestoring
              ? `${LEFT_RESTORE_ANIMATION_MS}ms`
              : undefined,
        }}
        data-panel="file-manager"
        data-collapsed={collapsed.left || undefined}
      >
        <div
          data-panel-content
          className={`h-full transition-opacity duration-120 ease-out ${
            collapsed.left
              ? 'pointer-events-none opacity-0'
              : 'pointer-events-auto opacity-100'
          }`}
          style={{
            minWidth: MIN_LEFT_WIDTH,
          }}
          aria-hidden={collapsed.left}
        >
          {leftContent}
        </div>
        <div
          data-panel-collapsed-rail
          className={`absolute inset-0 transition-opacity duration-120 ease-out ${
            collapsed.left
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0'
          }`}
          aria-hidden={!collapsed.left}
        >
          <CollapsedRail
            side="left"
            onExpand={expandLeft}
            label={t('appShell.expandFileManager')}
          />
        </div>
      </section>

      <ResizeHandle
        onMouseDown={(e) => {
          e.preventDefault()
          if (e.button !== 0) return
          if (e.detail > 1) return
          startResize('left', e.clientX)
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          activeResizeCleanupRef.current?.()
          if (collapsedRef.current.left) expandLeftCompact()
          else collapseLeft()
        }}
      />

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

      <ResizeHandle
        onMouseDown={(e) => {
          e.preventDefault()
          if (e.button !== 0) return
          if (e.detail > 1) return
          startResize('right', e.clientX)
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          activeResizeCleanupRef.current?.()
          if (collapsedRef.current.right) expandRightCompact()
          else collapseRight()
        }}
      />

      <section
        ref={rightPanelRef}
        className="relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l bg-sidebar transition-[width] duration-120 ease-out motion-reduce:transition-none will-change-[width]"
        style={{
          width: `var(--panel-drag-width, ${effectiveRight}px)`,
          transitionDuration: isRightCollapsing
            ? `${RIGHT_COLLAPSE_ANIMATION_MS}ms`
            : isRightRestoring
              ? `${RIGHT_RESTORE_ANIMATION_MS}ms`
              : undefined,
        }}
        data-panel="agent-assistant"
        data-collapsed={collapsed.right || undefined}
      >
        <div
          data-panel-content
          className={`h-full transition-opacity duration-120 ease-out ${
            collapsed.right
              ? 'pointer-events-none opacity-0'
              : 'pointer-events-auto opacity-100'
          }`}
          style={{
            minWidth: MIN_RIGHT_WIDTH,
          }}
          aria-hidden={collapsed.right}
        >
          {rightContent}
        </div>
        <div
          data-panel-collapsed-rail
          className={`absolute inset-0 transition-opacity duration-120 ease-out ${
            collapsed.right
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0'
          }`}
          aria-hidden={!collapsed.right}
        >
          <CollapsedRail
            side="right"
            onExpand={expandRight}
            label={t('appShell.expandAgentAssistant')}
          />
        </div>
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

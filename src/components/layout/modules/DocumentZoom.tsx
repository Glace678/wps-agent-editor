import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useTranslation } from '@/lib/i18n/runtime'
import { consumeWheelZoomSteps, normalizeWheelZoomDelta } from './document-zoom-wheel'

const MIN_ZOOM = 0.1  // 10%
const MAX_ZOOM = 5    // 500%
const ZOOM_STEP = 0.1
const DEFAULT_ZOOM = 1
const ZOOM_STORAGE_KEY = 'wps-document-zoom'
const ZOOM_MODE_KEY = 'wps-zoom-mode'
const WHEEL_GESTURE_IDLE_MS = 160
const WHEEL_ZOOM_MIN_INTERVAL_MS = 32

type PageLayoutMode = 'single' | 'two-pages' | 'continuous'

function clampZoom(value: number): number {
  const rounded = Math.round(value * 100) / 100
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rounded))
}

function loadZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY)
    if (!raw) return DEFAULT_ZOOM
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_ZOOM
    return clampZoom(n)
  } catch {
    return DEFAULT_ZOOM
  }
}

function isZoomInKey(e: KeyboardEvent): boolean {
  return (
    e.key === '+' ||
    e.key === '=' ||
    e.code === 'Equal' ||
    e.code === 'NumpadAdd'
  )
}

function isZoomOutKey(e: KeyboardEvent): boolean {
  return e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract'
}

function isZoomResetKey(e: KeyboardEvent): boolean {
  return e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0'
}

function hasManagedDocumentZoom(root: HTMLElement | null, target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest('[data-manages-document-zoom]')) return true
  return Boolean(root?.querySelector('[data-manages-document-zoom]'))
}

interface DocumentZoomProps {
  children: ReactNode
}

interface DocumentZoomValue {
  zoom: number
  percent: number
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  /** 编辑器内部缩放（如 SuperDoc 工具栏缩放下拉）回写全局状态，单位百分比 */
  setZoomPercent: (percent: number) => void
}

const DocumentZoomContext = createContext<DocumentZoomValue | null>(null)

export function useDocumentZoom(): DocumentZoomValue {
  const value = useContext(DocumentZoomContext)
  if (!value) {
    return {
      zoom: DEFAULT_ZOOM,
      percent: 100,
      zoomIn: () => {},
      zoomOut: () => {},
      zoomReset: () => {},
      setZoomPercent: () => {},
    }
  }
  return value
}

/**
 * 文档区缩放：
 * - 通过 CSS 变量 --document-zoom 下发比例
 * - 默认由 .document-zoom-target 缩放（PDF、演示文稿等）
 * - Word 仅缩放正文；Excel/文本编辑器使用自身的高清原生缩放
 * - 左右侧栏不在此容器内，不受影响
 */
export function DocumentZoom({ children }: DocumentZoomProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(loadZoom)
  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const zoomRef = useRef(zoom)
  const wheelGestureRef = useRef<{
    accumulatedDelta: number
    direction: -1 | 0 | 1
    frame: number | null
    flushTimer: ReturnType<typeof setTimeout> | null
    idleTimer: ReturnType<typeof setTimeout> | null
    lastFlushAt: number
  }>({
    accumulatedDelta: 0,
    direction: 0,
    frame: null,
    flushTimer: null,
    idleTimer: null,
    lastFlushAt: Number.NEGATIVE_INFINITY,
  })
  zoomRef.current = zoom

  const showHint = useCallback(() => {
    setHintVisible(true)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHintVisible(false), 900)
  }, [])

  const applyZoom = useCallback(
    (next: number) => {
      const z = clampZoom(next)
      if (Math.abs(z - zoomRef.current) < 0.005) return
      setZoom(z)
      zoomRef.current = z
      try {
        localStorage.setItem(ZOOM_STORAGE_KEY, String(z))
      } catch {
        /* ignore */
      }
      showHint()
    },
    [showHint],
  )

  const zoomIn = useCallback(() => applyZoom(zoomRef.current + ZOOM_STEP), [applyZoom])
  const zoomOut = useCallback(() => applyZoom(zoomRef.current - ZOOM_STEP), [applyZoom])
  const zoomReset = useCallback(() => applyZoom(DEFAULT_ZOOM), [applyZoom])
  const setZoomPercent = useCallback(
    (percent: number) => {
      if (!Number.isFinite(percent) || percent <= 0) return
      const next = clampZoom(percent / 100)
      // 编辑器回写同值时不重复触发（避免 setZoom ↔ zoomChange 往返）
      if (Math.abs(next - zoomRef.current) < 0.005) return
      applyZoom(next)
    },
    [applyZoom],
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (hasManagedDocumentZoom(rootRef.current, e.target)) return

      if (isZoomInKey(e)) {
        e.preventDefault()
        zoomIn()
        return
      }
      if (isZoomOutKey(e)) {
        e.preventDefault()
        zoomOut()
        return
      }
      if (isZoomResetKey(e)) {
        e.preventDefault()
        zoomReset()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [zoomIn, zoomOut, zoomReset])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return

    const flushWheelZoom = () => {
      const gesture = wheelGestureRef.current
      gesture.frame = null
      gesture.lastFlushAt = performance.now()
      const { steps, remainder } = consumeWheelZoomSteps(gesture.accumulatedDelta)
      gesture.accumulatedDelta = remainder
      if (steps !== 0) applyZoom(zoomRef.current - steps * ZOOM_STEP)
    }

    const scheduleWheelZoom = () => {
      const gesture = wheelGestureRef.current
      if (gesture.frame !== null || gesture.flushTimer !== null) return
      const wait = WHEEL_ZOOM_MIN_INTERVAL_MS - (performance.now() - gesture.lastFlushAt)
      const queueFrame = () => {
        gesture.flushTimer = null
        gesture.frame = requestAnimationFrame(flushWheelZoom)
      }
      if (wait > 0) gesture.flushTimer = setTimeout(queueFrame, wait)
      else queueFrame()
    }

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (hasManagedDocumentZoom(rootRef.current, e.target)) return
      // Tauri disables whole-page zoom hotkeys in the webview configuration.
      // Keeping this listener passive lets ordinary document scrolling stay on
      // the compositor thread instead of waiting for the renderer main thread.
      e.stopPropagation()
      const delta = normalizeWheelZoomDelta(e.deltaY, e.deltaMode)
      if (delta === 0) return

      const gesture = wheelGestureRef.current
      const direction = Math.sign(delta) as -1 | 1
      if (gesture.direction !== 0 && gesture.direction !== direction) {
        gesture.accumulatedDelta = 0
      }
      gesture.direction = direction
      gesture.accumulatedDelta += delta

      if (gesture.idleTimer) clearTimeout(gesture.idleTimer)
      gesture.idleTimer = setTimeout(() => {
        gesture.accumulatedDelta = 0
        gesture.direction = 0
        gesture.idleTimer = null
      }, WHEEL_GESTURE_IDLE_MS)

      scheduleWheelZoom()
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      const gesture = wheelGestureRef.current
      if (gesture.frame !== null) cancelAnimationFrame(gesture.frame)
      if (gesture.flushTimer !== null) clearTimeout(gesture.flushTimer)
      if (gesture.idleTimer !== null) clearTimeout(gesture.idleTimer)
      gesture.accumulatedDelta = 0
      gesture.direction = 0
      gesture.frame = null
      gesture.flushTimer = null
      gesture.idleTimer = null
      gesture.lastFlushAt = Number.NEGATIVE_INFINITY
    }
  }, [applyZoom])

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    }
  }, [])

  const percent = Math.round(zoom * 100)
  const rootStyle = {
    // 供 Word 正文 / .document-zoom-target 读取
    ['--document-zoom' as string]: String(zoom),
  } as CSSProperties

  return (
    <DocumentZoomContext.Provider value={{ zoom, percent, zoomIn, zoomOut, zoomReset, setZoomPercent }}>
      <div
        ref={rootRef}
        className="document-zoom-root relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
        data-document-zoom={zoom}
        style={rootStyle}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="h-full min-h-full w-full">{children}</div>
        </div>

        {hintVisible && (
          <div
            className="pointer-events-none absolute bottom-12 left-1/2 z-20 -translate-x-1/2 rounded-md bg-foreground/85 px-3 py-1.5 text-xs font-medium text-background shadow-lg"
            role="status"
            aria-live="polite"
          >
            {t('appShell.documentZoom', { percent })}
          </div>
        )}
      </div>
    </DocumentZoomContext.Provider>
  )
}

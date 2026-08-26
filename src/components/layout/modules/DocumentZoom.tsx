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
const WHEEL_GESTURE_IDLE_MS = 280

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

function persistZoom(value: number): void {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(value))
  } catch {
    /* ignore */
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
  settledZoom: number
  percent: number
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
  previewZoomPercent: (percent: number) => void
  setZoomPercent: (percent: number, settle?: boolean) => void
}

const DocumentZoomContext = createContext<DocumentZoomValue | null>(null)

export function useDocumentZoom(): DocumentZoomValue {
  const value = useContext(DocumentZoomContext)
  if (!value) {
    return {
      zoom: DEFAULT_ZOOM,
      settledZoom: DEFAULT_ZOOM,
      percent: 100,
      zoomIn: () => {},
      zoomOut: () => {},
      zoomReset: () => {},
      previewZoomPercent: () => {},
      setZoomPercent: () => {},
    }
  }
  return value
}

export function DocumentZoom({ children }: DocumentZoomProps) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(loadZoom)
  const [settledZoom, setSettledZoom] = useState(zoom)
  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const zoomRef = useRef(zoom)
  const settledZoomRef = useRef(settledZoom)
  const wheelGestureRef = useRef<{
    accumulatedDelta: number
    direction: -1 | 0 | 1
    frame: number | null
    idleTimer: ReturnType<typeof setTimeout> | null
  }>({
    accumulatedDelta: 0,
    direction: 0,
    frame: null,
    idleTimer: null,
  })
  zoomRef.current = zoom
  settledZoomRef.current = settledZoom

  const showHint = useCallback(() => {
    setHintVisible(true)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHintVisible(false), 900)
  }, [])

  const updateZoom = useCallback(
    (next: number, settle: boolean) => {
      const z = clampZoom(next)
      const displayChanged = Math.abs(z - zoomRef.current) >= 0.005
      const settledChanged = settle && Math.abs(z - settledZoomRef.current) >= 0.005
      if (!displayChanged && !settledChanged) return
      if (displayChanged) {
        setZoom(z)
        zoomRef.current = z
      }
      if (settledChanged) {
        setSettledZoom(z)
        settledZoomRef.current = z
        persistZoom(z)
      }
      showHint()
    },
    [showHint],
  )

  const cancelWheelGesture = useCallback(() => {
    const gesture = wheelGestureRef.current
    if (gesture.frame !== null) cancelAnimationFrame(gesture.frame)
    if (gesture.idleTimer !== null) clearTimeout(gesture.idleTimer)
    gesture.accumulatedDelta = 0
    gesture.direction = 0
    gesture.frame = null
    gesture.idleTimer = null
  }, [])

  const applyZoom = useCallback((next: number) => {
    cancelWheelGesture()
    updateZoom(next, true)
  }, [cancelWheelGesture, updateZoom])

  const previewZoom = useCallback((next: number) => {
    cancelWheelGesture()
    updateZoom(next, false)
  }, [cancelWheelGesture, updateZoom])

  const settleWheelZoom = useCallback(() => {
    const z = zoomRef.current
    if (Math.abs(z - settledZoomRef.current) < 0.005) return
    setSettledZoom(z)
    settledZoomRef.current = z
    persistZoom(z)
  }, [])

  const zoomIn = useCallback(() => applyZoom(zoomRef.current + ZOOM_STEP), [applyZoom])
  const zoomOut = useCallback(() => applyZoom(zoomRef.current - ZOOM_STEP), [applyZoom])
  const zoomReset = useCallback(() => applyZoom(DEFAULT_ZOOM), [applyZoom])

  const previewZoomPercent = useCallback(
    (percent: number) => {
      if (!Number.isFinite(percent) || percent <= 0) return
      const next = clampZoom(percent / 100)
      if (Math.abs(next - zoomRef.current) < 0.005) return
      previewZoom(next)
    },
    [previewZoom],
  )

  const setZoomPercent = useCallback(
    (percent: number, settle = true) => {
      if (!Number.isFinite(percent) || percent <= 0) return
      const next = clampZoom(percent / 100)
      if (settle && Math.abs(next - settledZoomRef.current) < 0.005 && Math.abs(next - zoomRef.current) < 0.005) return
      if (!settle) {
        previewZoom(next)
      } else {
        applyZoom(next)
      }
    },
    [applyZoom, previewZoom],
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
      const { steps, remainder } = consumeWheelZoomSteps(gesture.accumulatedDelta)
      gesture.accumulatedDelta = remainder
      if (steps !== 0) updateZoom(zoomRef.current - steps * ZOOM_STEP, false)
    }

    const scheduleWheelZoom = () => {
      const gesture = wheelGestureRef.current
      if (gesture.frame !== null) return
      gesture.frame = requestAnimationFrame(flushWheelZoom)
    }

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (hasManagedDocumentZoom(rootRef.current, e.target)) return
      e.preventDefault()
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
        settleWheelZoom()
      }, WHEEL_GESTURE_IDLE_MS)

      scheduleWheelZoom()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      cancelWheelGesture()
    }
  }, [cancelWheelGesture, settleWheelZoom, updateZoom])

  // 用户点击正文、按下按键或触控交互时，立即结算滚轮手势，无需等待 280ms idle 定时器，保证点击立即响应
  useEffect(() => {
    const onUserInteractionCapture = (e: Event) => {
      if (e instanceof KeyboardEvent && (e.ctrlKey || e.metaKey)) return
      if (e instanceof MouseEvent && (e.ctrlKey || e.metaKey)) return
      const gesture = wheelGestureRef.current
      if (
        gesture.idleTimer !== null ||
        gesture.frame !== null ||
        Math.abs(zoomRef.current - settledZoomRef.current) >= 0.005
      ) {
        cancelWheelGesture()
        settleWheelZoom()
      }
    }

    window.addEventListener('pointerdown', onUserInteractionCapture, true)
    window.addEventListener('mousedown', onUserInteractionCapture, true)
    window.addEventListener('touchstart', onUserInteractionCapture, true)
    window.addEventListener('wheel', onUserInteractionCapture, true)
    window.addEventListener('keydown', onUserInteractionCapture, true)
    return () => {
      window.removeEventListener('pointerdown', onUserInteractionCapture, true)
      window.removeEventListener('mousedown', onUserInteractionCapture, true)
      window.removeEventListener('touchstart', onUserInteractionCapture, true)
      window.removeEventListener('wheel', onUserInteractionCapture, true)
      window.removeEventListener('keydown', onUserInteractionCapture, true)
    }
  }, [cancelWheelGesture, settleWheelZoom])

  const percent = Math.round(zoom * 100)
  const rootStyle = {
    ['--document-zoom']: String(zoom),
  } as CSSProperties

  return (
    <DocumentZoomContext.Provider
      value={{ zoom, settledZoom, percent, zoomIn, zoomOut, zoomReset, previewZoomPercent, setZoomPercent }}
    >
      <div
        ref={rootRef}
        className="document-zoom-root relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden"
        data-document-zoom={zoom}
        data-document-zoom-settled={settledZoom}
        data-document-zoom-preview={Math.abs(zoom - settledZoom) >= 0.005 ? zoom : undefined}
        style={rootStyle}
      >
        <div className="min-h-0 flex-1 overflow-hidden">
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

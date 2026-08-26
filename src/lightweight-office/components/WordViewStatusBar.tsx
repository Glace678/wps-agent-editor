import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  Focus,
  Globe2,
  ListTree,
  Minus,
  FastForward,
  LocateFixed,
  Pause,
  Play,
  Plus,
} from 'lucide-react'
import { useDocumentZoom } from '@/components/layout/modules/DocumentZoom'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTranslation } from '@/lib/i18n/runtime'
import type { WordPlaybackState } from '@/types/document'

export type WordViewMode = 'page' | 'outline' | 'reading' | 'web'

export interface WordOutlineItem {
  level: number
  text: string
  nodeId: string
}

export interface WordViewSnapshot {
  html: string
  outline: WordOutlineItem[]
}

interface WordAlternateViewProps {
  mode: Exclude<WordViewMode, 'page'>
  snapshot: WordViewSnapshot
  zoom: number
}

interface WordViewStatusBarProps {
  editorRootRef: RefObject<HTMLElement>
  eyeCare: boolean
  onEyeCareChange: (enabled: boolean) => void
  viewMode: WordViewMode
  onViewModeChange: (mode: WordViewMode) => void
  playback?: WordPlaybackState | null
  onPlaybackPause?: () => void
  onPlaybackResume?: () => void
  onPlaybackLocate?: () => void
  onPlaybackSkipAnimations?: () => void
}

type ZoomChoice = '200' | '100' | '75' | 'page-width' | 'text-width' | 'whole-page' | 'custom'
type FitZoomChoice = Extract<ZoomChoice, 'page-width' | 'text-width' | 'whole-page'>

const MIN_ZOOM_PERCENT = 10
const MAX_ZOOM_PERCENT = 500
const ZOOM_SLIDER_VALUES = [
  10, 20, 30, 40, 50, 60, 70, 75, 80, 90, 100,
  110, 120, 130, 140, 150, 175, 200, 250, 350, 500,
] as const

function clampPercent(value: number): number {
  return Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, Math.round(value)))
}

function fixedChoice(percent: number): ZoomChoice {
  if (percent === 200) return '200'
  if (percent === 100) return '100'
  if (percent === 75) return '75'
  return 'custom'
}

function isFitChoice(choice: ZoomChoice): choice is FitZoomChoice {
  return choice === 'page-width' || choice === 'text-width' || choice === 'whole-page'
}

function nearestSliderIndex(percent: number): number {
  let nearest = 0
  let distance = Number.POSITIVE_INFINITY
  ZOOM_SLIDER_VALUES.forEach((value, index) => {
    const nextDistance = Math.abs(value - percent)
    if (nextDistance < distance) {
      distance = nextDistance
      nearest = index
    }
  })
  return nearest
}

function measureTextBaseWidth(page: HTMLElement, currentScale: number): number {
  const pageRect = page.getBoundingClientRect()
  const candidates = Array.from(
    page.querySelectorAll<HTMLElement>(
      '.superdoc-line, [data-layout-fragment-id], [data-pm-start]',
    ),
  )
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    if (rect.right < pageRect.left || rect.left > pageRect.right) continue
    left = Math.min(left, Math.max(pageRect.left, rect.left))
    right = Math.max(right, Math.min(pageRect.right, rect.right))
  }
  const visualWidth = right > left ? right - left : pageRect.width * 0.78
  return Math.max(page.offsetWidth * 0.45, visualWidth / Math.max(currentScale, 0.01))
}

function calculateFitPercent(
  editorRoot: HTMLElement,
  choice: FitZoomChoice,
  currentZoom: number,
): number | null {
  const viewport = editorRoot.querySelector<HTMLElement>('.superdoc__sub-document')
  const page = editorRoot.querySelector<HTMLElement>('.superdoc-page')
  if (!viewport || !page) return null

  const pageRect = page.getBoundingClientRect()
  const baseWidth = page.offsetWidth || pageRect.width / Math.max(currentZoom, 0.01)
  const baseHeight = page.offsetHeight || pageRect.height / Math.max(currentZoom, 0.01)
  if (!baseWidth || !baseHeight) return null

  const measuredScale = pageRect.width > 0 ? pageRect.width / baseWidth : currentZoom
  const availableWidth = Math.max(1, viewport.clientWidth - 36)
  const availableHeight = Math.max(1, viewport.clientHeight - 28)

  if (choice === 'page-width') {
    return clampPercent((availableWidth / baseWidth) * 100)
  }
  if (choice === 'text-width') {
    const textWidth = measureTextBaseWidth(page, measuredScale)
    return clampPercent((availableWidth / textWidth) * 100)
  }
  return clampPercent(Math.min(availableWidth / baseWidth, availableHeight / baseHeight) * 100)
}

function ControlTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="whitespace-nowrap rounded-md px-2 py-1 text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function WordAlternateView({ mode, snapshot, zoom }: WordAlternateViewProps) {
  const { t } = useTranslation()
  const style = { '--word-alternate-zoom': String(zoom) } as CSSProperties

  return (
    <div
      className={`word-alternate-view word-alternate-view--${mode}`}
      data-testid={`word-${mode}-view`}
      data-word-alternate-view={mode}
      style={style}
      role="document"
      aria-label={t(`wordLayout.${mode}View`)}
    >
      {mode === 'outline' ? (
        <div className="word-outline-surface" role="tree" aria-label={t('wordLayout.outlineView')}>
          {snapshot.outline.length > 0 ? (
            snapshot.outline.map((item, index) => (
              <div
                key={`${item.nodeId}:${index}`}
                className="word-outline-item"
                data-outline-level={item.level}
                role="treeitem"
                aria-level={item.level}
                style={{
                  paddingInlineStart: `${Math.max(0, item.level - 1) * 22}px`,
                  fontSize: `${Math.max(0.9, 1.2 - item.level * 0.06)}em`,
                }}
              >
                <span className="word-outline-marker" aria-hidden="true" />
                <span>{item.text}</span>
              </div>
            ))
          ) : (
            <p className="word-outline-empty">{t('wordLayout.outlineEmpty')}</p>
          )}
        </div>
      ) : (
        <div className="word-alternate-surface">
          <div
            className="word-alternate-content"
            dangerouslySetInnerHTML={{ __html: snapshot.html }}
          />
        </div>
      )}
    </div>
  )
}

export function WordViewStatusBar({
  editorRootRef,
  eyeCare,
  onEyeCareChange,
  viewMode,
  onViewModeChange,
  playback,
  onPlaybackPause,
  onPlaybackResume,
  onPlaybackLocate,
  onPlaybackSkipAnimations,
}: WordViewStatusBarProps) {
  const { t } = useTranslation()
  const { percent, previewZoomPercent, setZoomPercent } = useDocumentZoom()
  const radioName = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const expectedPercentRef = useRef<number | null>(null)
  const sliderGestureRef = useRef<'pointer' | 'keyboard' | null>(null)
  const sliderPreviewPercentRef = useRef(percent)
  const applyFitRef = useRef<(choice: FitZoomChoice) => void>(() => {})
  const [menuOpen, setMenuOpen] = useState(false)
  const [zoomChoice, setZoomChoice] = useState<ZoomChoice>(() => fixedChoice(percent))
  const [customPercent, setCustomPercent] = useState(String(percent))

  const sliderIndex = useMemo(() => nearestSliderIndex(percent), [percent])
  const sliderProgress = (sliderIndex / (ZOOM_SLIDER_VALUES.length - 1)) * 100

  const applyPercent = (value: number, choice = fixedChoice(clampPercent(value))) => {
    const next = clampPercent(value)
    sliderPreviewPercentRef.current = next
    expectedPercentRef.current = next
    setZoomChoice(choice)
    setCustomPercent(String(next))
    setZoomPercent(next)
  }

  const previewSliderPercent = (value: number) => {
    const next = clampPercent(value)
    sliderPreviewPercentRef.current = next
    expectedPercentRef.current = next
    setZoomChoice(fixedChoice(next))
    setCustomPercent(String(next))
    previewZoomPercent(next)
  }

  const finishSliderGesture = () => {
    if (sliderGestureRef.current === null) return
    sliderGestureRef.current = null
    applyPercent(sliderPreviewPercentRef.current)
  }

  const applyFit = (choice: FitZoomChoice) => {
    setZoomChoice(choice)
    const editorRoot = editorRootRef.current
    if (!editorRoot) return
    const next = calculateFitPercent(editorRoot, choice, percent / 100)
    if (next !== null) applyPercent(next, choice)
  }
  applyFitRef.current = applyFit

  useEffect(() => {
    if (sliderGestureRef.current === null) sliderPreviewPercentRef.current = percent
    const expected = expectedPercentRef.current
    if (expected !== null && Math.abs(expected - percent) <= 1) {
      expectedPercentRef.current = null
    } else if (expected === null) {
      setZoomChoice(fixedChoice(percent))
    } else {
      expectedPercentRef.current = null
      setZoomChoice(fixedChoice(percent))
    }
    setCustomPercent(String(percent))
  }, [percent])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!isFitChoice(zoomChoice)) return
    const editorRoot = editorRootRef.current
    if (!editorRoot) return
    let frame: number | null = null
    const schedule = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        applyFitRef.current(zoomChoice)
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(editorRoot)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [editorRootRef, zoomChoice])

  const commitCustomPercent = () => {
    const next = Number(customPercent)
    if (Number.isFinite(next)) applyPercent(next, 'custom')
    else setCustomPercent(String(percent))
  }

  const viewControls = [
    { mode: 'page' as const, label: t('wordLayout.pageView'), Icon: FileText },
    { mode: 'outline' as const, label: t('wordLayout.outlineView'), Icon: ListTree },
    { mode: 'reading' as const, label: t('wordLayout.readingView'), Icon: BookOpen },
    { mode: 'web' as const, label: t('wordLayout.webView'), Icon: Globe2 },
  ]

  const zoomOptions: Array<{
    choice: Exclude<ZoomChoice, 'custom'>
    label: string
    shortcut?: string
    percent?: number
  }> = [
    { choice: '200', label: '200%', percent: 200 },
    { choice: '100', label: '100%', percent: 100 },
    { choice: '75', label: '75%', percent: 75 },
    { choice: 'page-width', label: t('wordLayout.pageWidth'), shortcut: 'P' },
    { choice: 'text-width', label: t('wordLayout.textWidth'), shortcut: 'T' },
    { choice: 'whole-page', label: t('wordLayout.wholePage'), shortcut: 'W' },
  ]

  return (
    <TooltipProvider delayDuration={450}>
      <div className="word-status-bar" data-testid="word-status-bar" dir="ltr">
        {playback && playback.phase !== 'idle' && (
          <div className="word-agent-status" data-phase={playback.phase} data-testid="word-agent-status">
            <span className="word-agent-status-dot" aria-hidden="true" />
            <span className="word-agent-status-name">{playback.agentName || t('wordAgent.agent')}</span>
            <span className="word-agent-status-action">
              {playback.phase === 'paused'
                ? t('wordAgent.paused')
                : playback.phase === 'interrupted'
                  ? t('wordAgent.replanning')
                  : playback.currentAction || t('wordAgent.editing')}
            </span>
            <span className="word-agent-status-count">
              {t('wordAgent.progressCount', { completed: playback.completed, total: playback.total })}
            </span>
            <span className="word-agent-progress-track" aria-hidden="true">
              <span style={{ width: `${playback.total > 0 ? (playback.completed / playback.total) * 100 : 0}%` }} />
            </span>
            <div className="word-agent-status-actions">
              {playback.phase === 'paused' ? (
                <ControlTooltip label={t('wordAgent.resume')}>
                  <button
                    type="button"
                    className="word-status-icon-button word-agent-control"
                    aria-label={t('wordAgent.resume')}
                    onClick={onPlaybackResume}
                    data-testid="word-agent-resume"
                  >
                    <Play aria-hidden="true" />
                  </button>
                </ControlTooltip>
              ) : playback.phase === 'running' ? (
                <ControlTooltip label={t('wordAgent.pause')}>
                  <button
                    type="button"
                    className="word-status-icon-button word-agent-control"
                    aria-label={t('wordAgent.pause')}
                    onClick={onPlaybackPause}
                    data-testid="word-agent-pause"
                  >
                    <Pause aria-hidden="true" />
                  </button>
                </ControlTooltip>
              ) : null}
              {!playback.followAgent && (
                <ControlTooltip label={t('wordAgent.locate')}>
                  <button
                    type="button"
                    className="word-status-icon-button word-agent-control"
                    aria-label={t('wordAgent.locate')}
                    onClick={onPlaybackLocate}
                    data-testid="word-agent-locate"
                  >
                    <LocateFixed aria-hidden="true" />
                  </button>
                </ControlTooltip>
              )}
              {!playback.skipAnimations && playback.phase !== 'completed' && (
                <ControlTooltip label={t('wordAgent.skipAnimations')}>
                  <button
                    type="button"
                    className="word-status-icon-button word-agent-control"
                    aria-label={t('wordAgent.skipAnimations')}
                    onClick={onPlaybackSkipAnimations}
                    data-testid="word-agent-skip-animations"
                  >
                    <FastForward aria-hidden="true" />
                  </button>
                </ControlTooltip>
              )}
            </div>
          </div>
        )}
        <div className="word-status-controls">
          <ControlTooltip label={t('wordLayout.eyeCare')}>
            <button
              type="button"
              className="word-status-icon-button"
              data-active={eyeCare ? 'true' : 'false'}
              data-testid="word-eye-care"
              aria-label={t('wordLayout.eyeCare')}
              aria-pressed={eyeCare}
              onClick={() => onEyeCareChange(!eyeCare)}
            >
              <Eye aria-hidden="true" />
            </button>
          </ControlTooltip>

          <span className="word-status-separator" aria-hidden="true" />

          {viewControls.map(({ mode, label, Icon }) => (
            <ControlTooltip key={mode} label={label}>
              <button
                type="button"
                className="word-status-icon-button"
                data-active={viewMode === mode ? 'true' : 'false'}
                data-testid={`word-view-${mode}`}
                aria-label={label}
                aria-pressed={viewMode === mode}
                onClick={() => onViewModeChange(mode)}
              >
                <Icon aria-hidden="true" />
              </button>
            </ControlTooltip>
          ))}

          <span className="word-status-separator" aria-hidden="true" />

          <ControlTooltip label={t('wordLayout.wholePage')}>
            <button
              type="button"
              className="word-status-icon-button"
              data-active={zoomChoice === 'whole-page' ? 'true' : 'false'}
              data-testid="word-zoom-fit"
              aria-label={t('wordLayout.wholePage')}
              onClick={() => applyFit('whole-page')}
            >
              <Focus aria-hidden="true" />
            </button>
          </ControlTooltip>

          <div className="word-zoom-menu-anchor" ref={menuRef}>
            <button
              type="button"
              className="word-zoom-trigger"
              data-testid="word-zoom-trigger"
              aria-label={t('wordLayout.displayScale')}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span>{percent}%</span>
              {menuOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </button>

            {menuOpen && (
              <div
                className="word-zoom-popup"
                data-testid="word-zoom-popup"
                role="dialog"
                aria-label={t('wordLayout.displayScale')}
              >
                <div className="word-zoom-popup-title">{t('wordLayout.displayScale')}</div>
                <div className="word-zoom-options" role="radiogroup">
                  {zoomOptions.map((option) => (
                    <label key={option.choice} className="word-zoom-option">
                      <input
                        type="radio"
                        name={radioName}
                        value={option.choice}
                        checked={zoomChoice === option.choice}
                        data-testid={`word-zoom-option-${option.choice}`}
                        onChange={() => {
                          if (typeof option.percent === 'number') {
                            applyPercent(option.percent, option.choice)
                          } else {
                            applyFit(option.choice as FitZoomChoice)
                          }
                        }}
                      />
                      <span>{option.label}</span>
                      {option.shortcut && <span className="word-zoom-shortcut">({option.shortcut})</span>}
                    </label>
                  ))}
                </div>
                <label className="word-zoom-custom-row">
                  <span>{t('wordLayout.percentage')} (E):</span>
                  <span className="word-zoom-number-field">
                    <input
                      type="number"
                      min={MIN_ZOOM_PERCENT}
                      max={MAX_ZOOM_PERCENT}
                      step={1}
                      value={customPercent}
                      data-testid="word-zoom-custom-input"
                      aria-label={t('wordLayout.percentage')}
                      onFocus={() => setZoomChoice('custom')}
                      onChange={(event) => setCustomPercent(event.target.value)}
                      onBlur={commitCustomPercent}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          commitCustomPercent()
                          setMenuOpen(false)
                        }
                      }}
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </label>
              </div>
            )}
          </div>

          <ControlTooltip label={t('wordLayout.zoomOut')}>
            <button
              type="button"
              className="word-status-icon-button word-zoom-step-button"
              data-testid="word-zoom-out"
              aria-label={t('wordLayout.zoomOut')}
              disabled={percent <= MIN_ZOOM_PERCENT}
              onClick={() => applyPercent(percent - 10)}
            >
              <Minus aria-hidden="true" />
            </button>
          </ControlTooltip>

          <input
            type="range"
            className="word-zoom-slider"
            min={0}
            max={ZOOM_SLIDER_VALUES.length - 1}
            step={1}
            value={sliderIndex}
            style={{ '--word-zoom-progress': `${sliderProgress}%` } as CSSProperties}
            data-testid="word-zoom-slider"
            aria-label={t('wordLayout.displayScale')}
            aria-valuetext={`${percent}%`}
            onPointerDown={() => {
              sliderGestureRef.current = 'pointer'
              sliderPreviewPercentRef.current = percent
            }}
            onPointerUp={finishSliderGesture}
            onPointerCancel={finishSliderGesture}
            onKeyDown={(event) => {
              if (
                sliderGestureRef.current !== 'pointer'
                && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']
                  .includes(event.key)
              ) {
                sliderGestureRef.current = 'keyboard'
                sliderPreviewPercentRef.current = percent
              }
            }}
            onKeyUp={(event) => {
              if (
                sliderGestureRef.current === 'keyboard'
                && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']
                  .includes(event.key)
              ) {
                finishSliderGesture()
              }
            }}
            onBlur={finishSliderGesture}
            onChange={(event) => {
              const index = Number(event.target.value)
              const next = ZOOM_SLIDER_VALUES[index] ?? 100
              if (sliderGestureRef.current === null) applyPercent(next)
              else previewSliderPercent(next)
            }}
          />

          <ControlTooltip label={t('wordLayout.zoomIn')}>
            <button
              type="button"
              className="word-status-icon-button word-zoom-step-button"
              data-testid="word-zoom-in"
              aria-label={t('wordLayout.zoomIn')}
              disabled={percent >= MAX_ZOOM_PERCENT}
              onClick={() => applyPercent(percent + 10)}
            >
              <Plus aria-hidden="true" />
            </button>
          </ControlTooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

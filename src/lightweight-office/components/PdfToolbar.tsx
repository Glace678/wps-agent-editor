import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Bold,
  ChevronDown,
  ChevronUp,
  Columns2,
  Fullscreen,
  ImageIcon,
  Italic,
  MoveHorizontal,
  Pencil,
  RectangleVertical,
  RotateCcw,
  RotateCw,
  Type,
  Underline,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'
import type { SystemFontFace } from '../utils/system-fonts'

export type PdfFitMode = 'custom' | 'page' | 'width'
export type PdfPageLayout = 'single' | 'two'
export type PdfEditTool = 'select' | 'text' | 'image' | null

interface PdfToolbarProps {
  currentPage: number
  totalPages: number
  /** 当前缩放百分比（整数） */
  percent: number
  fitMode: PdfFitMode
  layout: PdfPageLayout
  editMode: boolean
  editEnabled: boolean
  currentTool: PdfEditTool
  fontSize: number
  fontWeight: number
  fontItalic: boolean
  fontUnderline: boolean
  fontColor: string
  fontFamily: string
  fontFaces: SystemFontFace[]
  canUndoEdit: boolean
  canRedoEdit: boolean
  onPrevPage: () => void
  onNextPage: () => void
  onGoToPage: (page: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFitPage: () => void
  onFitWidth: () => void
  onRotateLeft: () => void
  onRotateRight: () => void
  onLayoutSingle: () => void
  onLayoutTwo: () => void
  onToggleEditMode: () => void
  onSetTool: (tool: PdfEditTool) => void
  onSetFontFamily: (family: string) => void
  onSetFontSize: (size: number) => void
  onToggleBold: () => void
  onToggleItalic: () => void
  onToggleUnderline: () => void
  onSetFontColor: (color: string) => void
  onInsertImage: () => void
  onUndoEdit: () => void
  onRedoEdit: () => void
  /** 注册「聚焦页码输入框」回调（Ctrl+G） */
  onRegisterFocusPageInput?: (focus: (() => void) | null) => void
}

/**
 * Office 风格增强提示：功能名称 +（快捷键）+ 功能说明。
 */
function RichTooltip({
  name,
  shortcut,
  description,
  children,
}: {
  name: string
  shortcut?: string
  description: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[320px]">
        <p className="text-[13px] font-semibold leading-tight">
          {name}
          {shortcut && (
            <span className="ml-1.5 font-normal opacity-60">({shortcut})</span>
          )}
        </p>
        <p className="mt-1 text-[12px] leading-snug opacity-75">{description}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function ToolButton({
  name,
  shortcut,
  description,
  pressed,
  disabled,
  testId,
  onClick,
  children,
}: {
  name: string
  shortcut?: string
  description: string
  pressed?: boolean
  disabled?: boolean
  testId: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <RichTooltip name={name} shortcut={shortcut} description={description}>
      {/* 禁用态用 aria-disabled 而非原生 disabled：Office 风格下
          禁用按钮仍显示悬停提示、保留在 Tab 顺序中 */}
      <button
        type="button"
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-foreground/80 outline-none',
          'hover:bg-black/[0.07] focus-visible:ring-2 focus-visible:ring-[#4f93e7] dark:hover:bg-white/[0.08]',
          pressed && 'bg-black/[0.09] text-foreground dark:bg-white/[0.12]',
          disabled && 'cursor-default opacity-40 hover:bg-transparent dark:hover:bg-transparent',
        )}
        aria-label={shortcut ? `${name} (${shortcut})` : name}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        data-testid={testId}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!disabled) onClick()
        }}
      >
        {children}
      </button>
    </RichTooltip>
  )
}

function Divider() {
  return <div aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-black/10 dark:bg-white/10" />
}

const ICON = 'h-4 w-4'

const PDF_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef',
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0',
  '#002060', '#7030a0',
]

interface PopupPosition {
  left: number
  top: number
  width: number
}

const POPUP_GAP = 4
const VIEWPORT_PADDING = 8

function useFixedToolbarPopup(width: number) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopupPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const popup = popupRef.current
    if (!trigger || !popup) return

    const triggerRect = trigger.getBoundingClientRect()
    const popupHeight = popup.getBoundingClientRect().height
    const resolvedWidth = Math.min(width, Math.max(0, window.innerWidth - VIEWPORT_PADDING * 2))
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - resolvedWidth - VIEWPORT_PADDING)
    const left = Math.min(Math.max(VIEWPORT_PADDING, triggerRect.left), maxLeft)
    const below = triggerRect.bottom + POPUP_GAP
    const above = triggerRect.top - POPUP_GAP - popupHeight
    const top = below + popupHeight <= window.innerHeight - VIEWPORT_PADDING
      ? below
      : Math.max(VIEWPORT_PADDING, above)
    setPosition({ left, top, width: resolvedWidth })
  }, [width])

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const toggle = useCallback(() => {
    setPosition(null)
    setOpen((value) => !value)
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const frame = requestAnimationFrame(updatePosition)
    return () => cancelAnimationFrame(frame)
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const isInside = (target: EventTarget | null) => target instanceof Node
      && (popupRef.current?.contains(target) || triggerRef.current?.contains(target))
    const handlePointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) close()
    }
    const handleFocusIn = (event: FocusEvent) => {
      if (!isInside(event.target)) close()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close(true)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [close, open, updatePosition])

  return { close, open, popupRef, position, toggle, triggerRef }
}

export function PdfToolbar({
  currentPage,
  totalPages,
  percent,
  fitMode,
  layout,
  editMode,
  editEnabled,
  currentTool,
  fontSize,
  fontWeight,
  fontItalic,
  fontUnderline,
  fontColor,
  fontFamily,
  fontFaces,
  canUndoEdit,
  canRedoEdit,
  onPrevPage,
  onNextPage,
  onGoToPage,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitPage,
  onFitWidth,
  onRotateLeft,
  onRotateRight,
  onLayoutSingle,
  onLayoutTwo,
  onToggleEditMode,
  onSetTool,
  onSetFontFamily,
  onSetFontSize,
  onToggleBold,
  onToggleItalic,
  onToggleUnderline,
  onSetFontColor,
  onInsertImage,
  onUndoEdit,
  onRedoEdit,
  onRegisterFocusPageInput,
}: PdfToolbarProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pageInput, setPageInput] = useState(String(currentPage))
  const {
    close: closeFontDropdown,
    open: fontDropdownOpen,
    popupRef: fontListRef,
    position: fontPopupPosition,
    toggle: toggleFontDropdown,
    triggerRef: fontTriggerRef,
  } = useFixedToolbarPopup(192)
  const {
    close: closeFontSizeDropdown,
    open: fontSizeDropdownOpen,
    popupRef: fontSizeListRef,
    position: fontSizePopupPosition,
    toggle: toggleFontSizeDropdown,
    triggerRef: fontSizeTriggerRef,
  } = useFixedToolbarPopup(56)
  const {
    close: closeColorDropdown,
    open: colorDropdownOpen,
    popupRef: colorListRef,
    position: colorPopupPosition,
    toggle: toggleColorDropdown,
    triggerRef: colorTriggerRef,
  } = useFixedToolbarPopup(236)

  // 输入框未聚焦时跟随当前页
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setPageInput(String(currentPage))
    }
  }, [currentPage])

  useEffect(() => {
    if (!onRegisterFocusPageInput) return
    onRegisterFocusPageInput(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => onRegisterFocusPageInput(null)
  }, [onRegisterFocusPageInput])

  const commitPageInput = () => {
    const n = Number.parseInt(pageInput, 10)
    if (Number.isFinite(n)) onGoToPage(n)
    inputRef.current?.blur()
  }

  /** 输入框聚焦时点击翻页按钮：先失焦，否则同步 effect 会跳过更新导致页码陈旧 */
  const blurPageInputThen = (action: () => void) => {
    if (document.activeElement === inputRef.current) inputRef.current?.blur()
    action()
  }

  // 字体列表（去重，按家族名排序）
  const fontFamilies = [...new Map(
    fontFaces.map((f) => [f.familyName.trim().toLowerCase(), f.familyName]),
  ).values()].sort((a, b) => a.localeCompare(b, 'zh-CN'))

  const fontSizeOptions = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]

  return (
    <TooltipProvider delayDuration={450}>
      <div
        className="h-9 shrink-0 border-b border-black/10 bg-background dark:border-white/10"
        role="toolbar"
        aria-label={t('pdfViewer.toolbarLabel')}
        data-testid="pdf-toolbar"
      >
        <div className="h-full overflow-x-auto overflow-y-hidden px-2">
          {/* 按钮轨道单独滚动；弹层通过 Portal 脱离此裁剪区域。 */}
          <div className="mx-auto flex h-full w-max items-center gap-0.5">
          {/* 编辑模式开关 */}
          <ToolButton
            name={editMode ? t('pdfViewer.toolbarExitEdit') : t('pdfViewer.toolbarEditMode')}
            description={t('pdfViewer.toolbarEditModeDesc')}
            pressed={editMode}
            disabled={!editEnabled}
            testId="pdf-edit-mode"
            onClick={onToggleEditMode}
          >
            <Pencil className={ICON} />
          </ToolButton>

          {editMode && (
            <>
              <Divider />

              {/* 撤销/重做（编辑模式） */}
              <ToolButton
                name={t('pdfViewer.toolbarUndo')}
                shortcut="Ctrl+Z"
                description={t('pdfViewer.toolbarUndoDesc')}
                disabled={!canUndoEdit}
                testId="pdf-edit-undo"
                onClick={onUndoEdit}
              >
                <Undo2 className={ICON} />
              </ToolButton>
              <ToolButton
                name={t('pdfViewer.toolbarRedo')}
                shortcut="Ctrl+Y"
                description={t('pdfViewer.toolbarRedoDesc')}
                disabled={!canRedoEdit}
                testId="pdf-edit-redo"
                onClick={onRedoEdit}
              >
                <Redo2 className={ICON} />
              </ToolButton>

              <Divider />

              {/* 工具：文本 */}
              <ToolButton
                name={t('pdfViewer.toolbarTextTool')}
                description={t('pdfViewer.toolbarTextToolDesc')}
                pressed={currentTool === 'text'}
                testId="pdf-tool-text"
                onClick={() => onSetTool(currentTool === 'text' ? null : 'text')}
              >
                <Type className={ICON} />
              </ToolButton>

              {/* 工具：图片 */}
              <ToolButton
                name={t('pdfViewer.toolbarImageTool')}
                description={t('pdfViewer.toolbarImageToolDesc')}
                pressed={currentTool === 'image'}
                testId="pdf-tool-image"
                onClick={() => {
                  if (currentTool === 'image') {
                    onSetTool(null)
                  } else {
                    onSetTool('image')
                    onInsertImage()
                  }
                }}
              >
                <ImageIcon className={ICON} />
              </ToolButton>

              <Divider />

              {/* 字体选择下拉 */}
              <div className="relative">
                <RichTooltip
                  name={t('pdfViewer.toolbarFontFamily')}
                  description={t('pdfViewer.toolbarFontFamilyDesc')}
                >
                  <button
                    ref={fontTriggerRef}
                    type="button"
                    className="flex h-7 items-center gap-1 rounded-[4px] border border-black/10 bg-background px-2 text-[12px] text-foreground/80 hover:bg-black/[0.07] dark:border-white/20 dark:hover:bg-white/[0.08]"
                    data-testid="pdf-font-family"
                    aria-expanded={fontDropdownOpen}
                    onClick={toggleFontDropdown}
                    style={{ fontFamily, maxWidth: 140 }}
                  >
                    <span className="truncate">{fontFamily}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                  </button>
                </RichTooltip>
                {fontDropdownOpen && createPortal(
                  <div
                    ref={fontListRef}
                    className="fixed z-[10000] max-h-64 overflow-y-auto rounded-md border border-black/10 bg-background p-1 shadow-lg dark:border-white/10"
                    style={{
                      left: fontPopupPosition?.left ?? -9999,
                      top: fontPopupPosition?.top ?? -9999,
                      width: fontPopupPosition?.width ?? 192,
                      visibility: fontPopupPosition ? 'visible' : 'hidden',
                    }}
                    role="listbox"
                    data-testid="pdf-font-family-menu"
                  >
                    {fontFamilies.map((family) => (
                      <button
                        key={family}
                        type="button"
                        role="option"
                        aria-selected={fontFamily === family}
                        className={cn(
                          'block w-full truncate rounded px-2 py-1 text-left text-[12px]',
                          'hover:bg-black/[0.07] dark:hover:bg-white/[0.08]',
                          fontFamily === family && 'bg-[#0f6cbd]/10 text-[#0f6cbd] dark:bg-[#60a5fa]/15 dark:text-[#60a5fa]',
                        )}
                        style={{ fontFamily: family }}
                        onClick={() => {
                          onSetFontFamily(family)
                          closeFontDropdown()
                        }}
                      >
                        {family}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
              </div>

              {/* 字号选择下拉 */}
              <div className="relative">
                <RichTooltip
                  name={t('pdfViewer.toolbarFontSize')}
                  description={t('pdfViewer.toolbarFontSizeDesc')}
                >
                  <button
                    ref={fontSizeTriggerRef}
                    type="button"
                    className="flex h-7 w-14 items-center justify-between rounded-[4px] border border-black/10 bg-background px-2 text-[12px] text-foreground/80 hover:bg-black/[0.07] dark:border-white/20 dark:hover:bg-white/[0.08]"
                    data-testid="pdf-font-size"
                    aria-expanded={fontSizeDropdownOpen}
                    onClick={toggleFontSizeDropdown}
                  >
                    <span className="tabular-nums">{fontSize}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                  </button>
                </RichTooltip>
                {fontSizeDropdownOpen && createPortal(
                  <div
                    ref={fontSizeListRef}
                    className="fixed z-[10000] max-h-64 overflow-y-auto rounded-md border border-black/10 bg-background p-1 shadow-lg dark:border-white/10"
                    style={{
                      left: fontSizePopupPosition?.left ?? -9999,
                      top: fontSizePopupPosition?.top ?? -9999,
                      width: fontSizePopupPosition?.width ?? 56,
                      visibility: fontSizePopupPosition ? 'visible' : 'hidden',
                    }}
                    role="listbox"
                    data-testid="pdf-font-size-menu"
                  >
                    {fontSizeOptions.map((size) => (
                      <button
                        key={size}
                        type="button"
                        role="option"
                        aria-selected={fontSize === size}
                        className={cn(
                          'block w-full rounded px-2 py-1 text-center text-[12px] tabular-nums',
                          'hover:bg-black/[0.07] dark:hover:bg-white/[0.08]',
                          fontSize === size && 'bg-[#0f6cbd]/10 text-[#0f6cbd] dark:bg-[#60a5fa]/15 dark:text-[#60a5fa]',
                        )}
                        onClick={() => {
                          onSetFontSize(size)
                          closeFontSizeDropdown()
                        }}
                      >
                        {size}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
              </div>

              <Divider />

              {/* 加粗/斜体/下划线 */}
              <ToolButton
                name={t('pdfViewer.toolbarBold')}
                shortcut="Ctrl+B"
                description={t('pdfViewer.toolbarBoldDesc')}
                pressed={fontWeight >= 700}
                testId="pdf-edit-bold"
                onClick={onToggleBold}
              >
                <Bold className={ICON} />
              </ToolButton>
              <ToolButton
                name={t('pdfViewer.toolbarItalic')}
                shortcut="Ctrl+I"
                description={t('pdfViewer.toolbarItalicDesc')}
                pressed={fontItalic}
                testId="pdf-edit-italic"
                onClick={onToggleItalic}
              >
                <Italic className={ICON} />
              </ToolButton>
              <ToolButton
                name={t('pdfViewer.toolbarUnderline')}
                shortcut="Ctrl+U"
                description={t('pdfViewer.toolbarUnderlineDesc')}
                pressed={fontUnderline}
                testId="pdf-edit-underline"
                onClick={onToggleUnderline}
              >
                <Underline className={ICON} />
              </ToolButton>

              <Divider />

              {/* 字体颜色 */}
              <div className="relative">
                <RichTooltip
                  name={t('pdfViewer.toolbarFontColor')}
                  description={t('pdfViewer.toolbarFontColorDesc')}
                >
                  <button
                    ref={colorTriggerRef}
                    type="button"
                    className="relative flex h-7 w-7 items-center justify-center rounded-[4px] hover:bg-black/[0.07] dark:hover:bg-white/[0.08]"
                    data-testid="pdf-font-color"
                    aria-expanded={colorDropdownOpen}
                    onClick={toggleColorDropdown}
                  >
                    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 20h16" />
                      <path d="M6.3 17 12 4l5.7 13" />
                    </svg>
                    <span
                      className="absolute bottom-0.5 left-1/2 h-1 w-4 -translate-x-1/2 rounded-sm"
                      style={{ backgroundColor: fontColor }}
                      aria-hidden="true"
                    />
                  </button>
                </RichTooltip>
                {colorDropdownOpen && createPortal(
                  <div
                    ref={colorListRef}
                    className="fixed z-[10000] grid grid-cols-9 gap-1 rounded-md border border-black/10 bg-background p-2 shadow-lg dark:border-white/10"
                    style={{
                      left: colorPopupPosition?.left ?? -9999,
                      top: colorPopupPosition?.top ?? -9999,
                      width: colorPopupPosition?.width ?? 236,
                      visibility: colorPopupPosition ? 'visible' : 'hidden',
                    }}
                    role="listbox"
                    data-testid="pdf-font-color-menu"
                  >
                    {PDF_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        role="option"
                        aria-selected={fontColor === color}
                        aria-label={color}
                        className={cn(
                          'h-5 w-5 rounded border border-black/10 transition-transform hover:scale-110 dark:border-white/20',
                          fontColor === color && 'ring-2 ring-[#0f6cbd] ring-offset-1 dark:ring-[#60a5fa]',
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => {
                          onSetFontColor(color)
                          closeColorDropdown()
                        }}
                      />
                    ))}
                  </div>,
                  document.body,
                )}
              </div>

              <Divider />
            </>
          )}

          {/* 页面导航 */}
          <ToolButton
            name={t('pdfViewer.toolbarPrevPage')}
            description={t('pdfViewer.toolbarPrevPageDesc')}
            disabled={currentPage <= 1}
            testId="pdf-prev-page"
            onClick={() => blurPageInputThen(onPrevPage)}
          >
            <ChevronUp className={ICON} />
          </ToolButton>
          <RichTooltip
            name={t('pdfViewer.toolbarPageInput')}
            shortcut="Ctrl+G"
            description={t('pdfViewer.toolbarPageInputDesc')}
          >
            <span className="flex items-center gap-1 px-1 text-[12px] text-foreground/80">
              <input
                ref={inputRef}
                value={pageInput}
                inputMode="numeric"
                className="h-6 w-10 rounded-[4px] border border-black/15 bg-transparent text-center outline-none focus:border-[#4f93e7] focus:ring-1 focus:ring-[#4f93e7] dark:border-white/20"
                aria-label={t('pdfViewer.toolbarPageInput')}
                data-testid="pdf-page-input"
                onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => setPageInput(String(currentPage))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitPageInput()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setPageInput(String(currentPage))
                    inputRef.current?.blur()
                  }
                }}
              />
              <span className="whitespace-nowrap tabular-nums" data-testid="pdf-page-total">
                {t('pdfViewer.toolbarPageTotal', { total: totalPages })}
              </span>
            </span>
          </RichTooltip>
          <ToolButton
            name={t('pdfViewer.toolbarNextPage')}
            description={t('pdfViewer.toolbarNextPageDesc')}
            disabled={currentPage >= totalPages}
            testId="pdf-next-page"
            onClick={() => blurPageInputThen(onNextPage)}
          >
            <ChevronDown className={ICON} />
          </ToolButton>

          <Divider />

          {/* 缩放 */}
          <ToolButton
            name={t('pdfViewer.toolbarZoomOut')}
            shortcut="Ctrl+-"
            description={t('pdfViewer.toolbarZoomOutDesc')}
            testId="pdf-zoom-out"
            onClick={onZoomOut}
          >
            <ZoomOut className={ICON} />
          </ToolButton>
          <RichTooltip
            name={t('pdfViewer.toolbarZoomLevel')}
            shortcut="Ctrl+0"
            description={t('pdfViewer.toolbarZoomLevelDesc')}
          >
            <button
              type="button"
              className="h-7 min-w-[3.25rem] shrink-0 rounded-[4px] px-1 text-center text-[12px] tabular-nums text-foreground/80 outline-none hover:bg-black/[0.07] focus-visible:ring-2 focus-visible:ring-[#4f93e7] dark:hover:bg-white/[0.08]"
              aria-label={`${t('pdfViewer.toolbarZoomLevel')} (Ctrl+0)`}
              data-testid="pdf-zoom-reset"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onZoomReset}
            >
              {percent}%
            </button>
          </RichTooltip>
          <ToolButton
            name={t('pdfViewer.toolbarZoomIn')}
            shortcut="Ctrl+="
            description={t('pdfViewer.toolbarZoomInDesc')}
            testId="pdf-zoom-in"
            onClick={onZoomIn}
          >
            <ZoomIn className={ICON} />
          </ToolButton>

          <Divider />

          {/* 适配 */}
          <ToolButton
            name={t('pdfViewer.toolbarFitWidth')}
            shortcut="Ctrl+2"
            description={t('pdfViewer.toolbarFitWidthDesc')}
            pressed={fitMode === 'width'}
            testId="pdf-fit-width"
            onClick={onFitWidth}
          >
            <MoveHorizontal className={ICON} />
          </ToolButton>
          <ToolButton
            name={t('pdfViewer.toolbarFitPage')}
            shortcut="Ctrl+1"
            description={t('pdfViewer.toolbarFitPageDesc')}
            pressed={fitMode === 'page'}
            testId="pdf-fit-page"
            onClick={onFitPage}
          >
            <Fullscreen className={ICON} />
          </ToolButton>

          <Divider />

          {/* 旋转 */}
          <ToolButton
            name={t('pdfViewer.toolbarRotateLeft')}
            shortcut="Ctrl+Shift+-"
            description={t('pdfViewer.toolbarRotateLeftDesc')}
            testId="pdf-rotate-left"
            onClick={onRotateLeft}
          >
            <RotateCcw className={ICON} />
          </ToolButton>
          <ToolButton
            name={t('pdfViewer.toolbarRotateRight')}
            shortcut="Ctrl+Shift+="
            description={t('pdfViewer.toolbarRotateRightDesc')}
            testId="pdf-rotate-right"
            onClick={onRotateRight}
          >
            <RotateCw className={ICON} />
          </ToolButton>

          <Divider />

          {/* 页面布局 */}
          <ToolButton
            name={t('pdfViewer.toolbarSinglePage')}
            shortcut="Ctrl+Shift+1"
            description={t('pdfViewer.toolbarSinglePageDesc')}
            pressed={layout === 'single'}
            testId="pdf-layout-single"
            onClick={onLayoutSingle}
          >
            <RectangleVertical className={ICON} />
          </ToolButton>
          <ToolButton
            name={t('pdfViewer.toolbarTwoPages')}
            shortcut="Ctrl+Shift+2"
            description={t('pdfViewer.toolbarTwoPagesDesc')}
            pressed={layout === 'two'}
            testId="pdf-layout-two"
            onClick={onLayoutTwo}
          >
            <Columns2 className={ICON} />
          </ToolButton>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

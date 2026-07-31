import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  Fullscreen,
  MoveHorizontal,
  RectangleVertical,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n/runtime'

export type PdfFitMode = 'custom' | 'page' | 'width'
export type PdfPageLayout = 'single' | 'two'

interface PdfToolbarProps {
  currentPage: number
  totalPages: number
  /** 当前缩放百分比（整数） */
  percent: number
  fitMode: PdfFitMode
  layout: PdfPageLayout
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
      <TooltipContent side="bottom" className="max-w-[280px]">
        <p className="text-[12px] font-semibold leading-tight">
          {name}
          {shortcut && (
            <span className="ml-1.5 font-normal opacity-60">({shortcut})</span>
          )}
        </p>
        <p className="mt-1 text-[11px] leading-snug opacity-75">{description}</p>
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

export function PdfToolbar({
  currentPage,
  totalPages,
  percent,
  fitMode,
  layout,
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
  onRegisterFocusPageInput,
}: PdfToolbarProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pageInput, setPageInput] = useState(String(currentPage))

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

  return (
    <TooltipProvider delayDuration={450}>
      <div
        className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-black/10 bg-background px-2 dark:border-white/10"
        role="toolbar"
        aria-label={t('pdfViewer.toolbarLabel')}
        data-testid="pdf-toolbar"
      >
        {/* 内层 mx-auto：空间足够时居中，不够时靠左并可横向滚动（不会左侧裁切） */}
        <div className="mx-auto flex items-center gap-0.5">
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
    </TooltipProvider>
  )
}

import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { FileText, Plus, X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import { CodeOfficialIcon } from '@/lib/code-official-icons'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getTabTransformX, reorderTabsById } from '../document-tabs'
import { createAgentAttachment, writeAgentAttachmentDragData } from '@/lib/agent-attachments'

export interface DocumentTabBarItem {
  id: string
  name: string
  path?: string
  dirty?: boolean
  kind?: 'word' | 'excel' | 'slide' | 'pdf' | 'text' | 'code' | 'unknown'
}

interface DocumentTabBarProps {
  tabs: DocumentTabBarItem[]
  activeTabId: string
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onReorder: (orderedIds: string[]) => void
  onNew?: () => void
  /** Show recognizable file-type badges (LightweightDocumentEditor shell). */
  showKindIcons?: boolean
  testId?: string
}

interface FileTypeBadgeProps {
  label: string
  title: string
  backgroundColor: string
  foregroundColor: string
  borderColor?: string
  accentColor?: string
  fileType: string
}

const DOCUMENT_TAB_ICON_SIZE = 16

function FileTypeBadge({
  label,
  title,
  backgroundColor,
  foregroundColor,
  borderColor = 'transparent',
  accentColor,
  fileType,
}: FileTypeBadgeProps) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[3px] border font-bold leading-none select-none"
      style={{
        width: DOCUMENT_TAB_ICON_SIZE,
        height: DOCUMENT_TAB_ICON_SIZE,
        backgroundColor,
        color: foregroundColor,
        borderColor,
        boxShadow: accentColor ? `inset 0 -2px ${accentColor}` : undefined,
        fontSize: label.length >= 3 ? '7px' : '8px',
      }}
      role="img"
      aria-label={title}
      title={title}
      data-file-type={fileType}
    >
      {label}
    </span>
  )
}

function KindIcon({ tab }: { tab: DocumentTabBarItem }) {
  if (tab.kind === 'word') {
    return <FileTypeBadge label="W" title="Word" backgroundColor="#2b579a" foregroundColor="#fff" fileType="word" />
  }
  if (tab.kind === 'excel') {
    return <FileTypeBadge label="X" title="Excel" backgroundColor="#107c41" foregroundColor="#fff" fileType="excel" />
  }
  if (tab.kind === 'slide') {
    return <FileTypeBadge label="P" title="PowerPoint" backgroundColor="#d24726" foregroundColor="#fff" fileType="powerpoint" />
  }
  if (tab.kind === 'pdf') {
    return <FileTypeBadge label="PDF" title="PDF" backgroundColor="#b00a0f" foregroundColor="#fff" fileType="pdf" />
  }
  if (tab.kind === 'text') {
    const markdown = /\.(?:md|markdown)$/i.test(tab.path ?? tab.name)
    return (
      <FileTypeBadge
        label={markdown ? 'MD' : 'TXT'}
        title={markdown ? 'Markdown' : 'Text'}
        backgroundColor={markdown ? '#755838' : '#64748b'}
        foregroundColor="#fff"
        fileType={markdown ? 'markdown' : 'text'}
      />
    )
  }
  if (tab.kind === 'code') {
    return <CodeOfficialIcon filePath={tab.path ?? tab.name} size={DOCUMENT_TAB_ICON_SIZE} className="shrink-0" />
  }
  if (tab.kind === 'unknown') {
    return <FileText size={DOCUMENT_TAB_ICON_SIZE} className="shrink-0 text-muted-foreground" />
  }
  return null
}

/**
 * Block / Pill styled document tab bar with fluid displacement animation and auto-scaling.
 * Features:
 * - Single-row responsive layout without scrollbars (自动缩放与单行展示).
 * - Rich hover tooltip displaying full file name, path, and unsaved state when hovering a tab.
 * - Discrete block/pill cards with right-side hover close button.
 * - Dynamic push/pull displacement animation on drag reorder.
 */
export function DocumentTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onReorder,
  onNew,
  showKindIcons = false,
  testId = 'document-tab-bar',
}: DocumentTabBarProps) {
  const { t } = useTranslation()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [tabWidths, setTabWidths] = useState<Record<string, number>>({})
  const dragIdRef = useRef<string | null>(null)
  const tabElementsRef = useRef<Map<string, HTMLDivElement>>(new Map())

  const commitReorder = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return
      const next = reorderTabsById(tabs, fromId, toId)
      if (next.every((tab, index) => tab.id === tabs[index]?.id)) return
      onReorder(next.map((tab) => tab.id))
    },
    [onReorder, tabs],
  )

  const onDragStart = (event: DragEvent, tabId: string) => {
    dragIdRef.current = tabId
    setDraggingId(tabId)
    setDropTargetId(tabId)

    // Snapshot measured widths of all tabs for fluid displacement calculations
    const widths: Record<string, number> = {}
    tabElementsRef.current.forEach((el, id) => {
      if (el) widths[id] = el.offsetWidth
    })
    setTabWidths(widths)

    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData('text/plain', tabId)
    event.dataTransfer.setData('application/x-document-tab-id', tabId)
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (tab?.path) {
      writeAgentAttachmentDragData(
        event.dataTransfer,
        [createAgentAttachment(tab.path, 'tab')],
      )
      event.dataTransfer.effectAllowed = 'copyMove'
    }
  }

  const onDragEnd = () => {
    dragIdRef.current = null
    setDraggingId(null)
    setDropTargetId(null)
    setTabWidths({})
  }

  const onDragOver = (event: DragEvent, tabId: string) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropTargetId !== tabId) {
      setDropTargetId(tabId)
    }
  }

  const onDrop = (event: DragEvent, tabId: string) => {
    event.preventDefault()
    const fromId =
      dragIdRef.current
      || event.dataTransfer.getData('application/x-document-tab-id')
      || event.dataTransfer.getData('text/plain')
    if (fromId && fromId !== tabId) {
      commitReorder(fromId, tabId)
    }
    onDragEnd()
  }

  const focusTabAt = (index: number) => {
    if (index < 0 || index >= tabs.length) return
    const tab = tabs[index]
    onSelect(tab.id)
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-document-tab-id="${CSS.escape(tab.id)}"]`,
      )
      el?.focus()
    })
  }

  const onTabKeyDown = (event: ReactKeyboardEvent, tabId: string) => {
    const index = tabs.findIndex((tab) => tab.id === tabId)
    if (index < 0) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(tabId)
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusTabAt((index + 1) % tabs.length)
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusTabAt((index - 1 + tabs.length) % tabs.length)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusTabAt(0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusTabAt(tabs.length - 1)
      return
    }
    // Ctrl+Shift+Arrow: move tab in the strip (keyboard reorder)
    if (event.ctrlKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      const targetIndex = event.key === 'ArrowLeft' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= tabs.length) return
      commitReorder(tabId, tabs[targetIndex].id)
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-document-tab-id="${CSS.escape(tabId)}"]`)
          ?.focus()
      })
    }
  }

  if (tabs.length === 0) return null

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="flex h-[38px] shrink-0 items-center gap-1.5 border-b border-border bg-muted/40 px-2 select-none overflow-hidden"
        role="tablist"
        aria-label={t('notepad.documentTabs')}
        data-testid={testId}
        dir="ltr"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden py-1">
          {tabs.map((tab, index) => {
            const active = tab.id === activeTabId
            const isDragging = draggingId === tab.id
            const isDropTarget = dropTargetId === tab.id && draggingId !== null && draggingId !== tab.id
            const offsetX = getTabTransformX(
              tab.id,
              index,
              draggingId,
              dropTargetId,
              tabs,
              tabWidths,
              4,
            )

            return (
              <Tooltip key={tab.id} open={draggingId ? false : undefined}>
                <TooltipTrigger asChild>
                  <div
                    ref={(el) => {
                      if (el) tabElementsRef.current.set(tab.id, el)
                      else tabElementsRef.current.delete(tab.id)
                    }}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    draggable
                    data-document-tab-id={tab.id}
                    data-agent-attachment-path={tab.path}
                    data-testid={`document-tab-${tab.id}`}
                    style={{
                      transform: offsetX ? `translate3d(${offsetX}px, 0, 0)` : undefined,
                      transition: draggingId
                        ? 'transform 180ms cubic-bezier(0.25, 1, 0.5, 1), opacity 150ms ease, background-color 150ms ease'
                        : 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
                    }}
                    className={cn(
                      'group relative flex h-[30px] flex-1 min-w-[34px] max-w-[200px] shrink cursor-grab items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-all active:cursor-grabbing will-change-transform select-none',
                      active
                        ? 'border-border bg-card text-card-foreground font-medium shadow-xs'
                        : 'border-transparent bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground hover:border-border/40',
                      isDragging && 'opacity-30 border-dashed border-primary/50 bg-primary/5 scale-[0.98]',
                      isDropTarget && 'ring-1 ring-inset ring-primary/80',
                    )}
                    onClick={() => onSelect(tab.id)}
                    onKeyDown={(event) => onTabKeyDown(event, tab.id)}
                    onDragStart={(event) => onDragStart(event, tab.id)}
                    onDragEnd={onDragEnd}
                    onDragOver={(event) => onDragOver(event, tab.id)}
                    onDrop={(event) => onDrop(event, tab.id)}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      if (dropTargetId !== tab.id) {
                        setDropTargetId(tab.id)
                      }
                    }}
                  >
                    <div className="flex shrink-0 items-center justify-center">
                      {showKindIcons ? <KindIcon tab={tab} /> : null}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {tab.name}
                    </span>
                    <div className="relative flex h-full w-[18px] shrink-0 items-center justify-center -mr-0.5">
                      <button
                        type="button"
                        className={cn(
                          'group/btn relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full',
                          tab.dirty
                            ? 'opacity-85 hover:opacity-100 hover:bg-red-500/20 text-foreground hover:text-red-600 dark:hover:text-red-400'
                            : active
                              ? 'opacity-70 hover:opacity-100 hover:bg-red-500/20 text-foreground hover:text-red-600 dark:hover:text-red-400'
                              : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-red-500/20 text-muted-foreground hover:text-red-600 dark:hover:text-red-400',
                        )}
                        aria-label={t('notepad.closeFile', { name: tab.name })}
                        title={tab.dirty ? `${t('notepad.unsaved')} - ${t('notepad.closeTabShortcut')}` : t('notepad.closeTabShortcut')}
                        draggable={false}
                        onClick={(event) => {
                          event.stopPropagation()
                          onClose(tab.id)
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        {tab.dirty ? (
                          <>
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-foreground/75 group-hover/btn:hidden"
                              aria-hidden="true"
                            />
                            <X
                              className="hidden h-3.5 w-3.5 text-red-600 dark:text-red-400 group-hover/btn:block"
                              aria-hidden="true"
                            />
                          </>
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={6}
                  align="center"
                  className="z-[9999] max-w-sm rounded-xl border border-border bg-popover px-3.5 py-2 text-popover-foreground shadow-lg"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 font-medium text-foreground text-[15px]">
                      <span className="truncate">{tab.name}</span>
                      {tab.dirty ? (
                        <span className="text-[12.5px] text-amber-500 font-normal">
                          ({t('notepad.unsaved')})
                        </span>
                      ) : null}
                    </div>
                    {tab.path && tab.path !== tab.name ? (
                      <div className="truncate text-[12.5px] text-muted-foreground font-mono" dir="rtl">
                        <span dir="ltr">{tab.path}</span>
                      </div>
                    ) : null}
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        {onNew ? (
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            aria-label={t('notepad.newTab')}
            title={t('notepad.newTabShortcut')}
            onClick={onNew}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </TooltipProvider>
  )
}

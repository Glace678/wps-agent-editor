import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Code2, FileText, Plus, X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import { cn } from '@/lib/utils'
import { reorderTabsById } from '../document-tabs'

export interface DocumentTabBarItem {
  id: string
  name: string
  dirty?: boolean
  kind?: 'word' | 'excel' | 'pdf' | 'text' | 'code' | 'unknown'
}

interface DocumentTabBarProps {
  tabs: DocumentTabBarItem[]
  activeTabId: string
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onReorder: (orderedIds: string[]) => void
  onNew?: () => void
  /** Show W/X/P/T badges (LightweightDocumentEditor shell). */
  showKindIcons?: boolean
  testId?: string
}

function KindIcon({ kind }: { kind?: DocumentTabBarItem['kind'] }) {
  if (kind === 'word') {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-[#2b579a]">
        <span className="text-[13px] font-bold text-white">W</span>
      </div>
    )
  }
  if (kind === 'excel') {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-[#107c41]">
        <span className="text-[13px] font-bold text-white">X</span>
      </div>
    )
  }
  if (kind === 'pdf') {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-[#b00a0f]">
        <span className="text-[13px] font-bold text-white">P</span>
      </div>
    )
  }
  if (kind === 'text') {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#888] bg-[#f5f5f5] dark:border-[#666] dark:bg-[#333]">
        <span className="text-[13px] font-bold text-[#555] dark:text-[#aaa]">T</span>
      </div>
    )
  }
  if (kind === 'code') {
    return <Code2 className="h-5 w-5 shrink-0 text-[#16825d]" />
  }
  if (kind === 'unknown') {
    return <FileText className="h-6 w-6 shrink-0" />
  }
  return null
}

/**
 * Draggable document tab strip (txt / Word / Excel / PDF).
 * Drag a tab to reorder; Arrow keys / Home / End when focused cycle selection.
 * Shell shortcuts Ctrl+Tab / Ctrl+Shift+Tab are wired separately via office-shortcuts.
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
  const dragIdRef = useRef<string | null>(null)

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
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tabId)
    // Required in some Electron builds for drop to fire.
    event.dataTransfer.setData('application/x-document-tab-id', tabId)
  }

  const onDragEnd = () => {
    dragIdRef.current = null
    setDraggingId(null)
    setDropTargetId(null)
  }

  const onDragOver = (event: DragEvent, tabId: string) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dropTargetId !== tabId) setDropTargetId(tabId)
  }

  const onDrop = (event: DragEvent, tabId: string) => {
    event.preventDefault()
    const fromId =
      dragIdRef.current
      || event.dataTransfer.getData('application/x-document-tab-id')
      || event.dataTransfer.getData('text/plain')
    if (fromId) commitReorder(fromId, tabId)
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
    <div
      className="flex h-[38px] shrink-0 items-end gap-1 border-b border-black/[0.08] bg-[#f3f3f3] px-2 pt-1 dark:border-white/[0.07] dark:bg-[#0b1b28]"
      role="tablist"
      aria-label={t('notepad.documentTabs')}
      data-testid={testId}
      dir="ltr"
    >
      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId
          const isDragging = draggingId === tab.id
          const isDropTarget = dropTargetId === tab.id && draggingId !== tab.id
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              draggable
              data-document-tab-id={tab.id}
              data-testid={`document-tab-${tab.id}`}
              className={cn(
                'group flex h-[33px] min-w-[104px] max-w-[244px] shrink-0 cursor-grab items-center gap-2 rounded-t-[6px] border border-b-0 pl-3 pr-1 active:cursor-grabbing',
                active
                  ? 'border-black/[0.08] bg-white shadow-sm dark:border-white/[0.08] dark:bg-[#203746]'
                  : 'border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.05]',
                isDragging && 'opacity-50',
                isDropTarget && 'ring-2 ring-inset ring-[#4f93e7]',
              )}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, tab.id)}
              onDragStart={(event) => onDragStart(event, tab.id)}
              onDragEnd={onDragEnd}
              onDragOver={(event) => onDragOver(event, tab.id)}
              onDrop={(event) => onDrop(event, tab.id)}
              onDragEnter={(event) => {
                event.preventDefault()
                setDropTargetId(tab.id)
              }}
            >
              {showKindIcons ? <KindIcon kind={tab.kind} /> : null}
              <span className="min-w-0 flex-1 truncate text-[13px]" title={tab.name}>
                {tab.name}
              </span>
              {tab.dirty ? (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-current"
                  aria-label={t('notepad.unsaved')}
                />
              ) : null}
              <button
                type="button"
                className={cn(
                  'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.07] dark:hover:bg-white/[0.08]',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label={t('notepad.closeFile', { name: tab.name })}
                title={t('notepad.closeTabShortcut')}
                draggable={false}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(tab.id)
                }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
      {onNew ? (
        <button
          type="button"
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/[0.06] dark:hover:bg-white/[0.07]"
          aria-label={t('notepad.newTab')}
          title={t('notepad.newTabShortcut')}
          onClick={onNew}
        >
          <Plus className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}

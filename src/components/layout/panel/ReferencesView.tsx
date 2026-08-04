import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import { usePanelStore } from '@/stores/panel.store'
import { useDebugStore } from '@/stores/debug.store'

export function ReferencesView() {
  const { t } = useTranslation()
  const references = usePanelStore((s) => s.references)
  const referenceSymbol = usePanelStore((s) => s.referencesSymbol)
  const navigateToLine = usePanelStore((s) => s.navigateToLine)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <ChevronRight className="h-3.5 w-3.5" />
        {referenceSymbol && <span className="font-mono font-medium text-foreground">{referenceSymbol}</span>}
        <span>{t('bottomPanel.referencesHint', { count: references.length })}</span>
      </div>
      {references.map((item) => (
        <button
          type="button"
          key={`${item.line}:${item.column}:${item.preview}`}
          className="flex w-full items-center gap-3 px-3 py-1 text-left text-xs hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
          onClick={() => navigateToLine(item.line, item.column)}
        >
          <span className="w-16 shrink-0 text-primary">{item.line}:{item.column}</span>
          <span className="truncate font-mono text-foreground">{item.preview}</span>
        </button>
      ))}
      {references.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t('bottomPanel.noReferences')}</p>
      )}
    </div>
  )
}

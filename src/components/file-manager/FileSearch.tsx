import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/lib/i18n/runtime'
import { cn } from '@/lib/utils'
import { FileIcon } from './FileIcon'
import type { FileEntry } from '@/types/file'

interface FileSearchProps {
  query: string
  onQueryChange: (q: string) => void
  results: FileEntry[]
  onOpen: (path: string) => void
  isSearching: boolean
}

export function FileSearch({ query, onQueryChange, results, onOpen, isSearching }: FileSearchProps) {
  const { t } = useTranslation()
  const searchLabel = t('appShell.searchFiles')
  const hasQuery = Boolean(query)

  return (
    <div className="flex min-w-0 flex-col">
      {/*
        Single horizontal row: [search icon | text | clear].
        Icons are laid out with the input in one h-9 flex row (not absolute to
        a taller padded box), so typed text and icons share the same baseline.
      */}
      <div className="min-w-0 w-full px-3 pb-2">
        <div
          className={cn(
            'flex h-9 min-w-0 w-full items-center gap-0 rounded-md border border-input bg-transparent shadow-sm',
            'focus-within:ring-1 focus-within:ring-ring',
          )}
        >
          <span className="flex h-full w-8 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
            <Search className="h-4 w-4" />
          </span>
          <Input
            className={cn(
              // Drop default Input chrome — the outer flex row owns the border/height.
              'h-full min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none',
              'focus-visible:ring-0 focus-visible:ring-offset-0',
              hasQuery ? 'pr-1' : 'pr-2.5',
            )}
            placeholder={searchLabel}
            title={searchLabel}
            aria-label={searchLabel}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          {hasQuery && (
            <button
              type="button"
              className="flex h-full w-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
              onClick={() => onQueryChange('')}
              title={t('appShell.clearFileSearch')}
              aria-label={t('appShell.clearFileSearch')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {query && (
        <div className="max-h-48 overflow-y-auto px-2">
          {isSearching && <p className="px-2 py-2 text-xs text-muted-foreground">{t('appShell.searchingFiles')}</p>}
          {!isSearching && results.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">{t('appShell.noMatchingFiles')}</p>
          )}
          {results.map((file) => (
            <button
              key={file.path}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => onOpen(file.path)}
            >
              <FileIcon filePath={file.path} />
              <div className="min-w-0">
                <p className="truncate text-sm">{file.name}</p>
                <p className="truncate text-xs text-muted-foreground">{file.path}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

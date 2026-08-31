import React, { useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Table2 } from 'lucide-react'
import type { Editor } from '@superdoc-dev/react'
import type { LanguageCode } from '@/lib/i18n'

export interface WordTablePickerProps {
  language: LanguageCode
  onInsertTable: (rows: number, cols: number) => void
  onOpenCustomDialog: () => void
  onCloseDropdown: () => void
}

const GRID_ROWS = 8
const GRID_COLS = 14

interface TablePickerTexts {
  insertTable: string
  moreRowsCols: string
  tableSizeFormat: (rows: number, cols: number) => string
}

const TABLE_PICKER_TEXTS: Record<LanguageCode, TablePickerTexts> = {
  'zh-CN': {
    insertTable: '插入表格',
    moreRowsCols: '更多行列(I)',
    tableSizeFormat: (r, c) => `${r}行 × ${c}列 表格`,
  },
  en: {
    insertTable: 'Insert Table',
    moreRowsCols: 'More Rows/Cols(I)',
    tableSizeFormat: (r, c) => `${r} × ${c} Table`,
  },
  ja: {
    insertTable: '表の挿入',
    moreRowsCols: 'その他の行・列(I)',
    tableSizeFormat: (r, c) => `${r} × ${c} の表`,
  },
  es: {
    insertTable: 'Insertar tabla',
    moreRowsCols: 'Más filas/columnas(I)',
    tableSizeFormat: (r, c) => `Tabla de ${r} × ${c}`,
  },
  pt: {
    insertTable: 'Inserir tabela',
    moreRowsCols: 'Mais linhas/colunas(I)',
    tableSizeFormat: (r, c) => `Tabela ${r} × ${c}`,
  },
  de: {
    insertTable: 'Tabelle einfügen',
    moreRowsCols: 'Weitere Zeilen/Spalten(I)',
    tableSizeFormat: (r, c) => `Tabelle ${r} × ${c}`,
  },
  fr: {
    insertTable: 'Insérer un tableau',
    moreRowsCols: 'Autres lignes/colonnes(I)',
    tableSizeFormat: (r, c) => `Tableau ${r} × ${c}`,
  },
  ru: {
    insertTable: 'Вставить таблицу',
    moreRowsCols: 'Другие строки/столбцы(I)',
    tableSizeFormat: (r, c) => `Таблица ${r} × ${c}`,
  },
  ar: {
    insertTable: 'إدراج جدول',
    moreRowsCols: 'المزيد من الصفوف/الأعمدة (I)',
    tableSizeFormat: (r, c) => `جدول ${r} × ${c}`,
  },
}

export function WordTablePickerMenu({
  language,
  onInsertTable,
  onOpenCustomDialog,
  onCloseDropdown,
}: WordTablePickerProps) {
  const [hovered, setHovered] = useState<{ rows: number; cols: number }>({ rows: 0, cols: 0 })
  const texts = TABLE_PICKER_TEXTS[language] ?? TABLE_PICKER_TEXTS.en

  const handleSelect = (r: number, c: number) => {
    onInsertTable(r, c)
    onCloseDropdown()
  }

  const handleOpenDialog = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onCloseDropdown()
    onOpenCustomDialog()
  }

  const titleText = hovered.rows > 0 && hovered.cols > 0
    ? texts.tableSizeFormat(hovered.rows, hovered.cols)
    : texts.insertTable

  return (
    <div
      className="word-table-picker select-none rounded-lg bg-[#222222] p-3 text-[#eeeeee] shadow-2xl dark:bg-[#222222] dark:text-[#eeeeee]"
      style={{ width: 280 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Top Bar: Title */}
      <div className="flex h-7 items-center justify-between gap-2 pb-1.5">
        <span className="text-[13px] font-medium tracking-wide text-white/95">
          {titleText}
        </span>
      </div>

      {/* 8 x 14 Table Grid */}
      <div
        className="my-1 grid cursor-pointer"
        style={{
          gridTemplateColumns: `repeat(${GRID_COLS}, 15px)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, 15px)`,
          gap: '3px',
        }}
        onPointerLeave={() => setHovered({ rows: 0, cols: 0 })}
      >
        {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, index) => {
          const row = Math.floor(index / GRID_COLS) + 1
          const col = (index % GRID_COLS) + 1
          const isSelected = row <= hovered.rows && col <= hovered.cols

          return (
            <div
              key={`${row}-${col}`}
              data-row={row}
              data-col={col}
              className="h-[15px] w-[15px] rounded-[2px] transition-colors duration-75"
              style={{
                backgroundColor: isSelected ? '#f8b284' : '#2d2d2d',
                border: isSelected ? '1px solid #e09464' : '1px solid rgba(255, 255, 255, 0.22)',
              }}
              onPointerEnter={() => setHovered({ rows: row, cols: col })}
              onClick={() => handleSelect(row, col)}
            />
          )
        })}
      </div>

      {/* Footer: 更多行列(I) */}
      <div className="mt-2 border-t border-white/10 pt-2">
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 rounded px-1.5 text-[12px] text-white/90 transition-colors hover:bg-white/10 active:bg-white/15"
          onClick={handleOpenDialog}
        >
          <div className="flex h-4 w-4 items-center justify-center text-emerald-400">
            <Table2 className="h-3.5 w-3.5" />
          </div>
          <span>{texts.moreRowsCols}</span>
        </button>
      </div>
    </div>
  )
}

export interface InstallWordTablePickerOptions {
  language: LanguageCode
  getEditor: () => Editor | null
  onOpenCustomDialog: () => void
}

export function closeSuperdocDropdown(): void {
  // Dispatch outside pointerdown event or trigger table button click to close SuperDoc's dropdown
  document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  const tableBtn = document.querySelector<HTMLElement>('.sd-toolbar-button[data-item="btn-table"]')
  if (tableBtn && tableBtn.getAttribute('data-active') === 'true') {
    tableBtn.click()
  }
}

export function installWordTablePicker(options: InstallWordTablePickerOptions): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}

  const activeRoots = new Map<HTMLElement, Root>()
  let stopped = false

  const decorate = (wrapper: HTMLElement) => {
    if (wrapper.dataset.wordTablePickerReady === 'true') return
    wrapper.dataset.wordTablePickerReady = 'true'

    // Adjust parent dropdown menu container
    const parentMenu = wrapper.closest<HTMLElement>('.sd-toolbar-dropdown-menu, .toolbar-dropdown-menu')
    if (parentMenu) {
      parentMenu.style.setProperty('min-width', '280px', 'important')
      parentMenu.style.setProperty('max-width', '320px', 'important')
      parentMenu.style.setProperty('padding', '0', 'important')
      parentMenu.style.setProperty('background', 'transparent', 'important')
      parentMenu.style.setProperty('border', 'none', 'important')
      parentMenu.style.setProperty('box-shadow', 'none', 'important')
    }

    // Clear built-in elements and mount React component
    wrapper.innerHTML = ''
    wrapper.style.padding = '0'
    wrapper.style.margin = '0'
    wrapper.style.display = 'block'
    wrapper.style.background = 'transparent'

    const root = createRoot(wrapper)
    activeRoots.set(wrapper, root)

    const handleInsert = (rows: number, cols: number) => {
      const editor = options.getEditor()
      if (editor) {
        try {
          if (typeof (editor.commands as Record<string, unknown>)?.insertTable === 'function') {
            ;(editor.commands as Record<string, (args: { rows: number; cols: number }) => boolean>).insertTable({ rows, cols })
          } else if (typeof (editor as unknown as { chain?: () => { insertTable?: (args: { rows: number; cols: number }) => { run: () => boolean } } }).chain === 'function') {
            ;(editor as unknown as { chain: () => { insertTable: (args: { rows: number; cols: number }) => { run: () => boolean } } }).chain().insertTable({ rows, cols }).run()
          }
        } catch (err) {
          console.warn('[WordTablePicker] insertTable failed:', err)
        }
      }
    }

    root.render(
      <WordTablePickerMenu
        language={options.language}
        onInsertTable={handleInsert}
        onOpenCustomDialog={options.onOpenCustomDialog}
        onCloseDropdown={closeSuperdocDropdown}
      />,
    )
  }

  const scan = () => {
    if (stopped) return
    document.querySelectorAll<HTMLElement>('.toolbar-table-grid-wrapper').forEach(decorate)
  }

  const observer = new MutationObserver(scan)
  observer.observe(document.body, { childList: true, subtree: true })
  scan()

  return () => {
    stopped = true
    observer.disconnect()
    activeRoots.forEach((root) => {
      try {
        root.unmount()
      } catch {
        // ignore unmount races
      }
    })
    activeRoots.clear()
  }
}

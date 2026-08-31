import { useState, useEffect } from 'react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/runtime'
import type { LanguageCode } from '@/lib/i18n'

export interface WordInsertTableDialogProps {
  open: boolean
  onClose: () => void
  onInsert: (rows: number, cols: number, fixedWidth?: number) => void
}

const STORAGE_KEY = 'word-table-insert-default-dims'

interface InsertTableTexts {
  title: string
  tableSize: string
  columns: string
  rows: string
  columnWidth: string
  fixedWidth: string
  cm: string
  autoWidth: string
  remember: string
  ok: string
  cancel: string
}

const INSERT_TABLE_TEXTS: Record<LanguageCode, InsertTableTexts> = {
  'zh-CN': {
    title: '插入表格',
    tableSize: '表格尺寸',
    columns: '列数(C)',
    rows: '行数(R)',
    columnWidth: '列宽选择',
    fixedWidth: '固定列宽(W)',
    cm: '厘米',
    autoWidth: '自动列宽(F)',
    remember: '为新表格记忆此尺寸(S)',
    ok: '确定',
    cancel: '取消',
  },
  en: {
    title: 'Insert Table',
    tableSize: 'Table Size',
    columns: 'Columns (C)',
    rows: 'Rows (R)',
    columnWidth: 'Column Width',
    fixedWidth: 'Fixed width (W)',
    cm: 'cm',
    autoWidth: 'Auto width (F)',
    remember: 'Remember dimensions for new tables (S)',
    ok: 'OK',
    cancel: 'Cancel',
  },
  ja: {
    title: '表の挿入',
    tableSize: '表のサイズ',
    columns: '列数(C)',
    rows: '行数(R)',
    columnWidth: '列幅の指定',
    fixedWidth: '固定列幅(W)',
    cm: 'cm',
    autoWidth: '自動調整(F)',
    remember: '新しい表の既定値として記憶(S)',
    ok: 'OK',
    cancel: 'キャンセル',
  },
  es: {
    title: 'Insertar tabla',
    tableSize: 'Tamaño de tabla',
    columns: 'Columnas (C)',
    rows: 'Filas (R)',
    columnWidth: 'Ancho de columna',
    fixedWidth: 'Ancho fijo (W)',
    cm: 'cm',
    autoWidth: 'Ancho automático (F)',
    remember: 'Recordar dimensiones para tablas nuevas (S)',
    ok: 'Aceptar',
    cancel: 'Cancelar',
  },
  pt: {
    title: 'Inserir Tabela',
    tableSize: 'Tamanho da tabela',
    columns: 'Colunas (C)',
    rows: 'Linhas (R)',
    columnWidth: 'Largura da coluna',
    fixedWidth: 'Largura fixa (W)',
    cm: 'cm',
    autoWidth: 'Largura automática (F)',
    remember: 'Lembrar dimensões para novas tabelas (S)',
    ok: 'OK',
    cancel: 'Cancelar',
  },
  de: {
    title: 'Tabelle einfügen',
    tableSize: 'Tabellengröße',
    columns: 'Spalten (C)',
    rows: 'Zeilen (R)',
    columnWidth: 'Spaltenbreite',
    fixedWidth: 'Feste Spaltenbreite (W)',
    cm: 'cm',
    autoWidth: 'Automatische Spaltenbreite (F)',
    remember: 'Abmessungen für neue Tabellen speichern (S)',
    ok: 'OK',
    cancel: 'Abbrechen',
  },
  fr: {
    title: 'Insérer un tableau',
    tableSize: 'Dimensions du tableau',
    columns: 'Colonnes (C)',
    rows: 'Lignes (R)',
    columnWidth: 'Largeur de colonne',
    fixedWidth: 'Largeur fixe (W)',
    cm: 'cm',
    autoWidth: 'Largeur automatique (F)',
    remember: 'Mémoriser les dimensions pour les nouveaux tableaux (S)',
    ok: 'OK',
    cancel: 'Annuler',
  },
  ru: {
    title: 'Вставка таблицы',
    tableSize: 'Размер таблицы',
    columns: 'Число столбцов (C)',
    rows: 'Число строк (R)',
    columnWidth: 'Ширина столбца',
    fixedWidth: 'Постоянная ширина (W)',
    cm: 'см',
    autoWidth: 'Автоподбор (F)',
    remember: 'Сохранить размеры для новых таблиц (S)',
    ok: 'ОК',
    cancel: 'Отмена',
  },
  ar: {
    title: 'إدراج جدول',
    tableSize: 'حجم الجدول',
    columns: 'عدد الأعمدة (C)',
    rows: 'عدد الصفوف (R)',
    columnWidth: 'عرض الأعمدة',
    fixedWidth: 'عرض ثابت (W)',
    cm: 'سم',
    autoWidth: 'عرض تلقائي (F)',
    remember: 'تذكر الأبعاد للجداول الجديدة (S)',
    ok: 'موافق',
    cancel: 'إلغاء',
  },
}

function getInitialDimensions(): { rows: number; cols: number; remember: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.rows === 'number' && typeof parsed.cols === 'number') {
        return { rows: parsed.rows, cols: parsed.cols, remember: true }
      }
    }
  } catch {
    // ignore storage errors
  }
  return { rows: 2, cols: 5, remember: false }
}

export function WordInsertTableDialog({ open, onClose, onInsert }: WordInsertTableDialogProps) {
  const { language } = useTranslation()
  const texts = INSERT_TABLE_TEXTS[language as LanguageCode] ?? INSERT_TABLE_TEXTS.en
  const initial = getInitialDimensions()
  const [cols, setCols] = useState(initial.cols)
  const [rows, setRows] = useState(initial.rows)
  const [widthMode, setWidthMode] = useState<'auto' | 'fixed'>('auto')
  const [fixedWidth, setFixedWidth] = useState('0.16')
  const [remember, setRemember] = useState(initial.remember)

  useEffect(() => {
    if (open) {
      const current = getInitialDimensions()
      setCols(current.cols)
      setRows(current.rows)
      setRemember(current.remember)
    }
  }, [open])

  if (!open) return null

  const handleConfirm = () => {
    if (remember) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows, cols }))
      } catch {
        // ignore
      }
    } else {
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
    }
    const widthVal = widthMode === 'fixed' ? parseFloat(fixedWidth) || undefined : undefined
    onInsert(rows, cols, widthVal)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-[360px] rounded-xl border border-black/15 bg-[#1f1f1f] text-[#f0f0f0] shadow-2xl dark:border-white/15 dark:bg-[#1f1f1f]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="word-insert-table-title"
      >
        {/* Title Bar */}
        <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">
          <span id="word-insert-table-title" className="text-[14px] font-medium tracking-wide">
            {texts.title}
          </span>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4 text-[13px]">
          {/* Section: 表格尺寸 */}
          <div>
            <div className="mb-2 text-[13px] font-medium text-white/90">
              {texts.tableSize}
            </div>
            <div className="space-y-2.5 pl-2">
              {/* 列数 */}
              <div className="flex items-center justify-between">
                <label htmlFor="word-insert-table-cols" className="text-white/80">
                  {texts.columns}
                </label>
                <div className="flex h-7 w-28 items-center rounded border border-[#0067c0] bg-[#121212] px-2 focus-within:ring-1 focus-within:ring-[#0067c0]">
                  <input
                    id="word-insert-table-cols"
                    type="number"
                    min={1}
                    max={63}
                    value={cols}
                    onChange={(e) => setCols(Math.max(1, Math.min(63, parseInt(e.target.value, 10) || 1)))}
                    className="w-full bg-transparent text-left text-[13px] font-medium text-white outline-none"
                    autoFocus
                  />
                  <div className="flex flex-col text-white/60">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => setCols((c) => Math.min(63, c + 1))}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => setCols((c) => Math.max(1, c - 1))}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 行数 */}
              <div className="flex items-center justify-between">
                <label htmlFor="word-insert-table-rows" className="text-white/80">
                  {texts.rows}
                </label>
                <div className="flex h-7 w-28 items-center rounded border border-white/20 bg-[#121212] px-2 focus-within:border-[#0067c0] focus-within:ring-1 focus-within:ring-[#0067c0]">
                  <input
                    id="word-insert-table-rows"
                    type="number"
                    min={1}
                    max={1000}
                    value={rows}
                    onChange={(e) => setRows(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 1)))}
                    className="w-full bg-transparent text-left text-[13px] font-medium text-white outline-none"
                  />
                  <div className="flex flex-col text-white/60">
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => setRows((r) => Math.min(1000, r + 1))}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="hover:text-white"
                      onClick={() => setRows((r) => Math.max(1, r - 1))}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section: 列宽选择 */}
          <div>
            <div className="mb-2 text-[13px] font-medium text-white/90">
              {texts.columnWidth}
            </div>
            <div className="space-y-2 pl-2">
              {/* 固定列宽 */}
              <div className="flex items-center gap-2">
                <input
                  id="word-width-fixed"
                  type="radio"
                  name="table-col-width"
                  checked={widthMode === 'fixed'}
                  onChange={() => setWidthMode('fixed')}
                  className="h-4 w-4 accent-[#0067c0]"
                />
                <label htmlFor="word-width-fixed" className="cursor-pointer text-white/80">
                  {texts.fixedWidth}
                </label>
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="flex h-7 w-20 items-center rounded border border-white/20 bg-[#121212] px-2">
                    <input
                      type="text"
                      disabled={widthMode !== 'fixed'}
                      value={fixedWidth}
                      onChange={(e) => setFixedWidth(e.target.value)}
                      className="w-full bg-transparent text-left text-[12px] text-white outline-none disabled:opacity-40"
                    />
                    <div className="flex flex-col text-white/60">
                      <button
                        type="button"
                        disabled={widthMode !== 'fixed'}
                        className="hover:text-white disabled:opacity-30"
                        onClick={() => {
                          const v = parseFloat(fixedWidth) || 0
                          setFixedWidth((v + 0.1).toFixed(2))
                        }}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={widthMode !== 'fixed'}
                        className="hover:text-white disabled:opacity-30"
                        onClick={() => {
                          const v = parseFloat(fixedWidth) || 0
                          setFixedWidth(Math.max(0.1, v - 0.1).toFixed(2))
                        }}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <span className="text-[12px] text-white/70">{texts.cm}</span>
                </div>
              </div>

              {/* 自动列宽 */}
              <div className="flex items-center gap-2">
                <input
                  id="word-width-auto"
                  type="radio"
                  name="table-col-width"
                  checked={widthMode === 'auto'}
                  onChange={() => setWidthMode('auto')}
                  className="h-4 w-4 accent-[#0067c0]"
                />
                <label htmlFor="word-width-auto" className="cursor-pointer text-white/80">
                  {texts.autoWidth}
                </label>
              </div>
            </div>
          </div>

          {/* Section: 记忆选项 */}
          <div className="pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-white/80">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded accent-[#0067c0]"
              />
              <span>{texts.remember}</span>
            </label>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="flex items-center justify-end gap-2.5 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            className="h-8 min-w-[72px] rounded-[6px] bg-[#0067c0] px-4 text-[13px] font-medium text-white hover:bg-[#005a9e] active:bg-[#004e8a]"
            onClick={handleConfirm}
          >
            {texts.ok}
          </button>
          <button
            type="button"
            className="h-8 min-w-[72px] rounded-[6px] border border-white/15 bg-white/[0.06] px-4 text-[13px] text-white hover:bg-white/10 active:bg-white/15"
            onClick={onClose}
          >
            {texts.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}

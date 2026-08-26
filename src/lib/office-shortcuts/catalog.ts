/**
 * Microsoft Office-style cross-app shortcut catalog.
 *
 * Grounded in official/common Microsoft Word & Excel shortcut lists
 * (support.microsoft.com keyboard shortcuts for Word/Excel) plus the shared
 * File/Edit/Format/View chords used across Office apps.
 *
 * This is the single source of truth for default chords and labels.
 * Editors must not hardcode alternate Office defaults for these actions.
 */
import type { ShortcutBinding } from './types'

export const OFFICE_SHORTCUT_CATALOG: readonly ShortcutBinding[] = [
  // ── File (Office common) ──────────────────────────────────────────
  {
    id: 'file.new',
    actionId: 'new',
    defaultChord: 'Ctrl+N',
    label: '新建',
    labelEn: 'Create a new document / workbook',
    category: 'file',
    contexts: ['all'],
  },
  {
    id: 'file.newWindow',
    actionId: 'newWindow',
    defaultChord: 'Ctrl+Shift+N',
    label: '新建窗口',
    labelEn: 'New window',
    category: 'file',
    contexts: ['all'],
  },
  {
    id: 'file.newMarkdown',
    actionId: 'newMarkdown',
    defaultChord: 'Ctrl+Alt+N',
    label: '新建 Markdown',
    labelEn: 'New Markdown tab',
    category: 'file',
    contexts: ['text'],
  },
  {
    id: 'file.open',
    actionId: 'open',
    defaultChord: 'Ctrl+O',
    label: '打开',
    labelEn: 'Open a document / workbook',
    category: 'file',
    contexts: ['all'],
  },
  {
    id: 'file.save',
    actionId: 'save',
    defaultChord: 'Ctrl+S',
    label: '保存',
    labelEn: 'Save',
    category: 'file',
    contexts: ['all'],
  },
  {
    id: 'file.saveAs',
    actionId: 'saveAs',
    defaultChord: 'Ctrl+Shift+S',
    label: '另存为',
    labelEn: 'Save As',
    category: 'file',
    contexts: ['all'],
  },
  {
    id: 'file.saveAs.f12',
    actionId: 'saveAs',
    defaultChord: 'F12',
    label: '另存为 (F12)',
    labelEn: 'Save As (F12)',
    category: 'file',
    contexts: ['all'],
    note: 'Classic Office Save As accelerator',
  },
  {
    id: 'file.saveAll',
    actionId: 'saveAll',
    defaultChord: 'Ctrl+Alt+S',
    label: '全部保存',
    labelEn: 'Save all',
    category: 'file',
    contexts: ['text'],
  },
  {
    id: 'file.print',
    actionId: 'print',
    defaultChord: 'Ctrl+P',
    label: '打印',
    labelEn: 'Print',
    category: 'file',
    contexts: ['all'],
  },
  {
    id: 'file.close',
    actionId: 'close',
    defaultChord: 'Ctrl+W',
    label: '关闭',
    labelEn: 'Close document / workbook',
    category: 'file',
    contexts: ['all'],
  },
  {
    id: 'file.closeWindow',
    actionId: 'closeWindow',
    defaultChord: 'Alt+F4',
    label: '关闭窗口',
    labelEn: 'Close window',
    category: 'file',
    contexts: ['all'],
  },

  // ── Edit (Office common) ──────────────────────────────────────────
  {
    id: 'edit.undo',
    actionId: 'undo',
    defaultChord: 'Ctrl+Z',
    label: '撤销',
    labelEn: 'Undo',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.redo',
    actionId: 'redo',
    defaultChord: 'Ctrl+Y',
    label: '重做',
    labelEn: 'Redo',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.redo.shiftZ',
    actionId: 'redo',
    defaultChord: 'Ctrl+Shift+Z',
    label: '重做 (Ctrl+Shift+Z)',
    labelEn: 'Redo (alternate)',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.cut',
    actionId: 'cut',
    defaultChord: 'Ctrl+X',
    label: '剪切',
    labelEn: 'Cut',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.copy',
    actionId: 'copy',
    defaultChord: 'Ctrl+C',
    label: '复制',
    labelEn: 'Copy',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.paste',
    actionId: 'paste',
    defaultChord: 'Ctrl+V',
    label: '粘贴',
    labelEn: 'Paste',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.pasteTextOnly',
    actionId: 'pasteTextOnly',
    defaultChord: 'Ctrl+Shift+V',
    label: '粘贴为纯文本',
    labelEn: 'Paste text only',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.delete',
    actionId: 'delete',
    defaultChord: 'Delete',
    label: '删除',
    labelEn: 'Delete',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.selectAll',
    actionId: 'selectAll',
    defaultChord: 'Ctrl+A',
    label: '全选',
    labelEn: 'Select all',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.find',
    actionId: 'find',
    defaultChord: 'Ctrl+F',
    label: '查找',
    labelEn: 'Find',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.findNext',
    actionId: 'findNext',
    defaultChord: 'F3',
    label: '查找下一个',
    labelEn: 'Find next',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.findPrevious',
    actionId: 'findPrevious',
    defaultChord: 'Shift+F3',
    label: '查找上一个',
    labelEn: 'Find previous',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.replace',
    actionId: 'replace',
    defaultChord: 'Ctrl+H',
    label: '替换',
    labelEn: 'Replace',
    category: 'edit',
    contexts: ['all'],
  },
  {
    id: 'edit.goTo',
    actionId: 'goTo',
    defaultChord: 'Ctrl+G',
    label: '转到',
    labelEn: 'Go to',
    category: 'edit',
    contexts: ['all'],
  },

  // ── Format (Office common; primarily Word/text) ───────────────────
  {
    id: 'format.bold',
    actionId: 'bold',
    defaultChord: 'Ctrl+B',
    label: '加粗',
    labelEn: 'Bold',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.italic',
    actionId: 'italic',
    defaultChord: 'Ctrl+I',
    label: '斜体',
    labelEn: 'Italic',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.underline',
    actionId: 'underline',
    defaultChord: 'Ctrl+U',
    label: '下划线',
    labelEn: 'Underline',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.strikethrough',
    actionId: 'strikethrough',
    defaultChord: 'Ctrl+Shift+X',
    label: '删除线',
    labelEn: 'Strikethrough',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.hyperlink',
    actionId: 'hyperlink',
    defaultChord: 'Ctrl+K',
    label: '插入超链接',
    labelEn: 'Insert hyperlink',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.clear',
    actionId: 'clearFormat',
    defaultChord: 'Ctrl+Space',
    label: '清除格式',
    labelEn: 'Clear formatting',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.alignLeft',
    actionId: 'alignLeft',
    defaultChord: 'Ctrl+L',
    label: '左对齐',
    labelEn: 'Align left',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.alignCenter',
    actionId: 'alignCenter',
    defaultChord: 'Ctrl+E',
    label: '居中',
    labelEn: 'Align center',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.alignRight',
    actionId: 'alignRight',
    defaultChord: 'Ctrl+R',
    label: '右对齐',
    labelEn: 'Align right',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.alignJustify',
    actionId: 'alignJustify',
    defaultChord: 'Ctrl+J',
    label: '两端对齐',
    labelEn: 'Justify',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.increaseFont',
    actionId: 'increaseFont',
    defaultChord: 'Ctrl+]',
    label: '增大字号',
    labelEn: 'Increase font size',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.decreaseFont',
    actionId: 'decreaseFont',
    defaultChord: 'Ctrl+[',
    label: '减小字号',
    labelEn: 'Decrease font size',
    category: 'format',
    contexts: ['word', 'text'],
  },
  {
    id: 'format.fontDialog',
    actionId: 'fontDialog',
    defaultChord: 'Ctrl+D',
    label: '字体',
    labelEn: 'Font dialog',
    category: 'format',
    contexts: ['word', 'text'],
    note: 'In Excel, Ctrl+D is Fill Down; scoped to word/text here',
  },

  // ── View ──────────────────────────────────────────────────────────
  {
    id: 'view.zoomIn',
    actionId: 'zoomIn',
    defaultChord: 'Ctrl+=',
    label: '放大',
    labelEn: 'Zoom in',
    category: 'view',
    contexts: ['all'],
  },
  {
    id: 'view.zoomIn.plus',
    actionId: 'zoomIn',
    defaultChord: 'Ctrl++',
    label: '放大 (+)',
    labelEn: 'Zoom in (+)',
    category: 'view',
    contexts: ['all'],
  },
  {
    id: 'view.zoomOut',
    actionId: 'zoomOut',
    defaultChord: 'Ctrl+-',
    label: '缩小',
    labelEn: 'Zoom out',
    category: 'view',
    contexts: ['all'],
  },
  {
    id: 'view.zoomReset',
    actionId: 'zoomReset',
    defaultChord: 'Ctrl+0',
    label: '恢复默认缩放',
    labelEn: 'Reset zoom',
    category: 'view',
    contexts: ['all'],
  },

  // ── Insert / misc ─────────────────────────────────────────────────
  {
    id: 'insert.timeDate',
    actionId: 'timeDate',
    defaultChord: 'F5',
    label: '时间/日期',
    labelEn: 'Time/date',
    category: 'insert',
    contexts: ['text'],
  },
  {
    id: 'help.help',
    actionId: 'help',
    defaultChord: 'F1',
    label: '帮助',
    labelEn: 'Help',
    category: 'help',
    contexts: ['all'],
  },
  {
    id: 'edit.spellCheck',
    actionId: 'spellCheck',
    defaultChord: 'F7',
    label: '拼写检查',
    labelEn: 'Spelling',
    category: 'edit',
    contexts: ['word', 'text'],
  },

  // ── App tab navigation (shared multi-doc UX for txt / Word / Excel) ─
  {
    id: 'nav.nextTab',
    actionId: 'nextTab',
    defaultChord: 'Ctrl+Tab',
    label: '下一个标签页',
    labelEn: 'Next tab',
    category: 'navigate',
    contexts: ['text', 'word', 'excel'],
  },
  {
    id: 'nav.previousTab',
    actionId: 'previousTab',
    defaultChord: 'Ctrl+Shift+Tab',
    label: '上一个标签页',
    labelEn: 'Previous tab',
    category: 'navigate',
    contexts: ['text', 'word', 'excel'],
  },
] as const

/** Number of imported Office-common bindings (for tests / settings). */
export const OFFICE_SHORTCUT_CATALOG_COUNT = OFFICE_SHORTCUT_CATALOG.length

export function getOfficeShortcutCatalog(): readonly ShortcutBinding[] {
  return OFFICE_SHORTCUT_CATALOG
}

export function getCatalogBindingsForContext(
  context: 'word' | 'excel' | 'text',
): ShortcutBinding[] {
  return OFFICE_SHORTCUT_CATALOG.filter(
    (b) => b.contexts.includes('all') || b.contexts.includes(context),
  )
}

export function getDefaultChordForAction(actionId: string): string | null {
  const hit = OFFICE_SHORTCUT_CATALOG.find((b) => b.actionId === actionId)
  return hit?.defaultChord ?? null
}

export function getBindingById(id: string): ShortcutBinding | undefined {
  return OFFICE_SHORTCUT_CATALOG.find((b) => b.id === id)
}

/** Settings UI data source — same catalog as runtime (not a duplicate list). */
export function getShortcutSettingsRows(): Array<{
  id: string
  actionId: string
  defaultChord: string
  label: string
}> {
  return OFFICE_SHORTCUT_CATALOG.map((b) => ({
    id: b.id,
    actionId: b.actionId,
    defaultChord: b.defaultChord,
    label: b.label,
  }))
}

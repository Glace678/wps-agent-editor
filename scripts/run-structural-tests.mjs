// Runs the fast source-level regression scripts that do not need a browser.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const STRUCTURAL_TESTS = [
  'test-agent-config-dialog-scroll.mjs',
  'test-code-file-tab-visuals.ts',
  'test-ctrl-w-close-tab.mjs',
  'test-document-tab-displacement.ts',
  'test-document-tab-reorder.mjs',
  'test-excel-dark-color-preservation.mjs',
  'test-excel-dirty-fingerprint.mjs',
  'test-excel-font-picker-search-pin.mjs',
  'test-excel-format-picker-width.mjs',
  'test-excel-frame-scroll.mjs',
  'test-excel-live-resize.mjs',
  'test-excel-style-roundtrip.ts',
  'test-excel-toolbar-selected-theme.mjs',
  'test-excel-toolbar-shortcuts.mjs',
  'test-file-hover-card-border.mjs',
  'test-file-list-row-hover-border.mjs',
  'test-notepad-format-menu-compact.mjs',
  'test-notepad-menubar.mjs',
  'test-notepad-menubar-narrow.mjs',
  'test-notepad-popup-center-fit.mjs',
  'test-notepad-remove-recent-updates.mjs',
  'test-notepad-settings-no-wheel-zoom.mjs',
  'test-notepad-table-delete-edit.mjs',
  'test-notepad-table-newlines.mjs',
  'test-notepad-toolbar-language.mjs',
  'test-notepad-toolbar-no-document-zoom.mjs',
  // The scripts below import extensionless TS modules, so they run under tsx.
  'test-office-shortcuts-dispatch.mjs',
  'test-office-shortcuts-catalog.mjs',
  'test-panel-collapse-icons.mjs',
  'test-panel-resize-drag-session.mjs',
  'test-recent-hover-details.mjs',
  'test-recent-hover-selection.mjs',
  'test-resize-handle-scrollbar-hit-area.mjs',
  'test-word-toolbar-overflow.mjs',
]

const NEEDS_TSX = new Set([
  'test-document-tab-reorder.mjs',
  'test-excel-dirty-fingerprint.mjs',
  'test-notepad-menubar.mjs',
  'test-notepad-table-newlines.mjs',
  'test-notepad-toolbar-language.mjs',
  'test-office-shortcuts-dispatch.mjs',
  'test-office-shortcuts-catalog.mjs',
])
const tsxCli = path.join(root, 'node_modules/tsx/dist/cli.mjs')

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failed = []
  for (const name of STRUCTURAL_TESTS) {
    const script = path.join(root, 'scripts', name)
    const args = name.endsWith('.ts') || NEEDS_TSX.has(name)
      ? [tsxCli, '--tsconfig', 'tsconfig.web.json', script]
      : [script]
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' })
    if (result.status === 0) {
      console.log(`PASS ${name}`)
    } else {
      failed.push(name)
      console.error(`FAIL ${name}\n${result.stdout}${result.stderr}`)
    }
  }
  if (failed.length) {
    console.error(`\n${failed.length}/${STRUCTURAL_TESTS.length} structural tests failed`)
    process.exit(1)
  }
  console.log(`\n${STRUCTURAL_TESTS.length} structural tests passed`)
}

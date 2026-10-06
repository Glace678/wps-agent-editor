// Runs the fast source-level regression scripts that do not need a browser.
//
// Scope (wps_07 B5): these are static guards over source text, not behavior
// tests. Their match/doesNotMatch assertions are the minimum "banned/required
// API shape" contract; executable behavior is covered by unit tests and e2e.
// To prevent a script from passing with zero executed assertions, every run
// gets the assertion-count loader (scripts/lib/structural-assert-loader.mjs),
// and a missing/zero STRUCTURAL_OK marker fails here even on exit code 0.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// node --import parses its argument as a URL; a bare C:\ path would parse
// with protocol 'c:'.
const assertRegister = pathToFileURL(
  path.join(root, 'scripts', 'lib', 'structural-assert-register.mjs'),
).href

export const STRUCTURAL_TESTS = [
  'test-agent-config-dialog-scroll.mjs',
  'test-code-file-tab-visuals.ts',
  'test-ctrl-w-close-tab.mjs',
  'test-document-tab-displacement.ts',
  'test-document-tab-reorder.mjs',
  'test-excel-dark-color-preservation.mjs',
  'test-excel-dirty-fingerprint.mjs',
  'test-excel-features-roundtrip.ts',
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failed = []
  for (const name of STRUCTURAL_TESTS) {
    const script = path.join(root, 'scripts', name)
    const usesTsx = name.endsWith('.ts') || NEEDS_TSX.has(name)
    // TS scripts: tsx must be registered BEFORE the assertion counter so the
    // counter's resolve hook stays outermost (multiple --import flags register
    // in order; the last one's hooks run first).
    const nodeArgs = usesTsx
      ? ['--import', 'tsx', '--import', assertRegister, script]
      : ['--import', assertRegister, script]
    const result = spawnSync(process.execPath, nodeArgs, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TSX_TSCONFIG_PATH: path.join(root, 'tsconfig.web.json') },
    })
    // B5: require an executed-assertion marker regardless of the exit code.
    const marker = /STRUCTURAL_OK: (\d+) assertions/.exec(result.stdout)
    const assertionCount = marker ? Number(marker[1]) : 0
    if (result.status === 0 && assertionCount > 0) {
      console.log(`PASS ${name} (${assertionCount} assertions)`)
    } else {
      failed.push(name)
      const reason = result.status !== 0
        ? `exit ${result.status}`
        : 'no executed assertions detected (missing STRUCTURAL_OK marker)'
      console.error(`FAIL ${name}: ${reason}\n${result.stdout}${result.stderr}`)
    }
  }
  if (failed.length) {
    console.error(`\n${failed.length}/${STRUCTURAL_TESTS.length} structural tests failed`)
    process.exit(1)
  }
  console.log(`\n${STRUCTURAL_TESTS.length} structural tests passed`)
}

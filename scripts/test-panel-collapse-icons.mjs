/**
 * Structural check: left file / right agent collapse controls use
 * authoritative panel-close icons (PanelLeftClose / PanelRightClose),
 * not plain chevrons alone; collapse handlers remain wired.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

let passed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`PASS  ${name}`)
    passed += 1
  } catch (err) {
    console.error(`FAIL  ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

const fileManager = read('src/components/file-manager/FileManager.tsx')
const agentSidebar = read('src/components/agent/AgentSidebar.tsx')
const layout = read('src/components/layout/resize/ResizableThreeColumnLayout.tsx')
const appLayout = read('src/components/layout/AppLayout.tsx')

test('left file collapse uses PanelLeftClose, not sole ChevronLeft', () => {
  assert.match(fileManager, /import\s*\{[^}]*PanelLeftClose[^}]*\}\s*from 'lucide-react'/)
  const collapseBtn = fileManager.match(
    /onClick=\{onCollapse\}[\s\S]*?aria-label=\{t\('appShell\.collapseFileManager'\)\}[\s\S]*?<\/Button>/,
  )
  assert.ok(collapseBtn, 'left collapse button block')
  assert.match(collapseBtn[0], /PanelLeftClose/)
  assert.doesNotMatch(collapseBtn[0], /ChevronLeft/)
})

test('right agent collapse uses PanelRightClose, not sole ChevronRight', () => {
  assert.match(agentSidebar, /import\s*\{[^}]*PanelRightClose[^}]*\}\s*from 'lucide-react'/)
  const collapseBtn = agentSidebar.match(
    /onClick=\{onCollapse\}[\s\S]*?aria-label=\{t\('appShell\.collapseAgentAssistant'\)\}[\s\S]*?<\/Button>/,
  )
  assert.ok(collapseBtn, 'right collapse button block')
  assert.match(collapseBtn[0], /PanelRightClose/)
  assert.doesNotMatch(collapseBtn[0], /ChevronRight/)
})

test('collapse wiring still reaches layout collapseLeft / collapseRight', () => {
  assert.match(appLayout, /collapseLeft/)
  assert.match(appLayout, /collapseRight/)
  assert.match(appLayout, /onCollapse=\{collapseLeft\}/)
  assert.match(appLayout, /onCollapse=\{collapseRight\}/)
  assert.match(layout, /const collapseLeft = /)
  assert.match(layout, /const collapseRight = /)
  assert.match(fileManager, /onCollapse\?:/)
  assert.match(agentSidebar, /onCollapse\?:/)
})

test('collapsed rails use matching panel-open icons for expand', () => {
  assert.match(layout, /PanelLeftOpen/)
  assert.match(layout, /PanelRightOpen/)
  const start = layout.indexOf('function CollapsedRail')
  assert.ok(start >= 0, 'CollapsedRail function')
  const rail = layout.slice(start)
  assert.match(rail, /PanelLeftOpen/)
  assert.match(rail, /PanelRightOpen/)
  assert.doesNotMatch(rail, /ChevronLeft|ChevronRight/)
})

if (process.exitCode) {
  console.error(`\n${passed} passed before failure`)
  process.exit(1)
}
console.log(`\n${passed} passed`)

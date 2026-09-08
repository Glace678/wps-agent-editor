import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')

const [packageSource, terminalView, desktopApi, appLayout, appMenu, tauriLib, appState, rustTerminal, agentRuntime] = await Promise.all([
  read('package.json'),
  read('src/components/layout/panel/TerminalView.tsx'),
  read('src/platform/desktop.ts'),
  read('src/components/layout/AppLayout.tsx'),
  read('src/components/layout/AppMenuBar.tsx'),
  read('src-tauri/src/lib.rs'),
  read('src-tauri/src/state.rs'),
  read('src-tauri/src/process/terminal.rs'),
  read('src-tauri/src/agents/runtime.rs'),
])

const packageJson = JSON.parse(packageSource)
assert.equal(packageJson.dependencies['@xterm/xterm'], '5.5.0')
assert.equal(packageJson.dependencies['@xterm/addon-fit'], '0.10.0')

assert.match(terminalView, /import\('@xterm\/xterm'\)/)
assert.match(terminalView, /import\('@xterm\/addon-fit'\)/)
assert.match(terminalView, /new ResizeObserver/)
assert.match(terminalView, /crypto\.randomUUID\(\)/)
assert.match(terminalView, /sessionsRef\.current\.length >= 4/)
assert.match(terminalView, /terminal\.onData\(\(data\) =>/)
assert.match(terminalView, /terminalWrite\(session\.id, data\)/)
assert.match(terminalView, /terminalResize\(session\.id/)
assert.match(terminalView, /terminalKill\(sessionId\)/)
assert.match(terminalView, /closedSessionIdsRef/)

assert.match(desktopApi, /terminalStart\(sessionId, options, onEvent\)/)
assert.match(desktopApi, /event\.sessionId === sessionId/)
assert.doesNotMatch(desktopApi, /terminalExec/)
assert.doesNotMatch(desktopApi, /defaultSession/i)

assert.match(appMenu, /action === 'open-terminal'/)
assert.match(appLayout, /<BottomPanel \/>/)
assert.doesNotMatch(appLayout, /codeFileActive/)

assert.match(tauriLib, /WindowEvent::Destroyed/)
assert.match(tauriLib, /state\.revoke_window\(window\.label\(\)\)/)
assert.match(appState, /terminal::kill_window\(window_label\)/)
assert.match(rustTerminal, /const MAX_SESSIONS_PER_WINDOW: usize = 4;/)
assert.match(rustTerminal, /get\(window\.label\(\), session_id\)/)
assert.match(rustTerminal, /fn key\(window_label: &str, session_id: &str\)/)
assert.match(agentRuntime, /assert!\(!is_document_tool\("terminal"\)\)/)

console.log('Terminal lifecycle and isolation contract checks passed')

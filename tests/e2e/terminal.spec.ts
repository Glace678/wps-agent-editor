import { expect, test, type Page } from '@playwright/test'

interface TerminalMockSnapshot {
  starts: Array<{ sessionId: string; cols: number; rows: number }>
  writes: Array<{ sessionId: string; data: string }>
  resizes: Array<{ sessionId: string; cols: number; rows: number }>
  kills: string[]
  listeners: string[]
  activeListeners: string[]
  menuActions: string[]
  deliveredEvents: string[]
}

async function installTerminalDesktopMock(
  page: Page,
  startDelay: number | 'manual' = 0,
): Promise<void> {
  await page.addInitScript(({ delay }) => {
    const callbacks = new Map<number, (payload: unknown) => void>()
    const channels = new Map<string, { callbackId: number; nextIndex: number }>()
    const eventCallbacks = new Map<string, Map<number, number>>()
    const pendingStartResolvers: Array<() => void> = []
    const snapshot: TerminalMockSnapshot = {
      starts: [],
      writes: [],
      resizes: [],
      kills: [],
      listeners: [],
      activeListeners: [],
      menuActions: [],
      deliveredEvents: [],
    }
    let callbackId = 0
    let eventId = 0

    const syncActiveListeners = () => {
      snapshot.activeListeners = [...eventCallbacks.entries()]
        .filter(([, listeners]) => listeners.size > 0)
        .map(([event]) => event)
    }

    const send = (
      ownerSessionId: string,
      eventSessionId: string,
      event: { type: 'output' | 'exit'; text?: string; code?: number | null },
    ) => {
      const channel = channels.get(ownerSessionId)
      if (!channel) throw new Error(`Missing terminal channel for ${ownerSessionId}`)
      const callback = callbacks.get(channel.callbackId)
      if (!callback) throw new Error(`Missing callback ${channel.callbackId}`)
      callback({
        index: channel.nextIndex++,
        message: {
          ...event,
          sessionId: eventSessionId,
          windowLabel: 'main',
        },
      })
    }

    const invoke = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
      if (command === 'plugin:event|listen') {
        const event = String(args?.event)
        eventId += 1
        const listeners = eventCallbacks.get(event) ?? new Map<number, number>()
        listeners.set(eventId, Number(args?.handler))
        eventCallbacks.set(event, listeners)
        snapshot.listeners.push(event)
        syncActiveListeners()
        return eventId
      }
      if (command === 'plugin:event|unlisten') {
        const event = String(args?.event)
        const listeners = eventCallbacks.get(event)
        listeners?.delete(Number(args?.eventId))
        if (listeners?.size === 0) eventCallbacks.delete(event)
        syncActiveListeners()
        return null
      }
      if (command === 'files_get_home') return { path: '/mock/home', grantId: 'home-grant' }
      if (command === 'files_session_load') {
        return {
          mainDirectory: null,
          currentDirectory: null,
          recentDirectories: [],
          openFiles: [],
          activeFile: null,
        }
      }
      if (command === 'files_list' || command === 'files_search' || command === 'files_get_recent') return []
      if (command === 'agents_list' || command === 'providers_list' || command === 'documents_list_fonts') return []
      if (command === 'providers_auth_status') return {}
      if (command === 'app_take_startup_files' || command === 'app_take_recovery_notices') return []
      if (command === 'app_menu_perform') {
        const action = String(args?.action)
        snapshot.menuActions.push(action)
        const event = `menu:${action}`
        const listeners = eventCallbacks.get(event)
        for (const [listenerEventId, listenerCallbackId] of listeners ?? []) {
          callbacks.get(listenerCallbackId)?.({ event, id: listenerEventId, payload: null })
          snapshot.deliveredEvents.push(event)
        }
        return { success: true }
      }
      if (command === 'process_terminal_start') {
        const request = args?.request as { sessionId: string; cols: number; rows: number }
        const channel = args?.onEvent as { id: number }
        snapshot.starts.push({
          sessionId: request.sessionId,
          cols: request.cols,
          rows: request.rows,
        })
        channels.set(request.sessionId, { callbackId: channel.id, nextIndex: 0 })
        if (delay === 'manual') {
          await new Promise<void>((resolve) => pendingStartResolvers.push(resolve))
        } else if (delay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delay))
        }
        return { started: true, cwd: '/mock/home', sessionId: request.sessionId }
      }
      if (command === 'process_terminal_write') {
        const request = args?.request as { sessionId: string; data: string }
        snapshot.writes.push({ ...request })
        return { success: true }
      }
      if (command === 'process_terminal_resize') {
        const request = args?.request as { sessionId: string; cols: number; rows: number }
        snapshot.resizes.push({ ...request })
        return { success: true }
      }
      if (command === 'process_terminal_kill') {
        snapshot.kills.push(String(args?.sessionId))
        return { success: true }
      }
      return { success: true }
    }

    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke,
        transformCallback(callback: (payload: unknown) => void) {
          callbackId += 1
          callbacks.set(callbackId, callback)
          return callbackId
        },
        unregisterCallback(id: number) {
          callbacks.delete(id)
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __WAE_TERMINAL_MOCK__: {
        snapshot,
        emitOutput(ownerSessionId: string, eventSessionId: string, text: string) {
          send(ownerSessionId, eventSessionId, { type: 'output', text })
        },
        emitExit(sessionId: string, code: number | null) {
          send(sessionId, sessionId, { type: 'exit', code })
        },
        releaseStarts() {
          for (const resolve of pendingStartResolvers.splice(0)) resolve()
        },
      },
    })
  }, { delay: startDelay })
}

async function openTerminalPanel(page: Page): Promise<void> {
  await page.goto('/')
  await expect.poll(async () => (await snapshot(page)).activeListeners)
    .toContain('menu:open-terminal')
  await page.getByTestId('app-menu-view').click()
  await page.getByTestId('app-menu-action-open-terminal').click()
  await expect(page.getByTestId('terminal-view')).toBeVisible()
}

async function snapshot(page: Page): Promise<TerminalMockSnapshot> {
  return page.evaluate(() => (
    (window as unknown as { __WAE_TERMINAL_MOCK__: { snapshot: TerminalMockSnapshot } })
      .__WAE_TERMINAL_MOCK__.snapshot
  ))
}

async function sessionId(page: Page, ordinal: number): Promise<string> {
  const value = await page.locator(`[data-terminal-ordinal="${ordinal}"]`)
    .getAttribute('data-terminal-session-id')
  if (!value) throw new Error(`Terminal ${ordinal} has no session id`)
  return value
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1_280, height: 800 })
})

test('routes ANSI, Unicode, input, resize, exit, and four tabs by exact session id', async ({ page }) => {
  test.setTimeout(60_000)
  await installTerminalDesktopMock(page)
  await openTerminalPanel(page)

  await expect(page.getByTestId('terminal-tab-1')).toHaveAttribute('data-terminal-status', 'running')
  const firstId = await sessionId(page, 1)
  expect(firstId).toMatch(/^[0-9a-f-]{36}$/)

  await page.evaluate(({ id }) => {
    const mock = (window as unknown as {
      __WAE_TERMINAL_MOCK__: {
        emitOutput: (owner: string, eventId: string, text: string) => void
      }
    }).__WAE_TERMINAL_MOCK__
    mock.emitOutput(id, id, '\u001b[31mRED\u001b[0m Unicode: 你好 العربية')
  }, { id: firstId })
  const firstRows = page.locator(`[data-terminal-session-id="${firstId}"] .xterm-rows`)
  await expect(firstRows).toContainText('RED Unicode: 你好 العربية')
  const redColor = await firstRows.locator('span').filter({ hasText: 'RED' }).first()
    .evaluate((element) => getComputedStyle(element).color)
  expect(redColor).not.toBe('rgb(212, 212, 212)')

  const terminalInput = page.locator(`[data-terminal-session-id="${firstId}"] .xterm-helper-textarea`)
  await terminalInput.focus()
  await page.keyboard.insertText('printf 你好')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Control+c')
  await expect.poll(async () => (await snapshot(page)).writes
    .filter((item) => item.sessionId === firstId)
    .map((item) => item.data)
    .join('')).toContain('printf 你好\r\u001b[A\u0003')

  for (let ordinal = 2; ordinal <= 4; ordinal += 1) {
    await page.getByTestId('terminal-new').click()
    await expect(page.getByTestId(`terminal-tab-${ordinal}`))
      .toHaveAttribute('data-terminal-status', 'running')
  }
  await expect(page.getByTestId('terminal-new')).toBeDisabled()
  const ids = await Promise.all([1, 2, 3, 4].map((ordinal) => sessionId(page, ordinal)))
  expect(new Set(ids).size).toBe(4)
  expect((await snapshot(page)).starts.map((item) => item.sessionId)).toEqual(ids)

  await page.evaluate(({ first, fourth }) => {
    const mock = (window as unknown as {
      __WAE_TERMINAL_MOCK__: {
        emitOutput: (owner: string, eventId: string, text: string) => void
      }
    }).__WAE_TERMINAL_MOCK__
    mock.emitOutput(first, fourth, 'WRONG-SESSION')
    mock.emitOutput(first, first, 'FIRST-ONLY')
    mock.emitOutput(fourth, fourth, 'FOURTH-ONLY')
  }, { first: ids[0], fourth: ids[3] })
  await expect(page.locator(`[data-terminal-session-id="${ids[3]}"] .xterm-rows`))
    .toContainText('FOURTH-ONLY')
  await page.getByTestId('terminal-tab-1').getByRole('button').first().click()
  await expect(firstRows).toContainText('FIRST-ONLY')
  expect(await firstRows.textContent()).not.toContain('WRONG-SESSION')
  await page.getByTestId('terminal-tab-4').getByRole('button').first().click()

  const resizeCount = (await snapshot(page)).resizes.length
  await page.setViewportSize({ width: 980, height: 700 })
  await expect.poll(async () => (await snapshot(page)).resizes.length).toBeGreaterThan(resizeCount)
  const latestResize = (await snapshot(page)).resizes.at(-1)
  expect(latestResize?.sessionId).toBe(ids[3])
  expect(latestResize?.cols).toBeGreaterThanOrEqual(10)
  expect(latestResize?.rows).toBeGreaterThanOrEqual(2)

  await page.evaluate(({ id }) => {
    (window as unknown as {
      __WAE_TERMINAL_MOCK__: { emitExit: (sessionId: string, code: number | null) => void }
    }).__WAE_TERMINAL_MOCK__.emitExit(id, 0)
  }, { id: ids[2] })
  await expect(page.getByTestId('terminal-tab-3')).toHaveAttribute('data-terminal-status', 'exited')
  await expect(page.getByTestId('terminal-tab-4')).toHaveAttribute('data-terminal-status', 'running')

  await page.getByTestId('terminal-close-2').click()
  await expect(page.getByTestId('terminal-tab-2')).toHaveCount(0)
  expect((await snapshot(page)).kills).toContain(ids[1])

  const startsBeforeCollapse = (await snapshot(page)).starts.length
  await page.getByTestId('bottom-panel-close').click()
  await expect(page.getByTestId('bottom-panel')).toBeHidden()
  await page.getByTestId('app-menu-view').click()
  await page.getByTestId('app-menu-action-open-terminal').click()
  await expect(page.getByTestId('terminal-tab-4')).toBeVisible()
  expect((await snapshot(page)).starts).toHaveLength(startsBeforeCollapse)
})

test('kills a session again when close wins a pending terminal start', async ({ page }) => {
  await installTerminalDesktopMock(page, 'manual')
  await openTerminalPanel(page)

  await expect.poll(async () => (await snapshot(page)).starts.length).toBe(1)
  const id = await sessionId(page, 1)
  await page.getByTestId('terminal-close-1').click()
  await expect(page.getByTestId('terminal-tab-1')).toHaveCount(0)
  await page.evaluate(() => {
    (window as unknown as {
      __WAE_TERMINAL_MOCK__: { releaseStarts: () => void }
    }).__WAE_TERMINAL_MOCK__.releaseStarts()
  })
  await expect.poll(async () => (await snapshot(page)).kills.filter((value) => value === id).length)
    .toBeGreaterThanOrEqual(2)
})

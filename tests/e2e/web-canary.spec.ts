import { expect, test, type Page } from '@playwright/test'

async function installDesktopMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (payload: unknown) => void>()
    let callbackId = 0
    let startupDrained = false
    const invokedCommands: string[] = []
    const providers = [{
      id: 'ollama',
      name: 'Ollama',
      api: 'http://127.0.0.1:11434/v1',
      npm: '',
      env: [],
      protocol: 'openaiCompatible',
      models: [],
      isCustom: false,
      isLocal: true,
    }]
    const invoke = async (command: string): Promise<unknown> => {
      invokedCommands.push(command)
      if (command === 'plugin:event|listen') return 1
      if (command === 'plugin:event|unlisten') return null
      if (command === 'files_get_home') return { path: '/mock/home', grantId: 'home-grant' }
      if (command === 'files_list' || command === 'files_search') return []
      if (command === 'files_get_recent') return []
      if (command === 'agents_list') return []
      if (command === 'providers_list') return providers
      if (command === 'providers_auth_status') return {}
      if (command === 'documents_list_fonts') return []
      if (command === 'app_take_startup_files') {
        if (!startupDrained && new URL(window.location.href).searchParams.get('startup') === 'text') {
          startupDrained = true
          return [{ path: '/mock/notes.txt', grantId: 'notes-grant' }]
        }
        return []
      }
      if (command === 'files_open') {
        return { path: '/mock/notes.txt', grantId: 'notes-grant', recent: [] }
      }
      if (command === 'documents_read_file') {
        return new TextEncoder().encode('typed desktop bridge\n')
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
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener() {},
      },
      __WAE_TEST_COMMANDS__: invokedCommands,
    })
  })
}

test.beforeEach(async ({ page }) => {
  await installDesktopMock(page)
})

test('starts with the typed desktop bridge and renders the workspace', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.goto('/')

  await expect(page).toHaveTitle('WPS Agent Editor')
  await expect(page.getByTestId('file-manager-home-button')).toBeVisible()
  await expect(page.getByTestId('theme-toggle')).toBeVisible()
  await expect(page.getByTestId('agent-new')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as { __WAE_TEST_COMMANDS__: string[] }).__WAE_TEST_COMMANDS__
      .includes('app_startup_healthy')
  ))).toBe(true)
  expect(pageErrors).toEqual([])
})

test('switches language and theme without loading an editor eagerly', async ({ page }) => {
  const editorChunks: string[] = []
  page.on('response', (response) => {
    if (/WordEditor|ExcelEditor|PresentationViewer|PdfViewer|CodeEditor/.test(response.url())) {
      editorChunks.push(response.url())
    }
  })
  await page.goto('/')

  await page.getByTestId('language-menu-trigger').click()
  await page.getByTestId('language-option-en').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  const before = await page.locator('html').getAttribute('class')
  await page.getByTestId('theme-toggle').click()
  await expect.poll(async () => page.locator('html').getAttribute('class')).not.toBe(before)
  expect(editorChunks).toEqual([])
})

test('opens, edits, and saves a granted text startup file through typed commands', async ({ page }) => {
  await page.goto('/?startup=text')

  const editor = page.getByTestId('text-editor-input')
  await expect(editor).toBeVisible()
  await expect(editor).toHaveValue('typed desktop bridge\n')
  await editor.fill('changed through Tauri')
  await editor.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')

  await expect.poll(() => page.evaluate(() => (
    (window as unknown as { __WAE_TEST_COMMANDS__: string[] }).__WAE_TEST_COMMANDS__
      .includes('documents_save_text')
  ))).toBe(true)
})

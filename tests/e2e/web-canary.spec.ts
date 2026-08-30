import { expect, test, type Page } from '@playwright/test'

async function installDesktopMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (payload: unknown) => void>()
    let callbackId = 0
    let startupDrained = false
    const invokedCommands: string[] = []
    const invokedMenuActions: string[] = []
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
    const invoke = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
      invokedCommands.push(command)
      if (command === 'app_menu_perform' && typeof args?.action === 'string') {
        invokedMenuActions.push(args.action)
      }
      if (command === 'plugin:event|listen') return 1
      if (command === 'plugin:event|unlisten') return null
      if (command === 'files_get_home') return { path: '/mock/home', grantId: 'home-grant' }
      if (command === 'files_list' || command === 'files_search') return []
      if (command === 'files_get_recent') return []
      if (command === 'files_session_load') {
        if (new URL(window.location.href).searchParams.get('session') === 'text') {
          return {
            mainDirectory: { path: '/mock/workspace', grantId: 'workspace-main-grant' },
            currentDirectory: { path: '/mock/workspace', grantId: 'workspace-current-grant' },
            recentDirectories: [
              { path: '/mock/workspace', grantId: 'workspace-recent-grant' },
            ],
            openFiles: [
              { path: '/mock/first.txt', grantId: 'first-grant' },
              { path: '/mock/notes.txt', grantId: 'notes-grant' },
            ],
            activeFile: '/mock/notes.txt',
          }
        }
        return {
          mainDirectory: null,
          currentDirectory: null,
          recentDirectories: [],
          openFiles: [],
          activeFile: null,
        }
      }
      if (command === 'files_session_save') return null
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
      __WAE_TEST_MENU_ACTIONS__: invokedMenuActions,
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

test('opens every application menu in every supported language', async ({ page }) => {
  const menuLabels = {
    'zh-CN': ['文件', '编辑', '查看', 'Agent', '帮助'],
    en: ['File', 'Edit', 'View', 'Agent', 'Help'],
    ja: ['ファイル', '編集', '表示', 'Agent', 'ヘルプ'],
    es: ['Archivo', 'Edición', 'Ver', 'Agent', 'Ayuda'],
    pt: ['Arquivo', 'Editar', 'Visualizar', 'Agent', 'Ajuda'],
    de: ['Datei', 'Bearbeiten', 'Ansicht', 'Agent', 'Hilfe'],
    fr: ['Fichier', 'Édition', 'Affichage', 'Agent', 'Aide'],
    ru: ['Файл', 'Правка', 'Вид', 'Agent', 'Справка'],
    ar: ['ملف', 'تحرير', 'عرض', 'Agent', 'مساعدة'],
  } as const
  const menuTops = ['file', 'edit', 'view', 'agent', 'help'] as const

  await page.goto('/')

  for (const [language, expectedLabels] of Object.entries(menuLabels)) {
    await test.step(language, async () => {
      await page.getByTestId('language-menu-trigger').click()
      await page.getByTestId(`language-option-${language}`).click()
      await expect(page.locator('html')).toHaveAttribute('lang', language)
      await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr')

      for (const [index, top] of menuTops.entries()) {
        const trigger = page.getByTestId(`app-menu-${top}`)
        const content = page.getByTestId(`app-menu-content-${top}`)
        await expect(trigger).toHaveText(expectedLabels[index])
        await trigger.click()
        await expect(content).toBeVisible()
        await trigger.click()
        await expect(content).toBeHidden()
      }

      const fileTrigger = page.getByTestId('app-menu-file')
      const editTrigger = page.getByTestId('app-menu-edit')
      await fileTrigger.click()
      await expect(page.getByTestId('app-menu-content-file')).toBeVisible()
      await editTrigger.click()
      await expect(page.getByTestId('app-menu-content-file')).toBeHidden()
      await expect(page.getByTestId('app-menu-content-edit')).toBeVisible()
      await editTrigger.click()
      await expect(page.getByTestId('app-menu-content-edit')).toBeHidden()
    })
  }
})

test('dispatches every visible application menu action', async ({ page }) => {
  const menuActions = {
    file: ['open-file', 'open-folder', 'save', 'print', 'quit'],
    edit: ['undo', 'redo', 'cut', 'copy', 'paste', 'select-all'],
    view: [
      'reload',
      'force-reload',
      'toggle-dev-tools',
      'reset-zoom',
      'zoom-in',
      'zoom-out',
      'toggle-fullscreen',
    ],
    agent: ['new-agent'],
    help: ['show-about'],
  } as const

  await page.goto('/')

  for (const [top, actions] of Object.entries(menuActions)) {
    for (const action of actions) {
      await page.getByTestId(`app-menu-${top}`).click()
      await page.getByTestId(`app-menu-action-${action}`).click()
      await expect.poll(() => page.evaluate((expectedAction) => (
        (window as unknown as { __WAE_TEST_MENU_ACTIONS__: string[] })
          .__WAE_TEST_MENU_ACTIONS__.includes(expectedAction)
      ), action)).toBe(true)
    }
  }
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

test('restores persisted folders and all document tabs through granted session paths', async ({ page }) => {
  await page.goto('/?session=text')

  const tabBar = page.getByTestId('shell-document-tab-bar')
  await expect(tabBar).toContainText('first.txt')
  await expect(tabBar).toContainText('notes.txt')
  await expect(page.getByTestId('text-editor-input')).toHaveValue('typed desktop bridge\n')
  await expect(page.getByRole('button', { name: '/mock/workspace', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as { __WAE_TEST_COMMANDS__: string[] }).__WAE_TEST_COMMANDS__
      .includes('files_session_save')
  ))).toBe(true)
})

import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { createMinimalPagedDocx } from './support/minimal-docx'

function sourceUrl(relativePath: string): string {
  return `/@fs/${path.resolve(relativePath).replaceAll('\\', '/')}`
}

/**
 * Invoke commands the word desktop session is expected to issue. Anything
 * outside this allowlist is recorded and tagged as unhandled so the test can
 * fail closed on an unexpected bridge call instead of silently accepting a
 * fabricated { success: true }.
 */
const MODELED_COMMANDS = new Set([
  'plugin:event|listen',
  'plugin:event|unlisten',
  'files_get_home',
  'files_session_load',
  'files_session_save',
  'documents_save_binary',
  'files_list',
  'files_search',
  'files_get_recent',
  'agents_list',
  'providers_list',
  'documents_list_fonts',
  'providers_auth_status',
  'documents_prepare_word',
  'app_take_startup_files',
  // Startup / lifecycle bridge calls the app issues on boot; these are routine
  // and unrelated to the color-picker flow, so model them rather than failing.
  'app_i18n_set_language',
  'app_theme_set',
  'app_startup_healthy',
  'app_take_recovery_notices',
  'documents_set_current_file',
  'agents_conversations_list',
  'agents_conversations_import_codex',
])

async function installWordDesktopMock(page: Page): Promise<void> {
  const bytes = await createMinimalPagedDocx(3)
  await page.addInitScript(({ fixtureBytes, modeled }) => {
    const callbacks = new Map<number, (payload: unknown) => void>()
    let callbackId = 0
    const invocations: Array<{ command: string; args?: unknown; handled: boolean }> = []
    const encodeWae1 = (metadata: unknown, payload: Uint8Array) => {
      const meta = new TextEncoder().encode(JSON.stringify(metadata))
      const out = new Uint8Array(8 + meta.length + payload.length)
      out.set([0x57, 0x41, 0x45, 0x31], 0)
      new DataView(out.buffer).setUint32(4, meta.length, true)
      out.set(meta, 8)
      out.set(payload, 8 + meta.length)
      return out
    }
    const modeledSet = new Set<string>(modeled)
    const invoke = async (command: string, args?: unknown): Promise<unknown> => {
      const handled = modeledSet.has(command)
      invocations.push({ command, args, handled })
      switch (command) {
        case 'plugin:event|listen': return ++callbackId
        case 'plugin:event|unlisten': return null
        case 'files_get_home': return { path: '/mock/home', grantId: 'home-grant' }
        case 'files_session_load':
          return {
            mainDirectory: null,
            currentDirectory: null,
            recentDirectories: [],
            openFiles: [{ path: '/mock/test.docx', grantId: 'word-grant' }],
            activeFile: '/mock/test.docx',
          }
        case 'files_session_save':
        case 'documents_save_binary': return null
        case 'files_list':
        case 'files_search':
        case 'files_get_recent': return []
        case 'agents_list':
        case 'providers_list':
        case 'documents_list_fonts': return []
        case 'providers_auth_status': return {}
        case 'documents_prepare_word':
          return encodeWae1({
            convertedFromLegacy: false,
            converter: null,
            nativeConversionFailed: false,
            normalizedLegacyImageCount: 0,
            normalizedTableCount: 0,
            removedUnderlineRunCount: 0,
          }, Uint8Array.from(fixtureBytes))
        case 'app_take_startup_files': return []
        case 'app_take_recovery_notices': return []
        case 'agents_conversations_list':
        case 'agents_conversations_import_codex': return []
        case 'app_i18n_set_language':
        case 'app_theme_set':
        case 'app_startup_healthy':
        case 'documents_set_current_file': return { success: true }
        default:
          // Fail closed: do not pretend an unmodeled command succeeded.
          return { success: false, error: `unhandled test command: ${command}` }
      }
    }
    Object.assign(window, {
      __WAE_INVOKED_COMMANDS__: invocations,
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
    })
  }, { fixtureBytes: Array.from(bytes), modeled: [...MODELED_COMMANDS] })
}

test('Excel circular picker reconnects to rerendered Fortune controls', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async (moduleUrl) => {
    const { mountExcelCircularColorPicker } = await import(moduleUrl)
    const container = document.createElement('div')
    container.id = 'fortune-custom-color'
    container.innerHTML = `
      <div class="color-reset" tabindex="0">Reset</div>
      <div class="custom-color">
        <input type="color" value="#123456" />
        <div class="button-basic button-primary" tabindex="0">Confirm</div>
      </div>
      <div class="fortune-toolbar-color-picker"></div>`
    document.body.appendChild(container)

    const waitFor = async (fn: () => boolean, timeout = 2000) => {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (fn()) return
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error('waitFor timed out')
    }

    mountExcelCircularColorPicker(container)
    await waitFor(() => Boolean(container.querySelector('.excel-circular-color-picker')))
    container.querySelector('.excel-circular-color-picker-mount')?.remove()
    container.querySelector('.color-reset')?.replaceWith(Object.assign(
      document.createElement('div'),
      { className: 'color-reset', tabIndex: 0, textContent: 'Reset again' },
    ))
    const customColor = document.createElement('div')
    customColor.className = 'custom-color'
    customColor.innerHTML = '<input type="color" value="#654321" /><div class="button-basic button-primary" tabindex="0">Confirm again</div>'
    container.querySelector('.custom-color')?.replaceWith(customColor)

    let resetClicks = 0
    let confirmClicks = 0
    let inputEvents = 0
    let changeEvents = 0
    container.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return
      if (event.target.matches('.color-reset')) resetClicks += 1
      if (event.target.matches('.button-primary')) confirmClicks += 1
    })
    container.addEventListener('input', () => { inputEvents += 1 })
    container.addEventListener('change', () => { changeEvents += 1 })

    mountExcelCircularColorPicker(container)
    await waitFor(() => Boolean(container.querySelector('.excel-circular-color-picker')))
    resetClicks = 0
    confirmClicks = 0
    inputEvents = 0
    changeEvents = 0
    container.querySelector<HTMLElement>('.excel-color-reset-btn')?.click()
    container.querySelector<HTMLElement>('.excel-color-confirm-btn')?.click()
    await waitFor(() => {
      const input = container.querySelector<HTMLInputElement>('input[type="color"]')
      return input !== null && input.value.toUpperCase() === '#654321'
    })

    const input = container.querySelector<HTMLInputElement>('input[type="color"]')
    const picker = container.querySelector<HTMLElement>('.excel-circular-color-picker')
    const output = {
      resetClicks,
      confirmClicks,
      inputEvents,
      changeEvents,
      inputValue: input?.value.toUpperCase(),
      selectedColor: picker?.dataset.selectedColor,
      resetHidden: container.querySelector<HTMLElement>('.color-reset')?.style.display,
      customHidden: container.querySelector<HTMLElement>('.custom-color')?.style.display,
    }
    container.remove()
    return output
  }, sourceUrl('src/lightweight-office/components/ExcelCircularColorPicker.tsx'))

  expect(result).toMatchObject({
    resetClicks: 1,
    confirmClicks: 1,
    inputEvents: 1,
    changeEvents: 1,
    resetHidden: 'none',
    customHidden: 'none',
  })
  expect(result.inputValue).toBe(result.selectedColor)
})

test('Word color picker installs palette, custom wheel, and reset behavior', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async (moduleUrl) => {
    const { installWordFontColorPicker } = await import(moduleUrl)
    const owner = document.createElement('div')
    owner.className = 'word-editor-panel'
    const trigger = document.createElement('div')
    trigger.dataset.item = 'btn-color'
    owner.appendChild(trigger)
    document.body.appendChild(owner)
    const item = {
      name: { value: 'color' },
      expand: { value: false },
      iconColor: { value: '#000000' },
    }
    const calls: Array<string | null> = []
    const toolbar = {
      toolbarContainer: owner,
      toolbarItems: [item],
      overflowItems: [],
      getToolbarItemByName: () => item,
      emitCommand: ({ argument }: { argument: string | null }) => calls.push(argument),
    }
    const cleanup = installWordFontColorPicker({ toolbar, root: owner, language: 'zh-CN' })
    const waitFor = async (fn: () => boolean, timeout = 2000) => {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (fn()) return
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error('waitFor timed out')
    }
    const openMenu = () => {
      item.expand.value = true
      const menu = document.createElement('div')
      menu.className = 'toolbar-dropdown-menu'
      menu.dataset.sdPart = 'dropdown-menu'
      menu.innerHTML = '<div class="toolbar-dropdown-option"><div><div class="options-grid-wrap"></div></div></div>'
      document.body.appendChild(menu)
      return menu
    }

    trigger.click()
    const palette = openMenu()
    await waitFor(() => palette.querySelectorAll('[data-word-color-swatch]').length === 64)
    const swatchCount = palette.querySelectorAll('[data-word-color-swatch]').length
    // The swatch we click must exist and carry the exact color we expect.
    const swatch = palette.querySelector<HTMLElement>('[data-word-color-swatch="#F00F00"]')
    if (!swatch) throw new Error('expected #F00F00 swatch to be rendered')
    swatch.click()
    await waitFor(() => item.iconColor.value === '#F00F00')
    palette.remove()

    const custom = openMenu()
    trigger.click()
    await waitFor(() => custom.querySelector('[data-word-color-custom]') !== null)
    custom.querySelector<HTMLElement>('[data-word-color-custom]')?.click()
    await waitFor(() => Boolean(custom.querySelector('.excel-circular-color-picker')))
    const hasCircularPicker = Boolean(custom.querySelector('.excel-circular-color-picker'))
    // The wheel must seed its hex field from the color just applied to the
    // toolbar icon (#F00F00), proving selection propagated into the editor state.
    const seededHex = custom.querySelector<HTMLInputElement>('.excel-color-hex-input')?.value.toUpperCase()
    custom.querySelector<HTMLElement>('.excel-color-confirm-btn')?.click()
    await waitFor(() => item.iconColor.value === '#F00F00')
    custom.remove()

    const reset = openMenu()
    trigger.click()
    await waitFor(() => reset.querySelector('[data-word-color-reset]') !== null)
    reset.querySelector<HTMLElement>('[data-word-color-reset]')?.click()
    await waitFor(() => item.iconColor.value === '#000000')
    cleanup()
    owner.remove()
    reset.remove()
    return { swatchCount, calls, itemColor: item.iconColor.value, itemExpanded: item.expand.value, hasCircularPicker, seededHex }
  }, sourceUrl('src/lightweight-office/word-color-picker.tsx'))

  expect(result).toEqual({
    swatchCount: 64,
    calls: ['#F00F00', '#F00F00', null],
    itemColor: '#000000',
    itemExpanded: false,
    hasCircularPicker: true,
    seededHex: '#F00F00',
  })
})

test('Word color picker works inside the editor', async ({ page }, testInfo) => {
  await installWordDesktopMock(page)
  const errors: Error[] = []
  page.on('pageerror', (error) => errors.push(error))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?session=word', { waitUntil: 'domcontentloaded' })

  const trigger = page.locator(".word-editor-panel [data-item='btn-color']").first()
  await expect(trigger).toBeVisible({ timeout: 30_000 })

  // --- Palette swatch applies the color to the toolbar/editor state. ---
  await trigger.click()
  const picker = page.locator('body [data-word-font-color-picker="true"]')
  await expect(picker).toBeVisible()
  await expect(picker.locator('[data-word-color-swatch]')).toHaveCount(64)
  // The chosen swatch must carry the exact color and be visible before clicking.
  const chosenSwatch = picker.locator('[data-word-color-swatch="#F00F00"]')
  await expect(chosenSwatch).toBeVisible()
  await chosenSwatch.click()
  // Applying closes the menu...
  await expect(picker).toBeHidden()

  // ...and propagates to editor state: reopening the custom wheel seeds its hex
  // field from the applied color rather than the default black.
  await trigger.click()
  await expect(picker).toBeVisible()
  await picker.locator('[data-word-color-custom]').click()
  const wheel = picker.locator('.excel-circular-color-picker')
  await expect(wheel).toBeVisible()
  const hexInput = picker.locator('.excel-color-hex-input')
  await expect(hexInput).toHaveValue('#F00F00')

  // --- Wheel geometry: the wheel keeps v (brightness) from the seeded color.
  // Seeding #F00F00 -> v = 240/255. Clicking the wheel center sets saturation
  // to 0, i.e. pure gray at that brightness: rgb(240,240,240) = #F0F0F0.
  // The pointer handler lives on .excel-color-wheel-wrap (not the canvas), so we
  // drive raw pointer coordinates rather than element.click() interception. ---
  const canvas = picker.locator('.excel-color-wheel-canvas')
  const wheelBox = await canvas.boundingBox()
  expect(wheelBox).not.toBeNull()
  await page.mouse.click(wheelBox!.x + wheelBox!.width / 2, wheelBox!.y + wheelBox!.height / 2)
  await expect(hexInput).toHaveValue('#F0F0F0')

  // Clicking the right horizontal midline at 60% radius selects hue 0 (red
  // family) at saturation 0.6 with the same v: hsvToRgb(0, 0.6, 240/255) =
  // rgb(240, 96, 96) = #F06060. This ties the click geometry to an exact color.
  await page.mouse.click(wheelBox!.x + 116, wheelBox!.y + 74)
  await expect(hexInput).toHaveValue('#F06060')

  await page.screenshot({ path: testInfo.outputPath('word-font-color-picker.png') })
  await picker.locator('.excel-color-confirm-btn').click()
  await expect(picker).toBeHidden()

  // Confirm must apply #F06060 to the editor state: reopening the wheel now
  // seeds its hex field with the confirmed color.
  await trigger.click()
  await expect(picker).toBeVisible()
  await picker.locator('[data-word-color-custom]').click()
  await expect(picker.locator('.excel-circular-color-picker')).toBeVisible()
  await expect(picker.locator('.excel-color-hex-input')).toHaveValue('#F06060')

  // --- Fail-closed bridge: the document must have loaded via the modeled
  // prepare/session commands, and no unmodeled Tauri command may have been
  // invoked (those return { success: false } and would surface as errors). ---
  const invocations = await page.evaluate(() => (
    window as unknown as {
      __WAE_INVOKED_COMMANDS__: Array<{ command: string; handled: boolean }>
    }
  ).__WAE_INVOKED_COMMANDS__)
  const commands = invocations.map((entry) => entry.command)
  expect(commands).toContain('files_session_load')
  expect(commands).toContain('documents_prepare_word')
  const unhandled = invocations.filter((entry) => !entry.handled).map((entry) => entry.command)
  expect(unhandled).toEqual([])

  expect(errors).toEqual([])
})

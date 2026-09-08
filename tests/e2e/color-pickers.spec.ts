import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { createMinimalPagedDocx } from './support/minimal-docx'

function sourceUrl(relativePath: string): string {
  return `/@fs/${path.resolve(relativePath).replaceAll('\\', '/')}`
}

async function installWordDesktopMock(page: Page): Promise<void> {
  const bytes = await createMinimalPagedDocx(3)
  await page.addInitScript((fixtureBytes) => {
    const callbacks = new Map<number, (payload: unknown) => void>()
    let callbackId = 0
    const encodeWae1 = (metadata: unknown, payload: Uint8Array) => {
      const meta = new TextEncoder().encode(JSON.stringify(metadata))
      const out = new Uint8Array(8 + meta.length + payload.length)
      out.set([0x57, 0x41, 0x45, 0x31], 0)
      new DataView(out.buffer).setUint32(4, meta.length, true)
      out.set(meta, 8)
      out.set(payload, 8 + meta.length)
      return out
    }
    const invoke = async (command: string): Promise<unknown> => {
      if (command === 'plugin:event|listen') return 1
      if (command === 'plugin:event|unlisten') return null
      if (command === 'files_get_home') return { path: '/mock/home', grantId: 'home-grant' }
      if (command === 'files_session_load') {
        return {
          mainDirectory: null,
          currentDirectory: null,
          recentDirectories: [],
          openFiles: [{ path: '/mock/test.docx', grantId: 'word-grant' }],
          activeFile: '/mock/test.docx',
        }
      }
      if (command === 'files_session_save' || command === 'documents_save_binary') return null
      if (command === 'files_list' || command === 'files_search' || command === 'files_get_recent') return []
      if (command === 'agents_list' || command === 'providers_list' || command === 'documents_list_fonts') return []
      if (command === 'providers_auth_status') return {}
      if (command === 'documents_prepare_word') {
        return encodeWae1({
          convertedFromLegacy: false,
          converter: null,
          nativeConversionFailed: false,
          normalizedLegacyImageCount: 0,
          normalizedTableCount: 0,
          removedUnderlineRunCount: 0,
        }, Uint8Array.from(fixtureBytes))
      }
      if (command === 'app_take_startup_files') return []
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
    })
  }, Array.from(bytes))
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

    mountExcelCircularColorPicker(container)
    await new Promise((resolve) => setTimeout(resolve, 50))
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
    await new Promise((resolve) => setTimeout(resolve, 50))
    resetClicks = 0
    confirmClicks = 0
    inputEvents = 0
    changeEvents = 0
    container.querySelector<HTMLElement>('.excel-color-reset-btn')?.click()
    container.querySelector<HTMLElement>('.excel-color-confirm-btn')?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

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
    await new Promise((resolve) => setTimeout(resolve, 100))
    const swatchCount = palette.querySelectorAll('[data-word-color-swatch]').length
    palette.querySelector<HTMLElement>('[data-word-color-swatch="#F00F00"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 30))
    palette.remove()

    const custom = openMenu()
    trigger.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    custom.querySelector<HTMLElement>('[data-word-color-custom]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const hasCircularPicker = Boolean(custom.querySelector('.excel-circular-color-picker'))
    custom.querySelector<HTMLElement>('.excel-color-confirm-btn')?.click()
    await new Promise((resolve) => setTimeout(resolve, 30))
    custom.remove()

    const reset = openMenu()
    trigger.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    reset.querySelector<HTMLElement>('[data-word-color-reset]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 30))
    cleanup()
    owner.remove()
    reset.remove()
    return { swatchCount, calls, itemColor: item.iconColor.value, itemExpanded: item.expand.value, hasCircularPicker }
  }, sourceUrl('src/lightweight-office/word-color-picker.tsx'))

  expect(result).toEqual({
    swatchCount: 64,
    calls: ['#F00F00', '#F00F00', null],
    itemColor: '#000000',
    itemExpanded: false,
    hasCircularPicker: true,
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
  await trigger.click()
  const picker = page.locator('body [data-word-font-color-picker="true"]')
  await expect(picker).toBeVisible()
  await expect(picker.locator('[data-word-color-swatch]')).toHaveCount(64)
  await picker.locator('[data-word-color-swatch="#F00F00"]').click()

  await trigger.click()
  await expect(picker).toBeVisible()
  await picker.locator('[data-word-color-custom]').click()
  await expect(picker.locator('.excel-circular-color-picker')).toBeVisible()
  await picker.locator('.excel-color-wheel-wrap').click({ position: { x: 110, y: 70 } })
  await expect(picker.locator('.excel-color-hex-input')).toHaveValue(/^#[0-9A-F]{6}$/i)
  await page.screenshot({ path: testInfo.outputPath('word-font-color-picker.png') })
  await picker.locator('.excel-color-confirm-btn').click()
  await expect(picker).toBeHidden()
  expect(errors).toEqual([])
})

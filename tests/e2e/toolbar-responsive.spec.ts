import { expect, test, type Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { createMinimalPagedDocx } from './support/minimal-docx'
import { e2eTestTimeout } from './support/timeouts'

type EditorKind = 'excel' | 'word'

async function installDesktopMock(page: Page, kind: EditorKind): Promise<void> {
  const bytes = kind === 'excel'
    ? await (async () => {
        const workbook = new ExcelJS.Workbook()
        workbook.addWorksheet('Toolbar').getCell('A1').value = 'Toolbar test'
        return new Uint8Array(await workbook.xlsx.writeBuffer())
      })()
    : await createMinimalPagedDocx()
  await page.addInitScript(({ kind, bytes }) => {
    const callbacks = new Map<number, (payload: unknown) => void>()
    let callbackId = 0
    const path = `/mock/toolbar.${kind === 'excel' ? 'xlsx' : 'docx'}`
    const invoke = async (command: string): Promise<unknown> => {
      if (command === 'plugin:event|listen') return 1
      if (command === 'plugin:event|unlisten') return null
      if (command === 'files_session_load') {
        return {
          mainDirectory: null,
          currentDirectory: null,
          recentDirectories: [],
          openFiles: [{ path, grantId: 'toolbar-grant' }],
          activeFile: path,
        }
      }
      if (command === 'files_get_home') return { path: '/mock/home', grantId: 'home-grant' }
      if (command === 'files_list' || command === 'files_search'
        || command === 'files_get_recent' || command === 'agents_list'
        || command === 'agents_conversations_list') return []
      if (command === 'providers_list') return []
      if (command === 'providers_auth_status') return {}
      if (command === 'documents_list_fonts' || command === 'app_take_startup_files'
        || command === 'app_take_recovery_notices') return []
      if (command === 'files_stat') {
        return {
          exists: true,
          size: bytes.length,
          modifiedAt: 1_788_825_600_000,
          createdAt: 1_788_825_600_000,
          extension: kind === 'excel' ? 'xlsx' : 'docx',
        }
      }
      if (command === 'documents_prepare_spreadsheet') return Uint8Array.from(bytes)
      if (command === 'documents_prepare_word') {
        const metadata = new TextEncoder().encode(JSON.stringify({
          convertedFromLegacy: false,
          converter: null,
          nativeConversionFailed: false,
          normalizedLegacyImageCount: 0,
          normalizedTableCount: 0,
          removedUnderlineRunCount: 0,
        }))
        const envelope = new Uint8Array(8 + metadata.length + bytes.length)
        envelope.set([0x57, 0x41, 0x45, 0x31], 0)
        new DataView(envelope.buffer).setUint32(4, metadata.length, true)
        envelope.set(metadata, 8)
        envelope.set(bytes, 8 + metadata.length)
        return envelope
      }
      if (command === 'agents_conversations_import_codex') {
        return {
          discovered: 0, imported: 0, updated: 0, skipped: 0,
          failed: 0, messages: 0, failures: [],
        }
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
    })
  }, { kind, bytes: Array.from(bytes) })
}

async function toolbarSnapshot(page: Page, kind: EditorKind) {
  return page.evaluate((kind) => {
    const row = document.querySelector<HTMLElement>(
      kind === 'excel' ? '.fortune-toolbar' : '.superdoc-toolbar',
    )
    if (!row) return null
    const rowRect = row.getBoundingClientRect()
    const items = Array.from(row.querySelectorAll<HTMLElement>(
      kind === 'excel' ? '.fortune-toolbar-item' : ':scope > .button-group > .sd-toolbar-item-ctn',
    ))
    const overflow = kind === 'excel'
      ? null
      : row.querySelector<HTMLElement>('.overflow-menu')?.parentElement ?? null
    const overflowRect = overflow?.getBoundingClientRect()
    return {
      width: row.clientWidth,
      rowRight: rowRect.right,
      count: items.length,
      lastRight: items.at(-1)?.getBoundingClientRect().right ?? rowRect.left,
      overlaps: overflowRect
        ? items.some((item) => {
            if (item === overflow) return false
            const rect = item.getBoundingClientRect()
            return rect.right > overflowRect.left && rect.left < overflowRect.right
          })
        : false,
    }
  }, kind)
}

for (const kind of ['excel', 'word'] as const) {
  test(`${kind} toolbar reflows in both directions before sidebar mouseup`, async ({ page }) => {
    test.setTimeout(e2eTestTimeout(90_000))
    const errors: Error[] = []
    page.on('pageerror', (error) => errors.push(error))
    await installDesktopMock(page, kind)
    await page.goto('/')
    await page.locator(kind === 'excel' ? '.fortune-toolbar' : '.superdoc-toolbar').waitFor()
    await expect.poll(async () => (await toolbarSnapshot(page, kind))?.count ?? 0).toBeGreaterThan(10)
    await page.waitForTimeout(300)

    const before = await toolbarSnapshot(page, kind)
    expect(before).not.toBeNull()
    const canvasWidth = kind === 'excel'
      ? await page.locator('.fortune-sheet-overlay').evaluate((element) => element.clientWidth)
      : null
    const handle = await page.getByRole('separator').last().boundingBox()
    expect(handle).not.toBeNull()
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 200)
    await page.mouse.down()

    // Deliberately hold the primary button down throughout these assertions.
    await page.mouse.move(handle!.x - 200, handle!.y + 200, { steps: 15 })
    await expect.poll(async () => (await toolbarSnapshot(page, kind))?.width ?? 0)
      .toBeLessThan(before!.width - 100)
    await expect.poll(async () => (await toolbarSnapshot(page, kind))?.count ?? 0)
      .toBeLessThan(before!.count)
    const narrowed = await toolbarSnapshot(page, kind)
    expect(narrowed!.lastRight).toBeLessThanOrEqual(narrowed!.rowRight + 1)
    expect(narrowed!.overlaps).toBe(false)
    if (kind === 'excel') {
      // Only the toolbar reflows on drag frames; the costly canvas layout is
      // still deferred until panel idle.
      expect(await page.locator('.fortune-sheet-overlay').evaluate((element) => element.clientWidth))
        .toBe(canvasWidth)
    }

    await page.mouse.move(handle!.x - 400, handle!.y + 200, { steps: 10 })
    await expect.poll(async () => (await toolbarSnapshot(page, kind))?.width ?? 0)
      .toBeLessThan(narrowed!.width - 100)
    const narrowest = await toolbarSnapshot(page, kind)
    expect(narrowest!.lastRight).toBeLessThanOrEqual(narrowest!.rowRight + 1)
    expect(narrowest!.overlaps).toBe(false)

    await page.mouse.move(handle!.x, handle!.y + 200, { steps: 15 })
    await expect.poll(async () => (await toolbarSnapshot(page, kind))?.count ?? 0)
      .toBe(before!.count)
    const restored = await toolbarSnapshot(page, kind)
    expect(restored!.overlaps).toBe(false)
    await page.mouse.up()

    const leftHandle = await page.getByRole('separator').first().boundingBox()
    expect(leftHandle).not.toBeNull()
    await page.mouse.move(leftHandle!.x + leftHandle!.width / 2, leftHandle!.y + 200)
    await page.mouse.down()
    await page.mouse.move(leftHandle!.x + 200, leftHandle!.y + 200, { steps: 10 })
    await expect.poll(async () => (await toolbarSnapshot(page, kind))?.width ?? 0)
      .toBeLessThan(restored!.width - 100)
    const leftDragged = await toolbarSnapshot(page, kind)
    expect(leftDragged!.lastRight).toBeLessThanOrEqual(leftDragged!.rowRight + 1)
    expect(leftDragged!.overlaps).toBe(false)
    await page.mouse.up()
    expect(errors).toEqual([])
  })
}

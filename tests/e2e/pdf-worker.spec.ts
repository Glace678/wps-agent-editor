import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

function sourceUrl(relativePath: string): string {
  return `/@fs/${path.resolve(relativePath).replaceAll('\\', '/')}`
}

const MINIMAL_PDF_BASE64 = 'JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMQoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguMSk+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1s0IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDw+PgplbmRvYmoKCjQgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCAzMDAgNDAwXS9Sb3RhdGUgMC9SZXNvdXJjZXMgMyAwIFIvUGFyZW50IDIgMCBSPj4KZW5kb2JqCgp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNDIgMDAwMDAgbiAKMDAwMDAwMDEyMCAwMDAwMCBuIAowMDAwMDAwMTcyIDAwMDAwIG4gCjAwMDAwMDAxOTMgMDAwMDAgbiAKCnRyYWlsZXIKPDwvU2l6ZSA1L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMjg0CiUlRU9GCg=='

async function installPdfDesktopMock(page: Page): Promise<void> {
  await page.addInitScript((fixture) => {
    let callbackId = 0
    let currentPdf = Uint8Array.from(atob(fixture), (character) => character.charCodeAt(0))
    let modifiedAt = 1_788_825_600_000
    let readCount = 0
    let saveCount = 0

    const binaryBytes = (value: unknown): Uint8Array | null => {
      if (value instanceof Uint8Array) return value
      if (value instanceof ArrayBuffer) return new Uint8Array(value)
      if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      }
      if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
        return Uint8Array.from(value as number[])
      }
      return null
    }

    const invoke = async (command: string, args?: unknown): Promise<unknown> => {
      if (command === 'plugin:event|listen') return 1
      if (command === 'plugin:event|unlisten') return null
      if (command === 'files_get_home') return { path: '/mock/home', grantId: 'home-grant' }
      if (command === 'files_session_load') {
        return {
          mainDirectory: null,
          currentDirectory: null,
          recentDirectories: [],
          openFiles: [{ path: '/mock/editable.pdf', grantId: 'pdf-grant' }],
          activeFile: '/mock/editable.pdf',
        }
      }
      if (command === 'documents_read_file') {
        readCount += 1
        ;(window as unknown as { __WAE_PDF_READ_COUNT__: number }).__WAE_PDF_READ_COUNT__ = readCount
        return currentPdf
      }
      if (command === 'documents_save_binary') {
        const bytes = binaryBytes(args)
        if (!bytes) throw new Error('PDF save did not use the binary desktop channel')
        currentPdf = new Uint8Array(bytes.byteLength)
        currentPdf.set(bytes)
        modifiedAt += 1_000
        saveCount += 1
        const testWindow = window as unknown as {
          __WAE_PDF_SAVE_COUNT__: number
          __WAE_SAVED_PDF__: number[]
        }
        testWindow.__WAE_PDF_SAVE_COUNT__ = saveCount
        testWindow.__WAE_SAVED_PDF__ = Array.from(currentPdf)
        return null
      }
      if (command === 'files_stat') {
        return {
          exists: true,
          size: currentPdf.byteLength,
          modifiedAt,
          createdAt: 1_788_825_600_000,
          extension: 'pdf',
        }
      }
      if (command === 'files_list' || command === 'files_search' || command === 'files_get_recent') return []
      if (command === 'agents_list' || command === 'providers_list' || command === 'documents_list_fonts') return []
      if (command === 'providers_auth_status') return {}
      if (command === 'app_take_startup_files' || command === 'app_take_recovery_notices') return []
      if (command === 'files_session_save' || command === 'documents_set_current_file') return null
      return { success: true }
    }

    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke,
        transformCallback() {
          callbackId += 1
          return callbackId
        },
        unregisterCallback() {},
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __WAE_PDF_READ_COUNT__: 0,
      __WAE_PDF_SAVE_COUNT__: 0,
      __WAE_SAVED_PDF__: [],
    })
  }, MINIMAL_PDF_BASE64)
}

test('MuPDF worker edits, journals, saves, and reopens WAE annotations', async ({ page }) => {
  test.setTimeout(90_000)
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.addInitScript(() => {
    let callbackId = 0
    const invoke = async (command: string): Promise<unknown> => {
      if (command === 'plugin:event|listen') return 1
      if (command === 'plugin:event|unlisten') return null
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
      return null
    }
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke,
        transformCallback() {
          callbackId += 1
          return callbackId
        },
        unregisterCallback() {},
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    })
  })
  await page.goto('/')

  const result = await page.evaluate(async ({ clientUrl, coordinateUrl, fixture }) => {
    const withTimeout = <T,>(label: string, promise: Promise<T>): Promise<T> => Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error(`${label} timed out`)), 20_000)
      }),
    ])
    const { MuPdfWorkerClient } = await withTimeout(
      'client import',
      import(clientUrl) as Promise<typeof import('../../src/lightweight-office/pdf/mupdf-client')>,
    )
    const { pdfCanonicalToViewRect, pdfViewToCanonicalRect } = await withTimeout(
      'coordinate import',
      import(coordinateUrl) as Promise<typeof import('../../src/lightweight-office/pdf/pdf-coordinates')>,
    )
    const source = Uint8Array.from(atob(fixture), (character) => character.charCodeAt(0)).buffer
    const client = new MuPdfWorkerClient(`test-${crypto.randomUUID()}`)
    try {
      const opened = await withTimeout('open', client.open(source))
      const rendered = await withTimeout('render', client.render(0, 240, 0))
      const annotation = {
        id: crypto.randomUUID(),
        type: 'text' as const,
        pageIndex: 0,
        rect: { x: 0.1, y: 0.15, width: 0.45, height: 0.12 },
        text: 'Worker save round trip',
        font: {
          fontId: 'builtin:Helvetica',
          familyName: 'Helvetica',
          faceIndex: 0,
          weight: 400,
          style: 'normal' as const,
        },
        fontSize: 16,
        underline: true,
        color: '#0F6CBD',
      }
      const inserted = await withTimeout('insert', client.upsertText(annotation))
      const undone = await withTimeout('undo', client.undo())
      const redone = await withTimeout('redo', client.redo())
      const saved = await withTimeout('save', client.save())
      const savedBytes = new Uint8Array(saved.data)
      const savedHeader = new TextDecoder().decode(savedBytes.slice(0, 5))
      const reopenData = saved.data.slice(0)
      const pngBytes = new Uint8Array(rendered.png)

      const rotations = [0, 90, 180, 270] as const
      const coordinateErrors = rotations.map((rotation) => {
        const roundTrip = pdfViewToCanonicalRect(
          pdfCanonicalToViewRect(annotation.rect, rotation),
          rotation,
        )
        return Math.max(
          Math.abs(roundTrip.x - annotation.rect.x),
          Math.abs(roundTrip.y - annotation.rect.y),
          Math.abs(roundTrip.width - annotation.rect.width),
          Math.abs(roundTrip.height - annotation.rect.height),
        )
      })

      client.dispose()
      const reopenedClient = new MuPdfWorkerClient(`reopen-${crypto.randomUUID()}`)
      try {
        const reopened = await withTimeout('reopen', reopenedClient.open(reopenData))
        return {
          pageCount: opened.pages.length,
          canAnnotate: opened.canAnnotate,
          pngSignature: Array.from(pngBytes.slice(0, 8)),
          insertedCount: inserted.annotations.length,
          insertDirty: inserted.dirty,
          insertCanUndo: inserted.canUndo,
          undoCount: undone.annotations.length,
          undoCanRedo: undone.canRedo,
          redoCount: redone.annotations.length,
          savedHeader,
          reopenedText: reopened.annotations[0]?.type === 'text'
            ? reopened.annotations[0].text
            : null,
          reopenedDirty: reopened.dirty,
          coordinateErrors,
        }
      } finally {
        reopenedClient.dispose()
      }
    } finally {
      client.dispose()
    }
  }, {
    clientUrl: sourceUrl('src/lightweight-office/pdf/mupdf-client.ts'),
    coordinateUrl: sourceUrl('src/lightweight-office/pdf/pdf-coordinates.ts'),
    fixture: MINIMAL_PDF_BASE64,
  })

  expect(result).toMatchObject({
    pageCount: 1,
    canAnnotate: true,
    pngSignature: [137, 80, 78, 71, 13, 10, 26, 10],
    insertedCount: 1,
    insertDirty: true,
    insertCanUndo: true,
    undoCount: 0,
    undoCanRedo: true,
    redoCount: 1,
    savedHeader: '%PDF-',
    reopenedText: 'Worker save round trip',
    reopenedDirty: false,
  })
  expect(Math.max(...result.coordinateErrors)).toBeLessThan(1e-9)
  expect(pageErrors).toEqual([])
})

test('PDF editor portals its menus and persists edits through Ctrl+S', async ({ page }) => {
  test.setTimeout(90_000)
  await installPdfDesktopMock(page)
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.setViewportSize({ width: 1_000, height: 800 })
  await page.goto('/?session=pdf')

  const toolbar = page.getByTestId('pdf-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-page-num="1"] img')).toBeVisible({ timeout: 30_000 })

  const editMode = page.getByTestId('pdf-edit-mode')
  await expect(editMode).not.toHaveAttribute('aria-disabled', 'true')
  await editMode.click()
  await expect(editMode).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('pdf-tool-text').click()

  const editPage = page.locator('[data-edit-page="0"]')
  await editPage.click({ position: { x: 100, y: 100 } })
  const annotation = page.locator('[data-annot-id]').first()
  const annotationText = annotation.locator('.pdf-annot-text')
  await expect(annotation).toBeVisible({ timeout: 20_000 })

  const assertFixedPortal = async (testId: string) => {
    const popup = page.getByTestId(testId)
    await expect(popup).toBeVisible()
    const geometry = await popup.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        parentIsBody: element.parentElement === document.body,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }
    })
    expect(geometry.parentIsBody).toBe(true)
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.top).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth)
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight)
    return popup
  }

  await page.getByTestId('pdf-font-family').click()
  const fontMenu = await assertFixedPortal('pdf-font-family-menu')
  await fontMenu.getByRole('option', { name: 'Helvetica', exact: true }).click()

  await page.getByTestId('pdf-font-size').click()
  const sizeMenu = await assertFixedPortal('pdf-font-size-menu')
  await sizeMenu.getByRole('option', { name: '18', exact: true }).click()

  await page.getByTestId('pdf-font-color').click()
  const colorMenu = await assertFixedPortal('pdf-font-color-menu')
  await colorMenu.getByRole('option', { name: '#ff0000', exact: true }).click()

  await page.keyboard.press('Control+b')
  await page.keyboard.press('Control+i')
  await page.keyboard.press('Control+u')
  await expect(page.getByTestId('pdf-edit-bold')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('pdf-edit-italic')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('pdf-edit-underline')).toHaveAttribute('aria-pressed', 'true')
  const expectedFontSize = await editPage.evaluate((element) => (
    18 * element.getBoundingClientRect().width / 300
  ))
  await expect.poll(async () => Number.parseFloat(
    await annotationText.evaluate((element) => getComputedStyle(element).fontSize),
  )).toBeCloseTo(expectedFontSize, 1)
  await expect(annotationText).toHaveCSS('font-weight', '700')
  await expect(annotationText).toHaveCSS('font-style', 'italic')
  await expect(annotationText).toHaveCSS('text-decoration-line', 'underline')
  await expect(annotationText).toHaveCSS('color', 'rgb(255, 0, 0)')

  await page.keyboard.press('Control+z')
  await expect(annotationText).toHaveCSS('text-decoration-line', 'none')
  await expect(page.getByTestId('pdf-edit-underline')).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Control+y')
  await expect(annotationText).toHaveCSS('text-decoration-line', 'underline')
  await expect(page.getByTestId('pdf-edit-underline')).toHaveAttribute('aria-pressed', 'true')

  await annotation.dblclick()
  await expect(annotationText).toHaveAttribute('contenteditable', 'true')
  await annotationText.fill('Persisted PDF annotation')
  await annotationText.press('Tab')
  await expect(annotationText).toHaveText('Persisted PDF annotation')

  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as { __WAE_PDF_SAVE_COUNT__: number }).__WAE_PDF_SAVE_COUNT__
  ))).toBe(1)
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as { __WAE_PDF_READ_COUNT__: number }).__WAE_PDF_READ_COUNT__
  ))).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.pdf-annot-text')).toHaveText('Persisted PDF annotation')

  const saved = await page.evaluate(() => (
    (window as unknown as { __WAE_SAVED_PDF__: number[] }).__WAE_SAVED_PDF__
  ))
  expect(new TextDecoder().decode(Uint8Array.from(saved.slice(0, 5)))).toBe('%PDF-')
  expect(saved.length).toBeGreaterThan(500)
  expect(pageErrors).toEqual([])
})

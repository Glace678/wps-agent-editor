import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

function sourceUrl(relativePath: string): string {
  return `/@fs/${path.resolve(relativePath).replaceAll('\\', '/')}`
}

/** 构造一页带一行 Helvetica 正文的 PDF（MuPDF 可提取其结构化文字层）。 */
function buildTextPdfBase64(body: string, fontSize = 18, ruled = false): string {
  const rule = ruled ? `q 1 0 0 RG 0.5 w 35 ${340 - fontSize * 0.35} m 265 ${340 - fontSize * 0.35} l S Q\n` : ''
  const content = `BT /F1 ${fontSize} Tf 40 340 Td (${body.replace(/[()\\]/g, '\\$&')}) Tj ET\n${rule}`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((objectBody, index) => {
    offsets[index] = pdf.length
    pdf += `${index + 1} 0 obj\n${objectBody}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new TextEncoder().encode(pdf)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const MINIMAL_PDF_BASE64 = 'JVBERi0xLjcKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMQoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvSW5mbzw8L1Byb2R1Y2VyKE11UERGIDEuMjguMSk+Pj4+CmVuZG9iagoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1s0IDAgUl0+PgplbmRvYmoKCjMgMCBvYmoKPDw+PgplbmRvYmoKCjQgMCBvYmoKPDwvVHlwZS9QYWdlL01lZGlhQm94WzAgMCAzMDAgNDAwXS9Sb3RhdGUgMC9SZXNvdXJjZXMgMyAwIFIvUGFyZW50IDIgMCBSPj4KZW5kb2JqCgp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNDIgMDAwMDAgbiAKMDAwMDAwMDEyMCAwMDAwMCBuIAowMDAwMDAwMTcyIDAwMDAwIG4gCjAwMDAwMDAxOTMgMDAwMDAgbiAKCnRyYWlsZXIKPDwvU2l6ZSA1L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMjg0CiUlRU9GCg=='

async function installPdfDesktopMock(page: Page, fixture = MINIMAL_PDF_BASE64): Promise<void> {
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
  }, fixture)
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
      const layer = await withTimeout('text layer', client.loadTextLayer(0))
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
          textLayerPage: layer.pageIndex,
          textLayerLineCount: layer.lines.length,
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
    textLayerPage: 0,
    textLayerLineCount: 0,
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

  // 浏览模式：透明文字层接收指针，点击页面不会新建注释
  const textLayer = page.getByTestId('pdf-text-layer-0')
  await expect(textLayer).toBeAttached({ timeout: 20_000 })
  await expect(textLayer).toHaveCSS('pointer-events', 'auto')
  await page.locator('[data-page-num="1"]').click({ position: { x: 100, y: 100 } })
  await expect(page.locator('[data-annot-id]')).toHaveCount(0)

  const editMode = page.getByTestId('pdf-edit-mode')
  await expect(editMode).not.toHaveAttribute('aria-disabled', 'true')
  await editMode.click()
  await expect(editMode).toHaveAttribute('aria-pressed', 'true')
  // 编辑模式下文字层不再拦截指针
  await expect(textLayer).toHaveCSS('pointer-events', 'none')
  await page.getByTestId('pdf-tool-text').click()

  const editPage = page.locator('[data-edit-page="0"]')
  await editPage.click({ position: { x: 100, y: 100 } })
  const annotation = page.locator('[data-annot-id]').first()
  const annotationText = annotation.locator('.pdf-annot-text')
  await expect(annotation).toBeVisible({ timeout: 20_000 })

  // 选中文本工具后单击页面：新文本框立即进入可编辑状态，无需双击
  await expect(annotationText).toHaveAttribute('contenteditable', 'true')
  // 一字未输按 Esc：空框自动消失
  await annotationText.press('Escape')
  await expect(page.locator('[data-annot-id]')).toHaveCount(0)

  // 再建空框后先打开字体菜单改字体：空框必须保留（暂存，等决定性时机再清理）
  await editPage.click({ position: { x: 100, y: 100 } })
  await expect(annotationText).toHaveAttribute('contenteditable', 'true')
  await page.getByTestId('pdf-font-family').click()
  const familyMenu = page.getByTestId('pdf-font-family-menu')
  await expect(familyMenu).toBeVisible()
  await familyMenu.getByRole('option', { name: 'Helvetica', exact: true }).click()
  await expect(page.locator('[data-annot-id]')).toHaveCount(1)
  // 在另一处新建文本框：暂存的空框被清理，页面始终只有一个框，且新框立即进入编辑
  await editPage.click({ position: { x: 220, y: 220 } })
  await expect(page.locator('[data-annot-id]')).toHaveCount(1)
  await expect(annotationText).toHaveAttribute('contenteditable', 'true')
  await annotationText.fill('Persisted PDF annotation')
  await annotationText.press('Tab')
  await expect(annotationText).toHaveText('Persisted PDF annotation')
  // 有内容的框：T 工具下单击直接进入编辑，Esc 只退出编辑、不删除
  await annotation.click()
  await expect(annotationText).toHaveAttribute('contenteditable', 'true')
  await annotationText.press('Escape')
  await expect(annotation).toBeVisible()
  await expect(annotationText).toHaveText('Persisted PDF annotation')

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

test('MuPDF worker replaces body text via redaction and restores it through undo', async ({ page }) => {
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
        return { mainDirectory: null, currentDirectory: null, recentDirectories: [], openFiles: [], activeFile: null }
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

  const result = await page.evaluate(async ({ clientUrl, fixture }) => {
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
    const source = Uint8Array.from(atob(fixture), (character) => character.charCodeAt(0)).buffer
    const client = new MuPdfWorkerClient(`body-${crypto.randomUUID()}`)
    try {
      await withTimeout('open', client.open(source))
      const before = await withTimeout('text layer', client.loadTextLayer(0))
      const line = before.lines[0]
      const replacement = {
        id: crypto.randomUUID(),
        type: 'text' as const,
        pageIndex: 0,
        rect: { x: line.x, y: line.y, width: line.width, height: line.height },
        text: 'Hello Edited',
        font: {
          fontId: 'builtin:Helvetica',
          familyName: 'Helvetica',
          faceIndex: 0,
          weight: 400,
          style: 'normal' as const,
        },
        fontSize: line.fontSize ?? 12,
        underline: false,
        color: line.color ?? '#000000',
      }
      const replaced = await withTimeout(
        'replace body',
        client.replaceBodyText(0, line, replacement),
      )
      // worker 侧缓存仍持有旧层：在 UI 中替换后会显式 invalidate
      client.invalidateTextLayer(0)
      const after = await withTimeout('reload layer', client.loadTextLayer(0))
      const undone = await withTimeout('undo', client.undo())
      client.invalidateTextLayer(0)
      const restored = await withTimeout('restored layer', client.loadTextLayer(0))
      await withTimeout('redo', client.redo())
      client.invalidateTextLayer(0)
      const redone = await withTimeout('redone layer', client.loadTextLayer(0))
      const saved = await withTimeout('save', client.save())

      client.dispose()
      const reopenedClient = new MuPdfWorkerClient(`body-reopen-${crypto.randomUUID()}`)
      try {
        const reopened = await withTimeout('reopen', reopenedClient.open(saved.data.slice(0)))
        return {
          original: line.text,
          annotationCount: replaced.annotations.length,
          annotationText: replaced.annotations[0]?.type === 'text'
            ? replaced.annotations[0].text
            : null,
          bodyLineAfterReplace: after.lines.map((entry) => entry.text).join('|'),
          bodyLineAfterUndo: restored.lines.map((entry) => entry.text).join('|'),
          bodyLineAfterRedo: redone.lines.map((entry) => entry.text).join('|'),
          undoCount: undone.annotations.length,
          savedHeader: new TextDecoder().decode(new Uint8Array(saved.data.slice(0, 5))),
          reopenedAnnotation: reopened.annotations[0]?.type === 'text'
            ? reopened.annotations[0].text
            : null,
        }
      } finally {
        reopenedClient.dispose()
      }
    } finally {
      client.dispose()
    }
  }, {
    clientUrl: sourceUrl('src/lightweight-office/pdf/mupdf-client.ts'),
    fixture: buildTextPdfBase64('Hello Body Text'),
  })

  expect(result.original).toBe('Hello Body Text')
  expect(result.annotationCount).toBe(1)
  expect(result.annotationText).toBe('Hello Edited')
  // 原字已从正文文字层抹除（新文字是注释，不出现在正文层）
  expect(result.bodyLineAfterReplace).toBe('')
  expect(result.bodyLineAfterUndo).toBe('Hello Body Text')
  expect(result.bodyLineAfterRedo).toBe('')
  expect(result.undoCount).toBe(0)
  expect(result.savedHeader).toBe('%PDF-')
  expect(result.reopenedAnnotation).toBe('Hello Edited')
  expect(pageErrors).toEqual([])
})

test('MuPDF worker erases a body line when the replacement text is empty', async ({ page }) => {
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
        return { mainDirectory: null, currentDirectory: null, recentDirectories: [], openFiles: [], activeFile: null }
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

  const result = await page.evaluate(async ({ clientUrl, fixture }) => {
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
    const source = Uint8Array.from(atob(fixture), (character) => character.charCodeAt(0)).buffer
    const client = new MuPdfWorkerClient(`erase-${crypto.randomUUID()}`)
    try {
      await withTimeout('open', client.open(source))
      const line = (await withTimeout('text layer', client.loadTextLayer(0))).lines[0]
      const erased = await withTimeout(
        'erase',
        client.replaceBodyText(0, line, {
          id: crypto.randomUUID(),
          type: 'text',
          pageIndex: 0,
          rect: { x: line.x, y: line.y, width: line.width, height: line.height },
          text: '',
          font: {
            fontId: 'builtin:Helvetica',
            familyName: 'Helvetica',
            faceIndex: 0,
            weight: 400,
            style: 'normal',
          },
          fontSize: line.fontSize ?? 12,
          underline: false,
          color: line.color ?? '#000000',
        }),
      )
      client.invalidateTextLayer(0)
      const after = await withTimeout('reload layer', client.loadTextLayer(0))
      return {
        annotations: erased.annotations.length,
        canUndo: erased.canUndo,
        remaining: after.lines.map((entry) => entry.text).join('|'),
      }
    } finally {
      client.dispose()
    }
  }, {
    clientUrl: sourceUrl('src/lightweight-office/pdf/mupdf-client.ts'),
    fixture: buildTextPdfBase64('Erase Me Please'),
  })

  expect(result.annotations).toBe(0)
  expect(result.canUndo).toBe(true)
  expect(result.remaining).toBe('')
  expect(pageErrors).toEqual([])
})

test('PDF editor edits original body text in place and saves it', async ({ page }) => {
  test.setTimeout(90_000)
  await installPdfDesktopMock(page, buildTextPdfBase64('Hello Body Text'))
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.setViewportSize({ width: 1_000, height: 800 })
  await page.goto('/?session=pdf')

  await expect(page.locator('[data-page-num="1"] img')).toBeVisible({ timeout: 30_000 })
  const bodyLine = page.locator('[data-pdf-body-line]').first()
  // 浏览模式下没有原文热区
  await expect(bodyLine).toHaveCount(0)

  await page.getByTestId('pdf-edit-mode').click()
  await expect(bodyLine).toBeAttached({ timeout: 20_000 })
  const box = await bodyLine.boundingBox()
  expect(box).not.toBeNull()
  await bodyLine.click({ position: { x: (box!.width / 2), y: (box!.height / 2) } })

  const editor = page.locator('[data-annot-id] .pdf-annot-text').first()
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await expect(editor).toHaveText('Hello Body Text')
  await editor.fill('Hello Edited')
  await editor.press('Tab')

  // 提交后：正文热区消失（该行被涂除），新文字以注释形式存在
  await expect.poll(async () => page.locator('[data-pdf-body-line]').count()).toBe(0)
  await expect(editor).toHaveText('Hello Edited')

  // 撤销恢复原文
  await page.keyboard.press('Control+z')
  await expect.poll(async () => page.locator('[data-pdf-body-line]').count()).toBeGreaterThan(0)
  await page.keyboard.press('Control+y')
  await expect.poll(async () => page.locator('[data-pdf-body-line]').count()).toBe(0)

  await page.keyboard.press('Control+s')
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as { __WAE_PDF_SAVE_COUNT__: number }).__WAE_PDF_SAVE_COUNT__
  ))).toBe(1)
  const saved = await page.evaluate(() => (
    (window as unknown as { __WAE_SAVED_PDF__: number[] }).__WAE_SAVED_PDF__
  ))
  expect(new TextDecoder().decode(Uint8Array.from(saved.slice(0, 5)))).toBe('%PDF-')
  expect(pageErrors).toEqual([])
})

for (const fontSize of [9, 2.5]) {
  test(`body text keeps its ${fontSize}pt size and baseline inside a ruled editing box`, async ({ page }, testInfo) => {
    const fixture = buildTextPdfBase64('Hello Body Text', fontSize, true)
    await installPdfDesktopMock(page, fixture)
    await page.setViewportSize({ width: 1200, height: 900 })
    await page.goto('/?session=pdf')
    const pdfPage = page.locator('[data-page-num="1"]')
    await expect(pdfPage.locator('img').first()).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('pdf-edit-mode').click()
    const bodyLine = page.locator('[data-pdf-body-line]').first()
    await expect(bodyLine).toBeAttached()
    await bodyLine.click()
    const editor = page.locator('.pdf-annot-text').first()
    await expect(editor).toHaveAttribute('contenteditable', 'true')
    await expect(page.getByTestId('pdf-font-size')).toHaveText(String(fontSize))

    const assertLayout = async () => {
      const layout = await editor.evaluate((element) => {
        const style = getComputedStyle(element)
        const frame = element.closest('[data-annot-id]')!.getBoundingClientRect()
        const page = element.closest('[data-page-num]')!.getBoundingClientRect()
        const text = element.getBoundingClientRect()
        const context = document.createElement('canvas').getContext('2d')!
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const metrics = context.measureText('Mg')
        const baseline = text.top
          + (Number.parseFloat(style.lineHeight) - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2
          + metrics.fontBoundingBoxAscent
        const range = document.createRange()
        range.selectNodeContents(element)
        const glyphs = range.getBoundingClientRect()
        return {
          fontSize: Number.parseFloat(style.fontSize),
          scale: page.width / 300,
          baseline: (baseline - page.top) / (page.width / 300),
          belowBox: glyphs.bottom - frame.bottom,
          lineHeight: glyphs.height,
          boxHeight: frame.height,
          overflow: getComputedStyle(element.parentElement!).overflow,
          whiteSpace: style.whiteSpace,
        }
      })
      expect(layout.fontSize).toBeCloseTo(fontSize * layout.scale, 2)
      expect(layout.baseline).toBeCloseTo(60, 1)
      expect(layout.overflow).toBe('hidden')
      expect(layout.whiteSpace).toBe('pre')
      expect(layout.belowBox).toBeLessThanOrEqual(1)
      expect(layout.lineHeight).toBeLessThanOrEqual(layout.boxHeight + 1)
    }
    await editor.press('ArrowRight')
    await assertLayout()
    if (fontSize === 9) await pdfPage.screenshot({ path: testInfo.outputPath('editing-original.png') })

    // A longer replacement must not wrap onto the rule or grow the font.
    const replacementText = 'Hello Edited Text '.repeat(4).trimEnd()
    await editor.fill(replacementText)
    await assertLayout()
    await editor.press('Tab')
    await expect.poll(() => page.locator('[data-pdf-body-line]').count()).toBe(0)
    await assertLayout()
    for (let step = 0; step < 6; step++) await page.getByTestId('pdf-zoom-out').click()
    await assertLayout()
    if (fontSize === 2.5) {
      expect(await editor.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeLessThan(4)
    }
    await page.getByTestId('pdf-zoom-reset').click()
    await assertLayout()
    // Resizing the box must repaint at the same point size and baseline.
    const handle = page.locator('[data-annot-id] [data-corner="e"]').first()
    const handleBox = (await handle.boundingBox())!
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 40, handleBox.y + handleBox.height / 2, { steps: 3 })
    await page.mouse.up()
    await assertLayout()
    await page.keyboard.press('Control+s')
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __WAE_PDF_SAVE_COUNT__: number }
    ).__WAE_PDF_SAVE_COUNT__)).toBe(1)
    await expect.poll(() => page.evaluate(() => (
      window as unknown as { __WAE_PDF_READ_COUNT__: number }
    ).__WAE_PDF_READ_COUNT__)).toBeGreaterThanOrEqual(2)
    await expect(editor).toBeVisible()
    await assertLayout()
    if (fontSize === 9) await pdfPage.screenshot({ path: testInfo.outputPath('saved-replacement.png') })

    // Inspect the actual saved PDF, including annotation appearances, outside
    // our HTML overlay. The strip below the text must remain pixel-identical.
    const savedLayout = await page.evaluate(async ({ moduleUrl, fixture }) => {
      const { default: mupdf } = await import(moduleUrl) as typeof import('mupdf')
      const original = new mupdf.PDFDocument(Uint8Array.from(atob(fixture), (c) => c.charCodeAt(0)))
      const saved = new mupdf.PDFDocument(Uint8Array.from((
        window as unknown as { __WAE_SAVED_PDF__: number[] }
      ).__WAE_SAVED_PDF__))
      const before = original.loadPage(0)
      const after = saved.loadPage(0)
      const annotations = after.getAnnotations()
      const annotation = annotations[0]
      const scale = 4
      const beforePixmap = before.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
      const afterPixmap = after.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
      const list = annotation.toDisplayList()
      const text = list.toStructuredText({})
      const fonts = new Set<InstanceType<typeof mupdf.Font>>()
      let firstBaseline: number | undefined
      let renderedFontSize: number | undefined
      try {
        text.walk({ onChar(_character, origin, font, size) {
          firstBaseline ??= origin[1]
          renderedFontSize ??= size
          fonts.add(font)
        } })
        const rect = annotation.getRect()
        const pixelsBefore = beforePixmap.getPixels()
        const pixelsAfter = afterPixmap.getPixels()
        let changedBelowBox = 0
        let redRulePixels = 0
        for (let y = Math.ceil(rect[3] * scale); y < Math.ceil((rect[3] + 6) * scale); y++) {
          for (let x = 20 * scale; x < 280 * scale; x++) {
            const offset = y * beforePixmap.getStride() + x * 3
            if (pixelsBefore[offset] > 200 && pixelsBefore[offset + 1] < 150) redRulePixels++
            if ([0, 1, 2].some((channel) => pixelsBefore[offset + channel] !== pixelsAfter[offset + channel])) {
              changedBelowBox++
            }
          }
        }
        return { firstBaseline, renderedFontSize, changedBelowBox, redRulePixels, contents: annotation.getContents() }
      } finally {
        for (const font of fonts) font.destroy()
        text.destroy()
        list.destroy()
        beforePixmap.destroy()
        afterPixmap.destroy()
        for (const item of annotations) item.destroy()
        before.destroy()
        after.destroy()
        original.destroy()
        saved.destroy()
      }
    }, { moduleUrl: sourceUrl('node_modules/mupdf/dist/mupdf.js'), fixture })
    expect(savedLayout.renderedFontSize).toBeCloseTo(fontSize, 3)
    expect(savedLayout.firstBaseline).toBeCloseTo(60, 2)
    expect(savedLayout.contents).toBe(replacementText)
    expect(savedLayout.redRulePixels).toBeGreaterThan(0)
    expect(savedLayout.changedBelowBox).toBe(0)
  })
}

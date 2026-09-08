import { expect, test, type Page } from '@playwright/test'
import { createMinimalPagedDocx } from './support/minimal-docx'

/**
 * Word 无感缩放端到端验证：
 * - Ctrl+滚轮 跨 60% 双页阈值缩放，期间页面 DOM 不得被整批重建（整批重绘=闪烁根源）；
 * - book（双页）排版从第 1 页起两页一排（无「封面单页」闪现）；
 * - 双页↔单页切换时克隆覆盖层在位（[data-word-mode-swap-cover]），
 *   且切换后滚动锚点页保持在视口顶部附近。
 *
 * 注意：Playwright 的 page.mouse.wheel 在按住 Control 时会被无头 Chromium
 * 当作浏览器自身缩放吞掉（页面收不到任何 wheel 事件），因此这里直接在页面
 * 内派发合成 WheelEvent（ctrlKey:true）——应用的非被动 wheel 监听器照常接收。
 */

const docxBytesPromise = createMinimalPagedDocx()

async function installDesktopMock(page: Page): Promise<void> {
  const docxBytes = await docxBytesPromise
  await page.addInitScript((bytes) => {
    const callbacks = new Map<number, (payload: unknown) => void>()
    let callbackId = 0
    // 桌面桥二进制通道使用 WAE1 信封（magic + uint32LE 元数据长度 + JSON + 负载）
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
      if (command === 'files_list' || command === 'files_search') return []
      if (command === 'files_get_recent') return []
      if (command === 'files_session_load') {
        return {
          mainDirectory: null,
          currentDirectory: null,
          recentDirectories: [],
          openFiles: [{ path: '/mock/sample.docx', grantId: 'word-grant' }],
          activeFile: '/mock/sample.docx',
        }
      }
      if (command === 'files_session_save') return null
      if (command === 'agents_list') return []
      if (command === 'providers_list') return []
      if (command === 'providers_auth_status') return {}
      if (command === 'documents_list_fonts') return []
      if (command === 'app_take_startup_files') return []
      if (command === 'documents_prepare_word') {
        return encodeWae1(
          {
            convertedFromLegacy: false,
            converter: null,
            nativeConversionFailed: false,
            normalizedLegacyImageCount: 0,
            normalizedTableCount: 0,
            removedUnderlineRunCount: 0,
          },
          Uint8Array.from(bytes),
        )
      }
      if (command === 'documents_read_file') return Uint8Array.from(bytes)
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
    })
  }, Array.from(docxBytes))
}

interface SamplerSummary {
  frames: Array<{
    t: number
    mode: string | null
    pages: number
    spreads: number
    cover: number
  }>
  pageMutations: Array<{
    t: number
    removedPages: number
    addedPages: number
    removedSpreads: number
    addedSpreads: number
  }>
  marks: Record<string, number>
  anchor: {
    beforeZoomIn: { topPage: number; scrollTop: number } | null
    afterZoomIn: { topPage: number; scrollTop: number } | null
  }
}

async function installSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: SamplerSummary['frames'] = []
    const pageMutations: SamplerSummary['pageMutations'] = []
    const marks: Record<string, number> = {}
    const t0 = performance.now()

    const countNode = (list: NodeListOf<Element> | Node[], selector: string) => {
      let n = 0
      list.forEach((node) => {
        if (node instanceof Element && node.matches(selector)) n += 1
      })
      return n
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const removed = Array.from(record.removedNodes)
        const added = Array.from(record.addedNodes)
        const countSide = (nodes: Node[], directSel: string, deepSel: string) => {
          let direct = 0
          let deep = 0
          for (const n of nodes) {
            if (!(n instanceof Element)) continue
            if (n.matches(directSel)) direct += 1
            deep += n.querySelectorAll(deepSel).length
          }
          return direct + deep
        }
        const removedPages = countSide(removed, '.superdoc-page', '.superdoc-page')
        const addedPages = countSide(added, '.superdoc-page', '.superdoc-page')
        const removedSpreads = countSide(removed, '.superdoc-spread', '.superdoc-spread')
        const addedSpreads = countSide(added, '.superdoc-spread', '.superdoc-spread')
        if (removedPages || addedPages || removedSpreads || addedSpreads) {
          pageMutations.push({
            t: performance.now() - t0,
            removedPages,
            addedPages,
            removedSpreads,
            addedSpreads,
          })
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    const sample = () => {
      const layout = document.querySelector('.word-document-layout')
      const pages = document.querySelectorAll(
        '.presentation-editor__pages .superdoc-page[data-page-index]',
      ).length
      frames.push({
        t: performance.now() - t0,
        mode: layout?.getAttribute('data-word-layout-mode') ?? null,
        pages,
        spreads: document.querySelectorAll('.superdoc-spread').length,
        cover: document.querySelectorAll('[data-word-mode-swap-cover]').length,
      })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

    const topState = () => {
      const viewport = document.querySelector('.presentation-editor__viewport')
      const vpRect = viewport?.getBoundingClientRect()
      if (!viewport || !vpRect) return null
      const pages = Array.from(
        document.querySelectorAll<HTMLElement>('.superdoc-page[data-page-index]'),
      )
      for (const p of pages) {
        const rect = p.getBoundingClientRect()
        if (rect.bottom <= vpRect.top + 8) continue
        if (rect.top >= vpRect.bottom) break
        return {
          topPage: Number.parseInt(p.dataset.pageIndex ?? '0', 10),
          scrollTop: Math.round(viewport.scrollTop),
        }
      }
      return null
    }

    Object.assign(window, {
      __wordZoomProbe: {
        frames,
        pageMutations,
        marks,
        mark(name: string) {
          marks[name] = performance.now() - t0
        },
        markAnchor(name: 'beforeZoomIn' | 'afterZoomIn') {
          this.anchor[name] = topState()
        },
        anchor: {
          beforeZoomIn: null as null | { topPage: number; scrollTop: number },
          afterZoomIn: null as null | { topPage: number; scrollTop: number },
        },
      },
    })
  })
}

async function getProbeSummary(page: Page): Promise<SamplerSummary> {
  return page.evaluate(
    () => (window as unknown as { __wordZoomProbe: SamplerSummary }).__wordZoomProbe,
  )
}

/**
 * 在页面内派发合成 Ctrl+滚轮事件。Playwright 的 mouse.wheel 在 Ctrl 按下时
 * 被无头 Chromium 吞掉（不进页面），合成 WheelEvent 可直达应用的真实监听器。
 */
async function ctrlWheel(
  page: Page,
  deltaY: number,
  notches: number,
  gapMs = 120,
): Promise<void> {
  await page.evaluate(
    async ({ deltaY, notches, gapMs }) => {
      const target = document.querySelector('.presentation-editor__viewport') as HTMLElement | null
      if (!target) throw new Error('viewport not found for wheel dispatch')
      for (let i = 0; i < notches; i += 1) {
        target.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY,
            deltaMode: 0,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        )
        await new Promise((r) => setTimeout(r, gapMs))
      }
    },
    { deltaY, notches, gapMs },
  )
}

/**
 * 滚到滚动容器最底部，量最后一页视觉底边与容器底边的距离。
 * 回归「页面下方存在大片可滚动空白」：未缩放内容高度沿 overflow:visible
 * 链传播到滚动容器时，这个值会高达数千像素；正常应为个位数。
 */
async function measureBlankBelowLastPage(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sc = document.querySelector('.super-editor-container.contained') as HTMLElement | null
    const host = document.querySelector('.presentation-editor__pages') as HTMLElement | null
    if (!sc || !host) return Number.NaN
    const previousScrollTop = sc.scrollTop
    sc.scrollTop = sc.scrollHeight
    return new Promise<number>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const pages = Array.from(
            host.querySelectorAll<HTMLElement>('.superdoc-page[data-page-index]'),
          ).sort(
            (a, b) =>
              Number.parseInt(a.dataset.pageIndex ?? '0', 10) -
              Number.parseInt(b.dataset.pageIndex ?? '0', 10),
          )
          const last = pages[pages.length - 1]
          const blank = last
            ? Math.round(
                sc.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom,
              )
            : Number.NaN
          // 恢复原滚动位置，避免干扰后续锚点断言
          sc.scrollTop = previousScrollTop
          resolve(blank)
        })
      })
    })
  })
}

async function mark(page: Page, name: string): Promise<void> {
  await page.evaluate(
    (n) =>
      (window as unknown as { __wordZoomProbe: { mark: (n: string) => void } }).__wordZoomProbe.mark(n),
    name,
  )
}

/** 把时间戳相近（<300ms 间隔）的页面增删突变合并为「事件段」 */
function episodes(muts: SamplerSummary['pageMutations']) {
  const sorted = [...muts].sort((a, b) => a.t - b.t)
  const out: Array<{
    t0: number
    t1: number
    removedPages: number
    addedPages: number
    removedSpreads: number
    addedSpreads: number
  }> = []
  for (const m of sorted) {
    const last = out[out.length - 1]
    if (last && m.t - last.t1 < 300) {
      last.t1 = m.t
      last.removedPages += m.removedPages
      last.addedPages += m.addedPages
      last.removedSpreads += m.removedSpreads
      last.addedSpreads += m.addedSpreads
    } else {
      out.push({
        t0: m.t,
        t1: m.t,
        removedPages: m.removedPages,
        addedPages: m.addedPages,
        removedSpreads: m.removedSpreads,
        addedSpreads: m.addedSpreads,
      })
    }
  }
  return out
}

test.beforeEach(async ({ page }) => {
  await installDesktopMock(page)
})

test.setTimeout(150_000)

test('Word zoom across the two-page threshold is seamless (no page rebuild, paired spreads, cover + anchor)', async ({
  page,
}) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('/?session=word', { waitUntil: 'domcontentloaded' })

  // 等待 Word 画布与至少两页挂载
  await expect
    .poll(
      async () =>
        page.locator('.presentation-editor__pages .superdoc-page[data-page-index]').count(),
      { timeout: 45_000 },
    )
    .toBeGreaterThanOrEqual(2)

  // 等首屏排版/虚拟窗稳定，避免把初始挂载突变算进缩放窗口
  await page.waitForTimeout(1500)
  await installSampler(page)

  // —— 缩小：从 100% 一路越过双页阈值 ——
  await mark(page, 'zoomStart')
  await ctrlWheel(page, 120, 8)
  await page.waitForTimeout(1800)

  // 双页排版：spread 存在且从第 1 页起两页一排
  const spreadCount = await page.locator('.superdoc-spread').count()
  expect(spreadCount, 'book mode should render spreads').toBeGreaterThanOrEqual(1)
  await expect(page.locator('.word-document-layout')).toHaveAttribute(
    'data-word-layout-mode',
    'book',
  )
  const firstSpreadPages = await page
    .locator('.presentation-editor__pages > .superdoc-spread')
    .first()
    .locator('.superdoc-page')
    .evaluateAll((els) =>
      els.slice(0, 2).map((el) => (el as HTMLElement).dataset.pageIndex),
    )
  expect(firstSpreadPages, 'first spread must pair page 0 and page 1 (Word style)').toEqual([
    '0',
    '1',
  ])

  // 双页模式下滚到底：最后一页视觉底边应贴近容器底边，
  // 不得存在数千 px 的「空白页区域」（旧几何的负 margin 补偿失效）
  const bookBlank = await measureBlankBelowLastPage(page)
  expect(
    bookBlank,
    `book mode must not leave blank scroll area below the last page (blank=${bookBlank}px)`,
  ).toBeLessThan(60)
  expect(bookBlank, 'blank measurement must be finite').toBeGreaterThan(-60)

  await page.evaluate(() =>
    (
      window as unknown as {
        __wordZoomProbe: { markAnchor: (n: 'beforeZoomIn') => void }
      }
    ).__wordZoomProbe.markAnchor('beforeZoomIn'),
  )

  // —— 放大：越过阈值回到单页 ——
  await ctrlWheel(page, -120, 8)
  await page.waitForTimeout(1800)
  await mark(page, 'zoomEnd')

  await expect(page.locator('.word-document-layout')).toHaveAttribute(
    'data-word-layout-mode',
    'vertical',
  )
  expect(await page.locator('.superdoc-spread').count()).toBe(0)

  // 单页模式下小幅缩小（不触双页阈值）：旧几何在 zoom<1 时同样会
  // 把未缩放高度沿 overflow 链泄漏成可滚动空白，这里一并回归。
  await ctrlWheel(page, 120, 3)
  await page.waitForTimeout(1200)
  await expect(
    page.locator('.word-document-layout'),
    'zoom-out leg must stay in single-page mode',
  ).toHaveAttribute('data-word-layout-mode', 'vertical')
  const verticalBlank = await measureBlankBelowLastPage(page)
  expect(
    verticalBlank,
    `vertical zoom-out must not leave blank scroll area below the last page (blank=${verticalBlank}px)`,
  ).toBeLessThan(60)
  expect(verticalBlank, 'blank measurement must be finite').toBeGreaterThan(-60)

  await page.evaluate(() =>
    (
      window as unknown as {
        __wordZoomProbe: { markAnchor: (n: 'afterZoomIn') => void }
      }
    ).__wordZoomProbe.markAnchor('afterZoomIn'),
  )

  const summary = await getProbeSummary(page)
  const tStart = summary.marks.zoomStart ?? 0
  const tEnd = summary.marks.zoomEnd ?? Number.POSITIVE_INFINITY

  // 用户可见白帧检测：真实页面数为 0 的瞬间，必须有克隆覆盖层挡在上面
  const visibleZeroFrames = summary.frames.filter(
    (f) => f.pages === 0 && f.cover === 0,
  )
  expect(
    visibleZeroFrames.length,
    'pages must never visibly vanish mid-zoom (no whiteout frames without cover)',
  ).toBe(0)

  // 页面增删突变段：缩放窗口内只允许「双页切换」两次（vertical→book、book→vertical）。
  // 判定标准：整批重建 = 一次移除 ≥5 页或移除任何 spread；虚拟滚动单页装卸
  // （视口外 1~2 页）不算重建，用户不可见。
  const rebuildEpisodes = episodes(summary.pageMutations)
    .filter((e) => e.t1 >= tStart - 200 && e.t0 <= tEnd + 200)
    .filter((e) => e.removedPages >= 5 || e.removedSpreads > 0)
  expect(
    rebuildEpisodes.length,
    `expected exactly 2 page-rebuild episodes (mode switches), got ${JSON.stringify(rebuildEpisodes)}`,
  ).toBe(2)

  // 覆盖层：两次切换期间都应有克隆覆盖帧，且结束时已撤收
  const coverFrames = summary.frames.filter((f) => f.cover > 0)
  expect(
    coverFrames.length,
    'mode-swap clone cover must be visible during switches',
  ).toBeGreaterThan(3)
  const lastCover = Math.max(...coverFrames.map((f) => f.t))
  const lastFrame = summary.frames[summary.frames.length - 1]
  expect(
    lastFrame.t - lastCover,
    'cover must be removed after the final switch',
  ).toBeGreaterThan(300)

  // 滚动锚点：放大回单页后，视口顶部页与双页时锚定页一致（±3 页容差）
  const before = summary.anchor.beforeZoomIn
  const after = summary.anchor.afterZoomIn
  expect(before && after, 'anchor samples must exist').toBeTruthy()
  expect(
    Math.abs((after?.topPage ?? 0) - (before?.topPage ?? 0)),
    `anchor page drifted: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  ).toBeLessThanOrEqual(3)

  expect(pageErrors, `page errors: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([])
})

import { expect, test, type Page } from '@playwright/test'
import { createMinimalPagedDocx } from './support/minimal-docx'
import { selfValidateMockPayloads, validateMockResponses } from './support/mock-payloads'
import { assertPerfBudgets, perfBudget } from './support/perf'
import { e2eTestTimeout } from './support/timeouts'

/**
 * Word 无感缩放端到端验证：
 * - Ctrl+滚轮 跨 60% 双页阈值缩放，期间页面 DOM 不得被整批重建（整批重绘=闪烁根源）；
 * - book（双页）排版从第 1 页起两页一排（无「封面单页」闪现）；
 * - 双页↔单页切换时克隆覆盖层在位（[data-word-mode-swap-cover]），
 *   且切换后滚动锚点页保持在视口顶部附近。
 *
 * 注意：Playwright 的 page.mouse.wheel 在按住 Control 时，部分平台/浏览器
 * 会当作浏览器自身缩放吞掉（页面收不到任何 wheel 事件），因此主用例直接在
 * 页面内派发合成 WheelEvent（ctrlKey:true）——应用的非被动 wheel 监听器照常
 * 接收。C4 另外提供一个真实 isTrusted 输入冒烟用例：在支持的平台上用
 * keyboard.down('Control') + mouse.wheel 验证真实输入链路；若浏览器吞掉事件
 * 则运行时 skip，而不是误判失败。
 */

const docxBytesPromise = createMinimalPagedDocx()

async function installDesktopMock(page: Page): Promise<void> {
  const docxBytes = await docxBytesPromise
  await page.addInitScript((bytes) => {
    const callbacks = new Map<number, (payload: unknown) => void>()
    let callbackId = 0
    // D1: un-whitelisted commands are recorded for the afterEach assertion.
    const unknownCommands: string[] = []
    // D2: record every mock response for runtime contract validation.
    const mockResponses: Array<{ command: string; result: unknown }> = []
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
    const handleInvoke = async (command: string): Promise<unknown> => {
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
      if (command === 'app_take_startup_files'
        || command === 'app_take_recovery_notices') return []
      if (command === 'files_stat') {
        return {
          exists: true,
          size: bytes.length,
          modifiedAt: 1_788_825_600_000,
          createdAt: 1_788_825_600_000,
          extension: 'docx',
        }
      }
      if (command === 'app_i18n_set_language'
        || command === 'app_theme_set'
        || command === 'app_startup_healthy'
        || command === 'documents_set_current_file') {
        return { success: true }
      }
      if (command === 'agents_conversations_list') return []
      if (command === 'agents_conversations_import_codex') {
        return {
          discovered: 0, imported: 0, updated: 0, skipped: 0,
          failed: 0, messages: 0, failures: [],
        }
      }
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
      unknownCommands.push(command)
      return { success: true }
    }
    const invoke = async (command: string): Promise<unknown> => {
      const result = await handleInvoke(command)
      mockResponses.push({ command, result })
      return result
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
      __WAE_UNKNOWN_COMMANDS__: unknownCommands,
      __WAE_MOCK_RESPONSES__: mockResponses,
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
    // MutationObserver delivery batch this record belongs to (C2): records in
    // the same batch are one deterministic mutation event.
    batch: number
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

    let batchId = 0
    const observer = new MutationObserver((records) => {
      // C2: sum every record delivered in this callback into ONE mutation
      // entry tagged with the delivery batch. Batch identity, rather than a
      // wall-clock window, is the primary evidence for "one rebuild event".
      batchId += 1
      const batch = {
        t: performance.now() - t0,
        batch: batchId,
        removedPages: 0,
        addedPages: 0,
        removedSpreads: 0,
        addedSpreads: 0,
      }
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
        batch.removedPages += countSide(removed, '.superdoc-page', '.superdoc-page')
        batch.addedPages += countSide(added, '.superdoc-page', '.superdoc-page')
        batch.removedSpreads += countSide(removed, '.superdoc-spread', '.superdoc-spread')
        batch.addedSpreads += countSide(added, '.superdoc-spread', '.superdoc-spread')
      }
      if (
        batch.removedPages
        || batch.addedPages
        || batch.removedSpreads
        || batch.addedSpreads
      ) {
        pageMutations.push(batch)
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
      // The real scroller (.super-editor-container.contained) has a bounded
      // height; .presentation-editor__viewport does not clip, so measuring
      // against it always reports page 0. Use the scroller's rect + scrollTop.
      const sc = document.querySelector('.super-editor-container.contained')
      const scRect = sc?.getBoundingClientRect()
      if (!sc || !scRect) return null
      const pages = Array.from(
        document.querySelectorAll<HTMLElement>('.superdoc-page[data-page-index]'),
      )
      for (const p of pages) {
        const rect = p.getBoundingClientRect()
        if (rect.bottom <= scRect.top + 8) continue
        if (rect.top >= scRect.bottom) break
        return {
          topPage: Number.parseInt(p.dataset.pageIndex ?? '0', 10),
          scrollTop: Math.round(sc.scrollTop),
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

/**
 * C3: deterministic "initial layout settled" signal — five consecutive
 * animation frames with an identical page set and page heights — replacing
 * the fixed 1500ms gamble before installing the sampler. Bounded fallback
 * keeps the test from hanging if the signature never stabilizes.
 */
async function waitForInitialLayoutSettled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const host = document.querySelector('.presentation-editor__pages')
    if (!host) {
      resolve()
      return
    }
    let lastSignature = ''
    let stableFrames = 0
    const sample = () => {
      const pages = host.querySelectorAll<HTMLElement>('.superdoc-page[data-page-index]')
      const signature = Array.from(
        pages,
        (p) => p.dataset.pageIndex + ':' + Math.round(p.getBoundingClientRect().height),
      ).join('|')
      if (signature && signature === lastSignature) stableFrames += 1
      else {
        stableFrames = 0
        lastSignature = signature
      }
      if (stableFrames >= 5) resolve()
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    setTimeout(resolve, 30_000)
  }))
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
    batch: number
    removedPages: number
    addedPages: number
    removedSpreads: number
    addedSpreads: number
  }> = []
  for (const m of sorted) {
    const last = out[out.length - 1]
    // Same observer batch always merges; the 300ms window only reconciles
    // batches split across deliveries (C2).
    if (last && (last.batch === m.batch || m.t - last.t1 < 300)) {
      last.t1 = m.t
      last.removedPages += m.removedPages
      last.addedPages += m.addedPages
      last.removedSpreads += m.removedSpreads
      last.addedSpreads += m.addedSpreads
    } else {
      out.push({
        t0: m.t,
        t1: m.t,
        batch: m.batch,
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

// D1: no test may leave the app calling commands this mock never whitelisted.
// D2: mock responses are validated at runtime against the generated contract.
test.afterEach(async ({ page }) => {
  selfValidateMockPayloads()
  const [unknown, responses] = await page.evaluate(() => [
    (window as unknown as { __WAE_UNKNOWN_COMMANDS__?: string[] }).__WAE_UNKNOWN_COMMANDS__ ?? [],
    (window as unknown as {
      __WAE_MOCK_RESPONSES__?: Array<{ command: string; result: unknown }>
    }).__WAE_MOCK_RESPONSES__ ?? [],
  ])
  expect(unknown, `unmocked invoke commands: ${unknown.join(', ')}`).toEqual([])
  const contractErrors = validateMockResponses(responses)
  expect(contractErrors, `mock payload contract violations:\n${contractErrors.join('\n')}`).toEqual([])
})

test.setTimeout(e2eTestTimeout(150_000))

test('Word zoom across the two-page threshold is seamless (no page rebuild, paired spreads, cover + anchor)', {
  // D3: heavy path; zoom legs carry explicit perf budgets.
  annotation: { type: 'perf-path', description: 'multi-leg zoom across layout threshold' },
  tag: '@perf',
}, async ({
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

  // 等首屏排版/虚拟窗稳定（确定性信号），避免把初始挂载突变算进缩放窗口
  await waitForInitialLayoutSettled(page)
  await installSampler(page)

  // —— 缩小：从 100% 一路越过双页阈值 ——
  await mark(page, 'zoomStart')
  // D3: measured against an explicit budget instead of a blind timeout.
  await perfBudget(test.info(), 'zoom-out across book threshold', 6_000, async () => {
    await ctrlWheel(page, 120, 8)

    // C2: 不用固定 sleep，轮询到双页 spread 真正出现
    await expect.poll(() => page.locator('.superdoc-spread').count(), {
      timeout: 30_000,
      message: 'book mode spreads never appeared after zoom-out',
    }).toBeGreaterThanOrEqual(1)
  })

  // 双页排版：spread 存在且从第 1 页起两页一排
  const spreadCount = await page.locator('.superdoc-spread').count()
  expect(spreadCount, 'book mode should render spreads').toBeGreaterThanOrEqual(1)
  await expect(page.locator('.word-document-layout')).toHaveAttribute(
    'data-word-layout-mode',
    'book',
  )
  // book mode disables virtualization, so every spread/page renders. Iterate ALL
  // spreads: each must pair exactly two consecutive pages, the union must cover
  // pages 0..7 with no gaps and no duplicates.
  const spreads = await page
    .locator('.presentation-editor__pages > .superdoc-spread')
    .evaluateAll((els) =>
      els.map((spread) =>
        Array.from(spread.querySelectorAll('.superdoc-page')).map(
          (p) => Number.parseInt((p as HTMLElement).dataset.pageIndex ?? '-1', 10),
        ),
      ),
    )
  expect(
    spreads.length,
    `8 pages in book mode should render 4 spreads, got ${JSON.stringify(spreads)}`,
  ).toBe(4)
  for (let i = 0; i < spreads.length; i += 1) {
    expect(
      spreads[i],
      `spread ${i} must pair pages ${i * 2} and ${i * 2 + 1}, got ${JSON.stringify(spreads[i])}`,
    ).toEqual([i * 2, i * 2 + 1])
  }
  const allPageIndices = spreads.flat()
  expect(allPageIndices, 'page indices must be contiguous 0..7 with no duplicates').toEqual([
    0, 1, 2, 3, 4, 5, 6, 7,
  ])

  // 双页模式下滚到底：最后一页视觉底边应贴近容器底边，
  // 不得存在数千 px 的「空白页区域」（旧几何的负 margin 补偿失效）
  const bookBlank = await measureBlankBelowLastPage(page)
  expect(
    bookBlank,
    `book mode must not leave blank scroll area below the last page (blank=${bookBlank}px)`,
  ).toBeLessThan(60)
  expect(bookBlank, 'blank measurement must be finite').toBeGreaterThan(-60)

  // Scroll to a deep, non-zero page before anchoring: otherwise the anchor test
  // trivially compares page 0 (top) to page 0. We need to prove a real scroll
  // position is preserved across the book→vertical mode switch. The real
  // scroller is .super-editor-container.contained (same one measureBlank uses).
  await page.evaluate(() => {
    const sc = document.querySelector('.super-editor-container.contained') as HTMLElement | null
    if (sc) sc.scrollTop = sc.scrollHeight
  })
  // C2: 轮询确认真的滚到了底（剩余不可滚动高度 ≤1px），再等两个 rAF
  // 让虚拟窗完成底部页面挂载，代替固定 900ms。
  await expect.poll(
    () =>
      page.evaluate(() => {
        const sc = document.querySelector('.super-editor-container.contained') as HTMLElement | null
        if (!sc) return -1
        return sc.scrollHeight - sc.scrollTop - sc.clientHeight
      }),
    { timeout: 10_000 },
  ).toBeLessThanOrEqual(1)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )

  await page.evaluate(() =>
    (
      window as unknown as {
        __wordZoomProbe: { markAnchor: (n: 'beforeZoomIn') => void }
      }
    ).__wordZoomProbe.markAnchor('beforeZoomIn'),
  )

  // —— 放大：越过阈值回到单页 ——
  await perfBudget(test.info(), 'zoom-in back to vertical', 6_000, async () => {
    await ctrlWheel(page, -120, 8)
    // C2: 轮询到 spread 全部拆除（单页模式确定生效），代替固定 1800ms。
    await expect.poll(() => page.locator('.superdoc-spread').count(), {
      timeout: 30_000,
      message: 'book mode spreads never tore down after zoom-in',
    }).toBe(0)
  })
  await mark(page, 'zoomEnd')

  await expect(page.locator('.word-document-layout')).toHaveAttribute(
    'data-word-layout-mode',
    'vertical',
  )
  expect(await page.locator('.superdoc-spread').count()).toBe(0)

  // 单页模式下小幅缩小（不触双页阈值）：旧几何在 zoom<1 时同样会
  // 把未缩放高度沿 overflow 链泄漏成可滚动空白，这里一并回归。
  await ctrlWheel(page, 120, 3)
  await expect(
    page.locator('.word-document-layout'),
    'zoom-out leg must stay in single-page mode',
  ).toHaveAttribute('data-word-layout-mode', 'vertical', { timeout: 15_000 })
  // C2: 重排完成的确定性信号是底部空白测量稳定，轮询代替固定 1200ms。
  await expect
    .poll(() => measureBlankBelowLastPage(page), {
      timeout: 15_000,
      message: 'vertical zoom-out leg: blank scroll area below the last page never settled',
    })
    .toBeLessThan(60)

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

  // 覆盖层：每次模式切换（两次 rebuild 事件）期间都必须有克隆覆盖帧，
  // 且结束时已撤收。不能只看"全程出现过若干帧"——要逐次切换各自覆盖。
  for (const [i, ep] of rebuildEpisodes.entries()) {
    const coversInWindow = summary.frames.filter(
      (f) => f.t >= ep.t0 - 200 && f.t <= ep.t1 + 500 && f.cover > 0,
    )
    expect(
      coversInWindow.length,
      `mode switch #${i + 1} at t=[${Math.round(ep.t0)},${Math.round(ep.t1)}] must show a clone cover`,
    ).toBeGreaterThan(0)
  }
  const coverFrames = summary.frames.filter((f) => f.cover > 0)
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
  // We actually scrolled down in book mode (non-zero scroll position), and the
  // book→vertical switch must NOT snap the scroll back to the very top.
  expect(
    before?.scrollTop ?? -1,
    `anchor must be measured at a non-zero scroll position, got ${JSON.stringify(before)}`,
  ).toBeGreaterThan(0)
  expect(
    after?.scrollTop ?? -1,
    `mode switch must preserve the scroll position (not snap to top), got ${JSON.stringify(after)}`,
  ).toBeGreaterThan(0)
  expect(
    Math.abs((after?.topPage ?? 0) - (before?.topPage ?? 0)),
    `anchor page drifted: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  ).toBeLessThanOrEqual(3)

  expect(pageErrors, `page errors: ${pageErrors.map((e) => e.message).join('; ')}`).toEqual([])

  // D3: report slow legs as performance regressions, not timeout flakes.
  assertPerfBudgets(test.info())
})

interface NativeWheelRecord {
  trusted: boolean
  ctrl: boolean
  deltaY: number
}

// C4: 真实 isTrusted 输入冒烟。合成事件只能覆盖应用逻辑，覆盖不了浏览器/OS
// 的输入派发；这里在按住 Control 时发真实 mouse.wheel，仅在「平台支持」（页面
// 真能收到事件）时断言缩放发生，否则运行时跳过。
test('native ctrl-wheel reaches the Word app on supporting platforms', async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.addInitScript(() => {
    const received: NativeWheelRecord[] = []
    ;(window as unknown as { __nativeWheelLog: NativeWheelRecord[] }).__nativeWheelLog = received
    window.addEventListener(
      'wheel',
      (event) => {
        received.push({ trusted: event.isTrusted, ctrl: event.ctrlKey, deltaY: event.deltaY })
      },
      true,
    )
  })
  await page.goto('/?session=word', { waitUntil: 'domcontentloaded' })

  await expect
    .poll(
      () =>
        page.locator('.presentation-editor__pages .superdoc-page[data-page-index]').count(),
      { timeout: 45_000 },
    )
    .toBeGreaterThanOrEqual(2)
  await waitForInitialLayoutSettled(page)

  const zoomTrigger = page.getByTestId('word-zoom-trigger')
  const readPercent = async () => {
    const text = (await zoomTrigger.textContent()) ?? ''
    return Number(/\d+/.exec(text)?.[0] ?? Number.NaN)
  }
  const beforePercent = await readPercent()
  expect(Number.isFinite(beforePercent)).toBeTruthy()

  await page.locator('.presentation-editor__viewport').hover()
  await page.keyboard.down('Control')
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, 120)
    // 输入节奏间隔（非等待条件成立），模拟真实滚格速度
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  await page.keyboard.up('Control')

  const received = await page.evaluate(
    () => (window as unknown as { __nativeWheelLog: NativeWheelRecord[] }).__nativeWheelLog,
  )
  const nativeCtrlWheels = received.filter((event) => event.trusted && event.ctrl)
  // 浏览器把 ctrl-wheel 截去做自身缩放：该平台不支持真实链路，跳过。
  test.skip(
    nativeCtrlWheels.length === 0,
    `${browserName} swallows ctrl-wheel as browser zoom on this platform`,
  )

  await expect
    .poll(readPercent, {
      timeout: 15_000,
      message: 'native ctrl-wheel reached the page but the Word zoom percentage never changed',
    })
    .not.toBe(beforePercent)
})

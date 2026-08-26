/**
 * Word 工具栏溢出策略：窄容器时保留左侧 UI，右端项优先收进「⋯」。
 *
 * SuperDoc 1.44 自带的溢出算法有两张硬编码降级清单：容器 < 768px 时强制把
 * zoom / fontFamily / fontSize / redo 收进溢出菜单，< 1430px 时收
 * linkedStyles / clearFormatting / copyFormat / ruler / formattingMarks——
 * 结果是「字体字号先消失、右端按钮反而常驻」，与期望相反，且配置无法改变。
 *
 * 这里在实例层包装 onToolbarResize，并订阅 toolbar-items-changed。首次安装或
 * 字体集合变化时取得完整 item 集；普通容器 resize 只按实测 DOM 宽度重新分区，
 * 不重复创建控件。可见项始终是视觉顺序的最大前缀，其余连续后缀进入「⋯」。
 * 分区完成后显式通知 Vue 重绘，因此左右侧栏拖动时能逐帧更新。
 */

interface ToolbarItemLike {
  name?: { value?: string }
  group?: { value?: string }
  type?: string
}

export interface SuperToolbarLike {
  toolbarItems?: ToolbarItemLike[]
  overflowItems?: ToolbarItemLike[]
  toolbarContainer?: HTMLElement | null
  getAvailableWidth?: () => number
  onToolbarResize?: () => void
  on?: (event: string, handler: () => void) => void
  off?: (event: string, handler: () => void) => void
  emit?: (event: string) => void
}

/**
 * 视觉顺序（= SuperDoc 1.44 makeDefaultItems 的固定顺序，经运行时实测确认）。
 * 后缀裁剪以此为准：越靠后越先进「⋯」。documentMode（右端的编辑/查看模式）
 * 也参与收纳——用户语义里它属于「右边的 UI」。
 */
const VISUAL_ORDER = [
  'undo',
  'redo',
  'acceptTrackedChangeBySelection',
  'rejectTrackedChangeOnSelection',
  'zoom',
  'fontFamily',
  'fontSize',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'highlight',
  'link',
  'image',
  'table',
  'tableActions',
  'textAlign',
  'list',
  'numberedlist',
  'indentleft',
  'indentright',
  'lineHeight',
  'linkedStyles',
  'ruler',
  'formattingMarks',
  'copyFormat',
  'clearFormatting',
  'documentMode',
] as const

/** 首次出现前的兜底值；出现后会被当前主题下的 DOM 实测宽度替代。 */
const FALLBACK_ITEM_WIDTHS: Record<string, number> = {
  zoom: 75,
  fontFamily: 116,
  // Keep the first pass aligned with the compact Word CSS before the browser
  // can measure the rendered item.
  fontSize: 50,
  textAlign: 38,
  list: 41,
  numberedlist: 41,
  linkedStyles: 144,
  documentMode: 81,
}
const DEFAULT_ITEM_WIDTH = 34
const DEFAULT_ROW_HORIZONTAL_PADDING = 16
/** 34px 三点按钮 + 3px 与最后一个可见按钮的间距。 */
const DEFAULT_OVERFLOW_SLOT_WIDTH = 37
const WIDTH_EPSILON = 0.75

const itemName = (item: ToolbarItemLike): string => item.name?.value ?? ''

function sameItems(a: ToolbarItemLike[] | undefined, b: ToolbarItemLike[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((item, index) => item === b[index])
}

function numericStyle(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 安装策略，返回卸载函数。SuperDoc 实例销毁时监听与补丁随之消亡，
 * 卸载函数主要用于编辑器切换文件时的对称清理。
 */
export function installWordToolbarOverflowPolicy(toolbar: SuperToolbarLike | null | undefined): () => void {
  if (!toolbar || typeof toolbar.onToolbarResize !== 'function') return () => {}

  const original = toolbar.onToolbarResize
  const measuredItemWidths = new Map<string, number>()
  let rowHorizontalPadding = DEFAULT_ROW_HORIZONTAL_PADDING
  let overflowSlotWidth = DEFAULT_OVERFLOW_SLOT_WIDTH
  let orderedItems: ToolbarItemLike[] = []
  let overflowControl: ToolbarItemLike | null = null
  let emittingChange = false
  let rebuilding = false

  const toolbarRow = (): HTMLElement | null => {
    const container = toolbar.toolbarContainer
    if (!container) return null
    if (container.matches('.superdoc-toolbar')) return container
    return container.querySelector<HTMLElement>('.superdoc-toolbar')
  }

  const measureRenderedToolbar = () => {
    const row = toolbarRow()
    if (!row) return

    const rowStyle = getComputedStyle(row)
    const measuredPadding = numericStyle(rowStyle.paddingLeft) + numericStyle(rowStyle.paddingRight)
    if (measuredPadding > 0) rowHorizontalPadding = measuredPadding

    const center = row.querySelector<HTMLElement>(":scope > [data-toolbar-position='center']")
    const measuredOverflowSlot = center ? numericStyle(getComputedStyle(center).paddingRight) : 0
    if (measuredOverflowSlot > 0) overflowSlotWidth = measuredOverflowSlot

    for (const wrapper of row.querySelectorAll<HTMLElement>('.sd-toolbar-item-ctn')) {
      const marker = wrapper.querySelector<HTMLElement>("[data-item^='btn-']")
      const markerName = marker?.dataset.item
      const width = wrapper.getBoundingClientRect().width
      if (markerName?.startsWith('btn-') && width > 0) {
        measuredItemWidths.set(markerName.slice(4), width)
      }
    }
  }

  const rebuildCompleteItemSet = () => {
    // SuperDoc 在窄宽下会按硬编码清单丢项目。仅在首次安装或项目集合变化时，
    // 临时提供无限宽来取得完整集合；侧栏拖动只重分区，不反复重建控件。
    const realGetAvailableWidth = toolbar.getAvailableWidth
    toolbar.getAvailableWidth = () => 100000
    try {
      original.call(toolbar)
    } finally {
      if (realGetAvailableWidth) toolbar.getAvailableWidth = realGetAvailableWidth
      else delete toolbar.getAvailableWidth
    }

    const all = [...(toolbar.toolbarItems ?? []), ...(toolbar.overflowItems ?? [])]
    const byName = new Map<string, ToolbarItemLike>()
    const extras: ToolbarItemLike[] = []
    overflowControl = null
    for (const item of all) {
      const name = itemName(item)
      if (item.type === 'overflow' || name === 'overflow') {
        overflowControl = item
        continue
      }
      if ((VISUAL_ORDER as readonly string[]).includes(name)) byName.set(name, item)
      else extras.push(item)
    }

    orderedItems = VISUAL_ORDER.flatMap((name) => {
      const item = byName.get(name)
      return item ? [item] : []
    }).concat(extras)

    // groups 只过滤名称，不重设 SuperDoc 的内置 group。documentMode 默认在
    // right 组，会被 CSS 插到 zoom 前；归入 center 后 DOM 才与菜单顺序一致。
    const documentMode = byName.get('documentMode')
    if (documentMode?.group) documentMode.group.value = 'center'
  }

  const repartition = (force = false): boolean => {
    const available = toolbar.getAvailableWidth?.() ?? 0
    if (!available || orderedItems.length === 0) return false

    const widths = orderedItems.map((item) => (
      measuredItemWidths.get(itemName(item))
      ?? FALLBACK_ITEM_WIDTHS[itemName(item)]
      ?? DEFAULT_ITEM_WIDTH
    ))
    const totalWidth = widths.reduce((sum, width) => sum + width, 0)
    const fullBudget = Math.max(0, available - rowHorizontalPadding)
    const needsOverflow = totalWidth > fullBudget + WIDTH_EPSILON
    const budget = Math.max(0, fullBudget - (needsOverflow ? overflowSlotWidth : 0))

    let used = 0
    let cut = orderedItems.length
    for (let i = 0; i < orderedItems.length; i++) {
      if (used + widths[i] > budget + WIDTH_EPSILON) {
        cut = i
        break
      }
      used += widths[i]
    }
    if (cut < 1) cut = 1

    const visible = orderedItems.slice(0, cut)
    const overflowed = orderedItems.slice(cut)
    if (overflowControl) visible.push(overflowControl)

    if (
      !force
      && sameItems(toolbar.toolbarItems, visible)
      && sameItems(toolbar.overflowItems, overflowed)
    ) {
      return false
    }

    toolbar.toolbarItems = visible
    toolbar.overflowItems = overflowed
    return true
  }

  const notifyVueToolbar = () => {
    if (!toolbar.emit) return
    emittingChange = true
    try {
      toolbar.emit('toolbar-items-changed')
    } finally {
      emittingChange = false
    }
  }

  const patched = () => {
    // Item widths stay stable while a sidebar is dragged. Cached values avoid
    // forcing layout reads for every pixel of movement.
    const panelResizing = toolbar.toolbarContainer?.closest('[data-panel-resizing="true"]')
    if (!panelResizing) measureRenderedToolbar()
    if (orderedItems.length === 0) rebuildCompleteItemSet()
    if (repartition()) notifyVueToolbar()
  }

  // 换编辑器或字体变化会绕过 onToolbarResize 重建 items；此时刷新完整集合。
  const reapply = () => {
    if (emittingChange || rebuilding) return
    rebuilding = true
    try {
      measureRenderedToolbar()
      rebuildCompleteItemSet()
      repartition(true)
      notifyVueToolbar()
    } finally {
      rebuilding = false
    }
  }
  toolbar.onToolbarResize = patched
  toolbar.on?.('toolbar-items-changed', reapply)
  reapply()

  return () => {
    if (toolbar.onToolbarResize === patched) toolbar.onToolbarResize = original
    toolbar.off?.('toolbar-items-changed', reapply)
  }
}

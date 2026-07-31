/**
 * Word 工具栏溢出策略：窄容器时保留左侧 UI，右端项优先收进「⋯」。
 *
 * SuperDoc 1.44 自带的溢出算法有两张硬编码降级清单：容器 < 768px 时强制把
 * zoom / fontFamily / fontSize / redo 收进溢出菜单，< 1430px 时收
 * linkedStyles / clearFormatting / copyFormat / ruler / formattingMarks——
 * 结果是「字体字号先消失、右端按钮反而常驻」，与期望相反，且配置无法改变。
 *
 * 这里在实例层重排：包装公开的 onToolbarResize 实例属性（组件的窗口 resize、
 * 容器 ResizeObserver、应用手动 notify 全部走它），并订阅 toolbar-items-changed
 *（换编辑器/字体变化后的重建）。每次 SuperDoc 重算后，把全部 items 按视觉
 * 顺序做「后缀裁剪」重新分区：从右端向左收，宽度装不下的连续尾段进溢出，
 * 左侧永远最后消失。Vue 组件在 onToolbarResize 之后才 bump key 重渲染，
 * 同步改写 toolbarItems / overflowItems 一定会被下一帧渲染采用。
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
  fontSize: 63,
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

  const repartition = () => {
    try {
      const available = toolbar.getAvailableWidth?.() ?? 0
      const currentVisible = toolbar.toolbarItems ?? []
      const currentOverflow = toolbar.overflowItems ?? []
      if (!available || currentVisible.length + currentOverflow.length === 0) return

      const all = [...currentVisible, ...currentOverflow]
      const byName = new Map<string, ToolbarItemLike>()
      const extras: ToolbarItemLike[] = []
      let overflowControl: ToolbarItemLike | null = null
      for (const item of all) {
        const name = itemName(item)
        if (item.type === 'overflow' || name === 'overflow') {
          overflowControl = item
          continue
        }
        if ((VISUAL_ORDER as readonly string[]).includes(name)) byName.set(name, item)
        else extras.push(item)
      }
      // 未知项（未来 SuperDoc 新增/自定义按钮）排在已知序列之后，最先被收纳
      const ordered = VISUAL_ORDER.flatMap((name) => {
        const item = byName.get(name)
        return item ? [item] : []
      }).concat(extras)

      const budget = available - RESERVED_WIDTH
      let acc = 0
      let cut = ordered.length
      for (let i = 0; i < ordered.length; i++) {
        const width = ITEM_WIDTHS[itemName(ordered[i])] ?? DEFAULT_ITEM_WIDTH
        if (acc + width > budget) {
          cut = i
          break
        }
        acc += width
      }
      // 至少保留 undo，避免极端窄时工具栏只剩「⋯」都放不下的抖动
      if (cut < 1 && ordered.length > 0) cut = 1

      const visible = ordered.slice(0, cut)
      const overflowed = ordered.slice(cut)
      // 「⋯」控件常驻可见（溢出为空时 SuperDoc 自行隐藏该按钮）
      if (overflowControl) visible.push(overflowControl)

      if (sameNames(visible, toolbar.toolbarItems) && sameNames(overflowed, toolbar.overflowItems)) return
      toolbar.toolbarItems = visible
      toolbar.overflowItems = overflowed
    } catch (err) {
      console.warn('[word-toolbar-overflow] 重分区失败，保留 SuperDoc 默认分配:', err)
    }
  }

  const original = toolbar.onToolbarResize
  const patched = () => {
    // SuperDoc 内部重算期间让它看到「无限宽」：其硬编码降级清单与贪心
    // 全部不触发，保证生成完整 item 集（真实窄宽下它还有一个坏 splice：
    // < 1024px 分隔符已被过滤时，linkedStyles 进溢出会误删紧随其后的
    // ruler，令其从两个数组中蒸发）。真实宽度的取舍完全由 repartition 做；
    // finally 恢复原方法，组件随后的紧凑样式计算仍读真实宽度。
    const realGetAvailableWidth = toolbar.getAvailableWidth
    toolbar.getAvailableWidth = () => 100000
    try {
      original.call(toolbar)
    } finally {
      if (realGetAvailableWidth) toolbar.getAvailableWidth = realGetAvailableWidth
      else delete toolbar.getAvailableWidth
    }
    repartition()
  }
  // 换编辑器/字体变化会绕过 onToolbarResize 直接重建 items（同样带降级清单），
  // 收到事件后走一遍完整重算 + 重分区；#makeToolbarItems 不会再发该事件，无循环
  let applying = false
  const reapply = () => {
    if (applying) return
    applying = true
    try {
      patched()
    } finally {
      applying = false
    }
  }
  toolbar.onToolbarResize = patched
  toolbar.on?.('toolbar-items-changed', reapply)
  patched()

  return () => {
    if (toolbar.onToolbarResize === patched) toolbar.onToolbarResize = original
    toolbar.off?.('toolbar-items-changed', reapply)
  }
}

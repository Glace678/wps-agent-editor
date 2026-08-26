import type { SystemFontFace } from './utils/system-fonts'
import { getOrderedFontFamilyEntries } from './utils/system-fonts'
import type { LanguageCode } from '../lib/i18n'
import { getWordToolbarTexts } from './word-toolbar-i18n'

/**
 * SuperDoc 完整工具栏配置。
 *
 * hideButtons + responsiveToContainer：容器变窄时把装不下的按钮收进「⋯」溢出菜单
 *（与 Excel 的 fortune-toolbar-more 类似）。
 *
 * IMPORTANT: SuperDoc 在传入自定义 `groups` 时，会用各组 name 的并集过滤
 * `toolbarItems` / `overflowItems`。内置的 `overflow`（三点按钮）必须显式列入
 * 某一组，否则溢出项会被计算出来却没有入口，表现为按钮直接消失。
 */
export const FULL_WORD_TOOLBAR_GROUPS = {
  left: [
    'undo',
    'redo',
    'search',
    'documentMode',
  ],
  center: [
    // 文本格式
    'bold',
    'italic',
    'underline',
    'strike',
    'clearFormatting',
    'copyFormat',
    // 字体
    'fontFamily',
    'fontSize',
    'color',
    'highlight',
    // 段落
    'linkedStyles',
    'textAlign',
    'list',
    'numberedlist',
    'indentleft',
    'indentright',
    'lineHeight',
    // 插入
    'link',
    'image',
    'table',
    'tableActions',
    // SuperDoc overflow (⋯) control — required when using custom groups
    'overflow',
  ],
  right: [
    'ruler',
    'formattingMarks',
    'zoom',
    'acceptTrackedChangeBySelection',
    'rejectTrackedChangeOnSelection',
  ],
} as const

/**
 * Excel 工具栏「更多」同款横向三点（SuperDoc 内置 overflow 图标是竖向 ⋮）。
 * 与 SuperDoc 内置图标一致：不带 fill，由工具栏文字颜色着色。
 */
const HORIZONTAL_OVERFLOW_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M8 256a56 56 0 1 1 112 0A56 56 0 1 1 8 256zm160 0a56 56 0 1 1 112 0 56 56 0 1 1-112 0zm160 0a56 56 0 1 1 112 0 56 56 0 1 1-112 0z"/></svg>'

export function createFullWordEditorModules(
  fontFaces: SystemFontFace[],
  language: LanguageCode,
) {
  // Shared menu order: Chinese families first (pinyin), then Western A→Z.
  const fonts = getOrderedFontFamilyEntries(fontFaces).map(({ familyName, displayName }) => ({
    // SuperDoc applies `label` to the document. Localized display names (宋体 /
    // 黑体…) are valid CSS font-family names on Windows and standard in DOCX,
    // so the menu shows what Excel shows while `key`/preview stay canonical.
    label: displayName || familyName,
    key: familyName,
    props: { style: { fontFamily: familyName } },
  }))

  return {
    toolbar: {
      // 装不下的按钮进入 overflowItems，由「⋯」菜单展示（非永久丢弃）
      hideButtons: true,
      // 按工具栏容器宽度重算可见/溢出项（侧栏收起/窗口缩放时更新三点菜单）
      responsiveToContainer: true,
      // 溢出按钮换成 Excel「更多」同款横向 ⋯
      icons: { overflow: HORIZONTAL_OVERFLOW_ICON_SVG },
      showFormattingMarksButton: true,
      toolbarGroups: ['left', 'center', 'right'],
      groups: {
        left: [...FULL_WORD_TOOLBAR_GROUPS.left],
        center: [...FULL_WORD_TOOLBAR_GROUPS.center],
        right: [...FULL_WORD_TOOLBAR_GROUPS.right],
      },
      texts: getWordToolbarTexts(language),
      fonts,
    },
    // 启用内置查找/替换浮层（工具栏 search 会用到）
    surfaces: {
      findReplace: true,
    },
    trackChanges: {
      enabled: true,
      visible: true,
      mode: 'review' as const,
    },
  }
}

import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { languages } from '../src/lib/i18n'
import {
  WORD_TOOLBAR_DISABLED_TEXTS,
  WORD_TOOLBAR_TEXTS,
  getWordToolbarTexts,
  installWordToolbarTooltipLocalization,
} from '../src/lightweight-office/word-toolbar-i18n'
import { createFullWordEditorModules } from '../src/lightweight-office/word-toolbar'
import {
  getOrderedFontFamilyEntries,
  isChineseFontFamily,
  isSymbolFontFamily,
  type SystemFontFace,
} from '../src/lightweight-office/utils/system-fonts'

const expectedKeys = Object.keys(WORD_TOOLBAR_TEXTS.en).sort()

for (const { code } of languages) {
  const texts = getWordToolbarTexts(code)
  assert.deepEqual(Object.keys(texts).sort(), expectedKeys, `${code} toolbar keys differ from English`)
  for (const [key, value] of Object.entries(texts)) {
    assert.ok(value.trim(), `${code}.${key} is empty`)
  }
  assert.ok(WORD_TOOLBAR_DISABLED_TEXTS[code].trim(), `${code} disabled marker is empty`)
}

const chineseModules = createFullWordEditorModules([], 'zh-CN')
assert.equal(chineseModules.toolbar.texts.undo, '撤销')
assert.equal(chineseModules.toolbar.texts.bold, '加粗')
assert.equal(chineseModules.toolbar.texts.formattingMarks, '显示或隐藏格式标记')
assert.equal(chineseModules.toolbar.texts.addRowBefore, '在上方插入行')
assert.equal(chineseModules.toolbar.texts.addRowAfter, '在下方插入行')
assert.equal(chineseModules.toolbar.texts.addColumnBefore, '在左侧插入列')
assert.equal(chineseModules.toolbar.texts.addColumnAfter, '在右侧插入列')
assert.equal(chineseModules.toolbar.texts.deleteRow, '删除行')
assert.equal(chineseModules.toolbar.texts.deleteColumn, '删除列')
assert.equal(chineseModules.toolbar.texts.deleteTable, '删除表格')
assert.equal(chineseModules.toolbar.texts.removeBorders, '清除边框')
assert.equal(chineseModules.toolbar.texts.mergeCells, '合并单元格')
assert.equal(chineseModules.toolbar.texts.splitCell, '拆分单元格')
assert.equal(chineseModules.toolbar.texts.fixTables, '修复表格')
assert.equal(WORD_TOOLBAR_DISABLED_TEXTS['zh-CN'], '不可用')

const japaneseModules = createFullWordEditorModules([], 'ja')
assert.equal(japaneseModules.toolbar.texts.undo, '元に戻す')
assert.equal(japaneseModules.toolbar.texts.bold, '太字')
assert.equal(japaneseModules.toolbar.texts.addRowBefore, '上に行を挿入')
assert.equal(japaneseModules.toolbar.texts.deleteTable, '表の削除')
assert.equal(japaneseModules.toolbar.texts.mergeCells, 'セルの結合')

const englishModules = createFullWordEditorModules([], 'en')
assert.equal(englishModules.toolbar.texts.undo, 'Undo')
assert.equal(englishModules.toolbar.texts.addRowBefore, 'Insert row above')
assert.equal(englishModules.toolbar.texts.deleteTable, 'Delete table')
assert.notEqual(chineseModules.toolbar.texts.undo, englishModules.toolbar.texts.undo)

const fontFace = (familyName: string, displayName = familyName): SystemFontFace => ({
  familyName,
  displayName,
  faceName: 'Regular',
  weight: 400,
  style: 'normal',
  stretch: 5,
})
const mixedFontFaces = [
  fontFace('Times New Roman'),
  fontFace('SimSun-ExtG'),
  fontFace('SimSun', '宋体'),
  fontFace('FangSong', '仿宋'),
  fontFace('Arial'),
  fontFace('Wingdings'),
]
const orderedFonts = getOrderedFontFamilyEntries(mixedFontFaces)
const firstWesternIndex = orderedFonts.findIndex(
  ({ familyName, displayName }) => !isChineseFontFamily(familyName, displayName),
)
assert.ok(firstWesternIndex > 0, 'Chinese fonts should precede Western fonts')
assert.ok(
  orderedFonts.slice(0, firstWesternIndex).every(
    ({ familyName, displayName }) => isChineseFontFamily(familyName, displayName),
  ),
  'the leading font section should contain only Chinese families',
)
assert.deepEqual(
  orderedFonts.slice(firstWesternIndex).map(({ familyName }) => familyName),
  ['Arial', 'Times New Roman', 'Wingdings'],
)
assert.equal(orderedFonts.find(({ familyName }) => familyName === 'SimSun')?.displayName, '宋体')
assert.equal(isChineseFontFamily('SimSun-ExtG'), true)
assert.equal(isSymbolFontFamily('Wingdings'), true)
assert.equal(isSymbolFontFamily('Times New Roman'), false)

const localizedFontModules = createFullWordEditorModules(mixedFontFaces, 'zh-CN')
const simSunOption = localizedFontModules.toolbar.fonts.find(({ key }) => key === 'SimSun')
assert.equal(simSunOption?.label, '宋体')
assert.equal(simSunOption?.props.style.fontFamily, 'SimSun')

async function testDisabledTooltipLocalization(): Promise<void> {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  Object.assign(globalThis, {
    document: dom.window.document,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    NodeFilter: dom.window.NodeFilter,
  })

  const uninstallChineseLocalization = installWordToolbarTooltipLocalization('zh-CN')
  const chineseTooltip = document.createElement('div')
  chineseTooltip.className = 'sd-tooltip-content'
  chineseTooltip.innerHTML = '<div>撤销 <span>(disabled)</span></div>'
  document.body.append(chineseTooltip)

  const chineseContextMenu = document.createElement('div')
  chineseContextMenu.className = 'context-menu'
  chineseContextMenu.innerHTML = `
    <div class="context-menu-search-header-label">Searching:</div>
    <div class="context-menu-item">Insert row above</div>
    <div class="context-menu-item">Merge cells</div>
    <div class="context-menu-item">Cut</div>
  `
  document.body.append(chineseContextMenu)

  const chineseLinkPopover = document.createElement('div')
  chineseLinkPopover.className = 'link-input-ctn'
  chineseLinkPopover.innerHTML = `
    <div class="link-title">Add link</div>
    <div class="link-input-wrapper">
      <div class="input-row text-input-row">
        <input type="text" name="text" placeholder="Text" />
      </div>
      <div class="input-row url-input-row">
        <input type="text" name="link" placeholder="Type or paste a link" />
      </div>
      <div class="input-row link-buttons">
        <button class="remove-btn"><div class="remove-btn__icon"></div> Remove </button>
        <button class="sd-submit-btn"> Apply </button>
      </div>
    </div>
  `
  document.body.append(chineseLinkPopover)

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(chineseTooltip.querySelector('span')?.textContent, '(不可用)')
  assert.equal(chineseContextMenu.querySelector('.context-menu-search-header-label')?.textContent, '搜索:')
  assert.equal(chineseContextMenu.querySelectorAll('.context-menu-item')[0]?.textContent?.trim(), '在上方插入行')
  assert.equal(chineseContextMenu.querySelectorAll('.context-menu-item')[1]?.textContent?.trim(), '合并单元格')
  assert.equal(chineseContextMenu.querySelectorAll('.context-menu-item')[2]?.textContent?.trim(), '剪切')
  assert.equal(chineseLinkPopover.querySelector('.link-title')?.textContent?.trim(), '添加链接')
  assert.equal(chineseLinkPopover.querySelector<HTMLInputElement>('input[name="text"]')?.placeholder, '显示文本')
  assert.equal(chineseLinkPopover.querySelector<HTMLInputElement>('input[name="link"]')?.placeholder, '键入或粘贴链接')
  assert.equal(chineseLinkPopover.querySelector('.sd-submit-btn')?.textContent?.trim(), '应用')
  assert.equal(chineseLinkPopover.querySelector('.remove-btn')?.textContent?.trim(), '移除')
  uninstallChineseLocalization()

  const uninstallJapaneseLocalization = installWordToolbarTooltipLocalization('ja')
  const japaneseTooltip = document.createElement('div')
  japaneseTooltip.className = 'sd-tooltip-content'
  japaneseTooltip.innerHTML = '<div>元に戻す <span>(不可用)</span></div>'
  document.body.append(japaneseTooltip)

  const japaneseContextMenu = document.createElement('div')
  japaneseContextMenu.className = 'context-menu'
  japaneseContextMenu.innerHTML = `
    <div class="context-menu-search-header-label">Searching:</div>
    <div class="context-menu-item">Insert row above</div>
    <div class="context-menu-item">Merge cells</div>
  `
  document.body.append(japaneseContextMenu)

  const japaneseLinkPopover = document.createElement('div')
  japaneseLinkPopover.className = 'link-input-ctn'
  japaneseLinkPopover.innerHTML = `
    <div class="link-title">Edit link</div>
    <div class="link-input-wrapper">
      <div class="input-row text-input-row">
        <input type="text" name="text" placeholder="Text" />
      </div>
      <div class="input-row url-input-row">
        <input type="text" name="link" placeholder="Type or paste a link" />
      </div>
      <div class="input-row link-buttons">
        <button class="sd-submit-btn"> Apply </button>
      </div>
    </div>
  `
  document.body.append(japaneseLinkPopover)

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(japaneseTooltip.querySelector('span')?.textContent, '(無効)')
  assert.equal(japaneseContextMenu.querySelector('.context-menu-search-header-label')?.textContent, '検索:')
  assert.equal(japaneseContextMenu.querySelectorAll('.context-menu-item')[0]?.textContent?.trim(), '上に行を挿入')
  assert.equal(japaneseContextMenu.querySelectorAll('.context-menu-item')[1]?.textContent?.trim(), 'セルの結合')
  assert.equal(japaneseLinkPopover.querySelector('.link-title')?.textContent?.trim(), 'リンクを編集')
  assert.equal(japaneseLinkPopover.querySelector<HTMLInputElement>('input[name="text"]')?.placeholder, '表示テキスト')
  assert.equal(japaneseLinkPopover.querySelector<HTMLInputElement>('input[name="link"]')?.placeholder, 'リンクを入力または貼り付け')
  assert.equal(japaneseLinkPopover.querySelector('.sd-submit-btn')?.textContent?.trim(), '適用')
  uninstallJapaneseLocalization()
}

void testDisabledTooltipLocalization()
  .then(() => {
    console.log(`PASS Word toolbar tooltips cover ${languages.length} languages and ${expectedKeys.length} text keys`)
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })

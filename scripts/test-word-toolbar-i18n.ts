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
assert.equal(WORD_TOOLBAR_DISABLED_TEXTS['zh-CN'], '不可用')

const japaneseModules = createFullWordEditorModules([], 'ja')
assert.equal(japaneseModules.toolbar.texts.undo, '元に戻す')
assert.equal(japaneseModules.toolbar.texts.bold, '太字')

const englishModules = createFullWordEditorModules([], 'en')
assert.equal(englishModules.toolbar.texts.undo, 'Undo')
assert.notEqual(chineseModules.toolbar.texts.undo, englishModules.toolbar.texts.undo)

async function testDisabledTooltipLocalization(): Promise<void> {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  Object.assign(globalThis, {
    document: dom.window.document,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
  })

  const uninstallChineseLocalization = installWordToolbarTooltipLocalization('zh-CN')
  const chineseTooltip = document.createElement('div')
  chineseTooltip.className = 'sd-tooltip-content'
  chineseTooltip.innerHTML = '<div>撤销 <span>(disabled)</span></div>'
  document.body.append(chineseTooltip)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(chineseTooltip.querySelector('span')?.textContent, '(不可用)')
  uninstallChineseLocalization()

  const uninstallJapaneseLocalization = installWordToolbarTooltipLocalization('ja')
  const japaneseTooltip = document.createElement('div')
  japaneseTooltip.className = 'sd-tooltip-content'
  japaneseTooltip.innerHTML = '<div>元に戻す <span>(不可用)</span></div>'
  document.body.append(japaneseTooltip)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(japaneseTooltip.querySelector('span')?.textContent, '(無効)')
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

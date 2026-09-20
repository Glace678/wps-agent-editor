import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function exists(rel: string) {
  return fs.existsSync(path.join(root, rel))
}

// 1. 测试焦点锚定算法（Focal-Point Anchoring）
function calculateAnchoredScroll(params: {
  currentScroll: { left: number; top: number }
  anchor: { x: number; y: number }
  oldZoom: number
  newZoom: number
}) {
  const { currentScroll, anchor, oldZoom, newZoom } = params
  const logicalX = (currentScroll.left + anchor.x) / oldZoom
  const logicalY = (currentScroll.top + anchor.y) / oldZoom

  const targetLeft = Math.max(0, Math.round(logicalX * newZoom - anchor.x))
  const targetTop = Math.max(0, Math.round(logicalY * newZoom - anchor.y))

  return { targetLeft, targetTop }
}

// 场景 A: 鼠标位于视口中心 (400, 300)，从 100% 放大到 125%
{
  const res = calculateAnchoredScroll({
    currentScroll: { left: 100, top: 200 },
    anchor: { x: 400, y: 300 },
    oldZoom: 1.0,
    newZoom: 1.25,
  })
  // logicalX = 500, logicalY = 500
  // targetLeft = 500 * 1.25 - 400 = 225
  // targetTop = 500 * 1.25 - 300 = 325
  assert.equal(res.targetLeft, 225)
  assert.equal(res.targetTop, 325)
}

// 场景 B: 鼠标位于文档左上角 (0, 0)，缩放时 (0, 0) 依然保持在原位
{
  const res = calculateAnchoredScroll({
    currentScroll: { left: 0, top: 0 },
    anchor: { x: 0, y: 0 },
    oldZoom: 1.0,
    newZoom: 2.0,
  })
  assert.equal(res.targetLeft, 0)
  assert.equal(res.targetTop, 0)
}

// 2. 结构性断言：word-editor.css 中已移除 transform 动画过渡与强制 height: 0
{
  const css = read('src/lightweight-office/word-editor.css')
  assert.doesNotMatch(
    css,
    /transition:\s*transform\s+100ms/,
    'word-editor.css must not have transform transition on pages or selection overlay',
  )
  assert.doesNotMatch(
    css,
    /data-word-zooming/,
    'word-editor.css must not have dynamic will-change zooming toggles',
  )
  assert.doesNotMatch(
    css,
    /\.presentation-editor__viewport\s*\{\s*height:\s*0\s*!important;?\s*\}/,
    'word-editor.css must not force height: 0 on .presentation-editor__viewport',
  )
  // spread 样式不得依赖 data-word-layout-mode：属性切换与引擎异步重绘之间
  // 存在时间差，限定到属性会在模式切换空档造成间距闪变。
  assert.match(
    css,
    /\.word-document-layout\s+\.superdoc-spread\s*\{/,
    'word-editor.css must style .superdoc-spread without mode attribute qualifier',
  )
  assert.doesNotMatch(
    css,
    /data-word-layout-mode='book'[\s\S]{0,160}superdoc-spread/,
    'spread styles must not be scoped by data-word-layout-mode',
  )
}

// 3. 结构性断言：WordEditor.tsx 挂载 data-manages-document-zoom 并支持平滑焦点缩放
{
  const wordEditor = read('src/lightweight-office/editors/WordEditor.tsx')
  assert.match(wordEditor, /data-manages-document-zoom/, 'WordEditor must manage document zoom')
  assert.match(wordEditor, /applyZoomWithAnchor/, 'WordEditor must provide applyZoomWithAnchor')
  assert.match(wordEditor, /normalizeWheelZoomDelta/, 'WordEditor must normalize wheel zoom delta')
  assert.doesNotMatch(wordEditor, /setIsZooming/, 'WordEditor must not toggle isZooming')
}

// 4. 结构性断言：补丁脚本包含三处 book/zoom 关键补丁
{
  const patchScript = read('scripts/patch-superdoc-word-layout.mjs')
  assert.match(
    patchScript,
    /layoutMode === "book"/,
    'patch-superdoc-word-layout must patch book mode in #applyZoom',
  )
  assert.match(
    patchScript,
    /skip full document re-render on zoom in paginated modes/,
    'patch script must skip the full rerender on zoom (seamless wheel zoom)',
  )
  assert.match(
    patchScript,
    /pair book-mode pages two-up from the first page/,
    'patch script must pair book-mode pages two-up from the first page',
  )
  // setZoom 尾部：仅 semantic flow 才挂全量重绘。补丁脚本此处使用
  // 真实换行和字面 \t 转义；同时支持 Git 的 LF / CRLF 检出。
  assert.match(
    patchScript,
    /if \(this\.#isSemanticFlowMode\(\)\) \{\r?\n(?:\\t)+this\.#pendingDocChange = true;\r?\n(?:\\t)+this\.#scheduleRerender\(\);/,
    'setZoom patch must gate pendingDocChange/scheduleRerender behind semantic flow mode',
  )
  // renderBookMode：从第 0 页开始两页一排（Word 多页排法）
  assert.match(
    patchScript,
    /for \(let i = 0; i < pages\.length; i \+= 2\)/,
    'renderBookMode patch must iterate spreads from page 0',
  )
  // #applyZoom 视口高度：必须显式设置为缩放后高度（负 margin 补偿在本
  // 应用 DOM 链中不收缩滚动区，留空 height 会导致缩小后页面下方出现
  // 数千 px 可滚动空白）。补丁脚本中这些字符串是模板字面量，反引号/$
  // 带反斜杠转义。
  assert.match(
    patchScript,
    /size the vertical viewport host to the scaled height in #applyZoom/,
    'patch script must size the vertical viewport host explicitly',
  )
  // 补丁脚本里目标字符串是嵌套在模板字面量中的，原始字节里反引号/$ 带
  // 反斜杠转义（\` \${），这里按原始字节匹配。
  assert.match(
    patchScript,
    /viewportHost\.style\.height = \\`\\\$\{scaledHeight\}px\\`;/,
    'patch script must set explicit scaled height on the book/vertical viewport host',
  )
  assert.match(
    patchScript,
    /viewportHost\.style\.height = \\`\\\$\{scaledHeight\$1\}px\\`;/,
    'patch script must set explicit scaled height on the horizontal viewport host',
  )
  // 补丁后必须失效 Vite 依赖预打包缓存，否则 dev server 重启仍跑旧引擎
  assert.match(
    patchScript,
    /'\.vite'/,
    'patch script must clear the Vite dependency prebundle cache',
  )
}

// 5. 结构性断言：引擎产物（node_modules）确实已打上缩放补丁，
//    防止 npm install 后漏跑 patch:superdoc 导致闪烁回归。
{
  const esmChunk = 'node_modules/superdoc/dist/chunks/src-CcBJnYZd.es.js'
  const cjsChunk = 'node_modules/superdoc/dist/chunks/src-VzGe-_l_.cjs'
  for (const chunk of [esmChunk, cjsChunk]) {
    if (!exists(chunk)) continue // 未安装依赖时跳过（CI 会先 install + patch）
    const code = read(chunk)
    assert.match(
      code,
      /if \(this\.#isSemanticFlowMode\(\)\) \{\s*\n\s*this\.#pendingDocChange = true;\s*\n\s*this\.#scheduleRerender\(\);/,
      `${chunk}: setZoom must skip the full rerender in paginated modes`,
    )
    assert.match(
      code,
      /mount\.style\.gap = `\$\{this\.pageGap\}px`;\s*\n\s*for \(let i = 0; i < pages\.length; i \+= 2\)/,
      `${chunk}: renderBookMode must pair pages two-up from page 0 with vertical gaps`,
    )
    // #applyZoom 的 horizontal/book/vertical 三个分支都必须显式设置
    // viewportHost 高度为缩放后高度（留空会在缩小时留下可滚动空白）。
    assert.match(
      code,
      /this\.#viewportHost\.style\.height = `\$\{scaledHeight\$1\}px`;/,
      `${chunk}: horizontal #applyZoom branch must set explicit viewport height`,
    )
    const explicitHeightCount = code
      .split(/this\.#viewportHost\.style\.height = `\$\{scaledHeight\}px`;/)
      .length - 1
    assert.equal(
      explicitHeightCount,
      2,
      `${chunk}: book and vertical #applyZoom branches must set explicit viewport height (found ${explicitHeightCount})`,
    )
    assert.doesNotMatch(
      code,
      /this\.#viewportHost\.style\.height = "";/,
      `${chunk}: no paginated #applyZoom branch may leave viewport height auto`,
    )
  }
}

// 6. 结构性断言：WordDocumentLayout 不再搬运/修补引擎 DOM，
//    改为模式切换时克隆覆盖 + 滚动锚定（无感切换）。
{
  const layout = read('src/lightweight-office/components/WordDocumentLayout.tsx')
  assert.doesNotMatch(
    layout,
    /pairBookPages|patchBookHostGeometry|resetBookHostGeometry/,
    'WordDocumentLayout must not move pages or patch host geometry (engine handles it natively)',
  )
  assert.doesNotMatch(
    layout,
    /pagesHost\.style\.minHeight\s*=\s*'0px'/,
    'WordDocumentLayout must not reset minHeight to 0px',
  )
  assert.match(layout, /coverWithPagesClone/, 'WordDocumentLayout must cover mode switches with a page clone')
  assert.match(layout, /cloneNode\(true\)/, 'WordDocumentLayout must deep-clone the pages host as cover')
  assert.match(layout, /captureScrollAnchor/, 'WordDocumentLayout must capture a scroll anchor before switching')
  assert.match(layout, /restoreScrollAnchor/, 'WordDocumentLayout must restore the scroll anchor after switching')
  assert.match(
    layout,
    /data-word-mode-swap-cover|wordModeSwapCover/,
    'cover clone must be tagged for easy inspection/cleanup',
  )
}

console.log('PASS  Word seamless zoom and anti-jitter / anti-blackscreen assertions passed')

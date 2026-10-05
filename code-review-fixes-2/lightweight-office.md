# 全量代码审查修复 — lightweight-office 分片

- 项目：`C:\Users\Glace\Desktop\wps\wps-agent-editor`（HEAD=55b8ccf，改动留工作树，**未 commit**）
- 分片范围：仅 `src/lightweight-office/` 下文件；按契约从 `@/lib/path` 导入（该文件由另一分片在合并时提供，本分片不创建）。
- 验证方式：**未运行 typecheck / vite build / playwright**（按纪律由总控合并后统一跑）。所有改动均为静态核对 + 就地阅读确认。

---

## 一、P1（PDF worker 韧性）

### 1. mupdf-client：补 `messageerror` 监听 + 每请求超时看门狗
- 【报告位置】§1.3 Top10 #7；§03 1.2（mupdf-client.ts L52-53 缺 messageerror、L75-100 无超时）。
- 【现状确认】原构造函数只挂 `message`/`error`（`mupdf-client.ts:52-53`），`request()` 发完 postMessage 后无任何超时，worker 卡死即 UI 永久 loading。
- 【关键改动】
  - 新增 `handleMessageError`：structured-clone 失败走 `messageerror` 而非 `error`，无法定位 requestId，故把全部挂起 pending 统一 reject 为 `MuPdfClientError('message-error', …)`；worker 本身仍存活，故**不**置 `workerFailed`，后续请求仍可服务。
  - 新增每请求超时看门狗 `DEFAULT_REQUEST_TIMEOUT_MS = 120_000`（宽裕值，只兜“worker 无响应”，不误杀大文档渲染）；超时 reject `MuPdfClientError('request-timeout', …)` 并从 pending/timers 移除；`handleMessage` 收到响应即 `clearTimer`；`dispose()` 移除监听并清空全部定时器。
  - 抽出 `clearTimer()` / `rejectAllPending()` 复用，`handleWorkerError`/`dispose` 改为调用。
- 【证据 file:line】`pdf/mupdf-client.ts:23`（超时常量）、`:43`（timers 字段）、`:59`（messageerror 监听）、`:81-90`（handleMessageError）、`:92-105`（clearTimer/rejectAllPending）、`:125-132`（请求超时回调）、dispose 清理见文件尾部。
- 【状态】✅ 已修复。

### 2. mupdf.worker：两处 `asPNG()` 返回的 Buffer 未 destroy
- 【报告位置】§03 3.1（renderPage L813、readWaeRecord L240；对照 saveToBuffer L999-1001 正确写法）。
- 【现状确认】两处均为 `copyArrayBuffer(pixmap.asPNG())` 直接用，asPNG() 返回的 mupdf `Buffer`（持原生内存）从未 destroy。
- 【关键改动】照 saveDocument 写法：`const pngBuffer = pixmap.asPNG(); try { copy } finally { destroyObject(pngBuffer) }`，再外层 finally destroy pixmap。
- 【类型修正（合并后两轮 typecheck 收敛）】`pixmap.asPNG()` 静态类型是 `Uint8Array<ArrayBufferLike>`：直接传给 `destroyObject` 报 TS2345（无 `destroy()`）；而先试的显式标注 `InstanceType<typeof mupdf.Buffer>` 又过强——既不接受 asPNG 的 Uint8Array 赋值、也让 `copyArrayBuffer(Uint8Array)` 传参失败。最终最小改法：声明保持 `const pngBuffer = pixmap.asPNG()`、`copyArrayBuffer(pngBuffer)` 不动，仅在销毁点做一次断言 `destroyObject(pngBuffer as unknown as { destroy(): void })`。运行时 asPNG 返回的就是带 `destroy()` 的 MuPDF Buffer，try/finally 结构不变。
- 【证据 file:line】`pdf/mupdf.worker.ts:250`（readWaeRecord 声明）+ `:254`（销毁断言）、`:831`（renderPage 声明）+ `:840`（销毁断言）。
- 【状态】✅ 已修复。

### 3. mupdf.worker：动态 import 失败后 `mupdfReady` 永久污染
- 【报告位置】§03 2.1（initializeMuPdf L71-79）。
- 【现状确认】`mupdfReady` 一旦 reject 就永久挂在 rejected Promise 上，后续每个请求都以同一原始错误失败，且错误码笼统为 `pdf-worker-error`。
- 【关键改动】`.catch` 内先 `mupdfReady = null`（复位为未初始化，下一请求重新 import），再抛专用 `PdfWorkerError('mupdf-load-failed', …)`。
- 【证据 file:line】`pdf/mupdf.worker.ts:81`（`mupdfReady = null`）、`:83`（`'mupdf-load-failed'`）。
- 【状态】✅ 已修复。

### 4. 图片上限常量去重（MAX_IMAGE_BYTES / MAX_IMAGE_PIXELS）
- 【报告位置】§03 4.3；§18 表 5/6.1。
- 【现状确认】`pdf-image-header.ts:3-4` 与 `worker/wae-limits.ts:5-6` 各定义一份同值常量。
- 【关键改动】pdf-image-header 删除本地定义，改为 `export { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from './worker/wae-limits'`，单一出处落在 wae-limits；UI 侧 PdfViewer 仍从 pdf-image-header 引入（re-export 透明）。
- 【证据 file:line】`pdf/pdf-image-header.ts:5`（re-export）；单一出处 `pdf/worker/wae-limits.ts:5-6`。
- 【wae-limits 导入打包核对】wae-limits.ts 顶部仅 `import type {…}`（编译期擦除），运行时只有纯常量 + 纯函数（JSON.parse / RegExp / Set / Object.keys），**无 `self`/`importScripts`/worker 专有全局**，UI 侧可安全引入。**注：未跑 build，仅静态阅读核对**。
- 【状态】✅ 已修复（打包为静态核对，待总控 build 复验）。

### 5. PdfViewer：fontBytesRef 跨文档不清 + 失败 Promise 不移出缓存
- 【报告位置】§03 3.2（fontBytesRef L178、重置 effect L329-341）。
- 【现状确认】文档重置 effect 清了 `loadedWorkerFontsRef` 等一组 ref，唯独漏 `fontBytesRef`；且 `fontTransfer` 对 readFont 的失败 Promise 不移出缓存，下次同字体直接复用 rejected promise。
- 【关键改动】重置 effect 并排补 `fontBytesRef.current.clear()`；fontTransfer 中对新建请求挂 `.catch`，仅当缓存项仍是该 promise 时移出（对齐 client.loadTextLayer 的失败重试）。
- 【证据 file:line】`editors/PdfViewer.tsx:330`（重置清理）、`:680-683`（失败移出缓存）。
- 【状态】✅ 已修复。

---

## 二、机械清理与去重（行为不变）

### 6. 删除 6 处 console.log
- 【报告位置】§18 一.4（ExcelEditor:225/227/233、WordEditor:292/295、fortune-rendering:570）。
- 【关键改动】全部删除；console.error/warn 保留。
  - ExcelEditor.tsx：删 3 行（其中源码已含 U+FFFD 损坏字符，按行精确过滤删除，保留编码/CRLF）。
  - WordEditor.tsx：删单行 `开始加载` 日志 + 跨行 `文件读取成功` 对象日志块。
  - fortune-rendering.ts:570：删除 console.log；`filled` 仅用于日志，改为直接调用 `fillMissingLocaleKeys(...)` 保留回填副作用。
- 【证据 file:line】`editors/ExcelEditor.tsx`（净减 3 行）、`editors/WordEditor.tsx`（load 内不再有调试日志）、`utils/fortune-rendering.ts`（fillMissingLocaleKeys 直接调用）。
- 【状态】✅ 已修复。本目录 `console.log` grep 现存 0 处。

### 7. word-alignment-policy.ts 去 BOM
- 【报告位置】§…:603。
- 【关键改动】剥离开头 EF BB BF，以无 BOM UTF-8 重写，内容一字不改。
- 【证据 file:line】字节级核对：HEAD blob 4940B → 现文件 4937B（恰少 3 字节 BOM），`oldBytes[3..]` 与现文件 `Compare-Object` 完全一致。
- 【状态】✅ 已修复。

### 8. document-bridge 私有 escapeHtml 改用 escapeHtmlText
- 【报告位置】§18 表 5（document-bridge:564 不转义引号，用于 insertContent HTML 拼接）。
- 【现状确认】原私有 `escapeHtml` 只转义 `& < >`，用在 `<p>${escapeHtml(line)}</p>` 文本内容拼接。
- 【关键改动】删除本地 `escapeHtml`，改从 `editors/notepad-tables.ts` 导入 `escapeHtmlText`（额外转义 `"` → `&quot;`）。调用处为 `<p>` **元素文本内容**语境（非属性），`&quot;` 在文本节点渲染为 `"`，渲染不变、更安全。notepad-tables.ts 零导入，无循环依赖。
- 【证据 file:line】`agent/document-bridge.ts:12`（import）、`:469`（`<p>${escapeHtmlText(line)}</p>`）。
- 【状态】✅ 已修复。

### 9. 按契约从 `@/lib/path` 导入并替换
- 【报告位置】§01 重复模式（baseName 4 处）；§18 表 5（扩展名、路径归一）。
- 【关键改动】
  - TextEditor.tsx 4 处 `filePath.split(/[/\\]/).pop()||filePath` → `baseName(filePath)`；`target` 那处 → `baseName(target)`。
  - utils/file-io.ts `getExtension` 改为对 `extensionOf` 的薄封装（语义一致：小写、无点、无扩展名/隐藏文件返回 `''`；调用方均与小写扩展名表比较），外部 6+ 调用方零改动。
  - utils/code-editor-constants.ts `isSameFile` 的分隔符归一 → `normalizePath`（**保留原有 `.toLowerCase()`**，维持大小写不敏感比较语义）。
  - editors/presentation-animation.ts `normalizeZipPath` 内 `target.replace(/\\/g,'/')` → `normalizePath(target)`。
- 【证据 file:line】
  - `editors/TextEditor.tsx:19`（import baseName）、`:218/:377/:819/:918`（4 处调用）。
  - `utils/file-io.ts:2`（import extensionOf）、`:108-111`（getExtension 转发）。
  - `utils/code-editor-constants.ts:1`（import normalizePath）、`:31`（isSameFile）。
  - `editors/presentation-animation.ts:3`（import）、`:40`（normalizeZipPath）。
- 【状态】✅ 已修复。注：本目录内其余带默认文件名兜底的 `split(/[/\\]/).pop()||'xxx'`（doc-compat/LightweightDocumentEditor/ExcelEditor/pdf-viewer-utils/PdfViewer/WordEditor/PresentationViewer）不在任务清单内，保持原样。

### 10. mupdf.worker 截断省略号 / transfer 抽 helper / close 幂等
- 【报告位置】§03 表 5（:885 省略号污染回填；:1086-1167 七处 transfer 重复；:1046-1049 close 死代码）。
- 【关键改动】
  - `MAX_TEXT_LINE_CHARS` 截断**不再追加 `…`**（省略号会混入正文，污染“点原文改”匹配与回填）。
  - 抽 `mutationTransfer(result)` helper，7 处 `transfer: result.annotations.flatMap(...)` 全部替换为 `transfer: mutationTransfer(result)`。
  - `close` 分支移到 `requireDocument` **之前**，改为幂等：仅当 `current.documentId` 匹配才 disposeCurrent，否则直接返回 `{closed:true}`。
- 【证据 file:line】`pdf/mupdf.worker.ts:913`（无省略号截断）、`:372-375`（mutationTransfer 定义）、`:1116/1133/1143/1153/1163/1173/1183`（7 处调用）、`:1073-1077`（close 幂等）。
- 【状态】✅ 已修复。

### 11. WordEditor platform 导入归一
- 【报告位置】任务指派。
- 【关键改动】`from '@/platform/desktop'` → `from '@/platform'`（@/platform 已 re-export desktopApi，file-io.ts 同样从 '@/platform' 引入）。
- 【证据 file:line】`editors/WordEditor.tsx:21`。
- 【状态】✅ 已修复。

### 12. 裸 setTimeout 25ms 抽常量；100MB 常量收敛评估
- 【报告位置】§18 表 6.13（LightweightDocumentEditor:446）；6.2（presentation-animation:36）。
- 【关键改动】
  - LightweightDocumentEditor.tsx：裸 `25` 抽为模块级 `SAVE_HANDLER_POLL_INTERVAL_MS = 25`。
  - presentation-animation.ts `MAX_PPTX_INPUT_BYTES = 100*1024*1024`：**评估后未收敛**。本目录另一处同值 100MB 是 `worker/wae-limits.ts` 的 `MAX_SAVE_BYTES`，语义域不同（PDF 保存上限 vs pptx 输入上限），前后端各自独立演化，互相导入会造成错误耦合。故保持现状。
- 【证据 file:line】`LightweightDocumentEditor.tsx:36`（常量）、`:449`（使用）；`editors/presentation-animation.ts:34`（MAX_PPTX_INPUT_BYTES 保留）。
- 【状态】✅ 已修复（25ms）；100MB 收敛 = 评估后判定不应合并（记录理由）。

### 13. TextEditor 搜索/帮助 URL 抽常量
- 【报告位置】§18 表 6.20（TextEditor:2288/2388）。
- 【关键改动】Bing 搜索 URL 与 Office 帮助 URL 抽到文件顶部具名常量 `BING_SEARCH_URL` / `OFFICE_HELP_URL`。
- 【证据 file:line】`editors/TextEditor.tsx:169-170`（常量）、openBing 与 help 分支引用。
- 【状态】✅ 已修复。

---

## 三、明确不做（延期 / 待用户决策）

| 项 | 理由 |
|---|---|
| PdfViewer / TextEditor / PresentationViewer / ExcelEditor / CodeEditor hook 化与组件拆分 | 纯结构重构，无行为/安全收益，风险高；报告 §4.2 列为“重构”优先级最低，留待后续。 |
| mupdf.worker.ts 按 §4.1 七模块拆分 | 纯移动式重构，依赖 e2e 全程护航；本分片只做韧性与去重，拆分留专门重构任务。 |
| NotepadCommandBar 拆分、word-toolbar-i18n 数据文件化 | 结构/数据组织类重构，无 P1 影响。 |
| useNotepadZoom / useNotepadTabs 等 hook 抽取 | 结构重构，跨多文件、行为风险。 |
| `usePersistedSetting` 在本目录设置页采用 | 跨分片事项（与 stores/设置页统一），按指示延期。 |
| `PdfWorkerResultMap` / 协议运行时守卫（§03 1.1） | 类型层增强，非 P1 韧性项；报告列为“协议加固”第二步，留后续。 |
| listAnnotations 图片预览缓存、wrapText 前缀宽度、渲染 debounce（§03 性能） | 性能可选优化，非本次必修。 |
| alert/prompt/confirm 集中为 dialog helper | 交互层重构，非 P1。 |

---

## 四、汇总

- **已修复项计数：13 组（P1 ×5 + 机械清理 ×8）**，涉及本目录 14 个文件：
  pdf/mupdf-client.ts、pdf/mupdf.worker.ts、pdf/pdf-image-header.ts、editors/PdfViewer.tsx、editors/TextEditor.tsx、editors/WordEditor.tsx、editors/ExcelEditor.tsx、editors/presentation-animation.ts、agent/document-bridge.ts、utils/file-io.ts、utils/code-editor-constants.ts、utils/fortune-rendering.ts、LightweightDocumentEditor.tsx、word-alignment-policy.ts。
- **wae-limits 导入打包**：pdf-image-header 改为从 `./worker/wae-limits` re-export。wae-limits 仅含 type-only import + 纯常量/纯函数（无 worker 专有全局），UI 侧引入静态安全。**未跑 build，仅静态阅读核对**，待总控 build 复验。
- **未做**：不 git commit、不改报告、不跑 typecheck/vite build/playwright。工作树中 src-tauri、src/platform 等本目录之外的改动属其他并行分片，本分片未触碰。

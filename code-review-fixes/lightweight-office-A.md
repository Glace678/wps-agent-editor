# lightweight-office A 组修复对账

## 汇总

- 候选：54（A 组原分派）+ 1（追加跨分区项 doc-compat #2，文件所有权在本组）
- 已修复：55
- 不适用：0
- 残留：0

范围：仅处理 `src/lightweight-office/**` 中分派给 A 组的 26 个文件；B 组文件（notepad-tables.ts、presentation-animation.ts、text-editor-utils.ts 等）未触碰。
验收：`npx tsc --noEmit -p tsconfig.web.json` 通过（exit 0）；`npx tsx --tsconfig tsconfig.web.json scripts/test-agent-document-bridge.ts` 输出 `PASS visible Word and code Agent document operations`。
竞态统一手法：generation/文件路径身份快照 + await 后复核 + 串行化保存链；XSS 用 `import DOMPurify from 'dompurify'` 在组件内强制净化；资源类硬上限 + 有界/头部预读 + fail closed。

## 逐项

### src/lightweight-office/LightweightDocumentEditor.tsx（2）
1. [medium·confirmed] 代码保存快捷键 `void saveRef.current?.()` 未处理 rejection → 改为读取返回值并 `.catch(console.error)`，与二进制文档保存一致。关键改动 `LightweightDocumentEditor.tsx:614`。验证→tsc 通过。
2. [medium·conditional] 切换文件时旧 editor 的 save 回调未清除，快捷键可能误触发旧文档保存 → 在 `currentFile` 变更的 effect 中先 `saveRef.current = null`。关键改动 `LightweightDocumentEditor.tsx:589-596`。验证→tsc 通过。

### src/lightweight-office/agent/document-bridge.ts（4）
1. [medium·conditional] 空文档 `textContent===''` 回退磁盘旧内容 → 只要存在 live editor 就返回 live `doc.textContent`（含空串），仅在无 live editor 时回退 mammoth 磁盘文本。
2. [medium·conditional] 异步读取无身份校验 → 读取开始快照 `{kind,filePath,superdoc,workbook,revision}`，await 后经 `identityStale()` 复核，漂移则返回 `{success:false, stale:true, error:'STALE_READ_DOCUMENT'}`。
3. [low·conditional] agent 回声时间窗盲等 → 用一次性 `pendingAgentEcho`（由 agent 自身 onEditorUpdate 回声消费）+ 150ms 安全定时器替换原 250ms 窗口。
4. [low·conditional] code range 越界/非整数 → 新增 `finiteInt`/`clampCodePosition`/`positionsOrdered` 校验与钳制。
验证→`scripts/test-agent-document-bridge.ts` PASS。

### src/lightweight-office/agent/live-operation-queue.ts（1）
1. [low·conditional] 已取消 run 记录无界增长 → 新增 `MAX_CANCELLED_RUNS=1000` 上限淘汰。验证→tsc 通过。

### src/lightweight-office/agent/useAgentBridge.ts（2）
1. [low·confirmed] `sendDocumentResult` 无 try/catch，拒绝即未处理 → 包裹 try/catch。
2. [low·conditional] 卸载后仍发结果 → 增加 `disposed` 守卫。验证→tsc 通过。

### src/lightweight-office/components/DocumentTabBar.tsx（1）
1. [medium·confirmed] Ctrl+Shift+方向键重排被普通方向键分支提前吞掉 → 将 Ctrl+Shift+重排判断移到普通方向键之前。验证→tsc 通过。

### src/lightweight-office/components/ExcelCircularColorPicker.tsx（2）
1. [low·conditional] dpr 换算 wheel 尺寸不整 → `pixelSize = Math.round(WHEEL_SIZE*dpr)`。
2. [medium·conditional] wheel/slider 监听与指针事件卸载泄漏 → detach refs + `pointercancel` + 卸载 cleanup。验证→tsc 通过。

### src/lightweight-office/components/PdfToolbar.tsx（2）
1. [low·confirmed] 页码输入越界 → clamp 到 `[1,totalPages]`。
2. [low·conditional] 退出 editMode 时弹出层未关 → 退出时关闭 popups。验证→tsc 通过。

### src/lightweight-office/components/SaveConfirmDialog.tsx（2）
1. [medium·conditional] 重复点击保存无 pending 守卫 → `handleSave` 增加 pending 守卫 + catch。
2. [medium·conditional] 按钮在保存中可点、错误无展示 → 保存中禁用按钮 + 错误行展示。验证→tsc 通过。

### src/lightweight-office/components/WordCaret.tsx（1）
1. [low·conditional] effect 依赖缺 viewMode、cleanup 未移除属性 → deps 补 viewMode，cleanup 移除 attribute。验证→tsc 通过。

### src/lightweight-office/components/WordDocumentLayout.tsx（1）
1. [low·conditional] settleTimerRef 清理后未置空 → clearTimeout 后置 null。验证→tsc 通过。

### src/lightweight-office/components/WordInsertTableDialog.tsx（3）
1. [low·confirmed] rows/cols 未钳制可越界 → `clampDimension` 钳到 `rows∈[1,1000]`、`cols∈[1,63]`。
2. [low·confirmed] fixed width 直接 parseFloat 未校验 → `parseFixedWidth` 有界解析。
3. [medium·conditional] widthMode 未随打开重置 → 打开 effect 重置 `widthMode='auto'`、`fixedWidth='0.16'`。验证→tsc 通过。

### src/lightweight-office/components/WordPageStitch.tsx（3）
1. [medium·conditional] 旧滚动锚定 settle rAF 未取消 → `settleRafRef` 跟踪，toggle 前取消 + 卸载 cleanup。
2. [low·conditional] `enabled` 还原被强转 false、丢失 undefined 默认语义 → 原配置类型改 `boolean | undefined`，原样保存/恢复。
3. [medium·conditional] layout rebuild 异常时已改写的 virtualization 配置未回滚 → catch 中回滚到拼接前值并重建 vertical。验证→tsc 通过。

### src/lightweight-office/components/WordViewStatusBar.tsx（2）
1. [high·conditional XSS] `snapshot.html` 流入 `dangerouslySetInnerHTML` → 在 `WordAlternateView` 内用 `DOMPurify.sanitize(..., {USE_PROFILES:{html:true}, FORBID_TAGS/FORBID_ATTR})` 强制净化，不依赖上游。
2. [low·conditional] slider rAF 卸载未取消 → 卸载 effect 取消 `sliderFrameRef`。验证→tsc 通过。

### src/lightweight-office/dom-observer.ts（3）
1. [low·conditional] body 未就绪时观察失败 → 等待 body。
2. [low·conditional] 观察目标错误 → 观察 `document`。
3. [low·conditional] rAF 不可用时退化 → rAF→setTimeout fallback。验证→tsc 通过。

### src/lightweight-office/editors/CodeEditor.tsx（4）
1. [medium·confirmed] 非 UTF-8 文件被无条件 utf-8 解码/保存损坏 → mount 时用 `fatal:true` TextDecoder 探测，非 UTF-8 置 `nonUtf8Ref`，`saveCurrent` 中 fail-closed 拒绝覆盖。
2. [medium·confirmed] `startDebug` reject 后状态卡在 starting → 整体 try/catch，失败时 `endSession()` + 错误状态。
3. [medium·conditional] 异步保存完成回调跨文件切换误清 dirty → 新增 `filePathRef`/`unmountedRef`，await 后仅当仍为同一文件且未卸载才 `onSaveSuccess()`。
4. [low·conditional] monaco model 卸载未释放 → 记录 `createdModel` 归属，cleanup 仅 dispose 自有 model。验证→tsc 通过。

### src/lightweight-office/editors/ExcelEditor.tsx（2）
1. [high·conditional] 解析 await 后未复核 generation/filePath → `xlsxBufferToSheets` await 后二次 `if (cancelled) return`。
2. [medium·conditional] 挂载后 500ms baseline 定时器未跟踪/未取消 → `baselineSettleTimerRef` 跟踪，切文件/卸载清除并复核 `workbookRef.current===api`。验证→tsc 通过。

### src/lightweight-office/editors/NotepadSettingsPage.tsx（3）
1. [medium·conditional] open=false 仍留在 tab 序/可聚焦 → `if (!open) return null`。
2. [medium·conditional] initialSection 变化未同步 expanded → 新增 effect 在 open/initialSection 变化时重置 expanded。
3. [medium·conditional] 聚焦 rAF 未取消 → 跟踪 rafId，cleanup `cancelAnimationFrame`。验证→tsc 通过。

### src/lightweight-office/editors/PdfViewer.tsx（1）
1. [medium·conditional] createImageBitmap 全量解码在尺寸上限检查前（解压炸弹 DoS）→ 新增 `readImageHeaderDimensions` 从 PNG/JPEG/WebP 头部廉价解析宽高，先于解码；仅头部解析失败才回退原解码路径。验证→tsc 通过。

### src/lightweight-office/editors/PresentationViewer.tsx（3）
1. [medium·conditional] 保存/编辑竞态 → 新增 `mutationChainRef` 串行化，save 在快照 buffer 前 await 进行中的编辑。
2. [medium·conditional] 切换文件后旧异步编辑结果污染新文档 → `executeEditOperation` 快照 `targetFile`，await 后复核 `presentationBufferFileRef.current===targetFile`，否则丢弃。
3. [low·confirmed] 行内编辑无条件 `.trim()` 丢首尾空格 → 使用原始文本比较与提交。验证→tsc 通过。

### src/lightweight-office/editors/TextEditor.tsx（1）
1. [high·confirmed] 保存完成无条件清 dirty，丢失保存期间的新编辑 → 快照 `snapshotTabId`，新增 `saveChainRef` 串行化保存；await 后仅当同一 tab 且 `textRef.current===value` 才 `savedTextRef/dirty=false`；模型更新用快照 tab id。验证→tsc 通过。

### src/lightweight-office/editors/WordEditor.tsx（3）
1. [medium·confirmed] Ctrl/Cmd+Shift+Z 被当作 undo → `isUndo` 增加 `!e.shiftKey`，Shift+Z 归 redo。
2. [medium·conditional] 切文件未重置 `isInitializedRef` 门闩 → 加载 effect 重置为 false；新增 `initGateTimerRef` 跟踪并清理 500ms 门闩定时器。
3. [low·conditional] agent 指针延迟清除定时器未清理 → 局部 timer 跟踪，新事件取消旧定时器，卸载清理。验证→tsc 通过。

### src/lightweight-office/editors/text-editor/markdown.ts（3）
1. [low·conditional] marker 未在异常路径移除 → try/finally 移除 marker。
2-3. 相应 caret-path trim 等按建议收敛。验证→tsc 通过。

### src/lightweight-office/editors/text-editor/preview-dom.ts（1）
1. [low·conditional] 偏移越界 → 非负有限整数守卫。验证→tsc 通过。

### src/lightweight-office/editors/text-editor/print.ts（1）
1. [low·conditional] HTML 转义多趟 → 单趟 `/&(&|[fdpt])/g` 替换器。验证→tsc 通过。

### src/lightweight-office/editors/text-editor/table.ts（2）
1. [low·conditional] 行选择越界 → `getDirectRows()` 作用域收敛。
2. [low·conditional] 插入行未感知网格 → grid-aware `insertTableRowAfter`。验证→tsc 通过。

### src/lightweight-office/editors/text-editor/zoom.ts（1）
1. [low·conditional] 缩放基数 NaN → `Number.isFinite` 回退。验证→tsc 通过。

### 跨分区追加：src/lightweight-office/utils/doc-compat.ts 第 2 项（来源 doc-compat #2，文件所有权在本组）
1. [low·conditional] file.doc/odt 经转换生成的 file.docx 与已有 DOCX 碰撞会被静默覆盖 → 在 doc-compat.ts 新增纯函数 `resolveUniqueWordSavePath(target, exists)`（`utils/doc-compat.ts:68`）：目标已存在时按 `file (1).docx`、`file (2).docx`… 递增直到空闲；在最终保存层 `WordEditor.tsx` 的 save effect 接入：仅对“直接写入（已有 grant、未弹保存框）且源仍是 .doc/.odt”的场景调用唯一化；走 `selectSaveFile` 的路径视为显式冲突确认，尊重用户选择，不二次改名。禁止静默覆盖。关键改动 `utils/doc-compat.ts:68`、`editors/WordEditor.tsx:580`。验证→tsc 通过（`npx tsc --noEmit -p tsconfig.web.json` exit 0）。
   - 说明：doc-compat.ts 第 1 项（OOXML 结构校验 `looksLikeDocxPackage`）由 B 组修复，本次未改动。

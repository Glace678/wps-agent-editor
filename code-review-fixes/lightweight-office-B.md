# lightweight-office B 组修复对账

范围：`src/lightweight-office/**` B 组共 50 项静态审查候选。A 组文件（LightweightDocumentEditor.tsx、agent/、components/、dom-observer.ts、editors 主编辑器 ExcelEditor/WordEditor/TextEditor/PresentationViewer、editors/text-editor/）未改动；审查报告本身只读未改。

## 汇总

- 候选：50
- 已修复：49
- 不适用：0
- 残留 / 跨分区请求：1（`utils/doc-compat.ts` #2 保存输出路径碰撞的覆盖确认，需在 A 组 `WordEditor.tsx` 保存流程实现，本分区无法闭合）

自查：`npx tsc --noEmit -p tsconfig.web.json` → exit 0（本分区无新增类型错误）。

## 逐项

### editors/notepad-tables.ts（4）
1. 报告 confirmed/high：序列化丢失 colspan/rowspan/class/style/caption/colgroup。处理：已修复。`serializeTableElement` 改白名单属性 `serializeAttrs()`，保留 caption/colgroup/col。验证→tsc 通过。
2. 报告 confirmed/high：普通文本被误判 Markdown 表格改写。处理：已修复。新增 `splitPipeCells()`，`isPipeSeparatorRow` 收紧（必须含 `|`、每格 `:?-+:`），`findMarkdownTableRegions` 加列数一致校验。
3. 报告 confirmed/high：表头属性注入。处理：已修复。`sanitizeTableAttributes()` 仅输出白名单 `name="value"` 对并转义。**后续修正**：全量回归发现白名单过紧，丢弃了内部插入标记 `data-notepad-new-table="true"`（破坏 `test:notepad-multi-tables` Scenario 1 "New table has unique identifier"）。已在 `sanitizeTableAttributes` 放行 `data-*` 前缀属性（与 `serializeAttrs` 的 "plus data-*" 一致），值仍经 `escapeHtmlText` 转义；`on*`/其他危险属性继续丢弃。验证→8/8 scenario 通过、`npm run typecheck` exit 0。
4. 报告 confirmed/medium：NaN/Infinity 行列。处理：已修复。非有限行列回退 1。

### editors/presentation-animation.ts（2）
1. 报告 confirmed/medium：绝对包路径 Target 未去前导 `/`。处理：已修复。`normalizeZipPath` 去前导斜杠后直接查包根。
2. 报告 confirmed/medium：ZIP 无解压炸弹上限。处理：已修复。加输入/条目数/解压总量上限 + `boundedMap()` 并发 6。

### editors/text-editor-utils.ts（1）
1. 报告 confirmed/medium：大小写折叠扩展长度（U+0130 等）导致 UTF-16 索引错位。处理：已修复。`findTextMatches` 建 folded→原 UTF-16 索引映射。

### fortune-sheet-theme.css（3）
1. 报告 conditional/medium：动画期 `pointer-events: none !important` 冻结整个编辑区，状态残留即不可点。处理：已修复。删除 4 个动画冻结块（shell/word/notepad/pdf）的 `pointer-events: none !important`。
2. 报告 conditional/medium：`contain: layout paint size` + overflow 裁剪 fixed 模态。处理：已修复。稳态 `contain` 去掉 `paint`（`contain: layout size`），fixed 模态不再被裁剪。
3. 报告 confirmed/low：固定 356px 颜色选择器内容溢出约 4px。处理：已修复。宽/最小/最大统一为 360px。

### pdf/mupdf-client.ts（1）
1. 报告 confirmed/high：Worker 崩溃后仍发请求。处理：已修复。加 `workerFailed` 门闩，崩溃后拒绝后续请求。

### pdf/mupdf.worker.ts（3）
1. 报告 confirmed/high：空 redactionRects 跳过擦除却插入替换文本。处理：已修复。空 rect 回退为 `[redactionRect]`。
2. 报告 confirmed/high：WAE Payload JSON 无界解析。处理：已修复。加 64KB/200 keys/6 层嵌套深度上限，超限 fail-closed。
3. 报告 confirmed/medium：open 新文档先替换状态再验证。处理：已修复。先成功 `new PDFDocument` 再 `disposeCurrent()`。

### pdf/pdf-text-layout.ts（1）
1. 报告 confirmed/low：无 `document` 环境崩溃。处理：已修复。`getMeasurementContext()` 保护 `typeof document`。

### utils/doc-compat.ts（2）
1. 报告 confirmed/medium：仅凭扩展名/MIME 判 DOCX。处理：已修复。用 jszip 校验 `[Content_Types].xml` + `word/document.xml` 最低结构再判为 DOCX。
2. 报告 confirmed/medium：转换目标路径与已有文件碰撞。处理：**残留/跨分区请求**。覆盖确认逻辑在 A 组 `WordEditor.tsx` 保存流程，本分区无权修改，需 A 组在保存层加存在即询问/自动改名。

### utils/excel-dirty.ts（1）
1. 报告 confirmed/high：纯样式空 cell 不进脏指纹。处理：已修复。加 `STYLE_CELL_KEYS`（bg/ff/fc/bl/it/fs/cl/un/vt/ht/tb/tr/rt/mc/qp/ct）与 `cellHasContentOrStyle()`。

### utils/excel-live-resize.ts（2）
1. 报告 confirmed/medium：cleanup 不恢复预览尺寸。处理：已修复。cleanup 改 `endSession(true)` 恢复预览尺寸。
2. 报告 conditional/low：尺寸计算异常残留。处理：已修复。`applyLen` 加 try/catch 收尾。

### utils/excel-toolbar-popup-boundary.ts（2）
1. 报告 confirmed/medium：嵌套菜单超 shell 宽度。处理：已修复。宽度按 shell 上限裁剪。
2. 报告 confirmed/low：cleanup 不恢复快照状态。处理：已修复。PopupSnapshot 在 cleanup 恢复。

### utils/excel-toolbar-shortcuts.ts（2）
1. 报告 confirmed/medium：按 data-tips/id 猜测图标重绑定。处理：已修复。icon id 用 hasOwn + 字符串校验。
2. 报告 confirmed/low：选择器选到非工具栏按钮。处理：已修复。选择器去掉 `[data-tips]` 并补 more 菜单 combo-arrow 限定。

### utils/fortune-rendering.ts（2）
1. 报告 high/conditional：替换 fontarray 未迁移既有 cell 字体索引导致错位。处理：已修复。采用位置保持策略——旧索引位置保留同名 family，新 family 追加在后，fontjson 按最终数组重建。
2. 报告 confirmed/high：`configureFortuneRendering([])` 清空字体目录。处理：已修复。空/空数组目录守卫，保留默认/旧目录。

### utils/typed-array-polyfill.ts（2）
1. 报告 confirmed/high：fromHex 非法字符静默截断。处理：已修复。严格正则，非法字符抛 `TypeError`（main + worker 两处）。
2. 报告 confirmed/high：sumPrecise 非规范累加。处理：已修复。改 Kahan 补偿求和并传播 NaN（两处）。

### utils/xlsx-convert.ts（4）
1. 报告 confirmed/high：工作表名未规范化/未唯一。处理：已修复。`uniqueSheetName()` 去非法字符并保证唯一。
2. 报告 confirmed/high：单元格坐标未校验。处理：已修复。`validCellCoord()` 有限整数 + Excel 行 1048575/列 16383 边界。
3. 报告 confirmed/high：合并区域未校验。处理：已修复。端点/边界/重叠校验。
4. 报告 conditional/low：CSV 探测误判。处理：已修复。`collectCsvSampleLines` 取前 10 行多行探测。

### word-alignment-policy.ts（3）
1. 报告 confirmed/medium：cleanup 不恢复按钮状态。处理：已修复。跟踪 boundButtons 并在 cleanup 移除监听/恢复。
2. 报告 confirmed/low：按钮事件取到内层 span。处理：已修复。改 label-only 选中。
3. 报告 conditional/low：getEditor/scan 无 try/catch。处理：已修复。加 try/catch 兜底。

### word-color-picker.css（1）
1. 报告 conditional/low：窄视口（<~366px）颜色选择器水平裁剪。处理：已修复。自定义块加 `max-width: min(356px, 100vw-16px)` + `overflow-x:auto`，窄屏媒体查询内部横向滚动。

### word-color-picker.tsx（2）
1. 报告 confirmed/medium：命令失败仍更新 iconColor。处理：已修复。命令成功后才更新。
2. 报告 confirmed/medium：多工具栏时菜单查找越界。处理：已修复。`findColorMenu` 限定 toolbarRoot 所属候选。

### word-editor.css（2）
1. 报告 conditional/low：表格边框回退误伤 class 边框表格。处理：已修复。回退选择器加 `:not([class*='border'])`。
2. 报告 confirmed/medium：`:focus`/`:focus-visible` 同时去 outline 丢键盘指示。处理：已修复。`:focus`（鼠标）去 outline，`:focus-visible` 恢复 2px 高对比蓝环（状态栏/缩放控件 + dark 工具栏两处）。

### word-font-search.ts（2）
1. 报告 conditional/low：dispose 不恢复筛选后选项状态。处理：已修复。dispose 恢复 `hidden`/`aria-hidden`/active/symbol 类、清 minWidth、删注入节点。
2. 报告 conditional/low：多实例 disposer 全局清理他实例 UI。处理：已修复。按实例 `Set` 追踪 decorated popups，dispose 只清本实例。

### word-font-size-input.ts（2）
1. 报告 conditional/medium：Enter/Tab 后 blur 兜底重复提交。处理：已修复。`keyboardSubmitted` 标记，键盘提交后跳过 blur 兜底。
2. 报告 conditional/low：重复安装叠加监听。处理：已修复。模块级 `installed` 幂等守卫。

### word-table-picker.tsx（2）
1. 报告 confirmed/low：插入失败仍关下拉。处理：已修复。`handleInsert` 返回布尔，成功才 `onCloseDropdown`。
2. 报告 confirmed/low：已移除 wrapper 的 root 延迟到 dispose 才释放。处理：已修复。scan 时 sweep 断开 root 即时 unmount。

### word-toolbar-i18n.ts（3）
1. 报告 conditional/low：重复切语言无法重定位。处理：已修复。首本地化在 `dataset.waeI18nKey` 存英文原键，后续按稳定键查表。
2. 报告 conditional/low：重复安装叠加 observer。处理：已修复。模块级单例 observer，新安装先 disconnect 旧的。
3. 报告 conditional/low：observer 不看 characterData。处理：已修复。观察项加 `characterData: true` 并处理 characterData 记录。

### word-toolbar-overflow.ts（1）
1. 报告 confirmed/low：无溢出仍加三点控件。处理：已修复。仅当 `overflowed.length > 0` 才 push overflowControl。

## 阻塞项 / 跨分区请求
- `utils/doc-compat.ts` #2：DOCX 转换保存目标路径与既有文件碰撞的覆盖确认/自动改名，需在 A 组 `WordEditor.tsx` 保存层实现，本分区无法闭合。

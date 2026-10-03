# 代码优化报告（2026-09-25）

## 0. 总结

本轮按照仓库内 `REFACTOR-PLAN-FOR-AI.md` 的阶段和约束执行。原则是**只做行为不变或有测试保护的改动**，不重写编辑器，不改 Tauri IPC wire 协议。

| 指标 | 优化前 | 优化后 |
|---|---|---|
| `TextEditor.tsx` 行数 | 3612 | 3226（纯函数移到 `text-editor/` 下 8 个模块） |
| `agents/runtime.rs` 行数 | 2351 | 1383（拆出 `runtime/` 下 3 个子模块） |
| 模型显示名实现 | 3 套不一致的实现 | 1 套共享实现 + 13 个 golden case |
| 未接入任何命令的测试脚本 | 26 个（其中 5 个已失效） | 0 个；全部修复并接入 CI canary |
| 未使用的变量/导入/类型（TS） | 13 处 | 0 处，并在 tsconfig 开启 `noUnusedLocals` / `noUnusedParameters` 防止回归 |
| 发现并修复的真实不一致 | — | Word 工具栏缩放按钮溢出兜底宽度 70px ≠ CSS 实际 56px |

所有验证全部通过（见第 6 节）。**改动未提交**，由你审阅后再决定是否提交。

---

## 1. 模型显示名统一（计划 Phase 2）

**问题**：同一件事（把 `custom-<uuid>/doubao-pro` 之类的模型 ID 变成人类可读名称）在三个地方各写了一遍，结果不一致：

- `AgentList.tsx`：有缩写表（GPT/GLM/Qwen…），取路径最后一段，支持跨 provider 兜底；
- `CollaborationConfigDialog.tsx`：未命中 catalog 时直接显示原始 ID；
- `lib/agent-model.ts`（协作聊天用）：会把 `3.5` 拆成 `3 5`，没有缩写表；
- 另外 catalog 里 `name` 与 `id` 相同（如 `gpt-4o`）时，前两者一个会美化一个不会。

**改动**：
- `src/lib/agent-model.ts` 成为唯一实现 `modelDisplayName()`，规则：
  1. 精确 provider 命中且 catalog 名称不只是重复 ID → 用 catalog 名；
  2. 跨 provider 兜底**仅当所�� provider 对该 ID 给出同一个名称**时使用（避免同 ID 不同名时串名）；
  3. 否则取路径最后一段并���缩写表格式化（保留 `3.5` 这类版本号）；
  4. `custom-` 前缀剥离收紧为严格的 UUID 格式（与 Rust `store.rs` 与 `ProviderSettings.tsx` 生成的 ID 格式一致）。
- `AgentList.tsx` 删除 ~60 行重复逻辑及 `useMemo`；`CollaborationConfigDialog.tsx` 删��自带实现。空模型时两处原本的 `Default` / `default` 文案保持不变。
- 新增 `scripts/test-agent-model-display.ts`（13 个 case，含计划中列出的全部样例），接入 `npm run test:agent-model-display` 与 `test:web-canaries`。

**用户可见变化**：协作配置对话框中，未在 catalog 的模型现在显示为 `Bar Model 2` 而不是 `foo/bar_model_2`；协作聊天中 `claude-3.5-sonnet` 显示为 `Claude 3.5 Sonnet` 而不是 `Claude 3 5 Sonnet`。三处显示终于一致。

## 2. 孤儿测试脚本治理（计划 Phase 7）

**问题**：`scripts/` 下 26 个 `test-*` 脚本没有被 `package.json`/CI 引用，长期不跑，其中 5 个已经失效。

**逐个运行后的分类**：
- 21 个直接通过；
- 2 个（`test-office-shortcuts-dispatch/catalog`）本身没问题，只是因为引入无扩展名的 TS 模块，必须用 `tsx` 运行；
- 4 个是“源码快照式”断言跟不上**有意的**样式调整（均已核对当前实现后更新期望值，行为契约断言保持不变）：
  - `test-agent-config-dialog-scroll`：`px-6` → `px-5`
  - `test-panel-resize-drag-session`：`smoothstep` → 现在的 `clamp(...)` 渐变
  - `test-recent-hover-selection`：勾选框尺寸/颜色类名随改版更新；行点击断言放宽对前置属性顺��的依赖
  - `test-word-toolbar-overflow`：缩放按钮 54→56px、下拉 62→70px
- 1 个暴露了**真实不一致**，见第 3 节。

**新增**：
- `scripts/run-structural-tests.mjs`：一次性运行这 26 个无浏览器的结构测试（`npm run test:structural`）；
- `scripts/check-test-scripts-wired.mjs`：新增 `scripts/test-*` 必须被 package.json / CI / 上面的 runner 引用，否则失败（`npm run check:test-scripts`）；
- 两者都已接入 `test:web-canaries`，即进入 CI。

没有删除任何测试脚本。

## 3. 真实问题修复：Word 工具栏溢出兜底宽度

`src/lightweight-office/word-toolbar-overflow.ts` 中缩放按钮的首帧兜底宽度为 `70`，而 `word-editor.css` 实际把该按钮固定为 `56px`。这会让首次 DOM 测量前的溢出计算多预留 14px，可能导致首帧额外把一个按钮收进“更多”菜单再弹出（闪动）。同文件中 `fontSize` 已有“兜底值需与 CSS 对齐”的注释，所以改为 `56` 与 CSS 对齐。

## 4. 死代码清理 + 编译器防回归

用 `tsc --noUnusedLocals --noUnusedParameters` 扫描全部 TS 工程，清理：

| 文件 | 清理内容 |
|---|---|
| `components/layout/BottomPanel.tsx` | `startResize` 未使用的 `startY` 参数（及调用处传参） |
| `components/layout/modules/DocumentZoom.tsx` | 未使用常量 `ZOOM_MODE_KEY`、类型 `PageLayoutMode` |
| `components/layout/panel/ReferencesView.tsx` | 未使用的 react hooks 导入、`useDebugStore` 导入 |
| `lightweight-office/editors/CodeEditor.tsx` | 未使用接口 `ReferenceItem` |
| `lightweight-office/editors/ExcelEditor.tsx` | 未调用函数 `isExcelCellEditorActiveWithoutSelection` |
| `lightweight-office/editors/NotepadCommandBar.tsx` | 未使用图标 `Bold`、`Link`、`ListChecks` |
| `lightweight-office/utils/excel-toolbar-popup-boundary.ts` | 未使用参数改为 `_shell`（保留签名） |
| `lightweight-office/word-color-picker.tsx` | 未使用的 `React` 默认导入 |
| `tests/e2e/word-zoom-seamless.spec.ts` | 未使用的 `countNode` |

随后在 `tsconfig.web.json` 与 `tsconfig.node.json` 开启 `noUnusedLocals` 和 `noUnusedParameters`，`npm run typecheck` 以后会直接拦截此类死代码。

Rust 侧 `cargo clippy -D warnings` 本来就是零警告；唯一的 `#[allow(dead_code)]`（`update_health.rs` 的 `GuardianPlatform`）属于按平台条件编译的枚举，每个平台只用到部分变体，保留合理。

## 5. 大文件拆分（纯移动，不改逻辑）

### 5.1 `TextEditor.tsx`（计划 Phase 6A）

组件外部的纯函数/常量逐字移动（仅加 `export`）到 `src/lightweight-office/editors/text-editor/`：

| 新文件 | 内容 |
|---|---|
| `markdown.ts` | marked 全局配置、turndown 序列化规则、`renderNotepadMarkdown`、正文区域序列化函数 |
| `preview-dom.ts` | 预览区 DOM 定位/聚焦/可编辑区域启用 |
| `table.ts` | 表格行选中、插入、命中测试 |
| `zoom.ts` | 缩放常量、`clampNotepadZoom`、缩放锚点恢复 |
| `format.ts` | 拼写检查格式、字宽映射 |
| `print.ts` | 打印模板展开 |
| `settings.ts` | 布尔/数值设置读取 |
| `escape.ts` | 链接属性转义；`escapeNotepadLinkText` 与已有 `escapeHtmlText` 行为完全相同，改为复用 |

组件内部 state/hook 未拆（计划明确要求先纯移动）。`applyNotepadTextZoom` 因有结构测试直接检查它位于 `TextEditor.tsx` 而保留原处。

### 5.2 `agents/runtime.rs`（计划 Phase 5A）

| 新文件 | 内容 |
|---|---|
| `runtime/chat_context.rs` | provider 消息构建、上下文裁剪、tool call 解析、文档命令构建（及 5 个单元测试） |
| `runtime/attachments.rs` | 附件渲染、Office 压缩包 XML 文本提取、XML 转义（及 3 个单元测试） |
| `runtime/events.rs` | ID 规范化、文档事件类型映射、JSON 大小限制、截断（及 1 个单元测试） |

`AgentRuntime` 私有状态未暴露，移动的函数仅 `pub(super)`。错误字符串、事件顺序、serde 类型、`mode: Option<String>`、`map_document_event_type` 语义全部未变。编排逻辑（orchestration）直接操作运行时私有状态，风险较高，本轮未拆。

`scripts/test-terminal-contract.mjs` 原本只读取 `runtime.rs` 文本做断言，已改为读取 `runtime.rs + runtime/*.rs` 合并文本，以后移动代码不会误报。

## 6. 验证结果（按 CI 顺序，全部通过）

| 命令 | 结果 |
|---|---|
| `npm run check:sensitive` | PASS（664 个文件） |
| `node scripts/release/test-release-contract.mjs` | PASS |
| `npm run check:i18n` | PASS（9 种语言 × 761 键） |
| `npm run check:providers` | PASS（178 provider / 5482 模型） |
| `npm run test:web-canaries` | PASS（含新增的 26 个结构测试、模型显示名 13 case、协作 transcript 20 case、3 组 Playwright） |
| `npm run check:generated` | PASS（生成类型内容与 HEAD 字节一致） |
| `npm run typecheck`（已开启未使用检查） | PASS，0 错误 |
| `npm run build:web` | PASS（bundle 契约 1.74MB gzip，低于上限 1.91MB） |
| `npm run test:e2e` | PASS（25/25） |
| `cargo fmt --check` | PASS |
| `cargo clippy --all-targets -D warnings` | PASS，0 警告 |
| `cargo test` | PASS（199/199，与基线一致） |

**未覆盖的部分**：没有在真实 Tauri 窗口里手动打开 `.md/.txt/.lrc` 文件逐项点按（计划 6A 建议的手测）。自动化覆盖了记事本多表格、设置浮层、结构断言和 build，但仍建议你 `npm run dev` 后快速过一遍记事本的打开/编辑/预览/保存。

## 7. 刻意没有做的事（及原因）

- **没有统一各编辑器的缩放/Escape/对话框**：计划明确禁止，PDF/PPT/Excel 语义不同。
- **没有抽 `use-popover` hook、没有重写 transcript reducer**：计划要求先有键盘行为测试；这属于中高风险 UI 重构，本轮只做了有测试兜底的改动。
- **没有把 `ProviderDefinition`/`FileEntry` 换成生成类型**：手写类型有 `sortName`、`grantId` 安全边界问题，需单独设计。
- **没有批量清理 `console.*`**：仅剩 7 处 `console.log`，都在 Excel/Word 引擎适配诊断路径中。
- 计划中的 1B（chat/runTask 参数对象化）、1C（transcript 非空断言）、1D（effect 依赖）、1E（transcript golden case）、1F（STARTER_PROMPTS 抽离）、Phase 0 两个红项，在本轮开始前已经完成，复核后无需改动。

## 8. 工作区说明

- 本轮开始前就存在的未提交改动（`scripts/generate-command-contract.mjs` 的 CRLF 兼容、`src/platform/generated-command-names.ts`、未跟踪的 `SOURCE-INDEX.txt`、`verify-gate.cmd`）未被触碰。
- `git status` 中 `src/types/generated/*.ts` 显示为 M 是 `check:generated` 重写文件导致的换行符/状态缓存噪音，`git diff` 内容为空。
- 新增文件：`scripts/test-agent-model-display.ts`、`scripts/run-structural-tests.mjs`、`scripts/check-test-scripts-wired.mjs`、`src/lightweight-office/editors/text-editor/*`、`src-tauri/src/agents/runtime/*`、本报告。

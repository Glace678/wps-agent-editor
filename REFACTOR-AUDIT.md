# 屎山审计报告：wps-agent-editor

**日期**：2026-09-17
**分支**：`codex/stability-hardening`（工作树有未提交的协作功能 + PDF 改动）
**方法**：三路并行代码扫描（Agent/协作、lightweight-office/PDF、整体架构）+ 逐项人工复核（每条关键结论都用 `grep`/`diff`/实际运行脚本核对过）
**诉求**：全区域排查；产出诊断 + 重构计划；**优先可读性/可维护性**

---

## 0. 总体评价（先说结论）

**这不是典型屎山。** 项目有几处明显做得对的地方，重写式重构是错误答案：

- **平台访问层干净**：`@tauri-apps/api` 只在 `src/platform/transport.ts` 一个文件里被 import，其余 31 个模块全部走 `desktopApi`。没有散落的 `invoke`。
- **线类型由 ts-rs 生成**：`src/types/generated/` 下 53 个文件，Rust 是单一事实源，并有 `check:generated` 守着漂移。
- **校验脚本套件异常严格**：i18n 有术语检查、法语撇号检查、复制率上限（30%）、替换字符检查；包体有 gzip 基线 + 10% 回归上限；provider catalog 有契约检查。
- **`src/` 下 0 处 TODO/FIXME/HACK**；agent runtime 模块内无 `unsafe`、`unwrap`/`expect` 都在 `#[cfg(test)]` 里。
  > ⚠️ **修正**：不能推广成"全仓库无 unsafe"。`src-tauri/src/documents/converter.rs:1130/1239/1249/1264/1284` 等处生产代码有 `unsafe`（共 63 处 `unsafe` 字样）。本文档的 safe 结论只适用于 `src-tauri/src/agents/`。

**问题集中在六处**，全部是"局部重复 + 局部过大"，不是架构性失败：

> ## 修订记录（2026-09-17）
>
> 执行 `REFACTOR-PLAN-FOR-AI.md` 前复核，发现本文档最初版本有 **4 处过度主张**，已就地修正并在原位置标注 ⚠️：
>
> 1. **"Rust 侧 0 处 unsafe"** —— 错。该结论只适用于 `src-tauri/src/agents/`；`documents/converter.rs` 等处生产代码有 `unsafe`（全仓库 63 处）。
> 2. **"`map_document_event_type` 静默吞错"** —— 错。调用方 runtime.rs:283 返回 `AppError::invalid("Unknown Agent document event type")`，且该 None 行为有测试断言（runtime.rs:2164）。是有意的容错设计，不是 bug。
> 3. **"`FileEntry` 类型漂移，改 re-export 即可"** —— 表述不准。`desktop-api.ts:92` 有 `GrantedFileEntry = FileEntry & { grantId: string }`，手写 `FileEntry` 是刻意的基础类型；统一必须和授权边界一起设计。
> 4. **"`ProviderDefinition` 改 re-export"** —— 漏了手写版独有的 `sortName?: string`（types/provider.ts:35），直接替换会让排序退化；另外 `codexAutoImportStarted` 不应机械改 `useRef`，8 处 Escape 也不能集中成全局处理器。
>
> 后续以 `REFACTOR-PLAN-FOR-AI.md` 的约束为准。

1. **两处 CI 检查当前就红**（不是代码烂，是校验常数没跟着改）
2. **三段确凿的复制粘贴**（已 diff 确认）
3. **几个 2000–3600 行的巨石文件**
4. **覆盖层/弹出层逻辑横跨两个特性区重复 13 处**
5. **IPC 边界类型裸字符串化**（Rust 侧 17 处字面量 vs TS 侧 26 变体严格联合）
6. **34/50 个测试脚本是孤儿**（制造覆盖假象）

---

## 1. 度量基线

| 指标 | 数值 |
|---|---|
| `src/` 总行数 | 53,073 |
| 最大文件 | `TextEditor.tsx` 3,612 行 |
| locale 数 | 9（ar, de, en, es, fr, ja, pt, ru, zh-CN） |
| 各 locale 键数 | 761（**完全同步**） |
| `console.*` 渲染进程残留 | 74 处 |
| ts-rs 生成类型 | 53 个 |
| npm script | 22 个 `test:*` |
| `scripts/test-*` 脚本总数 | 50 |
| 其中孤儿（无任何 npm script 引用） | **34** |
| Rust 最大文件 | `src-tauri/src/agents/runtime.rs` 2,327 行 |

### 1.1 复杂度热点 Top 10（`src/`）

| # | 行数 | 文件 | 一句话诊断 |
|---|---|---|---|
| 1 | 3,612 | `lightweight-office/editors/TextEditor.tsx` | 组件本体 2979 行；52 useState / 81 useCallback；混 6 组模块级职责 |
| 2 | 2,482 | `lightweight-office/editors/ExcelEditor.tsx` | fortune-sheet 集成为主，dirty 追踪提及 40 处 |
| 3 | 2,071 | `lightweight-office/editors/PdfViewer.tsx` | 自管像素缩放 + 标注状态机 |
| 4 | 1,979 | `lightweight-office/editors/PresentationViewer.tsx` | pptx 渲染 + 动画 |
| 5 | 1,349 | `lightweight-office/editors/CodeEditor.tsx` | monaco 集成 |
| 6 | 1,184 | `lightweight-office/pdf/mupdf.worker.ts` | **结构良好**，~50 个小函数 + 单分发入口，不是屎山 |
| 7 | 1,157 | `lightweight-office/word-toolbar-i18n.ts` | 第二套并行 i18n 机制 |
| 8 | 996 | `lib/provider-search-aliases.ts` | 与 178-provider catalog 并行的第二张表 |
| 9 | 895 | `lightweight-office/editors/NotepadCommandBar.tsx` | 命令栏 |
| 10 | 822 | `lightweight-office/components/PdfToolbar.tsx` | 工具栏 |

### 1.2 hooks 使用密度（巨石的证据）

| 编辑器 | useState | useEffect | useCallback | useMemo |
|---|---|---|---|---|
| TextEditor | **52** | 15 | **81** | 9 |
| PdfViewer | 30 | 15 | 43 | 2 |
| PresentationViewer | 27 | 18 | 25 | 3 |
| CodeEditor | 11 | 12 | 18 | 2 |
| ExcelEditor | 5 | 13 | 6 | 0 |

> ExcelEditor 的低 useState 是反例说明：状态藏在 fortune-sheet 实例里，不代表简单。

### 1.3 `console.*` 分布（74 处）

| 目录 | 处 |
|---|---|
| `src/lightweight-office/editors` | 30 |
| `src/components/agent` | 13 |
| `src/`（根） | 7 |
| `src/lightweight-office`（根） | 6 |
| 其余 8 个目录 | 各 1–3 |

---

## 2. 发现详表

每条给出：**位置 / 证据 / 影响 / 风险 / 修复方向**。风险评级针对"修复"本身。

---

### A. 复制粘贴（三段，均已 diff 核实）

#### A1. 下拉弹出层 ~105 行逐字复制

**位置**
- `src/components/agent/CollaborationConfigDialog.tsx:162-271`
- `src/components/agent/AgentProviderPicker.tsx:62-166`
- 第三变体（简化版）：`src/components/agent/AgentList.tsx:100-114`

**证据**（我实际跑的 diff，两块代码 105 行 vs 110 行）

diff 只有 60 行差异，且全部是改名和常量：

```
8c11   < Math.max(triggerRect.width, 256),      > Math.max(triggerRect.width, 280),
23,24c26,27  < const close = useCallback(...)   > const closeDropdown = useCallback(...)
29,31c32,34  < const show = useCallback(...)    > const openDropdown = useCallback(...)
37c40  < if (!open) return                       > if (!dropdownOpen) return
```

复制的内容：`updatePosition`（视口钳位定位，含 `VIEWPORT_PADDING`/`POPUP_GAP`）、open/close、`useLayoutEffect` 的 rAF 定位 + 聚焦块、一个大 `useEffect` 注册 **capture 阶段**的 `pointerdown`/`keydown`/`focusin` + `resize`/`scroll` 监听并清理、以及 `focusOption`/`handleOptionsKeyDown` 的箭头漫游（ArrowUp?ArrowDown?Home?End）。

**影响**：修一个 bug 必须改两处，且第三处已经漂移成更简的变体（只有 pointerdown + Escape，没有 focusin/resize/scroll）。

**风险**：中。焦点管理 + capture 阶段监听是最容易无声回归的地方，且**没有自动化测试覆盖**。

**修复方向**：抽 `src/hooks/use-popover.ts`，参数化最小宽度（256/280）与锚元素。**这是移动，不是重设计**——先写一个 Playwright spec 覆盖 ArrowDown→Enter / Escape / 框外点击，再迁移。

---

#### A2. 模型显示名三套实现（含一个用户可见 bug）

**位置**
1. `src/lib/agent-model.ts:7-35` — 最新的规范版（`stripCustomPrefix` / `humanizeModelId` / `modelDisplayName`）
2. `src/components/agent/CollaborationConfigDialog.tsx:90-97` — `getCleanModelName`，**兜底返回原始 id**
3. `src/components/agent/AgentList.tsx:19-50` — 第三套，**功能最强**：取路径末段、带 `MODEL_TOKEN_NAMES` 缩写表（api/coder/code/gemini/glm/gpt/kimi/llama/minimax/mimo/qwen，:19-31）、`modelLabels` memo（:64-82）还有跨 provider 的 `byModelId` 兜底

provider 标签也两套：`CollaborationConfigDialog.tsx:99-107` vs `AgentList.tsx:92-95`（自定义 provider 判定方式不同：一个查 name 前缀、一个查 id 前缀）。

**证据**（三套实现的差异，已逐行读过）

| 实现 | 输入 `deepseek-chat` | 输入 `custom-uuid/doubao-pro` | 缩写表 | 跨 provider 兜底 |
|---|---|---|---|---|
| `agent-model.ts` | "Deepseek Chat" | "Custom uuid Doubao Pro" ✗ | 无 | 无 |
| `CollaborationConfigDialog` | **`deepseek-chat`** ✗ | `doubao-pro` ✗ | 无 | 无 |
| `AgentList` | "Deepseek Chat" | "Doubao Pro" ✓ | ✓ | ✓ |

**影响**：**用户可见的不一致**——同一个 agent，配置对话框里显示 `deepseek-chat`，协作聊天里（`CollaborationChat.tsx:75` 用 `modelDisplayName`）显示 "Deepseek Chat"。同一个正则 `/^custom-[a-f0-9-]+\//i` 在三个文件里各写一遍。

**风险**：中（改的是用户可见字符串）。

**修复方向**：**合并而非删除**——把 `AgentList` 的缩写表、末段路径逻辑、跨 provider 兜底**并入** `agent-model.ts`，让 `humanizeModelId` 成为三者的超集，然后两个调用点改调共享版。provider 标签的自定义判定统一成 **id 判断**（name 判断会误伤把 provider 命名为 "Custom GPT" 的用户）。

---

#### A3. Rust `run-complete` 事件块逐字节重复

**位置**
- `src-tauri/src/agents/runtime.rs:937-948`（在 `run_multi_agent_task`）
- `src-tauri/src/agents/runtime.rs:1033-1044`（在 `run_directed_agent_task`）

**证据**（我实际跑的 diff，两块完全相同）

```rust
let mut complete = AgentCollaborationEvent::new(run_id, "run-complete");
complete.content = Some(serde_json::to_string(
    &results.iter().map(|result| json!({
        "agentId": result.agent_id,
        "response": truncate_chars(&result.response, 4096)
    })).collect::<Vec<_>>(),
)?);
runtime.emit_event(window, &complete)?;
```

另有近乎相同的 `run-start` / `task-created` 对：`runtime.rs:808-815` 与 `:989-994`。

**影响**：多智能体编排的两条主路径共享序列化逻辑但没有共享实现，改一处忘另一处会产生隐蔽的行为分叉。

**风险**：低中。行为保持的纯抽取，且 cargo test 全覆盖（Rust 侧无 `unsafe`，`unwrap`/`expect` 全在 `#[cfg(test)]`，移动不会藏住潜在 panic 点）。

**修复方向**：抽 `emit_run_complete(run_id, results)` / `emit_run_started(...)` / `emit_task_created(...)` 到新的 `events.rs`，两处改调包装。

---

### B. 巨石文件

#### B1. `TextEditor.tsx`（3,612 行，全项目最严重）

**证据**

- 组件函数 `TextEditor` 从 **:634 一直延伸到 :3612，本体 2979 行**。
- 内部 **52 个 `useState`、81 个 `useCallback`、15 个 `useEffect`、9 个 `useMemo`**。
- Props 接口 `TextEditorProps`（:381-395）**只有 10 个 prop，很干净**——所以问题**不是 prop 钻取，是组件内部体量**。
- 组件之上还混了 6 组模块级职责（都有独立命名空间，可干净搬走）：

| 职责 | 行范围 | 内容 |
|---|---|---|
| markdown 序列化 | :87-378 | `markdownBodySerializer`(TurndownService)、`renderNotepadMarkdown`、`serializeMarkdownBodyRegion`、`serializePlainTextBodyRegion` 等 |
| 表格行编辑/选择 | :238-378 | 11 个函数：`focusAdjacentTableCell`、`markTableRowInsertTarget`、`markTableSelected`、`markTableRowRangeSelected`、`insertTableRowAfter`… |
| 缩放锚定 | :470-531 | 4 个常量（`NOTEPAD_MIN_ZOOM`/`MAX_ZOOM`/`ZOOM_STEP`/`WHEEL_ZOOM_IDLE_MS`）+ `clampNotepadZoom`/`applyNotepadTextZoom`/`restoreNotepadZoomAnchor` |
| 打印模板 | :536 | `expandPrintTemplate` |
| 转义助手 | :564-572 | `escapeNotepadLinkText` / `escapeNotepadLinkAttribute` |
| **内联手写 `Modal` 组件** | :576-620 | 全项目无共享 Modal（见 G） |

**影响**：任何记事本相关改动都要在 3000 行里定位上下文；diff 审查几乎不可行。

**风险**：中高，但**以纯移动为主**——这些函数命名清晰、边界干净，搬出去几乎不改逻辑。

**修复方向**：沿上表断层切成 `notepad-markdown.ts` / 表格逻辑（注意已有同名的 `notepad-tables.ts` 17835 字节，评估能否直接并入）/ `notepad-zoom.ts` / 打印模板；内联 `Modal` 换共享 Overlay（见 G）。组件本体再按输入区/预览区/历史栈拆。

---

#### B2. `runtime.rs`（2,327 行）

**证据**：混 5 个职责——运行态/文档通道状态机、聊天编排、多智能体编排、委派、**约 700 行附件抽取**。长函数：`run_agent_chat`(:538-746, 209 行)、`run_multi_agent_task`(:748-951, 204 行)。附件管线从 `render_attachment`(:1563-1705，单函数 143 行) 一直延伸到 `escape_xml`(:1707-2106)。

**拆分表**（沿已有符号边界切）：

| 新模块 | 搬移内容（当前 runtime.rs 行） | 约行数 |
|---|---|---|
| `attachments.rs` | `render_attachment`(1563-1705) + 附件管线到 `escape_xml`(1707-2106) + `MAX_ATTACHMENT_*` 常量(45-52) + `AttachmentSession`/`selected_attachment_part`/`natural_part_order`/`display_part_name` | ~750 |
| `orchestration.rs` | `run_agent_chat` / `run_multi_agent_task` / `run_directed_agent_task`(970-1051) / `execute_delegation`(1052-1177) / `resolve_delegation_target` / `delegation_protocol_text` / `DelegationCounters` / `AgentExecutionContext` / `collaboration_is_directed` | ~750 |
| `chat_context.rs` | `build_provider_messages` / `validate_agent` / `validate_messages` / `portable_chat_context` / `parse_tool_calls` / `build_document_command` / `required_string` | ~300 |
| `events.rs` | `map_document_event_type` / `truncate_chars` / `ensure_json_size` / `normalized_id` / `attachment_signature` / 协议常量（见 A3） | ~150 |
| `runtime.rs`（剩余） | `AgentRuntime` struct + impl + 运行态/文档通道 + `ActiveRun`/`PendingDocumentCommand` | ~400 |

**共享状态约束**：`AgentRuntime` 的字段（附件缓存、活动运行、文档通道）被编排和附件代码共用。解法：`impl AgentRuntime` 留在 `runtime.rs`，大函数作为**自由函数**移到兄弟模块、接收 `&AgentRuntime`/`&mut AgentRuntime`/已有的 `AgentExecutionContext<'a'>`（明显就是为此引入的）。字段标 `pub(crate)`。

**风险**：中。2327 行搬运，但编译器 + `cargo test` 完全覆盖。

---

#### B3. Agent 模块的 god components

| 文件 | 行数 | 证据 |
|---|---|---|
| `ProviderSettings.tsx` | 794 | 最大的非编辑器组件；provider 列表 + 增删改表单 + 模型筛选 + 自定义 provider 向导全在一起 |
| `AgentChat.tsx` | 626 | 内联 ~95 行 `STARTER_PROMPTS` 多语言表（:66-160） |
| `CollaborationConfigDialog.tsx` | 582 | 表单 + 自定义下拉 + 定位 + 键盘导航（A1 的宿主之一） |
| `AgentSidebar.tsx` | 501 | 8 个 useState + ~20 个 store 字段 + 10 个 handler；`handleSend`(:133-204) 72 行内**三个近似重复的 assistantMessage 分支**（:28-34、:37-44、:56-62，结构完全相同：构造消息 → `completeAssistantStream` → `persistConversation`）；向 `AgentChat` 传 **~18 个 props**（:427-459）；模块级可变单例 `let codexAutoImportStarted`（:25） |

**`AgentSidebar.tsx` 的 exhaustive-deps 两个 wart**（已核实）：
- app-menu effect（:308-321）依赖数组列了 `handleMultiAgent` 但函数体从未使用它 → 无意义的重复注册
- `handleMultiAgent` 的依赖数组（:274）**漏了它实际调用的 `setCollaborationMode`**

**风险**：中（`handleSend` 在每次聊天的关键路径上）。

---

#### B4. `buildCollaborationTranscript` 的 251 行单 switch

**位置**：`src/lib/collaboration-transcript.ts:106-356`

**证据**：一个 switch 套嵌分支，覆盖 16 个 case（已 grep 核实）：`run-start`、`task-created`、`task-assigned`、`agent-start`、`agent-stream`、`agent-message`/`agent-question`/`agent-answer`（合并）、`agent-delegated`、`agent-tool`、`document-operation-applied`/`-rejected`、`handoff`、`conflict`、`run-complete`、`run-cancelled`、`error`。`agent-message` 分支（:231-264）用了对非局部 `lastKey` 的 `!` 非空断言（:242,251,260），而 `lastKey` 来自可能返回 undefined 的 `Map.get`。

**风险**：中（纯逻辑、规范明确，但 26 种事件类型的排序规则很微妙）。

**修复方向**：改分发表 `Partial<Record<AgentCollaborationEventType, (event, ctx) => InternalItem[]>>`，每事件类型一个小函数 + 共享 ctx（携带 `agents`/`mode`/运行 uid/每说话者状态）。**导出签名和输出形状严格不变**（纯 reducer，用 golden 测试锁死）。动它之前必须先有 ≥10 个 golden case 覆盖 merge/dedupe 交互。

---

### C. IPC 边界的类型裸字符串化

**证据**

TS 侧是严格的 26 变体联合（`src/types/agent.ts:71-97`）。Rust 侧我 grep 出 **17 处**裸字符串事件构造：

```
runtime.rs:307 "error"          :315 "run-cancelled"
:349  "document-operation-prepared"   :410 "document-operation-rejected"
:597  "agent-start"     :609 "agent-stream"     :627 "agent-message"
:701  "agent-tool"      :741  "agent-complete"
:808  "run-start"       :811  "task-created"     :819 "task-assigned"
:890  "handoff"         :937  "run-complete"
:989  "run-start"       :992  "task-created"     :1033 "run-complete"
:1106 "agent-delegated"
```

同问题的两个近亲：
- `collaboration_is_directed`（runtime.rs:956-964）靠解析 `Option<&str>` 判断模式；`AgentRunTaskRequest.mode` 类型是 `Option<String>`（models.rs:34-35）
- `map_document_event_type`（runtime.rs:2064-2077）返回 `Option<&'static str>`，未知类型走 `_ => None`

> ⚠️ **修正（重要）**：我最初把 `_ => None` 描述成"静默吞错"。**这是错的**。调用方 runtime.rs:283-285 处理了 None 分支，返回 `AppError::invalid("Unknown Agent document event type")`；且 runtime.rs:2164 有测试明确断言 `map_document_event_type("unexpected") == None`。所以这不是 bug，是有意的容错设计。改成 `Result` 的理由只能是"类型表达更清楚"，不是"修一个静默丢失"。

**影响**：Rust 侧打错一个事件名字符串，编译器不会报，只能靠运行时错误兜底（会报，但只在调用到那条路径时）。这是 IPC 边界值得类型化的原因，但严重性低于我最初的判断。

**风险**：中高（动 IPC 边界；`mode` 字段穿过 Tauri，ts-rs 会重生成 `AgentRunTaskRequest.ts`，`check:generated` 会标记漂移，必须重生成并提交）。

**修复方向**：`events.rs` 加 `AgentEventType` 枚举（或常量模块，如果不想做 enum→`as_str` 转换），17 处构造统一走它；`mode` 改 `CollaborationMode` 枚举；`map_document_event_type` 的 `_ => None` 改成 surfacing（返回 `Result` 或记日志）。wire 格式保持字符串只类型化 Rust 侧，或干脆重生成类型——**倾向后者，这才是 ts-rs 的意义**。

---

### D. API 元数陷阱

**位置**：`src/types/desktop-api.ts:225-239`（已逐字读过）

```ts
chat: (
  agentId: string,
  messages: ChatMessage[],
  conversationId: string | undefined,
  runId: string,
  onEvent: (event: AgentCollaborationEvent) => void,
) => Promise<...>

runTask: (
  agentIds: string[],
  task: string,
  runId: string,
  rootAgentId: string | undefined,
  mode: CollaborationMode,
  onEvent: (event: AgentCollaborationEvent) => void,
) => Promise<...>
```

**证据**：`chat` 5 个位置参数、`runTask` 6 个；且 `runTask(task, runId, rootAgentId, mode)` 的顺序与 `chat` 的 `(messages, conversationId, runId)` **不一致**。调用点：`AgentSidebar.tsx:148-154` 与 `:242-249`。两个函数都返回 `{ runId, result }`，都收 `onEvent`，但参数排列互不相同——纯靠记忆区分。

**风险**：低中（机械化改动，TS 编译器端到端检查，会自动找出所有调用点）。

**修复方向**：两个都改成单一 options 对象：`chat({ agentId, messages, conversationId, runId, onEvent })` / `runTask({ agentIds, task, runId, rootAgentId, mode, onEvent })`。在 `transport.ts`（唯一的 `@tauri-apps/api` 站点）边界处重塑参数，**不改变跨 IPC 的内容**。

---

### E. 类型漂移与重复形状

| 位置 | 证据 | 影响 |
|---|---|---|
| `src/types/file.ts:1-7` 手写 `FileEntry` | 缺 `grantId`；生成的 `generated/FileEntry.ts` 有：`{ name, path, grantId, isDirectory, size, modifiedAt, extension }`。**但**：`desktop-api.ts:92` 定义 `GrantedFileEntry = FileEntry & { grantId: string }`，被 `files.list`/`files.search`（:132,135）使用 | **不是简单的漂移**——手写 `FileEntry` 是刻意的基础类型，`grantId` 由 `GrantedFileEntry` 承载。改不得盲目替换，要和授权边界一起设计 |
| 四份 `ProviderDefinition` | Rust struct（`providers/store.rs:53`）/ ts-rs 生成 / 手写（`types/provider.ts:22-39`）/ wire 版（`provider-contract.ts:14`）；`fromProviderDefinitionWire`（:53-71）是 **13 字段手抄循环**，我逐字读过：`id, name, api, npm, doc, env, protocol, models, defaultModel, defaultApi, isApiOverridden, isCustom, isLocal`。**但**：手写版有生成版没有的 `sortName?: string`（`types/provider.ts:35`），用于前端排序 | 任何字段增删要同步改 4 处；**不能改 re-export 生成版**，否则排序功能退化 |
| 扩展名列表跨 IPC 重复 | `lightweight-office/utils/file-io.ts:8-25` vs `src-tauri/src/files/operations.rs:19-23` 与 `dialogs.rs:25-30` | 两边各自维护 |
| 第二张 provider 表 | `lib/provider-search-aliases.ts`（996 行）与 178-provider catalog 并行；`provider-order.ts:12-15` 硬编码 `alibaba: 'T'` 特例 | 靠 `check-provider-search.ts` 守着 |

---

### F. i18n

**好消息**：9 个 locale 的键树**完全同步，各 761 键**（运行时验证，零缺失/零多余）。术语质量检查是真的（替换字符、`…`、debug 日志文本、过期的 ` MB)` 片段、法语弯撇号、30% 复制率上限——实测 fr 最差 33/761 = 4.3%）。

**坏消息 1：`check:i18n` 当前报错（实测）**

```
$ npm run check:i18n
Error: Expected 739 translation keys, received 761.
    at scripts/check-i18n.ts:217
```

工作树给 9 个 locale 都加了 22 个协作键，但 `check-i18n.ts:217` 的硬编码期望值 `739` 没更新。**CI 在这个分支上是红的。** 而 :219-224 的逐 locale 键比较才是真正有效的校验，那个数字断言是多余的安全带，每次加键都会断。

同文件 :52 的 `expectedCodes` 与 `i18n/types.ts:17` 的 `languages` 重复（有同步断言所以会响，不会静默）。

**坏消息 2：组件内硬编码多语言表**

`CollaborationConfigDialog.tsx:38-60` 在一个所有其他字符串都走 `t()` 的组件里，硬编码了两张 9 语言表（我逐字读过）：

```ts
const AGENT_SEARCH_PLACEHOLDER: Record<LanguageCode, string> = {
  'zh-CN': '搜索 Agent...', en: 'Search agents...', ja: 'エージェントを検索...', ...
}
const AGENT_SEARCH_EMPTY: Record<LanguageCode, string> = { ... }
```

**坏消息 3：第二套并行 i18n 机制** —— `word-toolbar-i18n.ts`（1,157 行）在主翻译树外手维护 53 个工具栏键 × 9 语言（:80 `WORD_TOOLBAR_TEXTS` + 另外 4 张 per-locale 表，:78 的注释明确说故意不并入主树）。它能跑，也有自己的测试（`test:word-toolbar-i18n`），但这是重复的本地化机制。

---

### G. 覆盖层/弹出层逻辑横跨两个特性区重复

**这是 A1 的延伸，也是唯一横跨 agent 与 office 两个特性区的重复。**

**证据**

手写的 fixed overlay / Modal 散落在 5 个文件：`TextEditor.tsx:576`（内联 `Modal`）、`CodeEditor.tsx`、`NotepadSettingsPage.tsx`、`PresentationEditDialog.tsx`、`PresentationViewer.tsx`。

`key === 'Escape'` 关闭逻辑在 **8 处**各自实现：`CodeEditor`×1、`ExcelEditor`×2、`PdfViewer`×2、`PresentationEditDialog`×1、`PresentationViewer`×2、`TextEditor`×2。

**关键反讽**：`@radix-ui/react-dialog` 装在依赖里（实测 `grep -rn "react-dialog" src tests` **零引用**），其余 6 个 Radix 包各只对应一个 `src/components/ui/*` 文件。**基元买好了但没用，各处手写。**

**修复方向**：A1 的 `use-popover.ts` 之外，**另开一个 Overlay 评估，不是一次性替换**：先盘点 AgentConfig / ProviderSettings / CollaborationConfig / TextEditor / PresentationEditDialog / SaveConfirmDialog / 文件管理器现有对话框的语义，选**一个**真实重复的基础行为做迁移，确认 focus / 背景点击 / Escape / z-index 后再扩大范围。

> ⚠️ **重要约束（修正我最初的过度主张）**：
> - **不要**把 8 处 Escape 集中到一个全局处理器——语义不同：PDF 的 Escape 是取消标注状态、Presentation 的是退出放映、保存确认框的是取消对话框。共享的只能是"基础覆盖层容器"，不是"Escape 语义"。
> - **不要**因为装了 radix-dialog 就立刻替换所有对话框：先比较 focus trap、背景点击、键盘快捷键、嵌套弹窗和样式要求。PDF 标注取消、PPT 退出放映、Excel 内嵌第三方 dialog 不应被通用 Overlay 接管。

---

### H. 缩放逻辑在 5 个编辑器里各写一套

**证据**：`utils/` 里没有缩放模块，每个编辑器自管（我 grep 了每个文件的缩放函数名）：

| 编辑器 | 实现 | zoom 提及数 |
|---|---|---|
| TextEditor | `clampNotepadZoom` / `applyNotepadTextZoom` / `restoreNotepadZoomAnchor` + 滚轮手势防抖 | 116 |
| PdfViewer | `clampZoom` + `isZoomInKey`/`isZoomOutKey`/`isZoomResetKey` | 45 |
| PresentationViewer | `setClampedZoom` | 37 |
| CodeEditor | `editorZoom` / `zoomPercent` + `zoomObserver` | 16 |
| ExcelEditor | `handleNativeZoomWheel` | 5 |

**重要约束**：**应用层不能统一**。按既有架构（PDF/页面布局自管像素宽度缩放，因为 CSS zoom 对百分比布局无效），各编辑器的"应用缩放"路径必然不同。**可共享的只有钳位 + 滚轮手势空闲去抖这一层**（`NOTEPAD_WHEEL_ZOOM_IDLE_MS` 模式）。

**修复方向**：只抽 `utils/zoom-clamp.ts`（钳位 + 滚轮去抖），**不要碰 apply 路径**。降级为"顺手做"。

---

### I. mupdf 层（结构良好，低优先级）

**证据**：`mupdf.worker.ts` 1,184 行，但**不是屎山**——~50 个小函数各司其职（`initializeMuPdf` / `requireDocument` / `withOperation` / `wrapText` / `applyTextAppearance` / `textLayerForPage` …），常量集中在 :21-29，单一分发入口 `handleRequest`（:987-1157），`postResponse` 在 :1157。`mupdf-protocol.ts` 与 `mupdf-client.ts` 都恰好 195 行，协议层紧凑。

若要拆，断层是：标注操作（:370-770）、文字层抽取（:825-951）、保存（:951-987）。**但当前可读性够用，列为可选。**

---

### J. 死代码与卫生

| 项 | 证据 | 处置 |
|---|---|---|
| `removeConversationSummary` | `agent.store.ts:138-142`，`grep -rn` 全 `src/` **零引用** | 删 |
| `@radix-ui/react-dialog` | `src/` + `tests/` **零 import** | 卸载，或用起来（见 G） |
| **34/50 个孤儿测试脚本** | 实测：不被任何 npm script 引用。含全部 8 个 `test-excel-*`、10 个 `test-notepad-*`、`test-office-shortcuts-catalog.mjs`、`test-ctrl-w-close-tab.mjs` 等 | 删或挪 attic；删前对照 `package.json` + `ci.yml` + 其他脚本的 `execFileSync` 确认 |
| 74 处 `console.*` | 见 1.3 分布 | 只在顺手改的文件里收，不做全量清扫 |
| 无单元测试框架 | 无 vitest/jest；全部是 ad-hoc `scripts/test-*` + 5 个 Playwright spec（19 个测试） | 见下方"明确不做" |
| `src/hooks/` 不存在 | 无自定义 hook 层 | 见 Phase 3 的准入门槛 |
| 供应链脆弱 | postinstall 跑 `patch-pptx-renderer.mjs` + 4 个 `patch:superdoc-*` 改 node_modules | 属供应链决策，不属重构 |

---

### K. 当前红的第二处 CI：provider logos

```
$ npm run verify:provider-logos
Unexpected provider logos: volcengine
```

**证据**：`src/assets/provider-logos/volcengine.svg` 存在；catalog（`src-tauri/resources/provider-catalog.json`）里没有 `volcengine` provider；工作树**有意**在 `src/lib/provider-logos.ts:46-53` 加了 `PROVIDER_NAME_ALIASES`，让自定义 provider（如火山方舟/Ark 端点）能解析到这个资产。但 `scripts/check-provider-logos.mjs:13-18` 的 `expectedIds = new Set(['ollama', ...catalogIds])` 把它判为"意外的资产"。

**修复方向（推荐）**：给 `sources.json` 加 `aliasAssets` 段（遵守同样的 provenance 要求：`officialColor`、`sourceType` /^official-/、`sourceUrl`、`pageUrl`、`assetFile`），脚本把 alias 资产 id 并入允许集并跑同样的校验；从 `provider-logos.ts` 导出 `ALIAS_ASSET_IDS` 让脚本读，让 manifest 和运行时解析器不会漂移。
**廉价替代**：删 svg + 回退别名——但丢掉工作树刻意加的功能，不推荐。

---

## 3. 分阶段重构计划

### 基线验证命令（每步前后都要绿）

```bash
npm run typecheck && npm run check:i18n && npm run check:providers && npm run check:generated
npm run test:web-canaries && npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

---

### Phase 0 — 修两处红的（今天，纯脚本，零运行时改动）

| 项 | 改动 | 风险 | 验证 |
|---|---|---|---|
| **0a** `check:i18n` | `check-i18n.ts:217` 删掉硬编码 739；结构校验（:219-224 逐 locale 键比较）已足够，想要正检查就 `assert(englishKeys.length > 700)`；`:52` 的 `expectedCodes` 改为从 `i18n/types.ts:17` 的 `languages` 派生 | 低 | `check:i18n` 退出 0；故意加 1 个键确认不再误报 |
| **0b** provider-logos | `sources.json` 加 `aliasAssets` 段；脚本并入允许集并跑同样校验；`provider-logos.ts` 导出 `ALIAS_ASSET_IDS` | 低中 | `verify:provider-logos` + `check:providers` 绿；手动让"火山方舟"自定义 provider 图标可解析 |

---

### Phase 1 — 便宜的 readability 胜利（各自独立 commit）

| 项 | 改动 | 风险 | 验证 |
|---|---|---|---|
| **1a** | 删 `agent.store.ts:138-142` 的 `removeConversationSummary`（零引用） | 低 | typecheck + grep 无残留 |
| **1b** | `chat`/`runTask` 位置参数 → options 对象（C 节）；动 `desktop-api.ts`、`transport.ts` 边界重塑、两个调用点、相关 contract 测试 | 低中 | typecheck + `test:desktop-channel` + `test:web-canaries`。**必须先于 6b**（同文件） |
| **1c** | 消除非空断言：`collaboration-transcript.ts:242,251,260` 改存在性守卫；`CollaborationChat.tsx:117` 用类型守卫；`AgentList.tsx:103` 用 `instanceof Node` | 低 | typecheck（strict 开着，去掉 `!` 会暴露真洞） |
| **1d** | 修 `AgentSidebar.tsx` 两个 deps wart（:308-321 删无用依赖；:274 补 `setCollaborationMode`） | 低 | 手动走一遍 app-menu 发起协作 + `test:e2e` |
| **1e** | `scripts/verify-collaboration-transcript.mjs`（当前未跟踪、未接线）变成正式 npm script 并链进 `test:web-canaries`；**先补 3-4 个 golden case** | 低 | canaries 绿；**4a 的前置条件** |
| **1f** | `AgentChat.tsx:66-160` 的 `STARTER_PROMPTS` 抽到 `starter-prompts.ts`，类型为 `Record<LanguageCode, StarterPrompt[]>`。**先不并入 `t()` 树** | 低 | typecheck + 各语言下 prompt chips 渲染正常 |
| **1g** | `src/types/file.ts` 的手写 `FileEntry` 改 re-export 生成版；`npm uninstall @radix-ui/react-dialog`（若 G 选择手写 Overlay） | 低 | typecheck + `check:generated` |

---

### Phase 2 — 合并三套模型显示名（前端最高性价比）

修掉一个**用户可见**的不一致 + 消灭三份同一个正则。

| 项 | 改动 | 风险 |
|---|---|---|
| **2a** | 把 `AgentList.tsx` 的 `MODEL_TOKEN_NAMES`、`humanizeModelToken`、末段路径逻辑、跨 provider `byModelId` 兜底**并入** `agent-model.ts`；`humanizeModelId` 成为三者超集；`modelDisplayName` 签名不变；新增 `providerDisplayName`（自定义判定统一成 id 检查） | **中**（改用户可见字符串） |
| **2b** | 迁移 `CollaborationConfigDialog.tsx`：删 `getCleanModelName`（它的原始 id 兜底**就是那个可见 bug**）和 `getProviderLabel` | 低（2a 后） |
| **2c** | 迁移 `AgentList.tsx`：删本地 `humanizeModelId`/`humanizeModelToken`/`MODEL_TOKEN_NAMES`/`modelLabels`/`modelLabel`/`providerLabel` | 低（2a 后） |
| **2d** | （独立于 2a）`CollaborationConfigDialog.tsx:38-60` 两张硬编码表 → 9 个 locale 的新 `agent.search.*` 段 | 低 |

**防回归**：配 golden 名字脚本钉进 canaries，断言例如 `custom-uuid/doubao-pro` → "Doubao Pro"、`deepseek-chat` → "Deepseek Chat"、`qwen-max` → "Qwen Max"、`gpt-4o` → "GPT 4o"。

**验证**：typecheck + 名字脚本 + `test:e2e` + 肉眼比对 AgentList / 配置对话框 / 协作运行三处。

**依赖**：2a → 2b、2c；2d 独立。

---

### Phase 3 — 共享弹出层（A1 + G）

**`src/hooks/` 的准入门槛**：只有 **≥2 个组件会重复**的逻辑才配进 hooks 目录。全项目符合条件的就这一组（popover 定位/消散、outside-click+Escape、roving tabindex）。**不要**回溯性抽取只有单个组件用的 `useEffect`——hook 目录变成垃圾抽屉就是这么开始的。

| 项 | 改动 | 风险 |
|---|---|---|
| **3a** | 新建 `src/hooks/use-popover.ts`，合并 `CollaborationConfigDialog:162-271` 与 `AgentProviderPicker:62-166`，参数化最小宽度（256/280）与锚元素。**移动不是重设计** | 中 |
| **3b** | 依次迁移 `AgentProviderPicker` → `CollaborationConfigDialog` → `AgentList`（第三变体） | 低（3a 后） |
| **3c** | Overlay **评估**（G 节）：盘点 7 处现有对话框语义 → 选 1 个真实重复的基础行为迁移 → 确认 focus/背景点击/Escape/z-index 后才扩大。**不集中 Escape 语义，不强制 radix-dialog** | 低中（但需先调研） |

**前置**：**先加 Playwright spec** `tests/e2e/dropdown-keyboard.spec.ts`，覆盖 ArrowDown→Enter 选择、Escape 关闭、框外点击——这是该行为**唯一**的自动化兜底。

---

### Phase 4 — 协作 transcript 与 store

| 项 | 改动 | 风险 |
|---|---|---|
| **4a** | `buildCollaborationTranscript`（251 行 switch）改分发表，每事件类型一个小函数 + 共享 ctx；导出签名与输出形状**严格不变** | 中（**必须等 1e 有 ≥10 个 golden case**） |
| **4b** | 把 `agent.store.ts:178-203` 的 `agent-stream` 合并逻辑抽成 `src/lib/agent-stream-merge.ts`，让 transcript 通过函数调用而非注释依赖它（:104-105 的注释承认了这个耦合） | 中 |

**验证**：`verify:collaboration-transcript`（扩展后的 case）+ canaries + 一次真实协作运行（两种模式）。

---

### Phase 5 — 拆 `runtime.rs`（后端最大单点收益）

**顺序严格**，每步独立可发布：

| 项 | 改动 | 风险 |
|---|---|---|
| **5a** | 按 B2 的拆分表纯移动函数与常量到 `attachments.rs` / `orchestration.rs` / `chat_context.rs` / `events.rs`；`mod.rs` 加 `mod`；字段 `pub(crate)`。零行为变化 | 中（安全：编译器 + cargo test 全覆盖） |
| **5b** | `events.rs` 加 `emit_run_complete` / `emit_run_started` / `emit_task_created`（A3），两处调用点改调包装 | 低中 |
| **5c** | `events.rs` 加 `AgentEventType` 枚举，17 处裸字符串构造统一走它（C 节）；`AgentRunTaskRequest.mode` → `CollaborationMode` 枚举；`map_document_event_type` 的 `_ => None` 改 surfacing | **中高**（动 IPC 边界，需 `generate:types` + `check:generated`） |

**验证**：`cargo fmt --check && cargo clippy -D warnings && cargo test`；5c 后 `npm run generate:types && npm run check:generated`，diff 确认是预期改动再提交；`test:desktop-channel` + `test:provider-contract` + 两种模式各一次真实协作。

---

### Phase 6 — 拆 god components（放最后，重复逻辑已被 1b/2b/3b/3c 清掉）

| 项 | 文件 | 改动 | 风险 |
|---|---|---|---|
| **6a** | `TextEditor.tsx`（3612） | **第一优先**。按 B1 的 6 组职责搬出模块级函数；内联 `Modal` 换 3c 的 Overlay；组件本体再按输入/预览/历史栈拆 | 中高（纯移动为主） |
| **6b** | `AgentSidebar.tsx`（501） | `handleSend` 拆成 `buildAssistantMessage` + `handleChatError` + 薄编排（三分支合一）；~18 个 props 中已属 store 的改 `AgentChat` 内部 `useStore` 直选。**`codexAutoImportStarted` 保持模块级语义**——模块级变量保证模块生命周期内只导入一次，`useRef` 在组件重新挂载后会重置；若以后挪 store 必须加"重新挂载不重复导入"的测试 | 中（聊天关键路径） |
| **6c** | `CollaborationConfigDialog.tsx` | 做完 2b/2d/3b 后应已降到 ~350 行；剩余表单拆 `<AgentSearchField>`/`<RootAgentPicker>`/`<ModeSelector>` | 低中 |
| **6d** | `AgentChat.tsx` | 1f 抠掉 95 行表后，render 仍 >150 行再抽 `<MessageRow>`/`<StreamingIndicator>` | 低 |
| **6e** | `ProviderSettings.tsx`（794） | 按区块拆子组件。**先拆组件，状态归属推迟到 Phase 7** | 中高（覆盖低） |
| **6f** | 其余编辑器 | **本轮不做大拆**。只做 3c 的 Overlay 替换和顺手清理——体量大部分是引擎集成固有复杂度（fortune-sheet/superdoc/mupdf），不像 TextEditor 混了可搬走的纯逻辑 | 低 |

---

### Phase 7 — 边界卫生（排序，多数应推迟）

| 项 | 改动 | 风险 | 裁决 |
|---|---|---|---|
| `FileEntry` 漂移、未用依赖 | 见 1g | 低 | **现在做** |
| 34 个孤儿 `scripts/test-*` | 确认无引用后删除/挪 attic；删前列清单写进 commit message | 低 | **晚做**（Phase 5/6 后） |
| 四份 `ProviderDefinition` 统一 | 生成版为准，`types/provider.ts` 改 re-export，干掉 13 字段手抄循环。**必须先解决 `sortName` 归属**（生成版无此字段，见 E 节）——要么让 Rust 成为真实来源并生成它，要么保留明确的前端扩展类型 | 中 | **6e 之后**，且先定 `sortName` 归属 |
| 缩放钳位（H） | 只抽钳位 + 滚轮去抖到 `utils/zoom-clamp.ts`，**不碰 apply 路径** | 中 | **降级为顺手做** |
| 扩展名列表跨 IPC 重复 | 单一 JSON 资源两边共用 | 中 | **推迟**（当前能跑，漂移有 canaries 兜着） |
| 组件直接调 `desktopApi` 而非经 store | 全量改道 31 个 importer | 高 | **跳过**。传输层本身没问题；收益主要是化妆。机会主义地在 6b 里顺手改 |
| 74 处 `console.*` | 统一走 `src/lib/log.ts` | 低价值 | **推迟**，只在顺手改的文件里做 |
| postinstall patch 脚本 | — | 高 | **跳过**。真实脆弱但零可读性收益，属供应链决策 |
| `provider-search-aliases.ts` 并入 catalog | — | 高 | **跳过**，有 guard 守着，改 provider 数据时再说 |
| `word-toolbar-i18n.ts` 并入主 i18n 树 | 53 键 × 8 非英语 locale 要翻译 + 重写测试 | 高 | **跳过/另开 i18n 专项** |
| `mupdf.worker.ts` 拆分 | 按标注操作/文字层/保存切模块 | 低价值 | **暂缓**。结构良好，当前可读性够用 |

---

## 4. 明确不做的事（含理由）

1. **不引入 vitest**。50 个 ad-hoc 脚本 + 34 个孤儿，本身就是可读性问题，但加框架解决不了——改为：(a) 有价值的孤儿脚本接线或删掉，(b) UI 行为优先用 Playwright（见 3a），(c) 加一个约定检查：每个 `scripts/test-*` 必须被某个 npm script 引用。等 Phase 2/4 产出 ≥3 个共享 `src/lib` 模块后再考虑 vitest，届时 2a/1e 的 golden 脚本就是第一批迁移对象。
2. **不统一各编辑器的缩放 apply 路径**。架构上必须分立（CSS zoom 对百分比布局无效，PDF 自管像素缩放）。只共享钳位 + 去抖。
3. **不做 store 改道的大重构**。`desktopApi` 漏斗是干净的，问题被夸大了。
4. **不把 `word-toolbar-i18n.ts` 并入主 i18n 树**。翻译量 + 测试重写，性价比不成立。
5. **不碰 postinstall patch 脚本**。供应链决策，不是重构。

---

## 5. 依赖图

```
Phase 0（解锁 CI）── 无依赖
  ├─ 1a/1c/1f/1g（孤立清理）
  ├─ 1b（元数→对象）── 必须先于 6b
  ├─ 1e（接线上 transcript 测试）── 必须先于 4a
  ├─ 2a ──> 2b, 2c；2d 独立
  ├─ 3a ──> 3b（三次迁移）
  ├─ 3c（Overlay 基元）── 必须先于 6a
  ├─ 4a（后于 1e）──> 4b
  ├─ 5a ──> 5b ──> 5c（5c 重生成 TS 类型）
  ├─ 6a（TextEditor，后于 3c）；6b（后于 1b/1d/2b/3b）；6c（后于 2b/2d/3b）
  │        6e（后于 3b，先于 Phase 7 的 ProviderDefinition 统一）
  └─ 7：1g 随时；缩放钳位与 Overlay 替换随各编辑器顺手做；孤儿脚本晚做；
          ProviderDefinition 统一在 6e 后；其余按表推迟
```

**核心原则**：每个 phase 是一组独立 commit；**绝不要把 Rust 模块移动（5a）和前端行为改动混进一个 commit**——两套验证工具链不同，出问题无法归因。

---

## 6. 建议执行顺序

| 序 | 内容 | 收益 |
|---|---|---|
| 1 | 0a + 0b（两个 commit） | CI 转绿 |
| 2 | 1a + 1g（卫生批量） | 删死代码、卸未用依赖 |
| 3 | 1b → 1f → 1e | 位置参数消亡、腾出 95 行、接上安全网 |
| 4 | 2a → 2b → 2c → 2d | 修可见 bug + 消灭三份重复 |
| 5 | 3a（先加 Playwright spec）→ 3b → 3c | 消灭横跨两特性区的弹出层重复 |
| 6 | 5a → 5b → 5c | 后端最大单点可读性收益 |
| 7 | 1c + 1d | 类型与 deps 清理 |
| 8 | 4a → 4b | transcript 可读性 |
| 9 | 6a → 6b → 6c → 6d → 6e | 巨石拆分（TextEditor 最先） |
| 10 | 孤儿脚本 → ProviderDefinition 统一 | 收尾 |

---

## 7. 验证方式（端到端）

- **每一步后**跑第 3 节开头的那组基线命令。
- **手动回归点**（自动化覆盖不到的）：
  - 模型显示名在 AgentList / 配置对话框 / 协作运行**三处一致**
  - 两个下拉的完整键盘流：输入筛选、ArrowUp?ArrowDown?Home?End、Escape、框外点击、打开时滚动/缩放、焦点回到 trigger
  - 协作多 agent 两种模式（directed / parallel）各跑一次
  - 自定义 provider 增删改 + 图标解析（含"火山方舟"）
  - 一次完整聊天发送走通
- **lightweight-office 专项**：markdown 双向序列化（源码 ↔ 预览往返）、表格行插入/拖选、缩放后光标锚点不漂、打印模板展开、所有被替换的 Overlay（保存确认、设置页、演示编辑对话框）开关与 Escape
- **Phase 5c 后**必须 `npm run generate:types && npm run check:generated`，diff 确认是预期改动再提交
- **6a（TextEditor）的防回归手段**：先把函数**整体搬到**新模块（纯移动 commit），再改导入；每搬一组就跑一次 typecheck + 手动打开 `.md`/`.txt`/`.lrc` 文件验证往返。该文件自动化覆盖低，`git diff` 审查是主要质量门

---

## 附录 A：本次审计的核实记录

以下结论是我**亲自跑命令核对**过的，不是转述扫描结果：

| 结论 | 核实方式 | 结果 |
|---|---|---|
| `check:i18n` 报错 | 实际运行 `npm run check:i18n` | `Expected 739 translation keys, received 761` |
| `verify:provider-logos` 报错 | 实际运行 | `Unexpected provider logos: volcengine` |
| `check:providers` 也因 logo 检查失败 | 实际运行 `npm run check:providers` | 退出 1，失败段是 `verify:provider-logos` |
| A1 下拉复制 | `diff` 两段代码 | 60 行差异，全是改名 + 256/280 |
| A3 Rust 重复 | `sed` 抽出两段 | 逐字节相同 |
| A2 三套实现 | 逐行读三个文件 | 确认三套，且 `getCleanModelName` 兜底是原始 id |
| 孤儿脚本数 | 遍历 `scripts/test-*` 对照 `package.json` | 50 个中 34 个无引用 |
| `FileEntry` 漂移 | `cat` 两个文件 | 手写版缺 `grantId` |
| radix-dialog 未用 | `grep -rn "react-dialog" src tests` | 空输出 |
| `fromProviderDefinitionWire` 手抄 | 逐行读 | 13 字段逐个赋值 |
| 17 处 Rust 裸字符串事件 | `grep -n 'AgentCollaborationEvent::new(run_id, "'` | 17 处，行号见 C 节 |
| TextEditor 组件体量 | `awk 'NR>=634'` 计行 + grep hooks | 2979 行 / 52 useState / 81 useCallback |
| console.* 分布 | `grep -rn | uniq -c` | 74 处，分布见 1.3 |
| transcript switch case 数 | `grep -n "case '"` | 16 个 case |
| handleSend 三分支 | `sed` 抽出 grep | 三个结构相同的 assistantMessage 块 |
| mupdf worker 结构 | grep 顶层声明 | ~50 个小函数 + 单一 `handleRequest` 分发 |
| **修正：全仓库 unsafe** | `grep -rn "unsafe" src-tauri/src --include=*.rs` | 63 处，含 `converter.rs:1130/1239/1249/1264/1284` 生产代码 |
| **修正：map_document_event_type 不静默** | `sed -n '278,296p' runtime.rs` | None 分支返回 `AppError::invalid("Unknown Agent document event type")`；`:2164` 有测试 |
| **修正：sortName 独有** | grep `sortName` 三个类型文件 | 仅 `types/provider.ts:35` 有，生成版无 |
| **修正：GrantedFileEntry 存在** | grep `GrantedFileEntry` | `desktop-api.ts:92` 定义，被 `files.list`/`search` 使用 |

**未核实的**（仅来自扫描，执行前需复核）：ProviderSettings.tsx 内部区块边界、孤儿脚本中是否有人手动跑过、`sources.json` 的 provenance 字段完整列表。

**复核后撤销的结论**（见顶部修订记录）：全仓库无 unsafe、map_document_event_type 静默吞错、FileEntry 简单漂移、ProviderDefinition 可直接 re-export、codexAutoImportStarted 应改 useRef。

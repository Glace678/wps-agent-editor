# wps-agent-editor 重构执行计划

这份文档给负责实际改代码的 AI 使用。目标是改善可维护性，同时保持当前协作功能、PDF 功能、编辑器行为和 Tauri IPC 协议稳定。

## 0. 当前上下文

- 工作目录：`??????wps-agent-editor?`
- 当前分支：`codex/stability-hardening`
- 工作树已有未提交改动，包含 Agent 协作、PDF、provider logo、i18n 和测试相关文件。
- 不要重置、清理、覆盖或回滚这些已有改动。开始工作前必须先保存 `git status --short` 和 `git diff --stat`，结束时再次检查。
- 本计划只描述实施方案。执行 AI 需要逐阶段修改，并在每阶段结束后报告变更和验证结果。

## 1. 已验证基线

以下结果已经在当前工作树执行过，不能把它们当作理论假设：

| 检查 | 当前结果 | 解释 |
|---|---|---|
| `npm run typecheck` | 通过 | TypeScript 当前可以编译 |
| `npm run test:desktop-channel` | 通过 | 桌面通道生命周期契约通过 |
| `npm run test:provider-contract` | 通过 | provider wire 转换契约通过 |
| `npm run check:i18n` | 失败 | `check-i18n.ts` 仍要求 739 个键，英文 locale 实际有 761 个 |
| `npm run verify:provider-logos` | 失败 | `volcengine.svg` 存在，但未登记为 catalog provider 或合法 alias asset |
| `npm run check:providers` | 失败 | 失败原因是上面的 provider logo 检查 |
| `npm run test:web-canaries` | 尚未作为本轮完整基线执行 | 执行 AI 修改前后都要运行 |
| `npm run test:e2e` | 尚未作为本轮完整基线执行 | 需要可用的 Playwright 浏览器环境 |

当前可复核的规模数据：

- `TextEditor.tsx`：3612 行；按 TypeScript AST 统计约 51 个 `useState`、14 个 `useEffect`、80 个 `useCallback`、8 个 `useMemo`。
- `src-tauri/src/agents/runtime.rs`：2327 行。
- `src/lib/collaboration-transcript.ts`：356 行，其中主 reducer 有 16 类事件分支。
- `scripts/` 下共有 50 个 `test-*` 脚本，其中 34 个没有被 `package.json` 或 CI 文本直接引用。这个数字只能作为清理候选数，不能直接等同于“应删除数”。
- `src-tauri` 整体存在生产代码中的 `unsafe`；不能泛化说“Rust 侧没有 unsafe”。Agent runtime 本身可以单独检查，但不要把局部结论写成全仓库结论。

## 2. 总体原则

1. 先修复当前 CI 红项，再做可读性重构。
2. 每次只改变一个行为边界。纯移动、纯命名整理、接口形状调整、用户可见文本变化、IPC 类型变化必须分开。
3. 任何抽象都必须先证明至少两个调用点具有相同的行为契约。相似的代码外观不等于可以共享。
4. 保持 Tauri wire JSON 兼容。Rust 类型改动必须同步检查 serde 行为、生成 TS 类型和所有调用方。
5. 生成文件只通过仓库已有脚本生成，不能手改 `src/types/generated/`。
6. UI 重构必须保留焦点、Escape、框外点击、滚动定位、RTL、Portal 和 z-index 行为。
7. 发现与当前工作树不一致的报告数字时，以实际代码、脚本输出和测试为准，并在执行记录中注明。
8. 不要为了降低行数引入大量转发层、泛型配置或“万能” hook。减少重复必须带来更清晰的调用契约。

## 3. 明确不要做的事

- 不要重写整个前端、整个 Agent runtime 或任何编辑器。
- 不要把 PDF、PPT、Excel、代码编辑器和记事本的缩放应用路径强行统一。可以共享纯钳位函数，不能共享各自的像素布局和引擎适配。
- 不要把所有 `Escape` 监听器集中到一个全局处理器。PDF 的 Escape 是取消标注状态，Presentation 的 Escape 可以退出放映，保存确认框的 Escape 是取消对话框，它们语义不同。
- 不要因为安装了 `@radix-ui/react-dialog` 就立即替换所有现有对话框。先比较 focus trap、背景点击、键盘快捷键、嵌套弹窗和样式要求。
- 不要把 `map_document_event_type` 的 `None` 说成当前静默吞错。它的调用方已经返回 `Unknown Agent document event type` 错误。若改成 `Result`，理由只能是类型表达更清楚。
- 不要直接把 `AgentRunTaskRequest.mode: Option<String>` 改成普通 enum。当前代码接受缺省值、空白包围的 `directed`/`parallel`，并拒绝未知值；serde enum 默认行为可能改变这些语义。
- 不要直接把 `types/provider.ts` 替换成生成版。手写类型有 `sortName` 等前端字段，而生成版当前没有这个字段。
- 不要因为 `FileEntry` 缺少 `grantId` 就直接删除 `GrantedFileEntry`。先核对所有生产调用、store 数据来源和 API 返回契约。
- 不要把 `codexAutoImportStarted` 机械改成 `useRef`。当前模块级变量保证模块生命周期内只自动导入一次，`useRef` 在组件重新挂载后会重置，可能改变行为。
- 不要直接删除 34 个未接入命令的测试脚本。先分类、运行有价值的脚本、确认没有文档或其他脚本调用，再逐批处理。
- 不要全量清理 74 个 `console.*`。只在正在修改的文件中顺手处理，并确认日志对诊断仍有价值。
- 不要引入 Vitest/Jest 作为本轮前置工作。先把已有纯函数和 Playwright 检查接入现有命令链。
- 不要使用 `git reset --hard`、`git checkout --`、批量 `rm` 或覆盖用户已有改动。

## 4. 推荐执行顺序

### Phase 0：修复两个当前红项

这一步只改校验和清单，不改运行时逻辑。

#### 0A. i18n 检查

位置：`scripts/check-i18n.ts`。

当前失败是硬编码 739 与实际 761 不一致。推荐处理方式：

1. 确认 22 个新协作键确实已在 9 个 locale 中存在且非空。
2. 将基线从 739 更新为当前真实值 761，并在同一变更中说明这 22 个键的来源。
3. 保留“英文 key 数量”这一防止误删大量键的保护。不要简单删除断言，也不要用 `> 700` 这种宽泛阈值替代它。
4. `expectedCodes` 与 `languages` 的重复可以改成由 `languages` 派生，但必须保持 locale 文件列表和翻译注册表的检查。
5. 修改后运行 `npm run check:i18n`，再执行一次“临时改变一个 locale 键”的负向检查，确认缺键和多键仍会失败。负向检查结束后必须恢复测试改动。

#### 0B. provider logo 清单

位置：`src/assets/provider-logos/sources.json`、`scripts/check-provider-logos.mjs`、`src/lib/provider-logos.ts`。

当前 `volcengine.svg` 是为了自定义 provider 名称别名而加入的运行时资源，不是 catalog 中的 provider ID。推荐处理方式：

1. 在 `sources.json` 增加明确的 `aliasAssets` 区域，例如登记 `volcengine` 的 `assetFile`、`sourceUrl`、`pageUrl`、`sourceType` 和 `officialColor`。
2. checker 从 manifest 读取 alias ID，并把 alias ID 合并到允许集合；不要让 Node checker 去 import `provider-logos.ts`，因为其中使用了 Vite 的 `import.meta.glob`，不能作为普通 Node 模块运行。
3. alias 资产必须经过与普通 provider 相同的来源、文件名、SVG 安全和 provenance 校验。
4. 运行时可以继续使用 provider 名称别名；不要为了让 checker 通过而删除 `volcengine.svg` 或删除火山方舟别名功能。
5. 运行 `npm run verify:provider-logos` 和 `npm run check:providers`。

Phase 0 完成条件：两个红项变绿；`git diff` 只包含预期的脚本/manifest 变更。

### Phase 1：低风险清理和测试接线

每个小项单独提交或至少保持独立 diff。

#### 1A. 无引用 store action

核对 `removeConversationSummary` 在 `src/`、`tests/`、`scripts/`、命令生成文件中均无调用后，再删除其接口和实现。运行 `npm run typecheck`。

#### 1B. 给 chat/runTask 改用 options 对象

当前 `desktopApi.agents.chat` 有 5 个位置参数，`runTask` 有 6 个，调用顺序不一致。可以改为：

```ts
chat({ agentId, messages, conversationId, runId, onEvent })
runTask({ agentIds, task, runId, rootAgentId, mode, onEvent })
```

要求：

1. 同步修改 `src/types/desktop-api.ts`、`src/platform/desktop.ts`、所有调用点和桌面通道契约脚本。
2. transport 发给 Tauri 的 request JSON 必须保持不变。
3. 不要把这个小改动和 AgentSidebar 的状态重构放在同一 diff。
4. 运行 `npm run typecheck`、`npm run test:desktop-channel`、`npm run test:web-canaries`。

#### 1C. 消除可证明的不安全断言

优先处理 transcript 中 `Map.get` 后的非空断言。使用存在性守卫，并补一个“没有上一条 speech item”的测试。不要为了消灭 `!` 而改变 reducer 的合并规则。

`CollaborationChat` 和 `AgentList` 中的 DOM 类型判断也要以实际运行环境为准。对 `event.target` 使用 `instanceof Node` 前，确认测试环境和浏览器环境都提供 `Node`。

#### 1D. 修正 AgentSidebar effect 依赖

可以删除 app-menu effect 中未使用的 `handleMultiAgent` 依赖。`setCollaborationMode` 是 React `useState` setter，引用稳定；不要仅为了“补全依赖”改变闭包结构。修改后至少走一次 app-menu 发起协作和普通新建 Agent 流程。

#### 1E. 接入协作 transcript 检查

现有 `scripts/verify-collaboration-transcript.mjs` 未接入 npm script。建议：

1. 先把它改名或包装成清晰的 `test:collaboration-transcript` 命令。
2. 增加至少 10 个 golden case，覆盖：空事件、任务行、typing 收束、同 operationId 合并、连续同 Agent 两轮消息、tool-only 消息、半截 tool fence、delegation、run-cancelled、error、身份回填和 clusterHead。
3. 断言输出类型、顺序、文本和隐藏项，不只断言“脚本退出 0”。
4. 接入 `test:web-canaries`，但不要把真实网络模型调用放进 canary。

#### 1F. 抽出 STARTER_PROMPTS

将 `AgentChat.tsx` 中的多语言 prompt 表移到独立模块，保留 `Record<LanguageCode, StarterPrompt[]>` 类型。先不改成 `t()` 动态翻译树，避免把纯数据迁移和 i18n 翻译重写混在一起。

#### 1G. FileEntry 和 Radix 依赖只做调查，不自动执行

`FileEntry` 是否改为生成版需要先检查所有 file manager store 和测试数据是否总有 `grantId`。如果没有完整证据，就保留当前类型，单独记录后续任务。

`@radix-ui/react-dialog` 是否卸载取决于 Phase 3 是否决定使用它；不要在 Phase 1 提前卸载。

### Phase 2：统一模型和 provider 显示名

这是当前前端最值得做的用户可见修复，但必须先写 golden case。

#### 2A. 设计共享显示规则

共享模块：`src/lib/agent-model.ts`。

推荐规则：

1. 有 provider catalog 且 `model.name` 有效、且不只是重复 ID 时，优先显示 catalog 名称。
2. 只对符合 `custom-<hex UUID>/` 形式的前缀执行剥离；不要用 `custom-uuid` 这种不符合约定的样例证明行为。
3. 无 catalog 命中时取模型路径的最后一段，再执行 token 格式化。
4. 保留 `GPT`、`GLM`、`Qwen`、`Kimi`、`Llama`、`MiniMax`、`MiMo` 等已存在的缩写规则，并测试数字版本。
5. 跨 provider fallback 只能在模型 ID 唯一对应同一显示名时使用；若不同 provider 对同一 ID 有不同名称，必须优先 provider 精确匹配。
6. provider 显示名优先使用真实 `ProviderDefinition.name` 和 `isCustom`，ID 前缀只作为缺少定义时的兜底。

至少测试：

```text
deepseek + deepseek-chat                  -> DeepSeek Chat（命中 catalog）
custom-01234567-89ab-cdef-0123-456789abcdef/doubao-pro -> Doubao Pro
qwen-max                                  -> Qwen Max
gpt-4o                                    -> GPT 4o 或 catalog 名称
provider 未命中 + foo/bar_model_2         -> Bar Model 2
两个 provider 同 ID 但不同名称            -> 使用精确 provider 名称
model 为空                                -> 保持当前 Default/空值语义
```

#### 2B/2C. 迁移两个调用点

迁移 `CollaborationConfigDialog` 和 `AgentList`，删除各自重复的 humanize 逻辑。迁移后必须用真实 provider 列表和空 provider 列表都测试，不能只看静态类型通过。

### Phase 3：只抽取真正相同的下拉逻辑

`AgentProviderPicker` 和 `CollaborationConfigDialog` 的 Portal、视口钳位、focusin、capture 阶段 outside click、Escape、????Home?End 行为高度相似，可以考虑抽 `use-popover.ts`。

要求：

1. 先写测试，覆盖 ArrowDown -> Enter、ArrowUp、Home、End、Escape、框外 pointerdown、框外 focusin、resize、scroll 和关闭后恢复 trigger focus。
2. hook 只负责共享机制，保留各组件自己的筛选数据、渲染内容、ARIA 文案、最小宽度和最大高度。
3. `AgentList` 当前是简单的相对定位下拉，没有搜索框和同样的 roving focus 机制。不要强制把它塞进同一个 hook；只有实际行为契约对齐后才迁移。
4. `useLayoutEffect`、Portal 和 `visibility: hidden` 的首次定位行为必须保持。

Overlay 处理另开评估：

- 先盘点 AgentConfig、ProviderSettings、CollaborationConfig、TextEditor、PresentationEditDialog、SaveConfirmDialog 和文件管理器现有对话框的语义。
- 先选择一个真实重复的基础行为做迁移，确认 focus、背景点击、Escape 和 z-index 后再扩大范围。
- PDF 标注取消、PPT 退出放映、Excel 内嵌第三方 dialog 不应被通用 Overlay 接管。

### Phase 4：transcript reducer

只有在 Phase 1E 的 golden case 稳定后才做。

可选方案是把 16 个事件分支拆成带共享 context 的小处理函数。无论采用 switch 还是 dispatch table，都必须满足：

- `buildCollaborationTranscript` 导出签名不变。
- 输出 item 的 kind、顺序、key 生成顺序、隐藏逻辑和 clusterHead 结果不变。
- `agent-stream` 合并和 `agent-message` 收束规则不变。
- 未展示的生命周期事件仍然被忽略。

如果 dispatch table 需要大量类型断言，保留 switch 反而更安全。可读性重构不能以牺牲事件类型安全为代价。

### Phase 5：拆分 Agent runtime

先做纯移动，再做类型化；每一步都跑 Rust 检查。

#### 5A. 纯模块移动

候选模块：

- `attachments.rs`：附件渲染、压缩文档 XML 提取和 XML escape。
- `orchestration.rs`：chat/multi-agent/directed/delegation 编排。
- `chat_context.rs`：provider message 构建、上下文裁剪、tool call 解析和 document command 构建。
- `events.rs`：事件辅助函数、ID 规范化、JSON 大小和截断逻辑。

注意：

1. `AgentRuntime` 的缓存、活动运行和 pending document 状态不要为了拆文件而全部公开。优先通过 `pub(super)` 方法或接收 `&AgentRuntime` 的自由函数访问。
2. `AgentExecutionContext` 已经是较好的共享边界，优先复用它。
3. 每次只移动一个完整符号组，避免同时改生命周期、错误处理和事件顺序。
4. 编译器能发现很多引用错误，但不能保证事件顺序和取消时序不变，所以要保留/增加相关测试。

#### 5B. 事件辅助函数

可以提取 `run-start`、`task-created`、`run-complete` 的重复序列化，但先确认两个路径的字段差异：directed 的 `task-created` 带 root agent，parallel 的创建事件字段不同，不能只按文本重复就强行共用同一构造器。

#### 5C. 事件名和 mode 类型化

这是中高风险项，最后做：

1. 如果只想防止 Rust 内部拼写错误，先使用常量模块，保持 wire 结构不变。
2. 如果引入 `AgentEventType` enum，必须确认 ts-rs 生成的 `AgentCollaborationEvent.ts` 变化、前端 `AgentCollaborationEventType` 的兼容方式和所有 JSON 消费者。
3. 如果把 mode 改成 enum，必须保留缺省 directed、空白 trim 和未知值报错语义；为 serde 写明确测试。
4. `map_document_event_type` 的未知分支当前已经由调用方转换为错误，不要为了修复不存在的静默丢失而大改 IPC。
5. 生成类型只能运行 `npm run generate:types` 生成，再用 `git diff -- src/types/generated` 检查是否只有预期变更。

### Phase 6：按风险拆分大组件

#### 6A. TextEditor

优先只搬出组件外已有的纯函数和常量组：markdown 序列化、表格辅助、zoom clamp、打印模板、转义函数。每个模块迁移后立刻运行 typecheck，并手动验证 `.md`、`.txt`、`.lrc` 的打开、编辑、预览往返、表格编辑、查找替换和保存。

不要一开始就把组件内部所有 state 拆成多个 hook。组件内函数互相依赖很多，先完成纯移动，再根据真实边界决定是否拆输入区、预览区和历史栈。

#### 6B. AgentSidebar

可以把 `handleSend` 中的消息构造、错误消息和状态更新整理成小函数，但必须保留：

- streaming message 的合并和完成时机；
- conversation 持久化顺序；
- stopping 状态优先级；
- toolCalls 完成提示；
- finally 中清理 `isRunning`、`activeRunId`、`isStopping`。

`codexAutoImportStarted` 先保持模块级语义；如果以后迁移到 store，必须加“组件重新挂载不会重复导入”的测试。

不要仅为了减少 props 数量把所有 AgentChat 状态直接改成 store 读取，这会扩大渲染耦合和测试范围。

#### 6C/6D/6E. 其他 Agent 组件

先做纯 presentational 拆分：搜索字段、模式选择、消息行、provider 列表行。状态归属和 store 直读推迟到有明确性能或职责问题时。

其余编辑器只在实际修改相关功能时做局部整理，不进行本轮大拆。

### Phase 7：收尾清理

#### 测试脚本

对 34 个未被命令直接引用的脚本逐个分类：

1. 仍能运行且覆盖关键业务：接入合适的 npm script。
2. 只覆盖一次性视觉实验：移动到明确的 `attic` 或归档目录，并保留原因。
3. 已失效、依赖不存在或被新测试完全替代：确认无 `execFileSync`、文档、CI、脚本间调用后再删除。

推荐增加一个轻量检查，约束新增 `scripts/test-*` 必须被 npm script 或 CI 引用，但不要把历史文件一次性全部删除。

#### 类型卫生

`ProviderDefinition` 统一必须先解决 `sortName` 的归属：要么让 Rust 成为真实来源并生成它，要么保留明确的前端扩展类型。不要直接 re-export 造成排序功能退化。

`FileEntry` 统一必须和 `grantId` 的安全边界一起设计，不能只做文本替换。

#### 缩放

如有顺手收益，只抽 `clamp` 和滚轮空闲去抖的纯工具；不修改各编辑器的 apply、anchor、布局和引擎适配路径。

## 5. 每阶段验证命令

前端纯逻辑或类型变更：

```bash
npm run typecheck
npm run check:i18n
npm run check:providers
npm run test:web-canaries
```

涉及 UI 行为：

```bash
npm run test:e2e
```

涉及生成类型或 Rust IPC：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run generate:types
npm run check:generated
```

`check:generated` 会运行生成脚本并可能改变生成文件。执行前确认这一步确实属于当前阶段，执行后检查 `git diff`，不要把无关生成变化带入提交。

完整发布前检查按 CI 顺序运行：

```bash
npm run check:sensitive
node scripts/release/test-release-contract.mjs
npm run check:i18n
npm run check:providers
npm run test:web-canaries
npm run check:generated
npm run typecheck
npm run build:web
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## 6. 每次提交前的审查清单

- `git diff --check` 通过。
- diff 不包含没有解释的生成文件、锁文件、构建产物或用户已有改动。
- 修改是否保持了 JSON wire 字段名、缺省值、错误码和事件顺序？
- UI 是否保持了焦点恢复、Escape、框外点击、Portal 定位和 RTL？
- 是否为用户可见文本变化添加了 golden case 或 E2E 断言？
- 是否只删除了经过全仓库引用检查的死代码？
- 是否把局部扫描结果误写成全仓库结论？
- 是否运行了与风险匹配的验证，而不是只运行 typecheck？
- 如果测试没有运行，是否明确写出原因和剩余风险？

## 7. 完成标准

本轮重构可以结束的条件：

1. CI 中的 i18n、provider、generated、typecheck、canary、E2E 和 Rust 检查全部通过，或每个未通过项都有明确的环境原因。
2. 当前两个红项已经修复且有回归保护。
3. 模型显示名、协作 transcript、下拉键盘行为等用户可见变化有自动化验证。
4. 大文件拆分保持小步、可审查，每次提交只包含一个主要职责变化。
5. 没有为了“统一”而改变 PDF/PPT/Excel/代码编辑器的专有行为。
6. 没有删除仍有业务价值的测试脚本，也没有把手写类型简单覆盖成不兼容的生成类型。

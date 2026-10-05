# frontend-shell 分片修复明细（src/lib/**、src/platform/**、src/stores/**、src/components/**、src/hooks/**、src/types/**、src/App.tsx、src/renderer/**）

> 基线 HEAD=55b8ccf，改动全部留工作树未 commit。行号为本分片改动后的当前行号。
> 后端形状核对均以 src-tauri Rust 命令签名为准（已逐一读源码）。

---

## P0

### 1. AgentMessageList 稳定 key + tool 徽章嗅探注释
- 【报告位置】§1.3 Top10-9 关联 / §07-26（报告 1507–1511）。
- 【现状确认】`src/components/agent/AgentMessageList.tsx:23` 原为 `key={i}`；`:78` 原为 `msg.content.includes('```tool')`。
- 【关键改动】
  - key 改为 `${msg.role}:${msg.streamingRunId ?? ''}:${msg.timestamp ?? ''}:${i}`：role+streamingRunId+timestamp 在流式帧拼接期间保持稳定（store 里 appendAssistantStream 只改 content，不动 streamingRunId/timestamp），index 仅作同 timestamp 碰撞兜底，正常消息不退化为纯 index。
  - 已核对 `src/types/agent.ts:35-43`：ChatMessage 字段为 role/content/timestamp?/attachments?/cacheUsage?/streamingRunId?，**无 toolCalls 字段、无 runId 字段**。故按任务约定保留 `'```tool'` 嗅探，并在 :84-89 加注释说明这是过渡信号、待结构化 toolCalls 上线后切换。
- 【证据】`src/components/agent/AgentMessageList.tsx:24-31`（messageKey 构造）、`:84-89`（注释+保留嗅探）。
- 【状态】已修复。

---

## P1（desktopApi）

### 2. successResult 收紧
- 【报告位置】§05 E3 / Top10-8（报告 991、1011、1146）。
- 【现状确认】`src/platform/desktop.ts:151-154` 旧实现：`{ success: value !== false }`，undefined/null/字符串都判成功。
- 【后端核对（逐一读 Rust 签名）】successResult 实际仅 **3 个调用点**（任务书称 7 个，grep 全仓证实为 3）：
  - `providers_set_base_url` → `AppResult<ProviderBaseUrlResult{success:bool, base_url:String}>`（commands/providers.rs:138-141,23-26）。
  - `providers_auth_set` → `AppResult<bool>`，Ok(true)（commands/providers.rs:159-164）。
  - `providers_auth_remove` → `AppResult<bool>`，Ok(true)（commands/providers.rs:167-173）。
- 【关键改动】收紧为：record 则要求 `value.success === true`；否则仅 `value === true` 才算成功（覆盖 auth.set/remove 的裸 bool 线形状）；undefined/null/字符串 → 失败。对 `app.setLanguage/setTheme/performMenuAction/openUrl` 四个 fire-and-forget 命令，保持 `{ success: true }` 硬编码不动，并在 :867-871 加注释说明（这些命令失败走 AppError reject，resolve 即代表已确认；D2 另行跟踪）。
- 【证据】`src/platform/desktop.ts:160-171`；硬编码注释 :867-871；调用点 :647(setBaseURL)、:661(auth.set)、:668(auth.remove)。
- 【状态】已修复。

### 3. assertSafeExternalUrl 改抛 AppError
- 【报告位置】§05 E1（报告 1009）。
- 【现状确认】`src/platform/desktop.ts` 旧 :723-740 四处 `throw new Error(...)`。
- 【关键改动】四处全部改为 `throw new AppError({ code: 'invalid-argument', message })`；校验逻辑（非空、控制字符 /[\u0000-\u001f\u007f]/、URL 解析、scheme 白名单 http/https）逐行不变。
- 【证据】`src/platform/desktop.ts:846-865`。
- 【状态】已修复。

### 4. D1 透传方法补形状校验
- 【报告位置】§05 D1（报告 989、1144）。
- 【现状确认】原实现均为裸 `return invokeDesktop(...)` 透传。
- 【关键改动】参照同文件 grantedItems/grantedPath 的 isRecord 守卫风格补最小校验，形状不符抛 `AppError code 'invalid-response'`，成功路径数据形状不变：
  - `files.stat` → FileStatInfo（exists/size/modifiedAt/createdAt/extension 五字段类型）。
  - `files.showInFolder` / `files.historyRestore` → FileRevealResult（success:boolean）。
  - `files.copyToClipboard` → FileClipboardResult（success:boolean）。
  - `files.historyList` → FileVersion[]（id:string/savedAt:number/size:number 逐元素）。
  - `documents.saveText` → `{success:boolean}`（核对后端 commands/documents.rs:287 确为 `json!({"success":true})`）。
  - `documents.listFonts` → SystemFontFace[]（逐元素 record + fontId/familyName/weight）。
  - `documents.setCurrentFile` → `{success:boolean}`（同族一并补齐，报告"等"字范围）。
  - `agents.list` → AgentConfig[]（逐元素 record + id/name string）。
  - `conversations.list` → ConversationSummary[]（数组守卫）；`get`/`save` → assertConversationRecord（summary record + messages array）；`delete` → boolean；`importCodex` → CodexImportResult（discovered/imported/messages 数字）。
  - `app.checkForUpdate` → available:boolean + currentVersion:string。
  - 未做：`agents.sendDocumentResult/sendDocumentEvent`（报告未列、调用方忽略返回值，避免超范围）。
- 【证据】`src/platform/desktop.ts:296-306`(stat)、`:323-332`(showInFolder)、`:340-350`(copyToClipboard)、`:351-368`(historyList)、`:369-378`(historyRestore)、`:522-531`(saveText)、`:533-548`(listFonts)、`:564-572`(setCurrentFile)、`:577-595`(agents.list)、`:597-644`(conversations)、`:910-919`(checkForUpdate)。
- 【状态】已修复。

### 5. R1 事件订阅下沉
- 【报告位置】§05 R1（报告 1020-1023）。
- 【现状确认】`desktop.ts:156-172 eventSubscription()` 与 `lib/desktop-events.ts:8-26 subscribeDesktopEvent()` 为两份拷贝。
- 【关键改动】新建 `src/platform/subscription.ts`（disposed/unlisten 竞态 + catch 单实现，用 desktopTransport.listen + AppError.from 记日志）；`lib/desktop-events.ts` 变薄壳 re-export；desktop.ts 删除本地 eventSubscription，onNavigateBack 改引用 subscription.ts。层级合规：platform 不 import lib。
- 【证据】`src/platform/subscription.ts:22-44`；`src/lib/desktop-events.ts:11`；`src/platform/desktop.ts:382-385`。
- 【状态】已修复。

### 6. R3 channel 工厂 + D7 InvokeBody channel 分支
- 【报告位置】§05 R3（1030-1033）、D7（995、1736）。
- 【现状确认】desktop.ts 原 :528-531/:537-540/:662-667/:690-695 四处同构 channel+`as unknown`。
- 【关键改动】抽泛型 `filteredChannel<T>(predicate, onEvent)`（:179-186），4 处调用各减 4 行；`types/desktop-api.ts` InvokeBody 增加 `DesktopChannel<unknown>` 分支（:71-78），4 处 `as unknown` 双重断言全部消除（grep 复核：desktop.ts 内已无业务 `as unknown`）。
- 【证据】`src/platform/desktop.ts:179-186`、chat :655-663、runTask :665-673、debugStart :786-792、terminalStart :808-818；`src/types/desktop-api.ts:71-78`。
- 【状态】已修复。

### 7. D3 'file-too-large' 入 AppErrorCode 联合
- 【报告位置】§05 D3（报告 991）。
- 【现状确认】`binary.ts:63/69` 抛 `code: 'file-too-large'`，原靠 `(string & {})` 兜底才合法。
- 【关键改动】联合中插入 `'file-too-large'`（字母序位）。
- 【证据】`src/types/desktop-api.ts:52`。
- 【状态】已修复。

---

## 状态层正确性

### 8. ensureConversationId 反模式
- 【报告位置】§08-2.1（报告 1691）。
- 【现状确认】`src/stores/agent.store.ts:122-132` 在 set() 回调内借外层闭包变量取值。
- 【关键改动】create 第二参改为 `(set, get)`；函数体外先 `get().conversationIds[agentId]`，存在即返回；否则生成 UUID、条件 set、返回该 id。行为等价（不再多生成一个被丢弃的 UUID）。
- 【证据】`src/stores/agent.store.ts:65`（create 签名）、`:123-133`。
- 【状态】已修复。

### 9. AgentSidebar handleSend 闭包读旧 messages
- 【报告位置】Top10-9（报告 40）。
- 【现状确认】`AgentSidebar.tsx:144` `[...(messages[activeAgentId]||[]), userMessage]` 读订阅快照，且 messages 在 deps 中。
- 【关键改动】在 addMessage **之前**用 `useAgentStore.getState().messages[activeAgentId]` 实时快照拼 history（保证 userMessage 只入一次），并从 deps 数组移除 `messages`。未拆函数、未动 buildAssistantMessage。
- 【证据】`src/components/agent/AgentSidebar.tsx:143-150`（history 快照）、`:231`（deps 已无 messages）。
- 【状态】已修复。

### 10. src/lib/path.ts 创建与 7 处替换
- 【报告位置】§05 R5（1041）、§18-5（3478-3479）。
- 【冻结契约】`src/lib/path.ts` 严格导出四函数：`baseName` / `extensionOf`（小写无点；隐藏文件 dot<=0 → ''）/ `normalizePath`（\ → /、压缩重复 /）/ `isSamePath`（navigator.platform 含 win → 大小写不敏感）。
- 【7 处替换证据】
  - `src/platform/grants.ts:11` pathKey 内联归一 → `normalizePath`（保留其 drive-letter/UNC 大小写判定）。
  - `src/stores/file-session.store.ts:10` 同上。
  - `src/components/layout/panel/DebugConsoleView.tsx:79` 内联 `replace(/\\/g,'/')===replace(...)` → `isSamePath(frame.file, sessionFile)`（注意：Windows 运行时下顺带修正为大小写不敏感，与 grants/file-session 路径键语义一致）。
  - `src/lib/file-icons.ts:28-34` getExtensionFromPath 改用 `extensionOf`，`ext ? '.'+ext : ''` 保留 dot<=0 隐藏文件语义与 map 的带点键。
  - `src/lib/provider-logos.ts:16-18` providerIdFromPath 改用 `baseName(path).replace(/\.[^.]+$/,'')`（glob 路径恒为正斜杠，baseName 兼容 \ 无行为差）。
  - `src/lib/code-languages.ts:141-143` fileNameOf → `baseName(filePath).toLowerCase()`。
  - `src/lib/agent-attachments.ts:9-11` fileNameFromPath → `baseName(filePath) || filePath`。
- 【证据】`src/lib/path.ts:31-71`；上述各行。
- 【状态】已修复。

### 11. theme / i18n 改走稳定入口
- 【报告位置】§08-3 违规 1（报告 1729-1733）。
- 【现状确认】`theme.ts:1`、`i18n/runtime.ts:3` 直连 `@/platform/desktop`。
- 【关键改动】均改 `@/platform`（grep 全仓已无 `from '@/platform/desktop'`；WordEditor 直连由另一分片处理）。
- 【证据】`src/lib/theme.ts:1`、`src/lib/i18n/runtime.ts:3`。
- 【状态】已修复。

---

## 共享工具与清理

### 12.1 safeStorage（已落并采用）
- 【报告位置】§1.4 路线图（报告 46）。
- 【现状确认】`enabled-provider.ts:3-18` 手写 localStorage try/catch。
- 【关键改动】新建 `src/lib/safe-storage.ts`（get/set/remove 永不抛），enabled-provider.ts 改为消费 safeStorage，行为逐行等价。其余 store（panel/debug/theme/i18n/registry）已有各自带注释的兜底语义，本轮不批量重写，避免改变其精确回退。
- 【证据】`src/lib/safe-storage.ts:11-30`；`src/components/agent/provider-settings/enabled-provider.ts:1-14`。
- 【状态】已修复（首轮点名处）。

### 12.2 usePointerDrag（已落并采用）
- 【现状确认】`BottomPanel.tsx:49-77` 内联 document 级 mousemove/mouseup/blur 拖拽 + cursor/userSelect 管理。
- 【关键改动】新建 `src/hooks/use-pointer-drag.ts`（useDocumentDrag），BottomPanel 的 onResizeMove 数学完全不变，startResize 改由 hook 提供；卸载清理由 hook 负责。ResizableThreeColumnLayout 按任务要求不拆。
- 【证据】`src/hooks/use-pointer-drag.ts:18-52`；`src/components/layout/BottomPanel.tsx:46-60`。
- 【状态】已修复。

### 12.3 wheel-gesture.ts
- 【状态】延期。理由：components 内非编辑器消费端仅 DocumentZoom.tsx 一处（其余 wheel 监听全在 lightweight-office，禁碰）；其手势状态机（accumulatedDelta/direction/rAF flush/idle 160ms）与 ctrl+zoom 深度耦合，抽通用 hook 非纯机械、有回归风险，且无第二个消费者。

### 12.4 ui/modal.tsx
- 【状态】延期。理由：grep `DialogContent|DialogTrigger` 在 src/components 零匹配（radix-dialog 正被卸载），无重复点。

### 12.5 ui/search-field.tsx
- 【状态】延期。理由：三处 type="search"（AgentModelPicker:182 / AgentProviderPicker:74 / CollaborationConfigDialog:171）容器类名分化（h-8 vs h-9、rounded-lg vs rounded-[4px]、text-xs vs text-sm、ring 有无），抽共享组件需要变体型 API，非机械替换。

### 12.6 icon-tooltip-button.tsx / lib/file-errors.ts / providerDisplayName / resolveDefaultModel
- 【状态】延期。理由：grep `resolveDefaultModel|providerDisplayName` 全仓零匹配（无现存重复点可收敛）；components 内 Tooltip+IconButton 已统一走 `components/ui/tooltip.tsx`，无第二份手写 tooltip 包裹模式；未定位到 ≥2 处真实重复。

### 12.7 popover-position.ts / useDocumentIsDark / observeCoalesced / useDocumentLifecycle / useLatestRequest / usePersistedSetting
- 【状态】延期。理由：
  - useDocumentIsDark：matchMedia('(prefers-color-scheme: dark)') 订阅仅 TopBar.tsx:23 一处（theme.ts:27 是一次性取值非订阅），无第二消费者。
  - popover-position：hooks/use-popover.ts 已是单实现（报告 §08-2 评价其设计良好），无重复定位逻辑。
  - observeCoalesced / useDocumentLifecycle / useLatestRequest：grep 未定位到 ≥2 处真实重复模式。
  - usePersistedSetting：panel/debug store 已有带注释的幂等持久化，DocumentZoom zoom 持久化为单消费者，批量改非机械。

### 13. 死代码清理
- FileTree 死 prop：`FileTreeProps.currentDir`（原 :14）在组件内从未解构消费，FileManager.tsx:446 传入。已删接口字段与传参。证据：`src/components/file-manager/FileTree.tsx:10-14`、`src/components/file-manager/FileManager.tsx:444-448`。
- LEFT_RESTORE_DRAG_THRESHOLD：grep 定位 constants.ts:12 定义、:16 仅喂给 RIGHT_RESTORE_DRAG_THRESHOLD，而 RIGHT 本身全仓零引用 → 两条均为死常量，一并删除。证据：`src/components/layout/resize/constants.ts:10-15`。
- 【状态】已修复。

### 14. @radix-ui/react-dialog 复核
- 【关键改动】grep 全仓（`*.{ts,tsx,js,jsx}`，含 src/tests）`react-dialog`：**零 import/require**。卸载安全；package.json 的卸载行由"脚本构建分片"执行，本分片未碰 package.json。
- 【证据】grep 结果 0 match。
- 【状态】已复核（结论记入本明细）。

---

## 明确不做（按任务书列延期/待决策）

| 项 | 理由 |
|---|---|
| ResizableThreeColumnLayout 拆分 | 任务书指定第二批 |
| 编辑器 hook 化 | lightweight-office 禁碰 |
| 桌面桥 mock 工厂 | 超范围 |
| i18n 三数据源合并 | 超范围 |
| App.tsx 四大 effect 抽 hooks | 任务书明确不做 |
| handleDebugEvent 移出 store（含中文文案 i18n 化） | 任务书明确不做 |
| types 双源全面规则化 | 任务书明确不做 |
| AgentCollaborationEvent 协议同步机制 | 任务书明确不做 |

---

## 汇总

- 已修复项：P0×1、P1×6、状态层×4、共享工具已落×2（safeStorage/usePointerDrag）、死代码清理×2、radix 复核×1 = **16 项**。
- 延期项：wheel-gesture、ui/modal、ui/search-field、icon-tooltip-button、file-errors、providerDisplayName/resolveDefaultModel、popover-position、useDocumentIsDark、observeCoalesced、useDocumentLifecycle、useLatestRequest、usePersistedSetting（理由均见上）。
- path.ts 最终导出：`baseName`、`extensionOf`、`normalizePath`、`isSamePath`（严格按冻结签名）。

---

## 追加：合并后 typecheck 类型集成修正（不改运行时行为）

总控合并分片后 typecheck 报 6 个错误，均为类型集成问题，逐项修复如下：

1. **TS2459（desktop.ts 引入 barrel 缺 re-export）**：`src/types/desktop-api.ts:10` 原 import FileStatInfo/FileVersion 仅用于本地。已在 import 行下补 `export type { FileStatInfo, FileVersion } from './file'`（:12-13，原 import 不动）。证据：`src/types/desktop-api.ts:12-13`。
2. **TS2352（校验后收窄与 UnknownRecord 不重叠）**：四处 `value as X` 改 `value as unknown as X`，校验条件逐字不变——`desktop.ts:305`（FileStatInfo，stat）、`:331`（FileRevealResult，showInFolder）、`:349`（FileClipboardResult，copyToClipboard）、`:377`（FileRevealResult，historyRestore）。
3. **TS2345（Tauri 边界 InvokeBody 宽于 InvokeArgs）**：`src/platform/transport.ts:41` 的 tauriInvoke 调用中 args 改 `args as Record<string, unknown>`（:43-45，附注释说明 channel 运行时经 toJSON 序列化、断言纯类型层）。InvokeBody 定义未动。

4. **§18 魔法数第 1 条（内联裸值）**：`desktop.ts:459` 原 `const maxPngBytes = 25 * 1024 * 1024` 函数体内联。已在模块顶部常量区（isRecord 之后）定义具名常量 `MAX_PNG_DATA_URL_BYTES = 25 * 1024 * 1024`（:59-62，注释注明镜像 lightweight-office/pdf/worker/wae-limits 的 MAX_IMAGE_BYTES 与 commands/documents.rs 的 MAX_PNG_BYTES，platform 不反向 import lightweight-office）；:463-469 pngDataUrlBytes 改引用该常量，函数内不再内联。阈值数值与来源完全不变。

以上错误/遗漏全部闭环，运行时行为零变化。

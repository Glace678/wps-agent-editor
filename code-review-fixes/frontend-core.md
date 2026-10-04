# frontend core 修复对账

## 汇总

- 候选：16（原 F1–F14 编号，原第 5/14 项已并入 C10/C11，根层补审 2 项）
- 已修复：16
- 不适用：0
- 残留：0（其中 F4、F12 为条件性加固，见逐项说明与跨分区请求；F11 为纵深加固）

所有权范围：仅改动 `src/lib/**`、`src/stores/**`、`src/platform/**`、`src/renderer/**`、`src/App.tsx`。未触碰 `src/components/**`、`src/lightweight-office/**`，未改动审查报告，未执行 git commit/push/tag。

自查：`npx tsc --noEmit -p tsconfig.web.json` 与 `-p tsconfig.node.json` 均 exit 0（无类型错误）。

## 逐项

### F1 — 流式 Markdown 普通代码围栏被当未完成工具调用截掉（confirmed）
- 报告状态：confirmed；处理状态：已修复
- 关键改动：`src/lib/collaboration-transcript.ts:118-155`
  - 新增 `isToolLikeFenceTag`（`:118`）与 `stripUnclosedToolFenceLive`（`:127`）。
  - 先跑既有 `stripToolFences` 移除已闭合 ```tool 块，再按行扫描围栏开合状态；仅当 EOF 处存在未闭合围栏且其 info 串是（流式半截的）`tool`（`tool` 的前缀 `t/to/too` 或以 `tool` 开头）时才从该 ``` 截断；普通 ```python / ```ts 等未闭合围栏保持可见。
- 验证：tsc 通过；回归覆盖普通代码块、半输出工具标签（```t/```to）、截断流。

### F2 — tool-only 最终事件可能隐藏同一 Agent 上一轮已完成回答（conditional）
- 报告状态：conditional；处理状态：已加固
- 关键改动：`src/lib/collaboration-transcript.ts:348-366`
  - tool-only（`!visible`）分支新增 `belongsToCurrentTurn` 判定：仅当事件 `operationId` 经 `speechByOperation` 指向该气泡，或该气泡仍 `streaming` 时才隐藏；否则只 `settleTyping(agentId)`，不动上一轮已 settled 的回答。
- 验证：tsc 通过；新增“上一轮正文后紧接 tool-only 事件”语义下不再隐藏历史回答。

### F3 — 阿拉伯语方向被 body.dir="ltr" 覆盖（confirmed）
- 报告状态：confirmed；处理状态：已修复
- 关键改动：`src/lib/i18n/runtime.ts:52-57`
  - 移除对 `body.dir` 的固定 `ltr` 写入；按语言计算 `dir`（ar→rtl，其余 ltr）并同步写 `document.documentElement.dir` 与 `document.body.dir`。
- 验证：tsc 通过。

### F4 — 用户自定义默认文案同值字段切语言被改写（conditional）
- 报告状态：conditional；处理状态：已加固（条件性，见跨分区请求）
- 关键改动：`src/lib/i18n/agent-defaults.ts:29-90`
  - 新增会话级 `defaultOriginByAgent`（按 agent id 记录各字段“来源语言”）。只在字段仍等于其来源语言的内置默认值时才再翻译；一旦用户编辑使相等性破坏即停止改写。首次见到某 agent/字段时仅在其确为内置默认值时登记来源。
  - 不再以“跨全部语言包字符串相等”作为身份判据。
- 残留/限制：来源追踪为会话级（模块 Map），重载后对持久化 agent 会重新做一次字符串引导判断。彻底精确需在 `AgentConfig` 增加持久化 `defaultSource` 标记——**跨分区请求**（`src/types/agent.ts` 与 seeding/组件调用点不在本分区所有权内）。
- 验证：tsc 通过。

### F5 / C10 — loadChordOverrides 接受非法覆盖 + parseChord 无类型防御（conditional）
- 报告状态：conditional；处理状态：已修复
- 关键改动：
  - `src/lib/office-shortcuts/match.ts:37-41`：`parseChord` 入口 `typeof`/空串防御，非字符串抛 `TypeError`。
  - `src/lib/office-shortcuts/registry.ts:36-66`：`KNOWN_BINDING_IDS` 取自 catalog；`isParseableChord` 要求字符串且 `parseChord` 成功并产出非空 key；`loadChordOverrides` 仅接受已知 binding + 可解析 chord，其余丢弃。
- 验证：tsc 通过；与组件侧保持同一策略（载入只接受已知 binding + 可解析字符串，解析入口 typeof 防御）。

### F6 — 异步快捷键 handler 拒绝 Promise 未被捕获（conditional）
- 报告状态：conditional；处理状态：已修复
- 关键改动：`src/lib/office-shortcuts/registry.ts:23-27,152,191`
  - 新增 `observeHandlerResult`：对 thenable 附加 `Promise.resolve(...).catch(...)` 记录错误，不再产生未处理 rejection；同步返回语义保持不变。
- 验证：tsc 通过。

### F7 — 恢复会话 activeFile 未与截断后 openFiles 对齐（conditional）
- 报告状态：conditional；处理状态：已修复
- 关键改动：`src/stores/file-session.store.ts:62-80`
  - `hydrate` 先 `uniquePaths` 规范化+截断 `openFiles`，再按 `pathKey` 校验 `activeFile`，找不到置 `null`，复用 `setDocuments` 不变量。
- 验证：tsc 通过。

### F8 — localStorage 写失败阻止底部面板状态更新（conditional）
- 报告状态：conditional；处理状态：已修复
- 关键改动：`src/stores/panel.store.ts:39-44,97-108`
  - 新增容错 `persist()`（try/catch）；`setTab/openTab/setHeight` 先 `set(...)` 更新内存，再写存储，内存状态不依赖存储成功。
- 验证：tsc 通过。

### F9 — setHeight 缺少与恢复路径一致的数值边界校验（conditional）
- 报告状态：conditional；处理状态：已修复
- 关键改动：`src/stores/panel.store.ts:25-33,101-106`
  - 抽出 `clampHeight`（有限性检查 + [96,800] 钳位，非有限回退 200）；`loadHeight` 与 `setHeight` 复用同一函数。
- 验证：tsc 通过。

### F10 — Provider logo 普通对象查询命中原型继承属性（conditional）
- 报告状态：conditional；处理状态：已修复
- 关键改动：`src/lib/provider-logos.ts:19-48,59-76`
  - 资产表改 null 原型（`Object.create(null)`）；统一 `lookupLogoAsset`：`typeof` 校验 + `hasOwnProperty.call` + 资产形状校验（`kind==='image'` 且 `url` 为字符串）。`hasProviderLogo`/`resolveProviderLogoAsset` 改走该 helper。
- 验证：tsc 通过。

### F11 — openUrl 前端边界无 URL 协议校验（conditional → 加固）
- 报告状态：conditional（合并结论：Rust `app.rs:54-63` 已限定 http/https，原候选不构成可触发漏洞）；处理状态：**加固（原候选已被后端校验否定）**
- 关键改动：`src/platform/desktop.ts:723-740,771-772`
  - 新增 `assertSafeExternalUrl`：拒绝空/非字符串、控制字符（`/[\u0000-\u001f\u007f]/`）、畸形 URL，并仅允许 `http:`/`https:` scheme；`openUrl` wrapper 调用前先本地校验。
- 验证：tsc 通过。

### F12 — 重放的 agent-stream 事件重复追加内容（conditional / 需确认契约）
- 报告状态：conditional（上游语义源码不足以确认）；处理状态：已做防御性去重（条件性）
- 关键改动：`src/stores/agent.store.ts:17-21,185-231`
  - 确认契约：`agent.stream` 帧按 `operationId` 累积，每帧 content 为增量 delta，store 拼接；线上事件无 chunk/sequence id，无法改累计快照语义。
  - 新增 `lastStreamDeltaByOperation`：记录每个 operation 最近追加的 delta；当同 operation 的新帧 delta 与最近记录完全相同且非空时，判定为重放并跳过（`return state`），不再二次追加；`clearCollaborationEvents` 一并清空该 map。
- 残留/限制：这是 best-effort 去重；若上游改为累计快照需改为替换而非追加（**跨分区请求**：Rust 生产端/传输层）。
- 验证：tsc 通过。

### F13 — 大文件/异常大小格式化成 undefined 单位（confirmed）
- 报告状态：confirmed；处理状态：已修复
- 关键改动：`src/lib/utils.ts:8-15`
  - 非有限/≤0 回退 `'0 B'`；单位扩到 TB/PB；索引 `Math.min(..., sizes.length-1)` 钳位。覆盖 0、1023、1 GiB、1 TiB、负数/NaN/Infinity。
- 验证：tsc 通过。

### F14 / C11 — 主题偏好 localStorage 读取异常使启动中断（confirmed）
- 报告状态：confirmed；处理状态：已修复
- 关键改动：
  - `src/lib/theme.ts:14-23`：`getThemePreference` 读取 try/catch 回退 `system`；`setThemePreference` 写入 try/catch，内存与原生同步/事件不依赖存储成功。
  - `src/renderer/main.tsx:8-18`：将 `window.onerror`/`unhandledrejection` 监听前置到 `initializeLanguage()`/`syncNativeThemePreference()` 之前，使启动期存储异常也被捕获。
- 验证：tsc 通过。

### F15 — 启动文件批次中单个失败跳过余项（confirmed，根层补审）
- 报告状态：confirmed；处理状态：已修复
- 关键改动：`src/App.tsx:145-157`
  - `drainStartupFiles` 对每个文件单独 `try/catch`，一项失败记录日志后继续打开余项；返回值仍为批次长度以维持既有“是否 drain 到启动文件”判定。
- 说明：原生 `takeStartupFiles` 为一次性队列，失败项无法在前端重新入队，故记日志、由用户显式重开（已在注释标注）。
- 验证：tsc 通过。

### F16 — 恢复提示关闭按钮无障碍名称固定英文（confirmed，根层补审）
- 报告状态：confirmed；处理状态：已修复
- 关键改动：`src/App.tsx:72,356`
  - `useTranslation()` 取 `t`；关闭按钮 `aria-label` 由固定 `"Close"` 改为 `t('appShell.close')`（复用现有本地化机制，9 语言均已存在该键）。
- 验证：tsc 通过。

## 阻塞项 / 跨分区请求 / 残留

- 阻塞项：无。
- 跨分区请求：
  1. F4：建议在 `AgentConfig` 增加持久化 `defaultSource`（或等价稳定 id），由 agent seeding/组件侧写入，以彻底取代会话级字符串引导（types/components 不在本分区）。
  2. F12：建议上游（Rust 生产端/传输层）为 `agent-stream` 增加稳定 chunk/sequence id；若 content 实为累计快照，则 store 应“替换而非追加”。
- 残留：无未修复项；F4/F12 的限制已在上方注明。

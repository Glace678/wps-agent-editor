# components 修复对账

## 汇总（候选23；已修复23；不适用0；残留0）

- confirmed 18 项全部修复：C01 C02 C03 C04 C05 C06 C08 C09 C10 C12 C13 C14 C15 C16 C17 C18 C21 C23
- conditional 5 项按建议加固使触发条件失效：C07 C11 C19 C20 C22
- 未编辑所有权外文件：`src/lib/office-shortcuts/**`（registry/match 侧）、`src/lib/theme.ts` 均未改动；审查报告 `final-review.md` 未改动。
- 自查命令：`npx tsc --noEmit -p tsconfig.web.json` → EXIT=0（期间曾瞬时出现 `src/stores/agent.store.ts` 两个他区 TS6133，复验时已消失，与本分区无关；本分区 `src/components/**` 零报错）。

## 逐项

| 项 | 报告状态 | 处理状态 | 关键改动（文件:行） | 验证 |
|---|---|---|---|---|
| C01 | confirmed | 已修复 | `agent/AgentConfigDialog.tsx:14` onSave 改 `Promise<void>\|void`；`:34-35` 加 saving/saveError；`:127-143` handleSave await+catch 失败保留弹窗；按钮 disabled+错误提示 | tsc 0 报错 |
| C02 | confirmed | 已修复 | `file-manager/FileManager.tsx:51` openFileRequestRef；`:96-120` openFile 递增序号，仅最新请求 setCurrentFile/refresh recent | tsc 0 报错 |
| C03 | confirmed | 已修复 | `file-manager/FileManager.tsx:52` searchRequestRef；`:154-177` 每次 effect 使旧搜索失效，响应/finally 均复核序号 | tsc 0 报错 |
| C04 | confirmed | 已修复 | `file-manager/FileManager.tsx:166-174` 搜索 try/catch，失败清空结果并 setOperationError | tsc 0 报错 |
| C05 | confirmed | 已修复 | `file-manager/FileManager.tsx:96-120` openFile 统一 try/catch，失败不推进编辑器/最近文件状态，图片分支改 await openExternal | tsc 0 报错 |
| C06 | confirmed | 已修复 | `layout/panel/ProblemsView.tsx:40-45` 用 `monacoModule.Uri.file(currentFile).path` 与 marker.resource.path 比较，统一 Win/Unix | tsc 0 报错 |
| C07 | conditional | 已加固 | `layout/panel/TerminalView.tsx:192-201` 启动失败路径 terminalKill(忽略二次错误)+disposeRuntime，复用卸载清理逻辑 | tsc 0 报错 |
| C08 | confirmed | 已修复 | `layout/resize/ResizableThreeColumnLayout.tsx:43-59` sanitizePanelWidth（number/finite/夹到 MAX_PANEL_WIDTH=1200/回退默认）；`:215-228` persistSizes/persistCollapse 写存储 catch | tsc 0 报错 |
| C09 | confirmed | 已修复 | `layout/resize/ResizableThreeColumnLayout.tsx:188,223-271` activeAnimationsRef 计数 + runPanelAnimation，仅全部活动动画结束才 setIsAnimating(false)/unfreeze | tsc 0 报错 |
| C10 | confirmed | 已修复 | `shortcuts/ShortcutSettingsPanel.tsx:27-46` sanitizeOverrides（仅已知 binding+非空可解析 chord）；`:74` 初始化过滤；`:95,213` resolveChord typeof 防御（registry/match 侧由另一执行者） | tsc 0 报错 |
| C11 | conditional | 已加固（组件侧） | `ErrorBoundary.tsx:38-56` dark 检测与 t() 包 try/catch + 英文兜底，错误页自身不再二次崩溃；theme.ts 启动期 try/catch 属另一执行者，未改 theme.ts | tsc 0 报错 |
| C12 | confirmed | 已修复 | `agent/ProviderSettings.tsx:289-302` handleSaveKey 加 isSavingKey/apiKeyError + try/catch/finally；按钮 disabled+错误展示 | tsc 0 报错 |
| C13 | confirmed | 已修复 | `agent/ProviderSettings.tsx:263-287` handleResetBaseURL 先 await setBaseURL 成功再更 UI，失败恢复旧值+setBaseURLError；按钮加 isResettingBaseURL | tsc 0 报错 |
| C14 | confirmed | 已修复 | `agent/ProviderSettings.tsx:375-401` handleSaveCustom 加 isCreatingCustom + try/catch，成功后才 closeCustomForm/setSelectedId，失败保留弹窗+customTestError | tsc 0 报错 |
| C15 | confirmed | 已修复 | `file-manager/FileManager.tsx:84-93` loadDir try/catch 保留旧目录；`:133-151` init、`:225-233` chooseHomeFolder、`:360-368` open-folder 均 catch；`:59-66,388-404` 错误横幅可见 | tsc 0 报错 |
| C16 | confirmed | 已修复 | `file-manager/RecentFiles.tsx:71-79` mapActionError；`:82-165` handleAction 外层 try/catch；share 改 Promise.allSettled 部分失败单独 warning | tsc 0 报错 |
| C17 | confirmed | 已修复 | `file-manager/RecentFileDialogs.tsx:271-303` HistoryDialog reload/初次加载/restore 加 catch+可见错误+historyRequestRef 防旧响应 | tsc 0 报错 |
| C18 | confirmed | 已修复 | `file-manager/RecentFileDialogs.tsx:204-216` copyPath 检测 clipboard API，仅 writeText 成功后才 finish('path')，失败 setError 保持弹窗 | tsc 0 报错 |
| C19 | conditional | 已加固 | `layout/AppMenuBar.tsx:128` performMenuAction 附加 .catch 消费 rejection 并 console.error（显示需全局 toast，本组件无该设施，至少已消费拒绝） | tsc 0 报错 |
| C20 | conditional | 已加固 | `layout/BottomPanel.tsx:79-99` handleCopyOutput 检测 clipboard API + catch，失败受控 Tooltip 提示；`:180-192` | tsc 0 报错 |
| C21 | confirmed | 已修复 | `layout/BottomPanel.tsx:54-55` maxAllowed=Math.max(PANEL_MIN_HEIGHT, innerHeight*ratio) | tsc 0 报错 |
| C22 | conditional | 已加固 | `layout/modules/DocumentZoom.tsx:209-218` onWheel 确认 Ctrl/Cmd+wheel 时 preventDefault；`:242` 监听改 `{ passive: false }` | tsc 0 报错 |
| C23 | confirmed | 已修复 | `layout/resize/ResizeHandle.tsx` 加 tabIndex=0/aria-valuenow-min/max/onKeyDown；`ResizableThreeColumnLayout.tsx:621-655` makeHandleKeyDown（Arrow 微调、Home/End 到边界）接入两侧 handle | tsc 0 报错 |

## 说明与边界

- 复用既有 i18n 文案键（`recentFiles.errorNotFound` / `recentFiles.errorOperationFailed` / `providerSettings.testConnectionFailed`）作为失败提示，未新增/修改 `src/lib/i18n/locales/**`（属所有权外）。
- C11 真正根因（theme.ts 启动期 localStorage 读取无 try/catch）由另一执行者处理；本侧仅对 ErrorBoundary 渲染路径做防御性加固。
- C10 运行时入口（registry.loadChordOverrides / match 解析）由另一执行者处理；本侧在 ShortcutSettingsPanel 初始化边界丢弃非法项并对访问点加 typeof 防御。
- C19 仅消费 rejection（无弹窗/toast 设施），满足“至少消费拒绝”的最低建议；如需本地化弹窗需另建全局通知组件，超出本批范围。
- 阻塞项：无。跨分区请求：无（registry/match、theme.ts 均由约定的另一执行者负责）。残留：无。

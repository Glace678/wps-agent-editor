# WPS Agent Editor — 架构规划

跨平台桌面应用：Electron + React + TypeScript + 本地轻量 Office + 多 Agent 协作文档编辑。

> 当前默认实现使用 SuperDoc、FortuneSheet、Monaco 和 PDF.js。OnlyOffice Bridge
> 是需要显式强 JWT 配置的可选兼容路径，不在特权 renderer 中加载第三方脚本。

---

## 1. 系统总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Electron 主进程 (Node.js)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ FileService  │  │ MenuManager  │  │ AgentOrchest │  │ OnlyOfficeBridge│ │
│  │ (fs/path)    │  │ (平台菜单)    │  │ (LangChain)  │  │ (HTTP + IPC)    │ │
│  └──────┬───────┘  └──────────────┘  └──────┬───────┘  └────────┬────────┘ │
│         │ IPC                                │ IPC               │ HTTP/WS  │
└─────────┼────────────────────────────────────┼───────────────────┼─────────┘
          │                                    │                   │
┌─────────▼────────────────────────────────────▼───────────────────▼─────────┐
│                      渲染进程 (React + TypeScript)                          │
│  ┌────────────┐  ┌─────────────────────────┐  ┌──────────────────────────┐ │
│  │ FileManager│  │ LightweightDocumentEditor│  │ AgentSidebar             │ │
│  │ 文件树/搜索 │  │ Word / Excel / PDF / Code│  │ Agent列表/对话/任务状态   │ │
│  └────────────┘  └─────────────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                    │                   │
          │                                    ▼                   │
          │              ┌─────────────────────────────────────────┐   │
          │              │   OnlyOffice Document Server (Docker)  │   │
          │              │   - 文档存储 & 协同编辑 OT 协议          │   │
          │              │   - JWT 鉴权 / Callback 保存             │   │
          │              └─────────────────────────────────────────┘   │
          │                                    ▲                       │
          └────────────────────────────────────┴───────────────────────┘
                              Agent 隐藏编辑器会话 (同 document.key)
```

---

## 2. 推荐目录结构

```
wps-agent-editor/
├── electron/                          # 主进程
│   ├── main.ts                        # 应用入口、窗口管理
│   ├── preload.ts                     # contextBridge 暴露安全 API
│   ├── ipc/
│   │   ├── channels.ts                # IPC 通道常量
│   │   ├── file.handlers.ts           # 文件系统 IPC
│   │   ├── onlyoffice.handlers.ts     # 编辑器配置 & 文档操作 IPC
│   │   └── agent.handlers.ts          # Agent 对话 & 工具调用 IPC
│   ├── services/
│   │   ├── file.service.ts            # 跨平台文件操作
│   │   ├── recent-files.service.ts     # 最近文件持久化
│   │   ├── onlyoffice.service.ts      # Document Server 通信
│   │   ├── agent-orchestrator.ts      # LangChain.js Agent 编排
│   │   └── agent-store.service.ts     # Agent 配置持久化
│   ├── menu/
│   │   └── menu.ts                    # macOS/Win/Linux 菜单适配
│   └── windows/
│       └── agent-editor.window.ts     # Agent 隐藏协同编辑窗口
├── src/                               # 渲染进程 (React)
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx          # 三栏布局
│   │   │   ├── TitleBar.tsx           # 自定义标题栏 (Win/Linux)
│   │   │   └── TopBar.tsx             # 文件信息 + Agent 快速切换
│   │   ├── file-manager/
│   │   │   ├── FileTree.tsx
│   │   │   ├── FileSearch.tsx
│   │   │   └── RecentFiles.tsx
│   │   ├── lightweight-office/
│   │   │   ├── LightweightDocumentEditor.tsx
│   │   │   └── editors/               # Word/Excel/PDF/文本/代码
│   │   └── agent/
│   │       ├── AgentSidebar.tsx
│   │       ├── AgentList.tsx
│   │       ├── AgentChat.tsx
│   │       ├── AgentConfigDialog.tsx
│   │       └── TaskStatus.tsx
│   ├── stores/
│   │   ├── file.store.ts              # Zustand
│   │   ├── editor.store.ts
│   │   └── agent.store.ts
│   ├── hooks/
│   │   ├── useIpc.ts
│   │   └── useOnlyOffice.ts
│   ├── lib/
│   │   └── utils.ts
│   └── types/
│       ├── file.ts
│       ├── onlyoffice.ts
│       └── agent.ts
├── server/                            # 可选本地桥接服务
│   └── onlyoffice-bridge/
│       └── index.ts                   # Express: 文档上传、JWT、Callback
├── docker/
│   └── onlyoffice/
│       ├── docker-compose.yml
│       └── .env.example
├── resources/                         # 打包资源
├── electron.vite.config.ts
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── electron-builder.yml
```

---

## 3. 跨平台兼容策略

### 3.1 文件路径

| 问题 | 方案 |
|------|------|
| 路径分隔符 `\` vs `/` | 统一使用 `path.join()` / `path.normalize()` |
| 盘符 (Windows `C:\`) | `path.parse()` 获取 root，文件树从 `os.homedir()` 或用户选定目录开始 |
| 符号链接 | `fs.lstat` + `fs.readlink` 跨平台一致 |
| 隐藏文件 | 不过滤 `.` 开头文件（macOS/Linux 常见） |

```typescript
// electron/services/file.service.ts
import path from 'node:path'
import fs from 'node:fs/promises'

export function normalizePath(p: string): string {
  return path.normalize(p)
}
```

### 3.2 打包配置 (electron-builder)

```yaml
# electron-builder.yml
mac:
  target: [dmg, zip]
  category: public.app-category.productivity
win:
  target: [nsis, portable]
linux:
  target: [AppImage, deb]
  category: Office
```

### 3.3 菜单适配

| 平台 | 行为 |
|------|------|
| **macOS** | 使用 `Menu.setApplicationMenu()`，首菜单为应用名；`titleBarStyle: 'hiddenInset'` |
| **Windows** | 系统菜单 + 可选自定义 TitleBar；`frame: true` |
| **Linux** | 同 Windows；注意 Wayland 下窗口装饰 |

```typescript
if (process.platform === 'darwin') {
  template.unshift({ role: 'appMenu', label: app.name })
}
```

### 3.4 本地编辑器

- 主 renderer 只加载应用自身脚本，不加载 Document Server 的第三方脚本
- Word、Excel、代码与 PDF 分别使用 SuperDoc、FortuneSheet、Monaco 和 PDF.js
- 可选 OnlyOffice 窗口没有 preload，启用 sandbox 与 `webSecurity`，并限制为 loopback 服务

---

## 4. 核心：Agent 实时修改文档 + 用户看到变化

以下 OnlyOffice OT 设计保留为可选兼容方案；当前正式路径见 4.6 与第 9 节。

### 4.1 原理：OnlyOffice 协同编辑 (Operational Transformation)

OnlyOffice Document Server 使用 **fast co-editing** 模式：
- 多个参与者共享同一 `document.key`
- 每人有唯一 `editorConfig.user.id`
- 服务端通过 WebSocket 广播 OT 操作，所有连接的编辑器实时同步

### 4.2 三方参与者模型

```
document.key = "doc-{hash}-{version}"   // 同一文档固定 key，保存后 version 递增

参与者:
  user-001     → 用户可见 iframe 编辑器
  agent-writer → Agent A 隐藏 BrowserWindow 编辑器
  agent-review → Agent B 隐藏 BrowserWindow 编辑器
```

### 4.3 数据流

```
1. 用户打开文件
   FileService 复制文件到 Bridge Server 缓存目录
   Bridge 生成 JWT + document.key + document.url
   渲染进程 iframe 加载编辑器配置

2. 用户指派 Agent 任务
   AgentOrchestrator 接收任务 → LangChain Agent 推理
   Agent 调用 Tool: onlyoffice.insertText / replaceText / ...

3. Tool 执行
   Main Process → Agent 隐藏窗口 postMessage Connector API
   或 → OnlyOfficeBridge HTTP → 触发 Agent 编辑器会话中的 JS 宏

4. 实时同步
   Agent 编辑器的 OT 操作 → Document Server → WebSocket
   → 用户 iframe 自动收到变更（无需刷新）
```

### 4.4 IPC 通信设计

```typescript
// channels.ts
export const IPC = {
  FILE_LIST: 'file:list',
  FILE_OPEN: 'file:open',
  FILE_SEARCH: 'file:search',
  OO_GET_CONFIG: 'onlyoffice:get-config',      // 获取 iframe 配置
  OO_FORCE_SAVE: 'onlyoffice:force-save',
  OO_AGENT_EDIT: 'onlyoffice:agent-edit',       // Agent 执行编辑命令
  AGENT_CHAT: 'agent:chat',
  AGENT_RUN_TASK: 'agent:run-task',
  AGENT_LIST: 'agent:list',
  AGENT_SAVE: 'agent:save',
} as const
```

```typescript
// preload 暴露
contextBridge.exposeInMainWorld('api', {
  file: { list, open, search, getRecent },
  onlyoffice: { getConfig, forceSave },
  agent: { chat, runTask, list, save },
})
```

### 4.5 Agent 编辑工具设计

```typescript
// LangChain Tool 定义
const onlyofficeTools = [
  {
    name: 'insert_text',
    description: '在文档当前光标或指定位置插入文本',
    schema: z.object({ text: z.string(), position: z.enum(['cursor', 'end', 'start']).optional() }),
    func: async ({ text, position }) => {
      return ipc.invoke(IPC.OO_AGENT_EDIT, { action: 'insertText', text, position })
    },
  },
  {
    name: 'replace_text',
    description: '查找并替换文档中的文本',
    schema: z.object({ search: z.string(), replace: z.string(), all: z.boolean().optional() }),
    func: async (args) => ipc.invoke(IPC.OO_AGENT_EDIT, { action: 'replaceText', ...args }),
  },
  {
    name: 'read_document',
    description: '读取文档当前文本内容（通过 Document Server conversion API）',
    schema: z.object({}),
    func: async () => ipc.invoke(IPC.OO_AGENT_EDIT, { action: 'readDocument' }),
  },
]
```

### 4.6 Agent 可见编辑器路径

Agent 修改只发送到用户当前窗口中的编辑器实例。默认 Word 路径由 SuperDoc 执行实际事务，代码文件由 Monaco 执行范围编辑；OnlyOffice 仅在当前可见实例提供命令能力时执行，否则返回明确的不支持结果。隐藏 Agent 编辑器不再是正式修改路径。

---

## 5. OnlyOffice 自托管 (Docker)

```yaml
# docker/onlyoffice/docker-compose.yml
services:
  onlyoffice-documentserver:
    image: onlyoffice/documentserver:9.4.0.1
    ports:
      - "127.0.0.1:8080:80"
    environment:
      JWT_ENABLED: "true"
      JWT_SECRET: ${OO_JWT_SECRET:?Set a random secret of at least 32 bytes}
      JWT_HEADER: Authorization
    volumes:
      - oo_data:/var/www/onlyoffice/Data
      - oo_logs:/var/log/onlyoffice
volumes:
  oo_data:
  oo_logs:
```

**集成要点：**
1. **JWT**：`documentServerUrl` 所有请求需签名（`jsonwebtoken`）
2. **Callback URL**：Bridge 使用随机文档 ID，URL 中不包含本机路径
3. **document.url**：仅可读取应用已打开并登记的普通文档
4. **document.key**：使用不可猜测的会话文档 ID，关闭后轮换
5. **coEditing.mode**：`fast` 启用实时协同

---

## 6. Agent 系统架构

```
AgentOrchestrator
├── LLM Providers
│   ├── Ollama (本地 http://localhost:11434)
│   ├── DeepSeek API
│   ├── Qwen API (DashScope)
│   └── 豆包 API (Volcengine)
├── Agent Registry (JSON 持久化)
│   └── { id, name, role, systemPrompt, model, tools[], color }
├── Single Agent Executor
└── Multi-Agent Coordinator
    ├── Root Agent → 分解、委派与最终审阅
    ├── Child Agents → 执行、提问或继续委派
    ├── Collaboration Event Stream → 时间线与状态追踪
    └── Visible Document Bridge → Word、Monaco 与其他编辑器
```

---

## 7. 实现优先级与里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| P1 | Electron 初始化 + 布局 + IPC + 菜单 | 进行中 |
| P2 | 文件管理器 | 待做 |
| P3 | 本地轻量 Office 编辑器 | 已完成 |
| P4 | 协同编辑多参与者 | 待做 |
| P5 | Agent 框架 + 模型接入 | 已完成 |
| P6 | Agent 可见文档工具 + 实时同步 | 已完成 |
| P7 | 多 Agent 协作编排 | 已完成 |
| P8 | UI 打磨 | 进行中 |

---

## 8. 技术选型确认

- **构建**: electron-vite + electron-builder
- **UI**: React 18 + Tailwind CSS + shadcn/ui (Radix)
- **状态**: Zustand
- **Agent**: @langchain/core + @langchain/openai (兼容 Ollama OpenAI 接口)
- **Office**: SuperDoc + FortuneSheet + Monaco + PDF.js
- **可选 OnlyOffice Bridge**: 受 JWT 保护的 loopback Express 服务

---

## 9. Visible multi-agent workflow (current implementation)

### Thinking logic

1. The user chooses a root Agent and gives it a role such as planner, implementer, or reviewer.
2. The root Agent receives the task and the current document context. It breaks the task into explicit work items and chooses child Agents by role and model capability.
3. Each child Agent receives the original goal, its assigned work item, the latest shared context, and the visible document revision. A child may ask another Agent for a review, but every handoff is recorded as an event instead of being hidden inside a model prompt.
4. Before a document change, the operation is assigned an operation id and base revision. The editor reports preparation, cursor/selection movement, application, rejection, and the new revision.
5. Operations are serialized per document. A stop request aborts the model run and marks queued operations as cancelled; already-applied edits remain visible and can be reverted through the editor undo stack.
6. The root Agent performs a final review/synthesis turn and reports the resulting task state. The user can inspect the full conversation and stop at any point.

### What changes in the product

- Agent events are streamed through the main process to the collaboration timeline. The timeline shows questions, answers, handoffs, tool calls, document operations, failures, and cancellation.
- Word edits use the active SuperDoc instance. Text insertion and replacement are applied to the visible document transaction, not to a hidden Agent window or a marker appended to the file.
- Code edits use the active Monaco model with line/column ranges. The editor moves the real caret, reveals the target, and renders a temporary Agent cursor label at the operation location.
- Every visible edit carries `operationId`, `runId`, `agentId`, `baseRevision`, and `revision`. The bridge uses the revision to reject an Agent operation that would overwrite a user edit; the same contract supports future approval and operation-history features.
- The default lightweight Office path is the active Word/Monaco implementation. OnlyOffice uses a visible renderer bridge when enabled; the old hidden Agent window is no longer the official execution path.
- Chat and collaboration runs expose a Stop control. Cancellation is propagated through IPC to the model runner and the renderer operation queue.

### User-visible result

- The user sees which Agent is thinking, who asked whom for help, what tool was called, and which document operation is currently being applied.
- The Word preview or code editor changes immediately while the Agent works. A temporary virtual pointer identifies the active Agent and location.
- The user can interrupt an incorrect operation before the next queued change, keep the edits already made, and continue reviewing the document normally.
- Code changes preserve Monaco editing behavior, selection, undo grouping, dirty state, and save flow. Word changes remain in the same SuperDoc instance and are included in the normal save operation.

### File-type adapter boundary

| File type | Visible editor | Agent operation boundary | Stop behavior |
| --- | --- | --- | --- |
| Word | SuperDoc | insert, replace, append, read | cancel before the next operation |
| Code | Monaco | insert/replace/delete by line and column, read | cancel queued edits and keep applied hunks |
| Plain text | Text editor bridge | text insertion/replacement, read | cancel queued edits |
| Excel | Fortune Sheet | cell write/read | cancel queued cell writes |
| OnlyOffice Word | visible OnlyOffice instance | renderer command bridge when its plugin API is available | explicit unsupported result when the API is unavailable |

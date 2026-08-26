# WPS Agent Editor

跨平台桌面文档编辑器，提供本地优先的 Office、代码编辑与多 Agent 协作。

## 功能

- 文件管理器（文件树、搜索、最近文件）
- Word、Excel、PowerPoint、PDF、文本与代码文件的本地编辑/预览
- 多 Provider Agent 系统与可见的文档修改审批流程
- API Key 使用 Electron `safeStorage` 加密；不可用时仅保留在当前会话
- 受限导航、sandbox renderer、可信 IPC 与敏感文件过滤

## 快速开始

### 1. 安装依赖 & Electron

```bash
npm install
npm run install:electron
```

### 2. 启动应用

```bash
npm run dev
```

本地轻量编辑器是默认路径，不需要安装 OnlyOffice 或 Docker。需要模型能力时，
在应用右侧 Provider 设置中配置 API Key。

## 可选 OnlyOffice 兼容服务

遗留 Document Server 集成默认不启动。启用时，应用和 Document Server 必须使用
同一个至少 32 字节的随机 `OO_JWT_SECRET`。Docker 示例位于
`docker/onlyoffice/docker-compose.yml`，配置模板位于 `docker/onlyoffice/.env.example`。
Bridge 只监听 loopback，仅服务应用已打开并登记的文档。

## 跨平台打包

```bash
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run dist:linux  # Linux
```

## 架构

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)

## 技术栈

- Electron + React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- SuperDoc、FortuneSheet、Monaco Editor、PDF.js
- 可选 OnlyOffice Document Server
- LangChain.js

# WPS Agent Editor

跨平台桌面文档编辑器 — OnlyOffice + 多 Agent 实时协作。

## 功能

- 文件管理器（文件树、搜索、最近文件）
- OnlyOffice 嵌入式编辑器（Word、Excel、PDF）
- 多 Agent 系统（DeepSeek、Qwen、豆包、Ollama）
- Agent 实时修改文档，用户界面同步可见

## 快速开始（离线优先）

### 1. 安装依赖 & Electron

```bash
npm install
npm run install:electron
```

### 2. 启动应用

```bash
npm run dev
```

### 3. 首次使用 — 安装本地 Office 引擎

应用启动后会引导你：

1. **下载** OnlyOffice Document Server 安装包（保存到本地）
2. **安装** 运行安装向导（一次性，约 2GB）
3. **检测** 确认本地引擎运行

完成后即可 **完全离线** 编辑 Word / Excel / PPT / PDF，无需 Docker、无需联网。

> 文档 Bridge 服务已内嵌在应用中（端口 13001），无需单独启动 `dev:bridge`。

### 4. 配置 API Key

在应用右侧 Agent 面板中配置各模型的 API Key，或设置环境变量：

```bash
set DEEPSEEK_API_KEY=sk-xxx
set QWEN_API_KEY=sk-xxx
```

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
- OnlyOffice Document Server
- LangChain.js
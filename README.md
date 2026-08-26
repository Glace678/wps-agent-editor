<div align="center">

# WPS Agent Editor

**跨平台轻量级桌面文档编辑器 · 本地优先 · 多 Agent 智能协作**

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-orange.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Release](https://img.shields.io/github/v/release/Glace678/wps-agent-editor?color=blue&label=Release)](https://github.com/Glace678/wps-agent-editor/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Glace678/wps-agent-editor)
[![Electron](https://img.shields.io/badge/Electron-34.x-47848F?logo=electron&logoColor=white)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<br />

<!-- Language Navigation Bar -->
[简体中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [Français](./README_FR.md) | [Deutsch](./README_DE.md) | [Español](./README_ES.md) | [Português](./README_PT.md) | [Русский](./README_RU.md) | [العربية](./README_AR.md)

</div>

---

## 项目简介

**WPS Agent Editor** 是一款专为下一代人机协同办公设计的**跨平台桌面文档编辑器**。

项目深度融合了**本地优先（Local-first）轻量 Office 编辑体系**与**前沿的多智能体（Multi-Agent）自主协同网络**。无论是撰写复杂 Word 文档、处理多维 Excel 数据表格、放映 PPT 演示文稿、查阅 PDF，还是进行多语言代码开发，WPS Agent Editor 都能为您提供丝滑的本地编辑体验与强大的 AI 伴写能力。

---

## 核心特性

### 1. 全格式本地优先文档套件
无需依赖外部重型服务端，开箱即用：
* **文档编辑 (Word / DOCX / DOC)**：基于轻量排版引擎，支持富文本样式、段落排版、表格插入、批注与标题层级大纲。
* **表格计算 (Excel / XLSX / XLS / CSV)**：集成高性能电子表格，内置丰富数学/统计公式、单元格样式定制、数据筛选与多工作表管理。
* **幻灯片演示 (PowerPoint / PPTX)**：支持幻灯片结构化渲染、母版解析与全屏沉浸式放映预览模式。
* **专业代码与文本编辑**：内置 Monaco Editor（VS Code 核心编辑器），支持 50+ 种主流编程语言语法高亮、代码折叠、正则查找替换与智能提示。
* **PDF 阅读与解析**：支持多页平滑滚动、目录跳转、缩放自适应与加密文档解密。
* **Markdown 即时创作**：支持 GFM 扩展语法、实时目录大纲与富文本双向同步。

### 2. 多 Agent 智能协同创作网络
打破单一 AI 对话框的局限，构建多角色协同矩阵：
* **多模型统一接入**：原生聚合 **OpenAI (GPT-4o/o3)**、**Anthropic (Claude 3.5/3.7)**、**Google (Gemini 2.0)**、**字节跳动 (ByteDance Seed / 豆包)**、**DeepSeek** 以及 **Ollama 本地私有化模型**。
* **专业化分工协作**：内置文档改写助手、数据透视助手、演示文稿策划助手与代码审查助手。
* **可信文档 Diff 审批流**：Agent 的每一次改动均以直观的 Git 风格 Diff 差异高亮呈现，需用户一键审查批准后方可生效，彻底避免内容被不可逆覆盖。
* **智能上下文缓存**：针对长文档优化 Prompt 缓存机制，极大降低 Token 开销与响应延迟。

### 3. 严谨的本地安全与隐私保护
* **系统级密钥加密**：所有 Provider API Key 均采用 Electron 原生 `safeStorage`（Windows DPAPI / macOS Keychain）底层加密存储。
* **纯本地脱敏过滤**：敏感系统文件自动隔离与过滤，确保本地隐私数据零泄露。
* **沙箱隔离架构**：严格的 IPC 权限白名单机制与 Sandbox Renderer，杜绝恶意脚本注入。

### 4. 全球化 9 语言支持
UI 与 Agent 系统深度本地化，支持 **9 种国际主流语言**一键即时无缝切换：
> 简体中文 · English · 日本語 · Français · Deutsch · Español · Português · Русский · العربية

---

## 下载安装

前往 [GitHub Releases 发行版页面](https://github.com/Glace678/wps-agent-editor/releases) 获取最新安装包：

* **Windows 安装包**：[`WPS.Agent.Editor.Setup.1.0.0.exe`](https://github.com/Glace678/wps-agent-editor/releases/download/v1.0.0/WPS.Agent.Editor.Setup.1.0.0.exe) *(双击安装，支持自定义安装路径)*
* **源码运行与便携版**：支持跨平台本地编译打包。

---

## 开发者快速开始

### 运行环境准备
* [Node.js](https://nodejs.org/) (>= 18.0.0)
* npm 或 pnpm / yarn

### 1. 克隆仓库并安装依赖
```bash
git clone https://github.com/Glace678/wps-agent-editor.git
cd wps-agent-editor

# 安装项目依赖
npm install

# 安装 Electron 运行依赖
npm run install:electron
```

### 2. 启动本地开发模式
```bash
npm run dev
```
启动后，可在应用右侧的 **Provider 设置** 中配置您所需的 AI 模型 API Key 或本地 Ollama 服务地址。

---

## 跨平台打包构建

本项目支持一键生成多平台桌面客户端二进制安装包：

```bash
# Windows (.exe)
npm run dist:win

# macOS (.dmg / .zip)
npm run dist:mac

# Linux (.AppImage / .deb)
npm run dist:linux
```

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Electron Main Process (Node.js)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ FileService  │  │ MenuManager  │  │ AgentOrchest │  │ SafeStorage     │ │
│  │ (Local FS)   │  │ (Native Menu)│  │ (LangChain.js)│ │ (Key Encryption)│ │
│  └──────┬───────┘  └──────────────┘  └──────┬───────┘  └─────────────────┘ │
│         │ IPC Secure Channel                 │ IPC State Stream              │
└─────────┼────────────────────────────────────┼─────────────────────────────┘
          │                                    │
┌─────────▼────────────────────────────────────▼─────────────────────────────┐
│                      Renderer Process (React + TypeScript + Vite)            │
│  ┌────────────┐  ┌─────────────────────────┐  ┌──────────────────────────┐ │
│  │ FileManager│  │ LightweightDocumentEditor│  │ AgentCollaborationWorkspace│
│  │ Tree/Search│  │ Word/Excel/PPT/PDF/Code │  │ Chat/Tasks/Diff Approval │ │
│  └────────────┘  └─────────────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 贡献者与 AI 协作者 (Contributors & AI Collaborators)

本项目在架构设计、核心逻辑编写与代码重构演进过程中，深度协同了以下 AI 智能体共同参与构建：

<table>
  <tr>
    <td align="center" width="160px">
      <a href="https://anthropic.com/claude">
        <img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/claude-color.png" width="60px;" alt="Claude"/><br />
        <sub><b>Claude</b></sub>
      </a><br />
      <sub>(Anthropic)</sub>
    </td>
    <td align="center" width="160px">
      <a href="https://openai.com">
        <img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/openai.png" width="60px;" alt="GPT"/><br />
        <sub><b>GPT</b></sub>
      </a><br />
      <sub>(OpenAI)</sub>
    </td>
    <td align="center" width="160px">
      <a href="https://deepmind.google/technologies/gemini/">
        <img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/gemini-color.png" width="60px;" alt="Gemini"/><br />
        <sub><b>Gemini</b></sub>
      </a><br />
      <sub>(Google DeepMind)</sub>
    </td>
    <td align="center" width="160px">
      <a href="https://seed.bytedance.com/en/">
        <img src="https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/dark/doubao-color.png" width="60px;" alt="ByteDance Seed"/><br />
        <sub><b>Seed (豆包)</b></sub>
      </a><br />
      <sub>(ByteDance)</sub>
    </td>
  </tr>
</table>

---

## 开源许可证 (License)

本项目采用 **[Creative Commons Attribution-NonCommercial 4.0 International (CC-BY-NC 4.0)](./LICENSE)** 许可协议。

* 允许个人免费学习、研究、分发和二次开发。
* **严格禁止任何形式的商业盈利性使用**。

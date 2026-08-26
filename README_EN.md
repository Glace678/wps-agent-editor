<div align="center">

# WPS Agent Editor

**Cross-platform Lightweight Desktop Document Editor · Local-First · Multi-Agent Collaboration**

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

## Overview

**WPS Agent Editor** is a cross-platform desktop document editor designed for next-generation human-AI collaborative workflows.

It seamlessly combines a **local-first lightweight Office editing suite** with a **multi-agent autonomous collaboration network**. Whether you are drafting complex Word documents, analyzing multi-dimensional Excel spreadsheets, presenting PPT slide decks, reading PDFs, or writing code across 50+ programming languages, WPS Agent Editor delivers a fluid local editing experience alongside powerful AI co-authoring capabilities.

---

## Key Features

### 1. Local-First Multi-Format Document Suite
No heavyweight background server required — ready out of the box:
* **Word Processing (DOCX / DOC)**: Lightweight rich text formatting engine supporting headings, tables, styles, annotations, and hierarchical outlines.
* **Spreadsheets (Excel / XLSX / XLS / CSV)**: High-performance spreadsheet interface with mathematical & statistical formulas, cell styling, data filtering, and multi-sheet workbooks.
* **Presentations (PowerPoint / PPTX)**: Structural slide deck rendering, master layout parsing, and full-screen presentation mode.
* **Professional Code & Text Editor**: Powered by Monaco Editor (the core engine of VS Code) with syntax highlighting for 50+ languages, code folding, regex find/replace, and autocompletion.
* **PDF Viewer & Parser**: Multi-page continuous scrolling, table of contents navigation, responsive zooming, and password-protected document decryption.
* **Real-Time Markdown**: GFM tables, dynamic outline generation, and bidirectional rich text synchronization.

### 2. Multi-Agent Collaboration Network
Moving beyond single chatbots to an orchestrated multi-role team:
* **Unified Multi-Provider Support**: Native integrations for **OpenAI (GPT-4o/o3)**, **Anthropic (Claude 3.5/3.7)**, **Google (Gemini 2.0)**, **ByteDance (Seed / Doubao)**, **DeepSeek**, and **Ollama local models**.
* **Specialized Agent Roles**: Document drafting & rewriting agent, spreadsheet data analysis agent, presentation planner, and code reviewer.
* **Trustworthy Diff Review & Approval**: Every proposed modification is displayed in an interactive Git-style visual diff, requiring explicit user approval before execution.
* **Intelligent Context Caching**: Optimized prompt cache handling for long documents, dramatically cutting token costs and latency.

### 3. Enterprise-Grade Local Security & Privacy
* **System-Level Credential Encryption**: All API keys are securely encrypted using Electron native `safeStorage` (Windows DPAPI / macOS Keychain).
* **Local Sensitive File Isolation**: Automatic file isolation and filtering to prevent private data leakage.
* **Hardened Sandbox Architecture**: Strict IPC permission whitelist and sandboxed renderer preventing malicious script execution.

### 4. Global 9-Language Localization
Seamless real-time switching between 9 major international languages:
> Simplified Chinese · English · Japanese · French · German · Spanish · Portuguese · Russian · Arabic

---

## Download & Installation

Visit the [GitHub Releases Page](https://github.com/Glace678/wps-agent-editor/releases) to download:

* **Windows Installer**: [`WPS.Agent.Editor.Setup.1.0.0.exe`](https://github.com/Glace678/wps-agent-editor/releases/download/v1.0.0/WPS.Agent.Editor.Setup.1.0.0.exe) *(Supports custom installation directory)*
* **Build from Source**: Cross-platform compilation supported for macOS and Linux.

---

## Developer Quick Start

### Prerequisites
* [Node.js](https://nodejs.org/) (>= 18.0.0)
* npm, pnpm, or yarn

### 1. Clone Repository & Install Dependencies
```bash
git clone https://github.com/Glace678/wps-agent-editor.git
cd wps-agent-editor

npm install
npm run install:electron
```

### 2. Start Development Mode
```bash
npm run dev
```
After starting, configure your AI Provider API Keys or local Ollama URL in the right-side **Provider Settings**.

---

## Cross-Platform Build

Generate standalone desktop installers with a single command:

```bash
# Windows (.exe)
npm run dist:win

# macOS (.dmg / .zip)
npm run dist:mac

# Linux (.AppImage / .deb)
npm run dist:linux
```

---

## System Architecture

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

## Contributors & AI Collaborators

This project was architected, developed, and refactored in deep synergy with the following AI models:

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

## License

This project is licensed under **[Creative Commons Attribution-NonCommercial 4.0 International (CC-BY-NC 4.0)](./LICENSE)**.

* Free for personal learning, research, and non-commercial development.
* **Commercial use of any kind is strictly prohibited.**

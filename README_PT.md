<div align="center">

# 📝 WPS Agent Editor

**Editor de documentos desktop leve e multiplataforma · Local-First · Colaboração Multi-Agente**

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-orange.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Release](https://img.shields.io/github/v/release/Glace678/wps-agent-editor?color=blue&label=Release)](https://github.com/Glace678/wps-agent-editor/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Glace678/wps-agent-editor)
[![Electron](https://img.shields.io/badge/Electron-34.x-47848F?logo=electron&logoColor=white)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<br />

<!-- Language Navigation Bar -->
[简体中文](./README.md) &nbsp;|&nbsp; [English](./README_EN.md) &nbsp;|&nbsp; [日本語](./README_JA.md) &nbsp;|&nbsp; [Français](./README_FR.md) &nbsp;|&nbsp; [Deutsch](./README_DE.md) &nbsp;|&nbsp; [Español](./README_ES.md) &nbsp;|&nbsp; [🌐 Português](./README_PT.md) &nbsp;|&nbsp; [Русский](./README_RU.md) &nbsp;|&nbsp; [العربية](./README_AR.md)

</div>

---

## 📖 Visão Geral

**WPS Agent Editor** é um editor de documentos desktop inovador, projetado para fluxos de trabalho colaborativos entre humanos e IA.

Integra uma suíte Office **Local-First** com uma rede de **múltiplos agentes autônomos**.

---

## ✨ Recursos Principais

### 1. 📄 Suíte de Documentos Multiformato Local-First
* **📝 Processamento de Texto (DOCX / DOC)**: Formatação avançada, tabelas, anotações e sumários hierárquicos.
* **📊 Planilhas (Excel / XLSX / XLS / CSV)**: Fórmulas matemáticas e estatísticas, estilos de células e abas múltiplas.
* **📑 Apresentações (PowerPoint / PPTX)**: Renderização de slides e modo apresentação em tela cheia.
* **💻 Editor de Código e Texto**: Monaco Editor integrado com suporte a mais de 50 linguagens.
* **📕 Leitor PDF**: Rolagem suave, navegação por índice e descriptografia.
* **📋 Markdown em Tempo Real**: Tabelas GFM e sincronização bidirecional.

### 2. 🤖 Rede de Colaboração Multi-Agente
* **Integração Multi-Provedor**: **OpenAI (GPT-4o/o3)**, **Anthropic (Claude 3.5/3.7)**, **Google (Gemini 2.0)**, **ByteDance (Seed / Doubao)**, **DeepSeek** e **Ollama**.
* **Fluxo de Aprovação Diff**: Alterações exibidas em Diff visual estilo Git com aprovação do usuário.
* **Cache Inteligente**: Otimização de contexto e redução de latência.

### 3. 🔒 Segurança e Privacidade Local
* **Criptografia de Chaves**: Chaves de API salvas via `safeStorage` do Electron.
* **Isolamento de Arquivos Sensíveis**: Filtragem segura de dados locais.

### 4. 🌍 Suporte a 9 Idiomas Globais
> Chinês Simplificado · Inglês · Japonês · Francês · Alemão · Espanhol · Português · Russo · Árabe

---

## 📥 Download e Instalação

Baixe em [GitHub Releases](https://github.com/Glace678/wps-agent-editor/releases):

* **Instalador Windows**: [`WPS.Agent.Editor.Setup.1.0.0.exe`](https://github.com/Glace678/wps-agent-editor/releases/download/v1.0.0/WPS.Agent.Editor.Setup.1.0.0.exe)

---

## 🚀 Início Rápido

### Pré-requisitos
* [Node.js](https://nodejs.org/) (>= 18.0.0)
* npm, pnpm ou yarn

### 1. Clonar e Instalar
```bash
git clone https://github.com/Glace678/wps-agent-editor.git
cd wps-agent-editor

npm install
npm run install:electron
```

### 2. Iniciar Desenvolvimento
```bash
npm run dev
```

---

## 📦 Build Multiplataforma

Comandos para compilação:

```bash
# Windows (.exe)
npm run dist:win

# macOS (.dmg / .zip)
npm run dist:mac

# Linux (.AppImage / .deb)
npm run dist:linux
```

---

## 🏛️ Arquitetura

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

## 🤖 Contribuidores e Colaboradores IA

Desenvolvido em colaboração com os seguintes modelos de IA:

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

## 📄 Licença

Licenciado sob **[Creative Commons Atribuição-NãoComercial 4.0 Internacional (CC-BY-NC 4.0)](./LICENSE)**.

* Uso comercial estritamente proibido.

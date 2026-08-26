<div align="center">

# 📝 WPS Agent Editor

**Кроссплатформенный легковесный редактор документов · Local-First · Мульти-агентная коллаборация**

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-orange.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Release](https://img.shields.io/github/v/release/Glace678/wps-agent-editor?color=blue&label=Release)](https://github.com/Glace678/wps-agent-editor/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Glace678/wps-agent-editor)
[![Electron](https://img.shields.io/badge/Electron-34.x-47848F?logo=electron&logoColor=white)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<br />

<!-- Language Navigation Bar -->
[简体中文](./README.md) &nbsp;|&nbsp; [English](./README_EN.md) &nbsp;|&nbsp; [日本語](./README_JA.md) &nbsp;|&nbsp; [Français](./README_FR.md) &nbsp;|&nbsp; [Deutsch](./README_DE.md) &nbsp;|&nbsp; [Español](./README_ES.md) &nbsp;|&nbsp; [Português](./README_PT.md) &nbsp;|&nbsp; [🌐 Русский](./README_RU.md) &nbsp;|&nbsp; [العربية](./README_AR.md)

</div>

---

## 📖 О проекте

**WPS Agent Editor** — это современный кроссплатформенный редактор документов для совместной работы человека и ИИ.

Проект сочетает легковесный офисный пакет с концепцией **Local-First** и автономную сеть **мульти-агентов ИИ**.

---

## ✨ Основные возможности

### 1. 📄 Офисный пакет Local-First
* **📝 Текстовые документы (DOCX / DOC)**: Форматирование текста, таблицы, стили и структура заголовков.
* **📊 Таблицы (Excel / XLSX / XLS / CSV)**: Математические формулы, стили ячеек, фильтрация и вкладки.
* **📑 Презентации (PowerPoint / PPTX)**: Просмотр слайдов и полноэкранный режим презентации.
* **💻 Редактор кода и текста**: Встроенный Monaco Editor с подсветкой синтаксиса для 50+ языков.
* **📕 Просмотр PDF**: Плавная прокрутка, оглавление и дешифрование защищенных файлов.
* **📋 Markdown в реальном времени**: Поддержка GFM-таблиц и оглавления.

### 2. 🤖 Мульти-агентная экосистема
* **Поддержка ведущих провайдеров**: **OpenAI (GPT-4o/o3)**, **Anthropic (Claude 3.5/3.7)**, **Google (Gemini 2.0)**, **ByteDance (Seed / Doubao)**, **DeepSeek** и **локальные модели Ollama**.
* **Безопасный процесс утверждения Diff**: Изменения отображаются в виде визуального Diff перед применением.
* **Умное кэширование контекста**: Снижение задержек и экономия токенов.

### 3. 🔒 Локальная безопасность и конфиденциальность
* **Шифрование ключей API**: Защита через Electron `safeStorage`.
* **Фильтрация конфиденциальных файлов**: Предотвращение утечек данных.

### 4. 🌍 Поддержка 9 языков
> Упрощенный китайский · Английский · Японский · Французский · Немецкий · Испанский · Португальский · Русский · Арабский

---

## 📥 Загрузка и установка

Скачать последнюю версию на [GitHub Releases](https://github.com/Glace678/wps-agent-editor/releases):

* **Установщик для Windows**: [`WPS.Agent.Editor.Setup.1.0.0.exe`](https://github.com/Glace678/wps-agent-editor/releases/download/v1.0.0/WPS.Agent.Editor.Setup.1.0.0.exe)

---

## 🚀 Быстрый старт для разработчиков

### Требования
* [Node.js](https://nodejs.org/) (>= 18.0.0)
* npm, pnpm или yarn

### 1. Клонирование и установка
```bash
git clone https://github.com/Glace678/wps-agent-editor.git
cd wps-agent-editor

npm install
npm run install:electron
```

### 2. Запуск разработки
```bash
npm run dev
```

---

## 📦 Сборка для платформ

Команды сборки инсталляторов:

```bash
# Windows (.exe)
npm run dist:win

# macOS (.dmg / .zip)
npm run dist:mac

# Linux (.AppImage / .deb)
npm run dist:linux
```

---

## 🏛️ Архитектура системы

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

## 🤖 Участники и ИИ-коллабораторы

Проект разработан в тесном сотрудничестве со следующими моделями ИИ:

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

## 📄 Лицензия

Лицензировано под **[CC-BY-NC 4.0 (Attribution-NonCommercial 4.0 International)](./LICENSE)**.

* Коммерческое использование строго запрещено.

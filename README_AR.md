<div align="center">

# 📝 WPS Agent Editor

**محرر مستندات مكتبي خفيف الوزن ومتعدد المنصات · محلي أولاً (Local-First) · تعاون متعدد الوكلاء الذكيين**

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-orange.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Release](https://img.shields.io/github/v/release/Glace678/wps-agent-editor?color=blue&label=Release)](https://github.com/Glace678/wps-agent-editor/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Glace678/wps-agent-editor)
[![Electron](https://img.shields.io/badge/Electron-34.x-47848F?logo=electron&logoColor=white)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<br />

<!-- Language Navigation Bar -->
[简体中文](./README.md) &nbsp;|&nbsp; [English](./README_EN.md) &nbsp;|&nbsp; [日本語](./README_JA.md) &nbsp;|&nbsp; [Français](./README_FR.md) &nbsp;|&nbsp; [Deutsch](./README_DE.md) &nbsp;|&nbsp; [Español](./README_ES.md) &nbsp;|&nbsp; [Português](./README_PT.md) &nbsp;|&nbsp; [Русский](./README_RU.md) &nbsp;|&nbsp; [🌐 العربية](./README_AR.md)

</div>

---

## 📖 نظرة عامة

يعد **WPS Agent Editor** محرر مستندات سطح مكتب متطور ومصمم للجيل القادم من التعاون بين الإنسان والذكاء الاصطناعي.

يجمع بين **حزمة مكتبية خفيفة تركز على الخصوصية المحلية** وشبكة متكاملة من **الوكلاء الأذكياء متعددي المهام**.

---

## ✨ المميزات الرئيسية

### 1. 📄 حزمة مكتبية محلية متعددة التنسيقات
* **📝 معالجة النصوص (DOCX / DOC)**: تنسيق نصي غني، جداول، وهوامش ومخططات هيكلية.
* **📊 جداول البيانات (Excel / XLSX / XLS / CSV)**: صيغ رياضية وإحصائية، تنسيق خلايا، تصفية وأوراق متعددة.
* **📑 العروض التقديمية (PowerPoint / PPTX)**: عرض الشرائح، تحليل القوالب الرئيسية ووضع ملء الشاشة.
* **💻 محرر الأكواد والنصوص**: محرك Monaco Editor المدمج مع دعم أكثر من 50 لغة برمجة.
* **📕 قارئ PDF**: تمرير سلس، فهرس المحتويات وفك تشفير المستندات المحمية.
* **📋 محرر Markdown**: دعم جداول GFM وتحديث فوري.

### 2. 🤖 شبكة تعاون متعددة الوكلاء (Multi-Agent)
* **دعم مزودين متعددين**: **OpenAI (GPT-4o/o3)**، **Anthropic (Claude 3.5/3.7)**، **Google (Gemini 2.0)**، **ByteDance (Seed / Doubao)**، **DeepSeek** ونماذج **Ollama المحلية**.
* **سير عمل مراجعة التغييرات (Diff Approval)**: عرض جميع التعديلات المقترحة في شكل مقارنة بصرية قبل التطبيق.
* **تخزين ذكي للسياق**: تقليل استهلاك التوكنز وتسريع الاستجابة.

### 3. 🔒 أمان وخصوصية محلية فائقة
* **تشفير المفاتيح**: حفظ مفاتيح API عبر `safeStorage` المشفر على مستوى النظام.
* **عزل الملفات الحساسة**: حماية تامة للبيانات المحلية.

### 4. 🌍 دعم عالمي لـ 9 لغات
> الصينية المبسطة · الإنجليزية · اليابانية · الفرنسية · الألمانية · الإسبانية · البرتغالية · الروسية · العربية

---

## 📥 التحميل والتثبيت

قم بزيارة [GitHub Releases](https://github.com/Glace678/wps-agent-editor/releases) للتحميل:

* **مثبت Windows**: [`WPS.Agent.Editor.Setup.1.0.0.exe`](https://github.com/Glace678/wps-agent-editor/releases/download/v1.0.0/WPS.Agent.Editor.Setup.1.0.0.exe)

---

## 🚀 البدء السريع للمطورين

### المتطلبات
* [Node.js](https://nodejs.org/) (>= 18.0.0)
* npm أو pnpm أو yarn

### 1. استنساخ المشروع وتثبيت الحزم
```bash
git clone https://github.com/Glace678/wps-agent-editor.git
cd wps-agent-editor

npm install
npm run install:electron
```

### 2. تشغيل وضع التطوير
```bash
npm run dev
```

---

## 📦 البناء والتجميع لعدة منصات

أوامر البناء والتصدير:

```bash
# Windows (.exe)
npm run dist:win

# macOS (.dmg / .zip)
npm run dist:mac

# Linux (.AppImage / .deb)
npm run dist:linux
```

---

## 🏛️ البنية الهندسية للنظام

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

## 🤖 المساهمون ووكلاء الذكاء الاصطناعي

تم بناء هذا المشروع بالتعاون العميق مع نماذج الذكاء الاصطناعي التالية:

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

## 📄 الترخيص

مرخص بموجب **[CC-BY-NC 4.0 (نسب المصنف - غير تجاري 4.0 دولي)](./LICENSE)**.

* الاستخدام التجاري محظور تماماً.

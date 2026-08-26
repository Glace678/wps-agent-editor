<div align="center">

# WPS Agent Editor

**Editor de documentos de escritorio ligero y multiplataforma · Local-First · Colaboración Multi-Agente**

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

## Descripción General

**WPS Agent Editor** es un editor de documentos de escritorio diseñado para la colaboración humano-IA de próxima generación.

Combina una suite ofimática ligera **Local-First** con una red autónoma de **múltiples agentes inteligentes**. Compatible con Word, Excel, PowerPoint, PDF y código en más de 50 lenguajes.

---

## Características Principales

### 1. Suite Ofimática Local-First Multiformato
Listo para usar sin servidores pesados:
* **Procesador de Textos (DOCX / DOC)**: Formato enriquecido, tablas, estilos, anotaciones y esquemas jerárquicos.
* **Hojas de Cálculo (Excel / XLSX / XLS / CSV)**: Fórmulas matemáticas/estadísticas, estilos de celda, filtros y soporte multisección.
* **Diapositivas (PowerPoint / PPTX)**: Renderizado de diapositivas, estilos maestros y modo presentación a pantalla completa.
* **Editor de Código y Texto**: Motor Monaco Editor (el núcleo de VS Code) con resaltado para más de 50 lenguajes.
* **Lector PDF**: Desplazamiento fluido, índice de contenidos y descifrado seguro.
* **Markdown en Tiempo Real**: Tablas GFM, esquema dinámico y sincronización visual.

### 2. Ecosistema Colaborativo Multi-Agente
Un equipo de asistentes especializados:
* **Soporte Multi-Proveedor**: **OpenAI (GPT-4o/o3)**, **Anthropic (Claude 3.5/3.7)**, **Google (Gemini 2.0)**, **ByteDance (Seed / Doubao)**, **DeepSeek** y **modelos locales Ollama**.
* **Roles Especializados**: Asistente de redacción, análisis de datos, diseño de presentaciones y revisión de código.
* **Flujo de Aprobación Diff Confiable**: Cada modificación se muestra en un Diff visual estilo Git y requiere confirmación del usuario.
* **Caché Inteligente de Contexto**: Reduce costes de tokens y tiempos de respuesta.

### 3. Seguridad y Privacidad Local
* **Cifrado de Credenciales**: Las claves API se almacenan con `safeStorage` de Electron.
* **Aislamiento de Archivos Sensibles**: Filtrado automático de archivos del sistema.
* **Arquitectura Sandbox**: Permisos IPC estrictos y renderizado seguro.

### 4. Soporte Global para 9 Idiomas
Interfaz localizada en 9 idiomas principales:
> Chino simplificado · Inglés · Japonés · Francés · Alemán · Español · Portugués · Ruso · Árabe

---

## Descarga e Instalación

Visite [GitHub Releases](https://github.com/Glace678/wps-agent-editor/releases) para descargar:

* **Instalador de Windows**: [`WPS.Agent.Editor.Setup.1.0.0.exe`](https://github.com/Glace678/wps-agent-editor/releases/download/v1.0.0/WPS.Agent.Editor.Setup.1.0.0.exe)

---

## Inicio Rápido para Desarrolladores

### Requisitos previos
* [Node.js](https://nodejs.org/) (>= 18.0.0)
* npm, pnpm o yarn

### 1. Clonar e Instalar
```bash
git clone https://github.com/Glace678/wps-agent-editor.git
cd wps-agent-editor

npm install
npm run install:electron
```

### 2. Modo Desarrollo
```bash
npm run dev
```

---

## Construcción Multiplataforma

Genere ejecutables con un solo comando:

```bash
# Windows (.exe)
npm run dist:win

# macOS (.dmg / .zip)
npm run dist:mac

# Linux (.AppImage / .deb)
npm run dist:linux
```

---

## Arquitectura del Sistema

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                        Electron Main Process (Node.js)                        │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │  FileService  │  │  MenuManager  │  │ AgentOrchestr │  │  SafeStorage  │   │
│  │  (Local FS)   │  │ (Native Menu) │  │ (LangChain.js)│  │(KeyEncryption)│   │
│  └───────┬───────┘  └───────────────┘  └───────┬───────┘  └───────────────┘   │
│         │ IPC Secure Channel                  │ IPC State Stream              │
└─────────┼─────────────────────────────────────┼───────────────────────────────┘
          │                                     │
┌─────────▼─────────────────────────────────────▼───────────────────────────────┐
│                 Renderer Process (React + TypeScript + Vite)                  │
│ ┌─────────────────────┐ ┌────────────────────────┐ ┌────────────────────────┐ │
│ │     FileManager     │ │  LightweightDocEditor  │ │ AgentCollaborateSpace  │ │
│ │    (Tree/Search)    │ │ (Word/Excel/PPT/Code)  │ │(Chat/Tasks/DiffReview) │ │
│ └─────────────────────┘ └────────────────────────┘ └────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## Contribuidores y Colaboradores IA

Proyecto desarrollado y optimizado en colaboración con los siguientes modelos de IA:

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

## Licencia

Licenciado bajo **[Creative Commons Atribución-NoComercial 4.0 Internacional (CC-BY-NC 4.0)](./LICENSE)**.

* Gratuito para aprendizaje e investigación.
* **Uso comercial estrictamente prohibido.**

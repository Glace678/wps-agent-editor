<div align="center">

# WPS Agent Editor

**Plattformübergreifender, leichtgewichtiger Desktop-Dokumenteneditor · Local-First · Multi-Agent-Kollaboration**

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-orange.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Release](https://img.shields.io/github/v/release/Glace678/wps-agent-editor?color=blue&label=Release)](https://github.com/Glace678/wps-agent-editor/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Glace678/wps-agent-editor)
[![Electron](https://img.shields.io/badge/Electron-34.x-47848F?logo=electron&logoColor=white)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<br />

<!-- Language Navigation Bar -->
[简体中文](./README.md) | [English](./README_EN.md) | [日本語](./README_JA.md) | [Français](./README_FR.md) | [Deutsch](./README_DE.md) | [Español](./README_ES.md) | [Português](./README_PT.md) | [Русский](./README_RU.md) | [العربية](./README_AR.md)

<br />
<sub>Diese Dokumentation und alle Sprachversionen werden von Gemini verfasst und gepflegt</sub>

</div>

---

## Projektübersicht

**WPS Agent Editor** ist ein moderner, plattformübergreifender Dokumenteneditor für die Mensch-KI-Kollaboration der nächsten Generation.

Er verbindet eine **Local-First-Office-Suite** mit einem **autonomen Multi-Agenten-Netzwerk**. Ob Word-Dokumente, Excel-Tabellen, PowerPoint-Folien, PDFs oder Code in über 50 Programmiersprachen – WPS Agent Editor bietet herausragende Performance und intelligente KI-Unterstützung.

---

## Hauptfunktionen

### 1. Local-First Multi-Format-Dokumentensuite
Sofort einsatzbereit ohne schwere Hintergrundserver:
* **Textverarbeitung (DOCX / DOC)**: Schlanke Rendering-Engine mit Formatierungen, Überschriftenhierarchien, Tabellen und Anmerkungen.
* **Tabellenkalkulation (Excel / XLSX / XLS / CSV)**: Leistungsstarke Tabellen mit mathematischen & statistischen Formeln, Zellstilen und Multi-Sheet-Support.
* **Präsentationen (PowerPoint / PPTX)**: Strukturierte Folienanzeige, Master-Folien-Parsing und Vollbild-Präsentationsmodus.
* **Professioneller Code-Editor**: Integrierter Monaco Editor (VS Code Kern) mit Syntax-Highlighting für 50+ Sprachen, Code-Faltung und Regex-Suche.
* **PDF-Viewer**: Flüssiges Multi-Page-Scrolling, Inhaltsverzeichnisnavigation und passwortgeschützte Entschlüsselung.
* **Live-Markdown**: GFM-Tabellen, dynamisches Inhaltsverzeichnis und bidirektionale Synchronisierung.

### 2. Multi-Agenten-Kollaborationsnetzwerk
Mehr als nur ein Chatbot – ein koordiniertes KI-Team:
* **Multi-Provider-Unterstützung**: Native Anbindung an **OpenAI (GPT-4o/o3)**, **Anthropic (Claude 3.5/3.7)**, **Google (Gemini 2.0)**, **ByteDance (Seed / Doubao)**, **DeepSeek** und **lokale Ollama-Modelle**.
* **Spezialisierte Agenten-Rollen**: Dokumenten-Assistent, Datenanalyse-Assistent, Präsentationsplaner und Code-Reviewer.
* **Sicherer Diff-Prüfungs-Workflow**: Alle vorgeschlagenen Änderungen werden als interaktiver Git-Diff visualisiert und erst nach Freigabe angewendet.
* **Smart Context Caching**: Optimiertes Prompt-Caching für lange Dokumente minimiert Token-Kosten und Latenzen.

### 3. Höchste lokale Sicherheit & Datenschutz
* **Systemverschlüsselung für API-Keys**: API-Schlüssel werden über Electrons `safeStorage` (Windows DPAPI / macOS Keychain) verschlüsselt gespeichert.
* **Lokale Datenfilterung**: Automatische Isolation sensibler Systemdateien.
* **Sandbox-Architektur**: Strikte IPC-Whitelist und isolierte Renderer-Prozesse.

### 4. Globale Unterstützung für 9 Sprachen
Vollständig lokalisierte Oberfläche und Agenten in 9 Sprachen:
> Vereinfachtes Chinesisch · Englisch · Japanisch · Französisch · Deutsch · Spanisch · Portugiesisch · Russisch · Arabisch

---

## Download & Installation

Laden Sie die neueste Version auf der [GitHub Releases-Seite](https://github.com/Glace678/wps-agent-editor/releases) herunter:

* **Windows-Installer**: [`WPS.Agent.Editor.Setup.1.0.0.exe`](https://github.com/Glace678/wps-agent-editor/releases/download/v1.0.0/WPS.Agent.Editor.Setup.1.0.0.exe)
* **Kompilierung aus dem Quellcode**: Unterstützung für Windows, macOS und Linux.

---

## Entwickler-Schnellstart

### Voraussetzungen
* [Node.js](https://nodejs.org/) (>= 18.0.0)
* npm, pnpm oder yarn

### 1. Repository klonen & Abhängigkeiten installieren
```bash
git clone https://github.com/Glace678/wps-agent-editor.git
cd wps-agent-editor

npm install
npm run install:electron
```

### 2. Entwicklungsmodus starten
```bash
npm run dev
```

---

## Plattformübergreifender Build

Erstellen Sie Desktop-Installer mit einem einzigen Befehl:

```bash
# Windows (.exe)
npm run dist:win

# macOS (.dmg / .zip)
npm run dist:mac

# Linux (.AppImage / .deb)
npm run dist:linux
```

---

## Systemarchitektur

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

## Mitwirkende & KI-Kollaborateure

Dieses Projekt wurde in enger Zusammenarbeit mit folgenden KI-Modellen entwickelt und optimiert:

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

## Lizenz

Lizenziert unter **[Creative Commons Namensnennung - Nicht-kommerziell 4.0 International (CC-BY-NC 4.0)](./LICENSE)**.

* Kostenlos für persönliches Lernen, Forschung und nicht-kommerzielle Entwicklung.
* **Kommerzielle Nutzung ist strengstens untersagt.**

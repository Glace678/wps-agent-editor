<div align="center">

# 📝 WPS Agent Editor

**Éditeur de documents de bureau multiplateforme et léger · Local-First · Collaboration Multi-Agent**

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC_BY--NC_4.0-orange.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Release](https://img.shields.io/github/v/release/Glace678/wps-agent-editor?color=blue&label=Release)](https://github.com/Glace678/wps-agent-editor/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/Glace678/wps-agent-editor)
[![Electron](https://img.shields.io/badge/Electron-34.x-47848F?logo=electron&logoColor=white)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<br />

<!-- Language Navigation Bar -->
[简体中文](./README.md) &nbsp;|&nbsp; [English](./README_EN.md) &nbsp;|&nbsp; [日本語](./README_JA.md) &nbsp;|&nbsp; [🌐 Français](./README_FR.md) &nbsp;|&nbsp; [Deutsch](./README_DE.md) &nbsp;|&nbsp; [Español](./README_ES.md) &nbsp;|&nbsp; [Português](./README_PT.md) &nbsp;|&nbsp; [Русский](./README_RU.md) &nbsp;|&nbsp; [العربية](./README_AR.md)

</div>

---

## 📖 Présentation

**WPS Agent Editor** est un éditeur de documents de bureau multiplateforme conçu pour la collaboration homme-machine de nouvelle génération.

Il combine harmonieusement une suite bureautique légère en approche **Local-First** et un réseau de **multi-agents autonomes**. Qu'il s'agisse de rédiger des documents Word, d'analyser des classeurs Excel, de présenter des diaporamas PPT, de lire des PDF ou de coder dans plus de 50 langages, WPS Agent Editor offre une fluidité remarquable et une assistance IA puissante.

---

## ✨ Fonctionnalités Clés

### 1. 📄 Suite bureautique multiformat Local-First
Prêt à l'emploi sans serveur externe lourd :
* **📝 Traitement de texte (DOCX / DOC)** : Moteur de mise en page riche avec gestion des titres, styles, tableaux, annotations et plan hiérarchique.
* **📊 Tableur (Excel / XLSX / XLS / CSV)** : Feuille de calcul haute performance avec formules mathématiques et statistiques, styles de cellules, filtres et onglets multiples.
* **📑 Présentations (PowerPoint / PPTX)** : Rendu vectoriel de diapositives, modèles maîtres et mode diaporama plein écran.
* **💻 Éditeur de code & texte** : Intégration de Monaco Editor (le moteur de VS Code) avec coloration syntaxique (50+ langages), repli de code, recherche regex et autocomplétion.
* **📕 Lecteur PDF** : Défilement fluide, navigation par sommaire, zoom adaptatif et déchiffrement de documents sécurisés.
* **📋 Markdown en temps réel** : Prise en charge GFM, génération dynamique de plan et synchronisation bidirectionnelle.

### 2. 🤖 Écosystème Multi-Agent Collaboratif
Une équipe d'assistants IA spécialisés au lieu d'une boîte de dialogue isolée :
* **Agrégation Multi-Provider** : Prise en charge native de **OpenAI (GPT-4o/o3)**, **Anthropic (Claude 3.5/3.7)**, **Google (Gemini 2.0)**, **ByteDance (Seed / Doubao)**, **DeepSeek** et **modèles locaux Ollama**.
* **Agents spécialisés** : Rédacteur de documents, analyste de données, concepteur de présentations et relecteur de code.
* **Workflow de validation Diff sécurisé** : Chaque modification suggérée est affichée sous forme de Diff interactif style Git, appliquée uniquement après validation explicite de l'utilisateur.
* **Mise en cache intelligente du contexte** : Optimisation du cache pour les longs documents réduisant drastiquement les coûts de tokens et le temps de latence.

### 3. 🔒 Sécurité et Confidentialité de Niveau Entreprise
* **Chiffrement des clés d'accès** : Les clés API sont chiffrées au niveau du système d'exploitation via Electron `safeStorage` (Windows DPAPI / macOS Keychain).
* **Filtrage des données sensibles** : Isolation automatique des fichiers sensibles pour éviter toute fuite.
* **Architecture Sandbox isolée** : Permissions IPC strictes et moteur de rendu en bac à sable.

### 4. 🌍 Internationalisation (9 Langues)
Interface et système d'agents entièrement traduits en 9 langues :
> Chinois simplifié · Anglais · Japonais · Français · Allemand · Espagnol · Portugais · Russe · Arabe

---

## 📥 Téléchargement et Installation

Consultez les [GitHub Releases](https://github.com/Glace678/wps-agent-editor/releases) pour télécharger la dernière version :

* **Programme d'installation Windows** : [`WPS.Agent.Editor.Setup.1.0.0.exe`](https://github.com/Glace678/wps-agent-editor/releases/download/v1.0.0/WPS.Agent.Editor.Setup.1.0.0.exe)
* **Compilation à partir des sources** : Compatible macOS et Linux.

---

## 🚀 Démarrage Rapide pour Développeurs

### Prérequis
* [Node.js](https://nodejs.org/) (>= 18.0.0)
* npm, pnpm ou yarn

### 1. Cloner le dépôt et installer les dépendances
```bash
git clone https://github.com/Glace678/wps-agent-editor.git
cd wps-agent-editor

npm install
npm run install:electron
```

### 2. Lancer le mode développement
```bash
npm run dev
```

---

## 📦 Compilation et Empaquetage Multiplateforme

Générez des exécutables autonomes en une seule commande :

```bash
# Windows (.exe)
npm run dist:win

# macOS (.dmg / .zip)
npm run dist:mac

# Linux (.AppImage / .deb)
npm run dist:linux
```

---

## 🏛️ Architecture du Système

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

## 🤖 Contributeurs & Collaborateurs IA

Ce projet a été conçu, développé et refactorisé en étroite synergie avec les modèles d'IA suivants :

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

## 📄 Licence

Ce projet est distribué sous licence **[Creative Commons Attribution - Pas d’Utilisation Commerciale 4.0 International (CC-BY-NC 4.0)](./LICENSE)**.

* Gratuit pour l'apprentissage, la recherche et le développement non commercial.
* **Toute utilisation commerciale est strictement interdite.**

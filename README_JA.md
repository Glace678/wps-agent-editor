<div align="center">

# WPS Agent Editor

**クロスプラットフォーム軽量デスクトップ文書エディタ · ローカルファースト · マルチAgent自律協調**

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
<sub>本ドキュメントおよび全言語版のREADMEは Gemini によって作成・管理されています</sub>

</div>

---

## プロジェクト概要

**WPS Agent Editor** は、次世代の人間とAIの協調ワークフローのために設計された**クロスプラットフォーム・デスクトップ文書エディタ**です。

**ローカルファーストの軽量Office編集環境**と**最先端のマルチエージェント協調ネットワーク**を高度に統合。Word文書の作成、Excelデータ分析、PPTスライドプレゼンテーション、PDF閲覧、50以上のプログラミング言語でのコード開発まで、快適なローカル操作感と強力なAIアシスタント機能を提供します。

---

## 主な機能・特徴

### 1. オールインワンのローカルファースト文書スイート
外部サーバ不要、インストールしてすぐに使用可能：
* **文書編集 (Word / DOCX / DOC)**: リッチテキスト書式設定、見出しアウトライン、テーブル挿入、注釈に対応した軽量組版エンジン。
* **表計算 (Excel / XLSX / XLS / CSV)**: 数学・統計関数、セル装飾、データフィルター、複数シート管理を備えた高速スプレッドシート。
* **スライド作成 (PowerPoint / PPTX)**: スライドレンダリング、マスタースタイル解析、全画面プレゼンテーションモード。
* **高機能コード＆テキストエディタ**: VS Codeの中核であるMonaco Editorを内蔵。50以上の言語の構文ハイライト、コード折りたたみ、正規表現検索置換に対応。
* **PDFリーダー＆パース**: 高速マルチスクロール、目次ジャンプ、拡大縮小、パスワード保護付きPDFの解除閲覧。
* **リアルタイムMarkdown**: GFM表構文、動的目次生成、双方向リッチテキスト同期。

### 2. マルチエージェント自律協調システム
単一チャットAIを超えた、専門エージェントチームの連携：
* **複数プロバイダーの統一統合**: **OpenAI (GPT-4o/o3)**、**Anthropic (Claude 3.5/3.7)**、**Google (Gemini 2.0)**、**ByteDance (Seed / 豆包)**、**DeepSeek**、**Ollamaローカルモデル**に対応。
* **専門エージェントの分業**: 文書執筆、データ集計、スライド構成案作成、コードレビューなど各専門エージェントが連携。
* **安全なDiff差分承認ワークフロー**: エージェントによる変更提案はすべてGitスタイルの差分として可視化。ユーザーの承認後にのみ適用。
* **スマートコンテキストキャッシュ**: 長文ドキュメント向けプロンプトキャッシュにより、コストと応答遅延を大幅削減。

### 3. 堅牢なローカルセキュリティとプライバシー保護
* **OS標準の暗号化ストレージ**: APIキーはElectronの `safeStorage` (Windows DPAPI / macOS Keychain) で安全に暗号化。
* **機密ファイルの自動フィルタリング**: ローカル機密ファイルを隔離し、外部への情報漏洩を防止。
* **サンドボックス隔離アーキテクチャ**: 厳格なIPC通信制御とサンドボックスレンダラーにより悪意あるスクリプトを遮断。

### 4. グローバル9言語対応
UIとエージェントシステムは9つの主要言語に完全ローカライズ：
> 簡体字中国語 · 英語 · 日本語 · フランス語 · ドイツ語 · スペイン語 · ポルトガル語 · ロシア語 · アラビア語

---

## ダウンロードとインストール

[GitHub Releases](https://github.com/Glace678/wps-agent-editor/releases) から最新版をダウンロード：

* **Windows インストーラー**: [`WPS.Agent.Editor.Setup.1.0.0.exe`](https://github.com/Glace678/wps-agent-editor/releases/download/v1.0.0/WPS.Agent.Editor.Setup.1.0.0.exe)
* **ソースコードからのビルド**: macOS、Linuxにも対応。

---

## 開発者向けクイックスタート

### 前提条件
* [Node.js](https://nodejs.org/) (>= 18.0.0)
* npm, pnpm, yarn

### 1. リポジトリのクローンと依存関係のインストール
```bash
git clone https://github.com/Glace678/wps-agent-editor.git
cd wps-agent-editor

npm install
npm run install:electron
```

### 2. 開発モードの起動
```bash
npm run dev
```
起動後、画面右側の **Provider Settings** でAPIキーまたはOllamaアドレスを設定してください。

---

## ビルド＆パッケージング

ワンコマンドで各プラットフォーム向けのパッケージを生成できます：

```bash
# Windows (.exe)
npm run dist:win

# macOS (.dmg / .zip)
npm run dist:mac

# Linux (.AppImage / .deb)
npm run dist:linux
```

---

## システムアーキテクチャ

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

## コントリビューターとAI協作者

本プロジェクトは、以下のAIモデルとの高度なペアプログラミング・協調開発により構築されました：

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

## ライセンス

本プロジェクトは **[CC BY-NC 4.0 (表示 - 非営利 4.0 国際)](./LICENSE)** ライセンスの下で公開されています。

* 個人学習、研究、非営利開発目的での利用・改変・再配布は自由です。
* **あらゆる商用目的での利用は禁止されています。**

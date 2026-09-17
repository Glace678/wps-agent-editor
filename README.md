# WPS Agent Editor

<div align="center">

### 语言切换 / Switch Language

[简体中文](#zh-cn) • [English](#en) • [繁體中文](#zh-tw) • [日本語](#ja) • [한국어](#ko) • [Español](#es) • [Français](#fr) • [Deutsch](#de) • [Русский](#ru) • [Português](#pt) • [العربية](#ar)

<sub>点击蓝色语言文字直接在当前页面切换 / Click any blue link to switch language directly on this page</sub>

</div>

---

<a id="zh-cn"></a>
## 简体中文

[English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [返回顶部](#wps-agent-editor)

**WPS Agent Editor 2** 是基于 **Tauri v2**、**React** 和 **Rust** 构建的新一代跨平台文档编辑器与多 Agent AI 工作台。桌面端采用系统原生 WebView，彻底摒弃了捆绑 Electron、Chromium、Node.js 或 OnlyOffice Document Server 的臃肿架构。

### 多 AI 对话与多 Agent 协同架构

WPS Agent Editor 内置强大的多模型协同编排引擎，能够将不同供应商的顶尖 AI 模型组织为高效的文档处理团队：

- **多元模型生态接入**：原生集成 OpenAI（GPT-4o、o1）、Anthropic（Claude 3.5 Sonnet）、Google Gemini、DeepSeek、Ollama（本地离线大模型）、火山引擎（豆包）以及任意兼容 OpenAI 规范的自定义 API。
- **双重协同工作流**：
  - **主导编排模式（Directed Mode）**：由主导 Agent（Director）统一规划复杂任务，自动将子任务分发（`delegate_task`）给擅长不同领域的专家模型（如数据分析专家、技术撰写专家、代码审查专家），汇总各模型输出并生成最终交付成果。
  - **并行协同模式（Parallel Mode）**：多个模型针对同一任务或文档的不同板块同步展开创作、润色或交叉验证，支持实时流式交互与接力传递（Handoff）。
- **可视化协同时间线**：细粒度捕获任务分工、模型间对话、思考推理历程（Reasoning）、工具调用与成果交接，全流程可视化透明可追溯。
- **智能上下文与 Codex 迁移**：超长会话在发送时自动压缩为便携式上下文窗口。首次启动可自动、幂等同步用户 `CODEX_HOME`（`~/.codex`）中的活动与归档 JSONL 会话。

### 协同文档处理能力

WPS Agent Editor 将生成式 AI 与底层文档编辑操作进行了深度整合：

- **原子级文档操作**：AI Agent 不仅能生成文字，更可以直接向文档底层引擎发送精确的原子级结构化指令（插入、排版、替换、批注），即时修改文档内容。
- **光标与选区感知**：实时追踪 Agent 与用户的光标焦点位置、文字选区范围及修改区间。
- **版本控制与冲突解决**：内置修订控制系统，主动检测并防止并发编辑冲突，维护事务状态，支持一键撤销（Undo）。
- **人工介入与审批机制**：支持将关键或敏感修改配置为需要用户确认（`approval-required`），经人工审批后才正式写入文档。

### 支持的文件类型

| 类别 | 扩展名 | 底层引擎与特性 |
| :--- | :--- | :--- |
| **Word 文档** | `.docx`, `.doc`, `.odt` | 基于 **SuperDoc** 富文本引擎，全面支持排版样式、表格、图片；旧格式通过本机工具自动无损转换。 |
| **电子表格** | `.xlsx`, `.xls`, `.csv`, `.ods` | 基于 **Fortune Sheet**，支持丰富计算公式、多工作表标签页、单元格样式与高性能运算。 |
| **演示文稿** | `.pptx`, `.ppt`, `.odp` | **pptx-renderer** 渲染画面，结合 **Rust OOXML** 高性能后端进行幻灯片内容精密修改。 |
| **PDF 文档** | `.pdf` | 采用 **PDF.js** 与 **MuPDF** 双引擎，高清渲染预览，支持可编辑持久化注释（高亮、画笔、文本批注）。 |
| **纯文本与 Markdown** | `.md`, `.markdown`, `.txt`, `.log` | 内置轻量编辑器，支持语法排版、实时预览与秒级加载。 |
| **源代码工程** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat` 等 | 集成工业级 **Monaco Editor**，支持语法高亮、智能补全，调用本机已安装的语言工具链执行与调试。 |
| **图片多媒体预览** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | 本机高性能图片查看器。 |

*注：旧版 `.doc`、`.ppt` 转换依赖系统安装的 WPS、Microsoft Office 或 LibreOffice。代码运行调用本地工具链（如 Node.js、Python、Cargo）。缺失依赖时给出清晰的 `dependency-missing` 提示，绝不在运行时静默下载庞大组件。*

### 开发指南

要求：
- Node.js 22+
- Rust stable 与对应编译目标
- [Tauri v2 平台前置依赖](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

仅运行浏览器界面：
```bash
npm run dev:web
```

验证与测试：
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### 发布目标与安全

Release 构建生成轻量原生桌面安装包：
- **Windows 10+**：x86_64 与 ARM64 NSIS 安装程序
- **macOS**：Intel 与 Apple Silicon DMG
- **Linux**：x86_64 与 ARM64 AppImage

CI 严格限制每个主下载包不超过 100 MiB。经过严格的签名防篡改、损坏恢复、真实更新验收冒烟测试。API Key 均存放在操作系统安全凭据库中。

### 许可证

本项目以 **GNU Affero General Public License v3.0 only**（AGPL-3.0-only）发布。详见 [LICENSE](./LICENSE) 与 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

[返回顶部](#wps-agent-editor)

---

<a id="en"></a>
## English

[简体中文](#zh-cn) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [Back to Top](#wps-agent-editor)

**WPS Agent Editor 2** is a next-generation, cross-platform document editor and multi-agent AI workbench built on **Tauri v2**, **React**, and **Rust**. Powered by native system WebViews, it completely eliminates bloated bundled runtimes such as Electron, Chromium, Node.js, or OnlyOffice Document Server.

### Multi-AI Dialogue & Multi-Agent Collaboration

WPS Agent Editor features a powerful multi-model collaboration engine designed to orchestrate diverse AI models into a unified document-processing team:

- **Broad Provider Ecosystem**: Native integration with OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (local offline models), Volcengine (Doubao), and any custom OpenAI-compatible API.
- **Dual Collaboration Modes**:
  - **Directed Mode (Director Orchestration)**: A lead Agent breaks down complex workflows, delegates specialized sub-tasks (`delegate_task`) to domain-expert models (e.g., data analyst, technical writer, code reviewer), aggregates intermediate findings, and synthesizes the final output.
  - **Parallel Mode**: Multiple models analyze, draft, or critique different document sections concurrently with live event streaming and handoffs.
- **Visual Collaboration Timeline**: Fine-grained live event stream tracking task dispatch, model dialogue exchanges, reasoning processes, tool invocations, and handoffs.
- **Smart Context & Codex Migration**: Long conversations are dynamically compressed into portable context windows upon request. Seamlessly imports active and archived JSONL sessions from `CODEX_HOME` (`~/.codex`) idempotently.

### Collaborative Document Processing Capabilities

WPS Agent Editor bridges conversational AI directly with document editing primitives:

- **Atomic Document Operations**: AI agents don't just generate text—they dispatch precise structural operations (`insert`, `format`, `replace`, `annotate`) directly to document engines.
- **Cursor & Selection Awareness**: Track live agent and user cursor positions, active text selections, and modification ranges.
- **Revision Tracking & Conflict Resolution**: Built-in revision control detects conflicting concurrent edits, maintains atomic transaction states, and supports one-click rollback/undo.
- **Human-in-the-Loop Approvals**: Configure critical document mutations to require user verification before execution (`approval-required`).

### Supported File Types

| Category | Extensions | Underlying Engine & Capabilities |
| :--- | :--- | :--- |
| **Word Documents** | `.docx`, `.doc`, `.odt` | Powered by **SuperDoc**. Full support for styles, tables, images, and formatting. Legacy formats converted via system tools. |
| **Spreadsheets** | `.xlsx`, `.xls`, `.csv`, `.ods` | Powered by **Fortune Sheet**. Complex formulas, multi-sheet tabs, formatting, and high-performance calculation. |
| **Presentations** | `.pptx`, `.ppt`, `.odp` | Rendered via **pptx-renderer**; slide modifications and structure updates driven by a high-speed **Rust OOXML** backend. |
| **PDF Documents** | `.pdf` | Dual engine with **PDF.js** and **MuPDF**. High-fidelity rendering and persistent editable annotations (highlight, pen, text). |
| **Text & Markdown** | `.md`, `.markdown`, `.txt`, `.log` | Built-in lightweight editor with live preview, syntax formatting, and fast loading. |
| **Source Code** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat`, etc. | Industrial-grade **Monaco Editor** with syntax highlighting, code intelligence, and execution/debugging via local toolchains. |
| **Image Previews** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | Native high-performance image viewer. |

*Note: Legacy `.doc` and `.ppt` conversions leverage local WPS, Microsoft Office, or LibreOffice. Code execution requires corresponding local language toolchains (e.g. Node.js, Python, Cargo). Missing dependencies trigger clear `dependency-missing` alerts without background bloatware downloads.*

### Development

Requirements:
- Node.js 22+
- Rust stable with target toolchains
- [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Run browser UI only:
```bash
npm run dev:web
```

Verification & Testing:
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Release Targets & Security

Release builds generate lightweight, native desktop packages:
- **Windows 10+**: x86_64 & ARM64 NSIS installers
- **macOS**: Intel & Apple Silicon DMG
- **Linux**: x86_64 & ARM64 AppImage

CI enforces a strict 100 MiB limit per primary package. Releases undergo automated signed staging smoke tests verifying tamper rejection, update recovery, live migrations, and rollback guards. API keys are strictly stored in operating system credential vaults.

### License

Distributed under the **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

[Back to Top](#wps-agent-editor)

---

<a id="zh-tw"></a>
## 繁體中文

[简体中文](#zh-cn) | [English](#en) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [返回頂部](#wps-agent-editor)

**WPS Agent Editor 2** 是基於 **Tauri v2**、**React** 和 **Rust** 構建的新一代跨平台文檔編輯器與多 Agent AI 工作台。桌面端採用系統原生 WebView，徹底拋棄了捆綁 Electron、Chromium、Node.js 或 OnlyOffice Document Server 的臃腫架構。

### 多 AI 對話與多 Agent 協同架構

WPS Agent Editor 內建強大的多模型協同調度引擎，能將不同廠商的頂尖 AI 模型組織為高效的文檔處理團隊：

- **多元模型生態接入**：原生支援 OpenAI（GPT-4o、o1）、Anthropic（Claude 3.5 Sonnet）、Google Gemini、DeepSeek、Ollama（本地離線大模型）、火山引擎（豆包）以及任意相容 OpenAI 規範的自訂 API。
- **雙重協同工作流**：
  - **主導編排模式（Directed Mode）**：由主導 Agent（Director）全面拆解複雜任務，精準指派子任務（`delegate_task`）給各領域專家模型（如數據分析師、技術撰稿人、代碼審查員），自動彙整各模型結論並生成最終成果。
  - **並行協同模式（Parallel Mode）**：多個模型針對同一任務或文檔的不同板塊同步進行寫作、潤色或交叉驗證，具備實時串流與接力轉移（Handoff）機制。
- **視覺化協同時間線**：細粒度捕獲任務分工、模型間對話、思考推理歷程（Reasoning）、工具調用與成果交接，全程可觀測、可追溯。
- **智慧上下文與 Codex 遷移**：超長會話自動壓縮為可移植上下文視窗。首次啟動可自動、等冪同步使用者 `CODEX_HOME`（`~/.codex`）中的 JSONL 會話。

### 協同文檔處理能力

WPS Agent Editor 將對話式 AI 與文檔底層編輯操作進行了深度整合：

- **原子級文檔操作**：AI Agent 不僅產出文字，還能直接向文檔引擎發送原子級精確指令（插入、排版、替換、標註），即時修改文檔。
- **游標與選區感知**：實時追蹤 Agent 與使用者的游標焦點、文字選取範圍與修改區間。
- **版本控制與衝突解決**：內建修訂控制系統，能主動檢測並防止併發衝突，維護事務狀態，支援一鍵復原（Undo）。
- **人工介入與審批機制**：支援將敏感或關鍵修改配置為使用者確認（`approval-required`），審批通過後才正式生效。

### 支援的文件格式清單

| 類別 | 副檔名 | 底層引擎與特性 |
| :--- | :--- | :--- |
| **Word 文檔** | `.docx`, `.doc`, `.odt` | 基於 **SuperDoc** 富文本引擎，全面支援樣式、表格、圖片排版。舊格式透過本機工具自動轉換。 |
| **電子試算表** | `.xlsx`, `.xls`, `.csv`, `.ods` | 基於 **Fortune Sheet**，支援豐富函數公式、多工作表分頁、單元格樣式與高效運算。 |
| **簡報 PPT** | `.pptx`, `.ppt`, `.odp` | **pptx-renderer** 渲染畫面，結合 **Rust OOXML** 高效能後端進行幻燈片內容精密修改。 |
| **PDF 文檔** | `.pdf` | 採用 **PDF.js** 與 **MuPDF** 雙引擎，高清晰度預覽，支援高亮、畫筆、文字註釋等持久化編輯。 |
| **純文本與 Markdown** | `.md`, `.markdown`, `.txt`, `.log` | 內建輕量編輯器，支援語法排版、即時預覽與毫秒級加載。 |
| **源代碼工程** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat` 等 | 整合工業級 **Monaco Editor**，支援語法高亮、智慧補全，調用本機安裝的語言工具鏈執行與除錯。 |
| **圖片多媒體預覽** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | 本機高效能圖片檢視器。 |

*注：舊版 `.doc`、`.ppt` 轉換依賴系統安裝的 WPS、Microsoft Office 或 LibreOffice。代碼運行調用本地工具鏈（如 Node.js、Python、Cargo）。缺失依賴時給予明確的 `dependency-missing` 提示，絕不在運行時靜默下載龐大組件。*

### 開發指南

要求：
- Node.js 22+
- Rust stable 與對應編譯目標
- [Tauri v2 平台前置依賴](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

僅運行瀏覽器網頁介面：
```bash
npm run dev:web
```

驗證與測試：
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### 發布目標與安全

Release 構建生成輕量原生桌面安裝包：
- **Windows 10+**：x86_64 與 ARM64 NSIS 安裝程式
- **macOS**：Intel 與 Apple Silicon DMG
- **Linux**：x86_64 與 ARM64 AppImage

CI 嚴格限制每個主下載包不超過 100 MiB。經過嚴格的簽名防篡改、損壞復原、真實更新驗收冒煙測試。API Key 均儲存在作業系統安全憑證庫中。

### 許可證

本專案以 **GNU Affero General Public License v3.0 only**（AGPL-3.0-only）發布。詳見 [LICENSE](./LICENSE) 與 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

[返回頂部](#wps-agent-editor)

---

<a id="ja"></a>
## 日本語

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [トップへ戻る](#wps-agent-editor)

**WPS Agent Editor 2** は、**Tauri v2**、**React**、**Rust** をベースに設計された、次世代のクロスプラットフォーム文書エディタ兼マルチエージェント AI ワークベンチです。ネイティブのシステム WebView を活用し、Electron、Chromium、Node.js、OnlyOffice などの肥大化したランタイムの同梱を完全に排除しています。

### マルチ AI 対話 ＆ マルチエージェント協調エンジン

WPS Agent Editor は、さまざまな AI モデルを 1 つの高度な文書処理チームとして組織化する強力なマルチモデル協調機能を備えています：

- **幅広いプロバイダー対応**：OpenAI（GPT-4o、o1）、Anthropic（Claude 3.5 Sonnet）、Google Gemini、DeepSeek、Ollama（ローカルオフラインモデル）、Volcengine（豆包）、および OpenAI 互換 API をネイティブサポート。
- **2 つの協業モード**：
  - **ディレクターモード（Directed Mode）**：司令塔となるエージェントが複雑な業務を分解し、専門モデル（データ分析、技術執筆、コードレビュー等）へ適切にサブタスクを委譲（`delegate_task`）。結果を集約して最終成果物を生成。
  - **並行協業モード（Parallel Mode）**：複数の AI モデルが同時に同一文書の異なる章やタスクを執筆・推敲・検証。リアルタイムストリーミングと引き継ぎ（Handoff）に対応。
- **協業タイムラインの可視化**：タスク割り当て、モデル間対話、推論思考（Reasoning）、ツール呼び出し、ハンドオフをイベントログとして視覚的に追跡。
- **スマートコンテキスト ＆ Codex 移行**：長大な対話履歴をポータブルなコンテキスト窓に自動圧縮。ローカルの `CODEX_HOME`（`~/.codex`）にある JSONL 履歴を重複なく同期可能。

### 協調型ドキュメント処理能力

対話型 AI と文書編集操作を直結し、実用的なドキュメント作業を実現：

- **アトミック文書操作**：テキスト出力にとどまらず、ドキュメントエンジンに対して直接挿入・書式設定・置換・注釈などの構造化操作を発行。
- **カーソル・選択範囲のリアルタイム追跡**：エージェントとユーザーのカーソル位置、選択範囲、編集領域をリアルタイムに把握。
- **版管理と競合解消**：リビジョン追跡により同時編集の衝突を自動検知。トランザクション管理により安全なワンクリック取り消し（Undo）を保証。
- **Human-in-the-Loop（人間の承認）**：重要な編集や変更に対して、実行前にユーザーの承認を求める（`approval-required`）安全制御。

### 対応ファイル形式一覧

| カテゴリ | 拡張子 | 採用エンジンと特徴 |
| :--- | :--- | :--- |
| **Word 文書** | `.docx`, `.doc`, `.odt` | **SuperDoc** リッチテキストエンジン。スタイル、表、画像のレイアウトを忠実に再現。旧形式はローカル環境で自動変換。 |
| **スプレッドシート** | `.xlsx`, `.xls`, `.csv`, `.ods` | **Fortune Sheet** 搭載。高度な関数計算、マルチシート、セル書式設定に対応。 |
| **プレゼンテーション** | `.pptx`, `.ppt`, `.odp` | **pptx-renderer** によるプレビュー表示と、**Rust OOXML** 高速バックエンドによるスライド編集。 |
| **PDF ドキュメント** | `.pdf` | **PDF.js** ＆ **MuPDF** デュアルエンジン。高速プレビューおよび編集可能な注釈（ハイライト、ペン、テキスト）の保存に対応。 |
| **テキスト & Markdown** | `.md`, `.markdown`, `.txt`, `.log` | リアルタイムプレビューと瞬時読み込みを備えた組み込み軽量エディタ。 |
| **ソースコード** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat` など | プロ仕様の **Monaco Editor**。構文ハイライト、コード補完、ローカルツールチェーンを用いた実行・デバッグに対応。 |
| **画像プレビュー** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | 高速なネイティブ画像ビューア。 |

*注：旧形式の `.doc`、`.ppt` 変換にはシステム上の WPS、Microsoft Office、または LibreOffice が必要です。コード実行には各言語のローカル環境（Node.js、Python、Cargo 等）を使用します。不足している依存関係は明示的な `dependency-missing` を返し、無断で巨大パッケージをダウンロードしません。*

### 開発ガイド

前提条件：
- Node.js 22+
- Rust stable およびターゲットコンパイラ
- [Tauri v2 前提条件](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

ブラウザ版 UI のみ起動：
```bash
npm run dev:web
```

検証・テスト：
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### リリースターゲットとセキュリティ

Release ビルドは軽量なネイティブデスクトップアプリを出力します：
- **Windows 10+**: x86_64 / ARM64 NSIS インストーラー
- **macOS**: Intel / Apple Silicon DMG
- **Linux**: x86_64 / ARM64 AppImage

主要バイナリは 100 MiB 以下の CI 制限を遵守。署名改ざん防止、復旧テスト、実更新スモークテストを実施済み。API キーは OS 組み込みのセキュアな資格情報保管庫で厳重に保護されます。

### ライセンス

本プロジェクトは **GNU Affero General Public License v3.0 only**（AGPL-3.0-only）の下で公開されています。[LICENSE](./LICENSE) および [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。

[トップへ戻る](#wps-agent-editor)

---

<a id="ko"></a>
## 한국어

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [맨 위로](#wps-agent-editor)

**WPS Agent Editor 2**는 **Tauri v2**, **React**, **Rust**를 기반으로 개발된 차세대 크로스 플랫폼 문서 편집기이자 멀티 에이전트 AI 워크벤치입니다. 운영체제 내장 WebView를 활용하여 Electron, Chromium, Node.js, OnlyOffice Document Server와 같은 무거운 런타임 번들링을 완전히 배제했습니다.

### 멀티 AI 대화 및 멀티 에이전트 협업 엔진

WPS Agent Editor는 다양한 최첨단 AI 모델을 하나의 체계적인 문서 처리 팀으로 조율하는 강력한 협업 엔진을 제공합니다:

- **광범위한 AI 공급자 지원**: OpenAI(GPT-4o, o1), Anthropic(Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama(로컬 오프라인 모델), Volcengine(Doubao) 및 표준 OpenAI 호환 API를 기본 지원합니다.
- **두 가지 협업 워크플로**:
  - **총괄 지휘 모드 (Directed Mode)**: 총괄 Agent(Director)가 복잡한 업무를 분석하고, 세부 하위 작업(`delegate_task`)을 각 분야 전문 모델(데이터 분석, 기술 문서 작성, 코드 리뷰 등)에 위임한 후 결과를 종합하여 최종 결과물을 도출합니다.
  - **병렬 협업 모드 (Parallel Mode)**: 여러 AI 모델이 동일한 문서의 서로 다른 섹션을 동시에 작성, 교정 및 검증하며 실시간 스트리밍 및 핸드오프(Handoff)를 지원합니다.
- **시각화된 협업 타임라인**: 작업 생성 및 할당, 모델 간 대화, 추론 사고 과정(Reasoning), 도구 실행 및 작업 인계를 이벤트 스트림으로 한눈에 추적합니다.
- **지능형 컨텍스트 압축 및 Codex 마이그레이션**: 장문 대화는 전송 시 자동으로 휴대용 컨텍스트 창으로 압축됩니다. `CODEX_HOME`(`~/.codex`)의 로컬 JSONL 기록을 멱등성 있게 원클릭 동기화할 수 있습니다.

### 지능형 문서 협업 처리 기능

대화형 AI와 문서 엔진을 직접 연결하여 실질적인 문서 조작을 수행합니다:

- **원자적 문서 조작 (Atomic Operations)**: 텍스트 답변 생성에 그치지 않고, 삽입, 서식 지정, 교체, 주석 달기 등의 정밀 명령을 문서 엔진에 직접 전달합니다.
- **커서 및 선택 영역 실시간 추적**: 사용자와 Agent의 커서 위치, 선택한 텍스트 범위, 수정 구역을 실시간으로 감지합니다.
- **리비전 추적 및 충돌 해결**: 내장된 리비전 제어로 동시 편집 충돌을 사전에 방지하고 트랜잭션 상태를 유지하여 원클릭 실행 취소(Undo)를 지원합니다.
- **사용자 승인 워크플로 (Human-in-the-Loop)**: 민감하거나 중요한 문서 수정에 대해 사용자 승인(`approval-required`) 단계를 설정할 수 있습니다.

### 지원 파일 형식 목록

| 구분 | 확장자 | 지원 엔진 및 핵심 기능 |
| :--- | :--- | :--- |
| **Word 문서** | `.docx`, `.doc`, `.odt` | **SuperDoc** 리치 텍스트 엔진. 서식 스타일, 표, 이미지 완벽 지원. 구형 포맷 자동 변환. |
| **스프레드시트** | `.xlsx`, `.xls`, `.csv`, `.ods` | **Fortune Sheet** 탑재. 방대한 함수 수식, 멀티 시트 탭, 서식 및 초고속 계산 지원. |
| **프레젠테이션** | `.pptx`, `.ppt`, `.odp` | **pptx-renderer**를 통한 고해상도 렌더링 및 **Rust OOXML** 고속 백엔드 슬라이드 편집. |
| **PDF 문서** | `.pdf` | **PDF.js** 및 **MuPDF** 듀얼 엔진. 초고속 열람 및 영구 저장 가능한 편집용 주석(형광펜, 펜, 텍스트) 지원. |
| **텍스트 및 Markdown** | `.md`, `.markdown`, `.txt`, `.log` | 실시간 미리보기 및 즉시 로딩을 지원하는 내장 경량 에디터. |
| **소스 코드** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat` 등 | **Monaco Editor** 탑재. 구문 강조, 코드 완성, 로컬 도구 체인을 통한 실행 및 디버깅 지원. |
| **이미지 미리보기** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | 고성능 네이티브 이미지 뷰어. |

*참고: 구형 `.doc`, `.ppt` 변환은 시스템에 설치된 WPS, Microsoft Office 또는 LibreOffice를 사용합니다. 코드 실행은 로컬 툴체인(Node.js, Python, Cargo 등)을 활용합니다. 종속성 부재 시 명확한 `dependency-missing` 알림을 제공하며 불필요한 대용량 다운로드를 수행하지 않습니다.*

### 개발 환경 설정

요구 사항:
- Node.js 22+
- Rust stable 및 컴파일 타깃
- [Tauri v2 필수 구성 요소](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

브라우저 UI 전용 실행:
```bash
npm run dev:web
```

검증 및 테스트:
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### 배포 타깃 및 보안

Release 빌드는 가볍고 빠른 네이티브 데스크톱 바이너리를 생성합니다:
- **Windows 10+**: x86_64 및 ARM64 NSIS 설치 프로그램
- **macOS**: Intel 및 Apple Silicon DMG
- **Linux**: x86_64 및 ARM64 AppImage

CI 단계에서 주요 패키지 용량을 100 MiB 이내로 제한합니다. 위변조 방지 서명 및 복구 테스트를 거치며, 모든 API 키는 운영체제의 보안 자격 증명 보관함에 안전하게 저장됩니다.

### 라이선스

본 프로젝트는 **GNU Affero General Public License v3.0 only** (AGPL-3.0-only)에 따라 배포됩니다. 자세한 내용은 [LICENSE](./LICENSE) 및 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 확인하세요.

[맨 위로](#wps-agent-editor)

---

<a id="es"></a>
## Español

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [Volver arriba](#wps-agent-editor)

**WPS Agent Editor 2** es un editor de documentos multiplataforma de nueva generación y un banco de trabajo de IA multi-agente construido con **Tauri v2**, **React** y **Rust**. Al aprovechar la WebView nativa del sistema operativo, prescinde por completo de los pesados paquetes de Electron, Chromium, Node.js o OnlyOffice Document Server.

### Diálogo Multi-IA y Colaboración Multi-Agente

WPS Agent Editor incorpora un sofisticado motor de orquestación multi-modelo concebido para coordinar diversos modelos de IA como un equipo de trabajo documental unificado:

- **Ecosistema Amplio de Proveedores**: Integración nativa con OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (modelos locales sin conexión), Volcengine (Doubao) y cualquier API compatible con OpenAI.
- **Dos Modos de Colaboración**:
  - **Modo Dirigido (Orquestación por Director)**: Un agente líder descompone flujos de trabajo complejos, delega subtareas (`delegate_task`) a modelos especializados (analista de datos, redactor técnico, revisor de código), recopila los resultados y genera la entrega final.
  - **Modo Paralelo**: Varios modelos redactan, analizan o revisan simultáneamente diversas secciones del documento con transmisión en tiempo real y traspaso fluido de tareas (Handoff).
- **Línea de Tiempo Visual de Colaboración**: Registro en directo que monitoriza asignaciones, diálogos entre modelos, razonamientos internos (Reasoning), llamadas a herramientas y transferencias de estado.
- **Contexto Inteligente y Migración de Codex**: Compresión automática de historiales largos en ventanas de contexto portátiles. Sincronización idempotente y transparente de sesiones JSONL desde `CODEX_HOME` (`~/.codex`).

### Capacidades de Procesamiento Colaborativo de Documentos

Conexión directa entre la IA conversacional y el núcleo de edición de documentos:

- **Operaciones Atómicas en Documentos**: Los agentes no solo generan texto; envían operaciones estructurales atómicas (`insertar`, `formatear`, `reemplazar`, `anotar`) directamente a los motores documentales.
- **Detección de Cursor y Selección**: Seguimiento en tiempo real de cursores, textos seleccionados y rangos de modificación tanto de los agentes como del usuario.
- **Control de Revisiones y Resolución de Conflictos**: Detección automática de colisiones en edición simultánea, persistencia transaccional y reversión (Undo) con un solo clic.
- **Aprobación Humana en el Bucle (Human-in-the-Loop)**: Configuración de acciones críticas que requieren autorización previa del usuario (`approval-required`) antes de aplicarse al documento.

### Formatos de Archivo Compatibles

| Categoría | Extensiones | Motor y Características |
| :--- | :--- | :--- |
| **Documentos Word** | `.docx`, `.doc`, `.odt` | Basado en **SuperDoc**. Soporte integral de estilos, tablas, imágenes y maquetación. Conversión automática de formatos antiguos. |
| **Hojas de Cálculo** | `.xlsx`, `.xls`, `.csv`, `.ods` | Basado en **Fortune Sheet**. Amplio catálogo de fórmulas, pestañas múltiples, estilos de celda y cálculo de alto rendimiento. |
| **Presentaciones** | `.pptx`, `.ppt`, `.odp` | Visualización fluida con **pptx-renderer** y edición estructural de diapositivas con backend de alta velocidad en **Rust OOXML**. |
| **Documentos PDF** | `.pdf` | Motor dual con **PDF.js** y **MuPDF**. Visualización nítida y anotaciones editables persistentes (resaltador, pluma, notas de texto). |
| **Texto y Markdown** | `.md`, `.markdown`, `.txt`, `.log` | Editor ligero integrado con vista previa instantánea y carga ultrarrápida. |
| **Código Fuente** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat`, etc. | Potenciado por **Monaco Editor**. Resaltado de sintaxis, autocompletado inteligente y ejecución/depuración con herramientas nativas instaladas. |
| **Previsualización de Imágenes** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | Visor nativo optimizado. |

*Nota: La conversión de formatos clásicos `.doc` y `.ppt` utiliza WPS, Microsoft Office o LibreOffice presentes en el sistema. La ejecución de código depende de las cadenas de herramientas locales (Node.js, Python, Cargo, etc.). Ante dependencias no instaladas, se emite un error explícito `dependency-missing` sin descargas ocultas.*

### Desarrollo

Requisitos:
- Node.js 22+
- Rust stable y destinos de compilación
- [Requisitos previos de Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Ejecutar únicamente la interfaz web:
```bash
npm run dev:web
```

Verificación y Pruebas:
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Publicación y Seguridad

Los ejecutables se generan de forma nativa y liviana:
- **Windows 10+**: Instaladores NSIS para x86_64 y ARM64
- **macOS**: DMG para Intel y Apple Silicon
- **Linux**: AppImage para x86_64 y ARM64

Límite de CI estricto de 100 MiB por paquete principal. Pruebas automáticas de rechazo de firmas alteradas y recuperación ante fallos. Todas las claves de API se almacenan de manera segura en el almacén de credenciales del sistema operativo.

### Licencia

Distribuido bajo licencia **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). Consulte [LICENSE](./LICENSE) y [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

[Volver arriba](#wps-agent-editor)

---

<a id="fr"></a>
## Français

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [Retour en haut](#wps-agent-editor)

**WPS Agent Editor 2** est un éditeur documentaire nouvelle génération et un environnement de travail d'IA multi-agents multiplateforme bâti sur **Tauri v2**, **React** et **Rust**. S'appuyant sur la WebView native du système d'exploitation, il se dispense entièrement des environnements lourds comme Electron, Chromium, Node.js ou OnlyOffice Document Server.

### Dialogue Multi-IA & Orchestration Multi-Agents

WPS Agent Editor embarque un moteur de collaboration multi-modèles conçu pour faire coopérer divers modèles d'IA en une véritable équipe d'ingénierie documentaire :

- **Écosystème Étendu de Fournisseurs** : Intégration native avec OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (modèles locaux hors ligne), Volcengine (Doubao) et toute API compatible OpenAI.
- **Deux Modes de Collaboration** :
  - **Mode Dirigé (Orchestration par Directeur)** : Un agent chef d'orchestre planifie les opérations complexes, délègue les sous-tâches (`delegate_task`) aux modèles experts les plus qualifiés (analyste de données, rédacteur, relecteur de code) et consolide le résultat final.
  - **Mode Parallèle** : Plusieurs modèles travaillent de concert sur différentes sections du document en streaming continu avec passage de relais (Handoff) instantané.
- **Chronologie Visuelle des Événements** : Traçabilité complète des attributions de tâches, dialogues entre modèles, chaînes de raisonnement (Reasoning), appels d'outils et transferts d'état.
- **Gestion Intelligente du Contexte & Migration Codex** : Compression dynamique des longs historiques dans des fenêtres contextuelles adaptées. Importation transparente et idempotente des sessions JSONL depuis `CODEX_HOME` (`~/.codex`).

### Traitement Collaboratif de Documents

L'IA générative interagit directement avec le cœur d'édition des documents :

- **Opérations Documentaires Atomiques** : Les agents ne se contentent pas de rédiger du texte ; ils émettent des instructions structurelles précises (`insertion`, `mise en page`, `remplacement`, `annotations`) directement aux moteurs de documents.
- **Sensibilité au Curseur & aux Sélections** : Localisation en temps réel des curseurs, des sélections de texte et des zones d'édition des agents et de l'utilisateur.
- **Gestion des Révisions & Résolution des Conflits** : Détection active des modifications simultanées concurrentes, intégrité transactionnelle et annulation (Undo) en un clic.
- **Validation Humaine (Human-in-the-Loop)** : Possibilité d'assujettir les modifications sensibles à une validation explicite de l'utilisateur (`approval-required`).

### Formats de Fichiers Pris en Charge

| Catégorie | Extensions | Moteur & Fonctionnalités |
| :--- | :--- | :--- |
| **Documents Word** | `.docx`, `.doc`, `.odt` | Moteur riche **SuperDoc**. Rendu fidèle des styles, tableaux et images. Conversion automatique des anciens formats. |
| **Feuilles de Calcul** | `.xlsx`, `.xls`, `.csv`, `.ods` | Propulsé par **Fortune Sheet**. Calcul haute performance, formules étendues, multi-onglets et mise en forme. |
| **Présentations PPT** | `.pptx`, `.ppt`, `.odp` | Rendu visuel par **pptx-renderer** et modifications des diapositives via un backend rapide en **Rust OOXML**. |
| **Documents PDF** | `.pdf` | Double moteur **PDF.js** et **MuPDF**. Affichage instantané et annotations persistantes éditables (surlignage, stylo, texte). |
| **Texte & Markdown** | `.md`, `.markdown`, `.txt`, `.log` | Éditeur léger intégré avec prévisualisation temps réel et ouverture ultra-rapide. |
| **Code Source** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat`, etc. | Environnement professionnel **Monaco Editor**. Coloration syntaxique, autocomplétion et exécution/débogage via les compilateurs locaux. |
| **Aperçu d'Images** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | Visionneuse d'images native performante. |

*Remarque : La conversion des formats historiques `.doc` et `.ppt` s'effectue via les suites bureautiques locales (WPS, Office ou LibreOffice). L'exécution du code sollicite les chaînes d'outils locales. Tout manque entraîne une erreur claire `dependency-missing` sans téléchargement silencieux.*

### Développement

Prérequis :
- Node.js 22+
- Rust stable et cibles de compilation
- [Prérequis Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Exécution de l'interface navigateur uniquement :
```bash
npm run dev:web
```

Vérification & Tests :
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Déploiement & Sécurité

Les versions distribuables génèrent des binaires natifs légers :
- **Windows 10+** : Installateurs NSIS pour x86_64 et ARM64
- **macOS** : DMG pour Intel et Apple Silicon
- **Linux** : AppImage pour x86_64 et ARM64

Plafond CI strict de 100 Mio par paquet principal. Tests approfondis de protection des signatures et de récupération. Les clés d'API sont stockées de façon étanche dans le trousseau de clés sécurisé du système d'exploitation.

### Licence

Distribué sous licence **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). Voir [LICENSE](./LICENSE) et [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

[Retour en haut](#wps-agent-editor)

---

<a id="de"></a>
## Deutsch

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [Nach oben](#wps-agent-editor)

**WPS Agent Editor 2** ist ein plattformübergreifender Dokumenteneditor der nächsten Generation und eine Multi-Agenten-KI-Workbench auf Basis von **Tauri v2**, **React** und **Rust**. Durch die Nutzung der systemeigenen WebView verzichtet die Anwendung vollständig auf ressourcenintensive Laufzeitumgebungen wie Electron, Chromium, Node.js oder OnlyOffice Document Server.

### Multi-KI-Dialog & Multi-Agenten-Kollaboration

WPS Agent Editor verfügt über eine leistungsfähige Multi-Modell-Orchestrierungs-Engine, um verschiedene KI-Modelle zu einem schlagkräftigen Team für Dokumentenverarbeitung zusammenzuführen:

- **Breites Provider-Ökosystem**: Native Unterstützung für OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (lokale Offline-Modelle), Volcengine (Doubao) sowie jede OpenAI-kompatible Schnittstelle.
- **Zwei Kollaborationsmodi**:
  - **Direktoren-Modus (Directed Mode)**: Ein führender Agent zerlegt komplexe Aufgaben, delegiert Teilaufgaben (`delegate_task`) an spezialisierte Expertenmodelle (Datenanalyst, technischer Redakteur, Code-Reviewer), konsolidiert Teilergebnisse und verfasst das Endergebnis.
  - **Paralleler Modus (Parallel Mode)**: Mehrere Modelle bearbeiten, analysieren oder überprüfen gleichzeitig unterschiedliche Abschnitte desselben Dokuments mit Live-Streaming und nahtloser Übergabe (Handoff).
- **Visuelle Kollaborations-Zeitleiste**: Lückenlose Verfolgung von Aufgabenzuweisungen, Dialogen zwischen Modellen, Denkprozessen (Reasoning), Tool-Ausführungen und Übergaben.
- **Intelligentes Kontextmanagement & Codex-Migration**: Lange Verläufe werden bei Bedarf automatisch in portable Kontextfenster komprimiert. Idempotente Synchronisation vorhandener JSONL-Sitzungen aus `CODEX_HOME` (`~/.codex`).

### Kollaborative Dokumentenverarbeitung

Die Verbindung von dialogorientierter KI mit nativer Dokumentenmanipulation:

- **Atomare Dokumentenoperationen**: Agenten generieren nicht nur Text, sondern übermitteln präzise strukturelle Befehle (`Einfügen`, `Formatieren`, `Ersetzen`, `Kommentieren`) direkt an die Dokumenten-Engines.
- **Cursor- & Auswahlverfolgung**: Echtzeiterfassung von Cursorpositionen, Textauswahlen und Bearbeitungsbereichen von Benutzern und Agenten.
- **Revisionskontrolle & Konfliktlösung**: Automatische Konflikterkennung bei gleichzeitiger Bearbeitung, transaktionale Zustandssicherung und One-Click-Rückgängigmachen (Undo).
- **Menschliche Freigabe (Human-in-the-Loop)**: Konfigurierbare Genehmigungsworkflows (`approval-required`) vor dem Ausführen kritischer Dokumentänderungen.

### Unterstützte Dateiformate

| Kategorie | Dateiendungen | Engine & Leistungsmerkmale |
| :--- | :--- | :--- |
| **Word-Dokumente** | `.docx`, `.doc`, `.odt` | Basiert auf **SuperDoc**. Vollständige Unterstützung von Stilen, Tabellen, Bildern und Layouts. Ältere Formate werden lokal konvertiert. |
| **Tabellenkalkulation** | `.xlsx`, `.xls`, `.csv`, `.ods` | Basiert auf **Fortune Sheet**. Umfangreiche Formeln, mehrere Arbeitsblätter, Zellstile und Hochleistungsberechnungen. |
| **Präsentationen** | `.pptx`, `.ppt`, `.odp` | Darstellung über **pptx-renderer**; Folienanpassungen und Struktur-Updates über ein schnelles **Rust OOXML** Backend. |
| **PDF-Dokumente** | `.pdf` | Duale Engine aus **PDF.js** und **MuPDF**. Kristallklare Darstellung und persistente bearbeitbare Anmerkungen (Textmarker, Stift, Text). |
| **Text & Markdown** | `.md`, `.markdown`, `.txt`, `.log` | Integrierter schlanker Editor mit Live-Vorschau und sofortiger Ladezeit. |
| **Quellcode** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat` etc. | Professioneller **Monaco Editor** mit Syntaxhervorhebung, Autovervollständigung sowie Ausführung und Debugging über lokale Toolchains. |
| **Bildvorschau** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | Schneller nativer Bildbetrachter. |

*Hinweis: Die Konvertierung von `.doc` und `.ppt` setzt lokal installiertes WPS, Microsoft Office oder LibreOffice voraus. Codeausführung nutzt die jeweiligen installierten Toolchains (Node.js, Python, Cargo). Fehlende Komponenten melden einen klaren `dependency-missing` Fehler ohne heimliche Downloads.*

### Entwicklung

Voraussetzungen:
- Node.js 22+
- Rust stable und entsprechende Kompilierungsziele
- [Tauri v2 Voraussetzungen](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Nur Web-Oberfläche ausführen:
```bash
npm run dev:web
```

Verifikation & Tests:
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Release-Ziele & Sicherheit

Release-Builds erzeugen schlanke, native Installationspakete:
- **Windows 10+**: x86_64 & ARM64 NSIS-Installationsprogramme
- **macOS**: Intel & Apple Silicon DMG
- **Linux**: x86_64 & ARM64 AppImage

Strikte CI-Grenze von 100 MiB pro Paket. Umfangreiche Integritätsprüfungen und Rollback-Sicherungen. API-Schlüssel werden geschützt im Anmeldeinformationsspeicher des Betriebssystems aufbewahrt.

### Lizenz

Veröffentlicht unter der **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). Siehe [LICENSE](./LICENSE) und [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

[Nach oben](#wps-agent-editor)

---

<a id="ru"></a>
## Русский

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Português](#pt) | [العربية](#ar) | [Наверх](#wps-agent-editor)

**WPS Agent Editor 2** — это кроссплатформенный редактор документов нового поколения и рабочая станция для мультиагентного ИИ на базе **Tauri v2**, **React** и **Rust**. Используя встроенный системный WebView, приложение полностью отказалось от тяжеловесных сред исполнения, таких как Electron, Chromium, Node.js или OnlyOffice Document Server.

### Мульти-ИИ диалог и мультиагентная координация

WPS Agent Editor оснащен мощным механизмом мультимодельной координации, объединяющим различные модели ИИ в единую команду для решения документоориентированных задач:

- **Широкая экосистема провайдеров**: Нативная интеграция с OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (локальные офлайн-модели), Volcengine (Doubao) и любыми OpenAI-совместимыми API.
- **Два режима совместной работы**:
  - **Режим управления (Directed Mode)**: Главный агент-директор разбивает сложную задачу на подзадачи, делегирует их (`delegate_task`) специализированным экспертным моделям (аналитик данных, технический писатель, ревьюер кода) и объединяет выводы в итоговый результат.
  - **Параллельный режим (Parallel Mode)**: Несколько моделей одновременно работают над разными разделами документа с поддержкой потоковой передачи данных и плавной передачи эстафеты (Handoff).
- **Визуальная временная шкала совместной работы**: Детальная фиксация распределения задач, межагентных диалогов, цепочек рассуждений (Reasoning), вызовов инструментов и передачи контекста.
- **Интеллектуальное управление контекстом и миграция Codex**: Автоматическое сжатие длинной истории в портативное контекстное окно. Бесшовная идемпотентная синхронизация локальных сессий JSONL из `CODEX_HOME` (`~/.codex`).

### Совместная обработка и редактирование документов

Прямая интеграция генеративного ИИ с внутренними механизмами редактирования документов:

- **Атомарные операции с документами**: Агенты не просто генерируют текст, а отправляют точные структурные команды (`вставка`, `форматирование`, `замена`, `аннотирование`) непосредственно в движки документов.
- **Отслеживание курсора и выделений**: Позиции курсоров и выделенные фрагменты текста пользователей и агентов отслеживаются в реальном времени.
- **Контроль версий и разрешение конфликтов**: Встроенная система ревизий выявляет параллельные конфликты редактирования, сохраняет целостность транзакций и обеспечивает отмену действий (Undo) в один клик.
- **Человеческий контроль (Human-in-the-Loop)**: Возможность настройки обязательного подтверждения пользователем (`approval-required`) для важных и критических правок.

### Поддерживаемые форматы файлов

| Категория | Расширения | Движок и возможности |
| :--- | :--- | :--- |
| **Документы Word** | `.docx`, `.doc`, `.odt` | Богатый текстовый редактор на базе **SuperDoc**. Полная поддержка стилей, таблиц и изображений. Автоматическая конвертация старых форматов. |
| **Электронные таблицы** | `.xlsx`, `.xls`, `.csv`, `.ods` | На базе **Fortune Sheet**. Сложные формулы, многостраничные книги, оформление ячеек и высокая скорость вычислений. |
| **Презентации** | `.pptx`, `.ppt`, `.odp` | Отображение через **pptx-renderer**; структурное редактирование слайдов на базе быстрого бэкенда **Rust OOXML**. |
| **Документы PDF** | `.pdf` | Двойной движок **PDF.js** и **MuPDF**. Быстрый просмотр и сохраняемые редактируемые аннотации (маркер, перо, текст). |
| **Текст и Markdown** | `.md`, `.markdown`, `.txt`, `.log` | Встроенный легковесный редактор с мгновенной загрузкой и живым предпросмотром. |
| **Исходный код** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat` и др. | Индустриальный редактор **Monaco Editor** с подсветкой синтаксиса, автодополнением, запуском и отладкой через системные компиляторы. |
| **Просмотр изображений** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | Быстрый нативный просмотрщик изображений. |

*Примечание: Преобразование форматов `.doc` и `.ppt` использует локально установленный пакет WPS, Microsoft Office или LibreOffice. Исполнение кода использует системные цепочки инструментов (Node.js, Python, Cargo). При отсутствии зависимостей выводится явная ошибка `dependency-missing` без скрытой загрузки компонентов.*

### Разработка

Системные требования:
- Node.js 22+
- Rust stable и целевые платформы
- [Предварительные требования Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Запуск только веб-интерфейса в браузере:
```bash
npm run dev:web
```

Верификация и тесты:
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Цели релизов и безопасность

Релизные сборки формируют компактные нативные пакеты:
- **Windows 10+**: установщики NSIS для x86_64 и ARM64
- **macOS**: DMG для Intel и Apple Silicon
- **Linux**: AppImage для x86_64 и ARM64

Строгий лимит CI в 100 МиБ на дистрибутив. Автоматизированное тестирование защиты подписей и процедур отката. Ключи API изолированно хранятся в защищенном системном хранилище учетных данных.

### Лицензия

Проект распространяется исключительно под лицензией **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). См. [LICENSE](./LICENSE) и [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

[Наверх](#wps-agent-editor)

---

<a id="pt"></a>
## Português

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [العربية](#ar) | [Voltar ao topo](#wps-agent-editor)

O **WPS Agent Editor 2** é um editor de documentos multiplataforma de última geração e ambiente de trabalho para múltiplos agentes de IA desenvolvido com **Tauri v2**, **React** e **Rust**. Ao utilizar o WebView nativo do sistema, elimina completamente empacotamentos pesados como Electron, Chromium, Node.js ou OnlyOffice Document Server.

### Diálogo Multi-IA e Colaboração Multi-Agente

O WPS Agent Editor traz um robusto motor de orquestração multi-modelo projetado para coordenar diferentes IAs como uma equipe de produção documental integrada:

- **Amplo Ecossistema de Provedores**: Integração nativa com OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (modelos locais offline), Volcengine (Doubao) e qualquer API compatível com o padrão OpenAI.
- **Dois Modos de Colaboração**:
  - **Modo Dirigido (Orquestração por Diretor)**: Um agente diretor planeja fluxos de trabalho complexos, delega subtarefas (`delegate_task`) a modelos especialistas (analista de dados, redator técnico, revisor de código), consolida as entregas e formula a resposta final.
  - **Modo Paralelo**: Múltiplos modelos analisam, escrevem ou validam diferentes partes do documento simultaneamente, com streaming ao vivo e transferência contínua de tarefas (Handoff).
- **Linha do Tempo Visual de Colaboração**: Rastreamento em tempo real de atribuições de tarefas, conversas entre modelos, raciocínio interno (Reasoning), chamadas de ferramentas e transições de estado.
- **Contexto Inteligente e Migração do Codex**: Compressão automática de históricos extensos em janelas de contexto portáteis. Sincronização idempotente e rápida de sessões JSONL a partir de `CODEX_HOME` (`~/.codex`).

### Processamento Colaborativo de Documentos

Integração direta entre IA generativa e a manipulação nativa de documentos:

- **Operações Atômicas em Documentos**: Os agentes não geram apenas texto puro; eles emitem instruções estruturais atômicas (`inserir`, `formatar`, `substituir`, `anotar`) diretamente para os motores dos documentos.
- **Detecção de Cursor e Seleção**: Acompanhamento em tempo real de posições de cursor, textos destacados e áreas de edição tanto dos agentes quanto do usuário.
- **Controle de Revisões e Resolução de Conflitos**: Deteção automática de conflitos em edições concorrentes, persistência atômica de transações e suporte a desfazer (Undo) com um clique.
- **Aprovação Humana (Human-in-the-Loop)**: Configuração de ações críticas que exigem confirmação explícita do usuário (`approval-required`) antes da aplicação no documento.

### Formatos de Arquivo Suportados

| Categoria | Extensões | Motor e Recursos |
| :--- | :--- | :--- |
| **Documentos Word** | `.docx`, `.doc`, `.odt` | Desenvolvido com **SuperDoc**. Suporte completo a estilos, tabelas, imagens e layout. Conversão automática de formatos antigos. |
| **Planilhas Eletrônicas** | `.xlsx`, `.xls`, `.csv`, `.ods` | Alimentado por **Fortune Sheet**. Fórmulas abrangentes, múltiplas planilhas, estilos de célula e cálculo veloz. |
| **Apresentações** | `.pptx`, `.ppt`, `.odp` | Visualização por **pptx-renderer** e edição de slides via backend rápido em **Rust OOXML**. |
| **Documentos PDF** | `.pdf` | Motor duplo com **PDF.js** e **MuPDF**. Visualização rápida e anotações editáveis permanentes (destaque, caneta, caixas de texto). |
| **Texto e Markdown** | `.md`, `.markdown`, `.txt`, `.log` | Editor leve integrado com pré-visualização em tempo real e abertura instantânea. |
| **Código-Fonte** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat`, etc. | Ambiente profissional **Monaco Editor**. Destaque sintático, autocompletar inteligente e execução/depuração via toolchains locais. |
| **Visualização de Imagens** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | Visualizador nativo rápido. |

*Nota: A conversão de formatos legados `.doc` e `.ppt` utiliza WPS, Microsoft Office ou LibreOffice instalados no computador. A execução de código depende das ferramentas locais instaladas (Node.js, Python, Cargo). Dependências ausentes retornam erro amigável `dependency-missing` sem downloads indesejados.*

### Desenvolvimento

Pré-requisitos:
- Node.js 22+
- Rust stable e alvos de compilação
- [Pré-requisitos do Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Executar apenas interface no navegador:
```bash
npm run dev:web
```

Validação e Testes:
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Alvos de Lançamento e Segurança

Compilações de lançamento geram binários nativos e leves:
- **Windows 10+**: Instaladores NSIS para x86_64 e ARM64
- **macOS**: DMG para Intel e Apple Silicon
- **Linux**: AppImage para x86_64 e ARM64

Limite rigoroso de CI de 100 MiB por instalador principal. Testes automáticos de integridade de assinatura e recuperação de falhas. As chaves de API são armazenadas exclusivamente no cofre de credenciais do sistema operacional.

### Licença

Distribuído sob a licença **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). Consulte [LICENSE](./LICENSE) e [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

[Voltar ao topo](#wps-agent-editor)

---

<a id="ar"></a>
## العربية

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العودة للأعلى](#wps-agent-editor)

يعد **WPS Agent Editor 2** محرراً متطوراً للمستندات متعدد المنصات ومحطة عمل للوكلاء البرمجيين المتعددين للذكاء الاصطناعي مبني على **Tauri v2** و **React** و **Rust**. يعتمد تطبيق سطح المكتب على متصفح النظام الأصلي (System WebView)، مستغنياً تماماً عن بيئات التشغيل الضخمة مثل Electron أو Chromium أو Node.js أو OnlyOffice Document Server.

### حوارات الذكاء الاصطناعي المتعدد والتعاون بين الوكلاء

يتميز WPS Agent Editor بمحرك تنسيق متعدد النماذج يتيح توجيه نماذج الذكاء الاصطناعي المختلفة كفريق عمل متكامل لمعالجة المستندات:

- **منظومة واسعة لمزودي النماذج**: تكامل أصلي مع OpenAI (GPT-4o, o1) و Anthropic (Claude 3.5 Sonnet) و Google Gemini و DeepSeek و Ollama (النماذج المحلية دون إنترنت) و Volcengine (Doubao) وأي واجهات برمجة متوافقة مع معايير OpenAI.
- **نمطان للعمل التعاوني**:
  - **النمط الإداري الموجه (Directed Mode)**: يقوم وكيل مدير بتفكيك المهام المعقدة وتفويض المهام الفرعية (`delegate_task`) إلى نماذج متخصصة (محلل بيانات، كاتب تقني، مراجع أكواد) ثم تجميع النتائج وصياغة المخرج النهائي.
  - **النمط المتوازي (Parallel Mode)**: تعمل عدة نماذج بالتزامن على أقسام مختلفة من المستند مع البث المباشر ونقل المهام بسلاسة (Handoff).
- **الخط الزمني المرئي للتعاون**: متابعة حية لتوزيع المهام، والحوارات المتبادلة بين النماذج، وسلاسل التفكير (Reasoning)، واستدعاء الأدوات، وتسليم الحالات.
- **إدارة السياق الذكية وترحيل Codex**: ضغط تلقائي للمحادثات الطويلة في نوافذ سياق مدمجة، ومزامنة غير مكررة لجلسات JSONL من مجلد `CODEX_HOME` (`~/.codex`).

### إمكانات المعالجة التعاونية للمستندات

ربط مباشر بين الذكاء الاصطناعي التوليدي وعمليات تحرير المستندات الأصلية:

- **عمليات ذرية على المستندات**: لا تقتصر الوكلاء على توليد النصوص، بل تصدر تعليمات هيكلية دقيقة (إدراج، تنسيق، استبدال، تدوين ملاحظات) مباشرة لمحركات المستندات.
- **إدراك المؤشر والتحديد**: تتبع دقيق لموضع مؤشر الماوس ونطاقات النصوص المحددة للوكلاء والمستخدم في الوقت الفعلي.
- **إدارة المراجعات وحل التعارضات**: اكتشاف استباقي لتعارضات التعديل المتزامن، وحفظ حالة المعاملات، والتراجع الفوري (Undo) بنقرة واحدة.
- **الاعتماد البشري (Human-in-the-Loop)**: إمكانية ضبط التعديلات الحساسة لتتطلب موافقة المستخدم الصريحة (`approval-required`) قبل تطبيقها.

### صيغ الملفات المدعومة

| الفئة | الامتدادات | المحرك والمميزات |
| :--- | :--- | :--- |
| **مستندات Word** | `.docx`, `.doc`, `.odt` | مدعوم بمحرك **SuperDoc** الغني. دعم كامل للأنماط والجداول والصور. تحويل آلي للصيغ القديمة. |
| **جداول البيانات** | `.xlsx`, `.xls`, `.csv`, `.ods` | مدعوم بمحرك **Fortune Sheet**. دوال متقدمة، أوراق عمل متعددة، أنماط خلايا وحسابات عالية السرعة. |
| **العروض التقديمية** | `.pptx`, `.ppt`, `.odp` | عرض بواسطة **pptx-renderer** وتعديل شرائح عبر واجهة خلفية فائقة السرعة بلغة **Rust OOXML**. |
| **مستندات PDF** | `.pdf` | محرك مزدوج **PDF.js** و **MuPDF**. عرض عالي الدقة وشروح قابلة للتعديل والحفظ (تمييز، قلم، نصوص). |
| **النصوص و Markdown** | `.md`, `.markdown`, `.txt`, `.log` | محرر خفيف مدمج مع معاينة فورية وسرعة تشغيل فائقة. |
| **الأكواد البرمجية** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat` وغيرها | محرر **Monaco Editor** الاحترافي مع تلوين الأكواد، والإكمال التلقائي، والتشغيل وتتبع الأخطاء عبر أدوات النظام المحلية. |
| **معاينة الصور** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | عارض صور سريع مدمج. |

*ملاحظة: تعتمد معالجة ملفات `.doc` و `.ppt` القديمة على حزم WPS أو Office أو LibreOffice المثبتة. تشغيل الأكواد يعتمد على أدوات التطوير المحلية (مثل Node.js و Python و Cargo). أي تبعيات ناقصة تُظهر تنبيهاً واضحاً باسم `dependency-missing` دون تنزيل حزم برمجية بصمت.*

### التطوير البرمجي

المتطلبات:
- Node.js 22+
- Rust stable مع بيئات التصريف المستهدفة
- [متطلبات منصة Tauri v2 المسبقة](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

تشغيل واجهة المتصفح فقط:
```bash
npm run dev:web
```

التحقق والاختبار:
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### أهداف الإصدار والأمان

تنتج عمليات البناء حزم سطح مكتب مدمجة وسريعة:
- **Windows 10+**: مثبتات NSIS لمعماريات x86_64 و ARM64
- **macOS**: حزم DMG لمعالجات Intel و Apple Silicon
- **Linux**: حزم AppImage لمعماريات x86_64 و ARM64

حد أقصى لحجم الحزم 100 ميجابايت في CI. اختبارات شاملة لمنع التلاعب واستعادة الأخطاء. يتم حفظ مفاتيح API حصرياً داخل مخزن بيانات الاعتماد الآمن بنظام التشغيل.

### الترخيص

هذا المشروع مرخص بموجب **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). راجع [LICENSE](./LICENSE) و [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

[العودة للأعلى](#wps-agent-editor)

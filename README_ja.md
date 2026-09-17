# WPS Agent Editor

[简体中文](./README.md#zh-cn) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | **日本語** | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

**WPS Agent Editor 2** は、**Tauri v2**、**React**、**Rust** をベースに設計された、次世代のクロスプラットフォーム文書エディタ兼マルチエージェント AI ワークベンチです。ネイティブのシステム WebView を活用し、Electron、Chromium、Node.js、OnlyOffice などの肥大化したランタイムの同梱を完全に排除しています。

---

## マルチ AI 対話 ＆ マルチエージェント協調エンジン

WPS Agent Editor は、さまざまな AI モデルを 1 つの高度な文書処理チームとして組織化する強力なマルチモデル協調機能を備えています：

- **幅広いプロバイダー対応**：OpenAI（GPT-4o、o1）、Anthropic（Claude 3.5 Sonnet）、Google Gemini、DeepSeek、Ollama（ローカルオフラインモデル）、Volcengine（豆包）、および OpenAI 互換 API をネイティブサポート。
- **2 つの協業モード**：
  - **ディレクターモード（Directed Mode）**：司令塔となるエージェントが複雑な業務を分解し、専門モデル（データ分析、技術執筆、コードレビュー等）へ適切にサブタスクを委譲（`delegate_task`）。結果を集約して最終成果物を生成。
  - **並行協業モード（Parallel Mode）**：複数の AI モデルが同時に同一文書の異なる章やタスクを執筆・推敲・検証。リアルタイムストリーミングと引き継ぎ（Handoff）に対応。
- **協業タイムラインの可視化**：タスク割り当て、モデル間対話、推論思考（Reasoning）、ツール呼び出し、ハンドオフをイベントログとして視覚的に追跡。
- **スマートコンテキスト ＆ Codex 移行**：長大な対話履歴をポータブルなコンテキスト窓に自動圧縮。ローカルの `CODEX_HOME`（`~/.codex`）にある JSONL 履歴を重複なく同期可能。

---

## 協調型ドキュメント処理能力

対話型 AI と文書編集操作を直結し、実用的なドキュメント作業を実現：

- **アトミック文書操作**：テキスト出力にとどまらず、ドキュメントエンジンに対して直接挿入・書式設定・置換・注釈などの構造化操作を発行。
- **カーソル・選択範囲のリアルタイム追跡**：エージェントとユーザーのカーソル位置、選択範囲、編集領域をリアルタイムに把握。
- **版管理と競合解消**：リビジョン追跡により同時編集の衝突を自動検知。トランザクション管理により安全なワンクリック取り消し（Undo）を保証。
- **Human-in-the-Loop（人間の承認）**：重要な編集や変更に対して、実行前にユーザーの承認を求める（`approval-required`）安全制御。

---

## 対応ファイル形式一覧

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

---

## 開発ガイド

### 前提条件
- Node.js 22+
- Rust stable およびターゲットコンパイラ
- [Tauri v2 前提条件](https://v2.tauri.app/start/prerequisites/)

### クイックスタート
```bash
# 依存関係のインストール
npm ci

# デスクトップアプリの開発起動
npm run dev

# ブラウザ版 UI のみ起動
npm run dev:web
```

### 検証・テスト
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

---

## リリースターゲットとセキュリティ

Release ビルドは軽量なネイティブデスクトップアプリを出力します：
- **Windows 10+**: x86_64 / ARM64 NSIS インストーラー
- **macOS**: Intel / Apple Silicon DMG
- **Linux**: x86_64 / ARM64 AppImage

主要バイナリは 100 MiB 以下の CI 制限を遵守。署名改ざん防止、復旧テスト、実更新スモークテストを実施済み。API キーは OS 組み込みのセキュアな資格情報保管庫で厳重に保護されます。

---

## ライセンス

本プロジェクトは **GNU Affero General Public License v3.0 only**（AGPL-3.0-only）の下で公開されています。[LICENSE](./LICENSE) および [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。

# WPS Agent Editor

[简体中文](./README.md) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | **日本語** | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

WPS Agent Editor 2 は、Tauri v2、React、Rust をベースにしたクロスプラットフォームなドキュメントエディタ兼マルチエージェント・ワークベンチです。デスクトップ版はシステムのネイティブ WebView を使用し、Electron、Chromium、Node.js、OnlyOffice Document Server の同梱を完全に廃止しています。

## 組み込み機能

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer；一般的な PPTX 編集は Rust OOXML バックエンドが処理
- **テキスト & Markdown**: 組み込みエディタ
- **コード**: Monaco；実行およびデバッグにはローカルにインストールされた言語ツールチェーンを使用
- **Agent**: OpenAI、Anthropic、Google、Ollama、および OpenAI 互換プロバイダー

旧形式の `.doc`、`.ppt` および複雑なメディア変換には、システムにインストールされた WPS、Microsoft Office、または LibreOffice が必要です。JavaScript/TypeScript の実行にはシステムの Node.js が必要であり、その他の言語も同様にシステムのツールチェーンを使用します。不足している依存関係は明示的な `dependency-missing` エラーを返し、実行時に巨大なコンポーネントをバックグラウンドで無断ダウンロードすることはありません。

## 開発環境

要件：

- Node.js 22+
- Rust stable および対応するターゲット
- [Tauri v2 前提条件](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

ブラウザ UI のみ実行：

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

## リリースターゲット

Release ビルドでは以下のデスクトップ成果物が生成されます：

- **Windows 10+**: x86_64 および ARM64 NSIS インストーラー
- **macOS**: Intel および Apple Silicon DMG
- **Linux**: x86_64 および ARM64 AppImage

主要なダウンロードパッケージの CI 上限は 100 MiB です。Git タグは `package.json`、Cargo、および `tauri.conf.json` のバージョンと一致する必要があります。安定版リリースにはさらに Windows Authenticode、macOS Developer ID / 公証、および Tauri アップデータ用 Ed25519 署名鍵が必要です。

Pull Request では、6 つのネイティブターゲット向けに短期間保持される未署名テストパッケージが生成されます。`v*-rc.*` タグは、チェックサム、SBOM、AGPL 対応ソースコードアーカイブ、GitHub ビルド構成証明を含む公開の未署名リリース候補（RC）をビルドしますが、アップデータ用メタデータの生成や自動更新チャンネルへの登録は行われません。本番タグビルドは、各プラットフォームでの署名、ファイル関連付け、コア文書、Agent ストリーミング応答、インストール、起動、コンテンツ検査、アンインストールのスモークテストに合格して初めて単一の finalize タスクへ進みます。finalize はアップデータメタデータ、拒絶テストフィクスチャ、チェックサム、SBOM、ソースアーカイブ、ビルド証明を一括生成し、まずプレリリースとして公開されます。

`Signed staging release smoke` は、厳格なタグを使用して 6 つのプラットフォームで署名改ざん拒否、破損インストールの復旧、実環境アップデート、再起動、起動ヘルスチェック、失敗ロールバック、外部バージョン/ハッシュの整合性を検証します。各ターゲットでは旧バージョンを再インストールし、アップデート後の起動失敗を意図的に注入して、プロセス外から以前のペイロードが正しく復元・再起動されることを確認します。ワークフローはデフォルトで検証のみを行い、明示的に `promote` が選択されマトリクスジョブがすべて成功した場合にのみ、分離された最小権限ジョブがプレリリースを安定版に昇格させます。`v2.0.0` 以降は、過去にリリースされたタグの指定が必須であり、アップグレード検証をスキップすることはできません。完全な RC、署名資格情報、安定版プロセスの詳細は [RELEASING.md](./RELEASING.md) を参照してください。

## v2 データ戦略

v2 では、設定が新しい `v2/` アプリケーションデータディレクトリに保存されます。旧 Electron の設定およびユーザードキュメントは読み取り、移行、削除されません。API キーは再入力が必要で、システム資格情報保管庫（Keychain / Credential Vault）にのみ安全に保管されます。更新前には `v2/updater-health/` に制限付きバックアップとアトミックなトランザクション状態が作成されます。新バージョンは React がマウントされネイティブ IPC の疎通が完了して初めて健全と判断され、それ以外の場合は独立した旧バージョン guardian プロセスが以前のインストールペイロードに自動ロールバックします。

## Codex 対話履歴の移行

Agent パネルを初めて起動すると、現在のユーザーの `CODEX_HOME`（未設定時は `~/.codex`）内のアクティブおよびアーカイブされた JSONL セッションがスキャンされ、冪等性を持って `v2/conversations/` に同期されます。履歴パネルのダウンロードボタンからいつでも再スキャンが可能です。同期済みのファイルが重複してインポートされることはなく、後から追加または変更された会話は差分更新されます。

インポート時は会話を再開可能なユーザー、アシスタント、システムメッセージのみを保持し、タイトル、プロジェクトパス、元のプロバイダー/モデル、アーカイブ状態も保持されます。開発者向けインストラクション、内部思考（Reasoning）、ツール呼び出しの出力、Codex 認証情報ファイル、および添付ファイルの生データは読み取られず、会話コンテキストに注入されることもありません。メッセージ本文に手動で貼り付けられた機密情報はそのまま保持されるため、共有前にご自身で確認してください。任意の履歴会話を選択した後、設定済みの OpenAI、Anthropic、Google、Ollama、または OpenAI 互換プロバイダーに即座に切り替えて作業を続行できます。長大な履歴は送信時に自動的にポータブルなコンテキストウィンドウへ圧縮されますが、ローカルの元データはそのまま完全な状態で保持されます。

Codex の shell/process セッション、承認ステータス、実行中のツールは移行されません。外部モデルはインポートされた可視メッセージと現在のアプリアベイラブルなツールに基づいて実行を継続します。

## ライセンス

本プロジェクトは GNU Affero General Public License v3.0 only の下で公開されています。[LICENSE](./LICENSE) および [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。バイナリを配布する場合は、そのバージョンに対応する完全なソースコードを同時に提供する必要があります。

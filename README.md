# WPS Agent Editor

<div align="center">

### 🌐 语言切换 / Switch Language

[简体中文](#zh-cn) • [English](#en) • [繁體中文](#zh-tw) • [日本語](#ja) • [한국어](#ko) • [Español](#es) • [Français](#fr) • [Deutsch](#de) • [Русский](#ru) • [Português](#pt) • [العربية](#ar)

<sub>点击蓝色语言文字直接在当前页面切换 / Click any blue link to switch language directly on this page</sub>

</div>

---

<a id="zh-cn"></a>
## 🇨🇳 简体中文

[English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [⬆ 返回顶部](#wps-agent-editor)

WPS Agent Editor 2 是基于 Tauri v2、React 和 Rust 的跨平台文档编辑器与多 Agent 工作台。桌面端使用系统 WebView，不再捆绑 Electron、Chromium、Node.js 或 OnlyOffice Document Server。

### 内置能力

- Word：SuperDoc
- Excel：Fortune Sheet
- PDF：PDF.js
- PowerPoint：pptx-renderer；常用 PPTX 编辑由 Rust OOXML 后端完成
- 文本与 Markdown：内置编辑器
- 代码：Monaco；执行和调试使用本机已安装的语言工具链
- Agent：OpenAI、Anthropic、Google、Ollama 和 OpenAI-compatible Provider

旧 `.doc`、`.ppt` 与复杂媒体转换需要系统 WPS、Microsoft Office 或 LibreOffice。JavaScript/TypeScript 运行需要系统 Node.js；其他语言同样使用系统工具链。缺失依赖会返回可识别的 `dependency-missing` 错误，不会在运行时静默下载大型组件。

### 开发

要求：

- Node.js 22+
- Rust stable 与对应编译目标
- [Tauri v2 平台依赖](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

仅运行浏览器界面：

```bash
npm run dev:web
```

验证：

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### 发布目标

Release 构建以下桌面产物：

- Windows 10+：x86_64 与 ARM64 NSIS 安装程序
- macOS：Intel 与 Apple Silicon DMG
- Linux：x86_64 与 ARM64 AppImage

每个主要下载包的 CI 上限为 100 MiB。Tag 必须与 `package.json`、Cargo 和 `tauri.conf.json` 的版本一致；稳定版还要求 Windows Authenticode、macOS Developer ID/公证及 Tauri updater Ed25519 密钥。

Pull Request 会在六个原生目标上生成短期保留的未签名测试包。`v*-rc.*` tag 构建公开的未签名候选包，并生成校验和、SBOM、AGPL 对应源码归档与 GitHub 构建证明，但不生成 updater 元数据，也不进入自动更新渠道。正式 tag 构建必须通过对应平台的签名、文件关联、核心文档、Agent 流式响应、安装、启动、内容检查和卸载冒烟后才能进入单一 finalize 任务；finalize 统一生成 updater 元数据、拒绝安装夹具、校验和、SBOM、源码归档与构建证明，并先发布为 prerelease。

`Signed staging release smoke` 使用精确 tag 在六个平台验证签名篡改拒绝、无效安装保持原程序、真实升级、重启、启动健康检查、失败回滚和外部版本/哈希。每个目标还会重新安装旧版，注入一次更新后启动失败，并从进程外确认旧载荷已恢复和重启。工作流默认只验收；显式选择 `promote` 且全部矩阵通过时，只有独立的最小权限 job 可以将 prerelease 提升为稳定版。`v2.0.0` 之后必须提供较旧的已发布 tag，不能跳过升级验收。完整的 RC、签名凭据和稳定版流程见 [RELEASING.md](./RELEASING.md)。

### v2 数据策略

v2 将配置写入新的 `v2/` 应用数据目录。旧 Electron 配置和用户文档不会被读取、迁移或删除；API key 需要重新录入并只存放在系统凭据库中。更新前会在 `v2/updater-health/` 创建受限备份和原子事务状态；新版本只有在 React 已挂载且完成原生 IPC 往返后才确认健康，否则独立旧版本 guardian 会恢复原安装载荷。

### Codex 对话迁移

Agent 面板首次启动时会扫描当前用户的 `CODEX_HOME`（未设置时使用 `~/.codex`）中的活动与归档 JSONL 会话，并以幂等方式写入 `v2/conversations/`。历史面板中的下载按钮可以随时重新扫描；已同步的文件不会重复导入，后续新增或变化的会话会增量更新。

导入仅保留可续聊的用户、助手和系统消息，同时保留标题、项目路径、原始 Provider/模型和归档状态；开发者指令、内部推理、工具调用输出、Codex 凭据文件和附件原始数据不会被读取或进入对话上下文。用户主动粘贴在正文中的敏感信息会按原文保存，请在共享前自行检查。选择任意历史对话后，可以直接切换到已配置的 OpenAI、Anthropic、Google、Ollama 或 OpenAI-compatible Provider 继续工作。超长历史会在发送时自动压缩为便携上下文窗口，原始记录仍完整保存在本地。

Codex 的 shell/process 会话、审批状态和正在运行的工具不会迁移；外部模型会基于已导入的可见消息和当前应用可用工具继续执行。

### 许可证

本项目以 GNU Affero General Public License v3.0 only 发布。参见 [LICENSE](./LICENSE) 和 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。分发二进制时必须同时提供该版本对应的完整源代码。

[⬆ 返回顶部](#wps-agent-editor)

---

<a id="en"></a>
## 🇺🇸 English

[简体中文](#zh-cn) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [⬆ Back to Top](#wps-agent-editor)

WPS Agent Editor 2 is a cross-platform document editor and multi-agent workbench built on Tauri v2, React, and Rust. The desktop application uses the native system WebView, completely eliminating bundled Electron, Chromium, Node.js, or OnlyOffice Document Server.

### Built-in Capabilities

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; common PPTX editing is handled by a Rust OOXML backend
- **Text & Markdown**: Built-in editor
- **Code**: Monaco; execution and debugging rely on locally installed language toolchains
- **Agent**: OpenAI, Anthropic, Google, Ollama, and OpenAI-compatible Providers

Legacy `.doc`, `.ppt`, and complex media conversions require system-installed WPS, Microsoft Office, or LibreOffice. JavaScript/TypeScript execution requires system Node.js; other languages similarly use system toolchains. Missing dependencies will return an explicit `dependency-missing` error rather than silently downloading heavy components at runtime.

### Development

Requirements:

- Node.js 22+
- Rust stable and corresponding compilation targets
- [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Run browser UI only:

```bash
npm run dev:web
```

Verification:

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Release Targets

Release builds produce the following desktop artifacts:

- **Windows 10+**: x86_64 and ARM64 NSIS installers
- **macOS**: Intel and Apple Silicon DMG
- **Linux**: x86_64 and ARM64 AppImage

Each primary download package is capped at a CI limit of 100 MiB. Tags must match the versions in `package.json`, Cargo, and `tauri.conf.json`. Stable releases additionally require Windows Authenticode, macOS Developer ID / notarization, and Tauri updater Ed25519 signing keys.

Pull Requests generate short-retention unsigned test packages across six native targets. `v*-rc.*` tags build public unsigned release candidates with checksums, SBOM, AGPL-compliant source archives, and GitHub build attestations, but do not generate updater metadata or enter automated update channels. Production tags must pass signing, file association, core document checks, Agent streaming verification, installation, launch, content validation, and uninstallation smoke tests on respective platforms before reaching a single finalize job; finalize uniformly generates updater metadata, rejection test fixtures, checksums, SBOM, source archives, and build attestations, publishing first as a prerelease.

`Signed staging release smoke` uses exact tags across six platforms to verify signature tampering rejection, corrupt install recovery, live upgrades, restarts, launch health checks, failed rollbacks, and external version/hash matching. Each target also reinstalls the older version, injects a simulated failed post-update launch, and verifies out-of-process that the previous payload is restored and restarted. Workflows default to verification only; when explicitly promoted and all matrix jobs pass, an isolated least-privilege job elevates the prerelease to a stable release. After `v2.0.0`, an older released tag must be provided and upgrade verification cannot be skipped. See [RELEASING.md](./RELEASING.md) for full RC, signing credentials, and stable release procedures.

### v2 Data Strategy

v2 stores configuration in a new `v2/` application data directory. Legacy Electron configurations and user documents are not read, migrated, or deleted; API keys must be re-entered and are exclusively stored in the system credential vault. Before updates, a restricted backup and atomic transaction state are created in `v2/updater-health/`; new versions are only deemed healthy after React mounts and completes a native IPC roundtrip, otherwise an independent legacy guardian process rolls back to the previous installation payload.

### Codex Conversation Migration

Upon the first launch of the Agent panel, the application scans active and archived JSONL sessions in the current user's `CODEX_HOME` (defaults to `~/.codex` if unset) and idempotently syncs them into `v2/conversations/`. The download button in the history panel can rescan at any time; synchronized files are not re-imported, while subsequent additions or modifications are updated incrementally.

Importing preserves only resumable user, assistant, and system messages, alongside conversation titles, project paths, original provider/model, and archive status. Developer instructions, internal reasoning, tool call outputs, Codex credential files, and raw attachment data are neither read nor injected into conversation contexts. Sensitive information manually pasted into message bodies will be preserved as-is; please inspect before sharing. After selecting any historical conversation, you can immediately switch to configured OpenAI, Anthropic, Google, Ollama, or OpenAI-compatible providers to continue work. Oversized histories are automatically compressed into portable context windows upon sending, while local original records remain intact.

Codex shell/process sessions, approval states, and actively running tools are not migrated; external models will continue execution based on imported visible messages and currently available application tools.

### License

This project is licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Distributing binaries requires providing corresponding complete source code for that version.

[⬆ Back to Top](#wps-agent-editor)

---

<a id="zh-tw"></a>
## 🇭🇰 繁體中文

[简体中文](#zh-cn) | [English](#en) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [⬆ 返回頂部](#wps-agent-editor)

WPS Agent Editor 2 是基於 Tauri v2、React 和 Rust 的跨平台文檔編輯器與多 Agent 工作台。桌面端使用系統 WebView，不再捆綁 Electron、Chromium、Node.js 或 OnlyOffice Document Server。

### 內建能力

- **Word**：SuperDoc
- **Excel**：Fortune Sheet
- **PDF**：PDF.js
- **PowerPoint**：pptx-renderer；常用 PPTX 編輯由 Rust OOXML 後端完成
- **文字與 Markdown**：內建編輯器
- **程式碼**：Monaco；執行和除錯使用本機已安裝的語言工具鏈
- **Agent**：OpenAI、Anthropic、Google、Ollama 和 OpenAI-compatible Provider

舊 `.doc`、`.ppt` 與複雜媒體轉換需要系統 WPS、Microsoft Office 或 LibreOffice。JavaScript/TypeScript 運行需要系統 Node.js；其他語言同樣使用系統工具鏈。缺失依賴會返回可識別的 `dependency-missing` 錯誤，不會在運行時靜默下載大型組件。

### 開發

要求：

- Node.js 22+
- Rust stable 與對應編譯目標
- [Tauri v2 平台依賴](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

僅運行瀏覽器介面：

```bash
npm run dev:web
```

驗證：

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### 發布目標

Release 構建以下桌面產物：

- **Windows 10+**：x86_64 與 ARM64 NSIS 安裝程式
- **macOS**：Intel 與 Apple Silicon DMG
- **Linux**：x86_64 與 ARM64 AppImage

每個主要下載包的 CI 上限為 100 MiB。Tag 必須與 `package.json`、Cargo 和 `tauri.conf.json` 的版本一致；穩定版還要求 Windows Authenticode、macOS Developer ID/公證及 Tauri updater Ed25519 金鑰。

Pull Request 會在六個原生目標上生成短期保留的未簽名測試包。`v*-rc.*` tag 構建公開的未簽名候選包，並生成校驗和、SBOM、AGPL 對應源代碼歸檔與 GitHub 構建證明，但不生成 updater 元數據，也不進入自動更新渠道。正式 tag 構建必須通過對應平台的簽名、檔案關聯、核心文檔、Agent 流式響應、安裝、啟動、內容檢查和卸載冒煙後才能進入單一 finalize 任務；finalize 統一生成 updater 元數據、拒絕安裝夾具、校驗和、SBOM、源代碼歸檔與構建證明，並先發布為 prerelease。

`Signed staging release smoke` 使用精確 tag 在六個平台驗證簽名篡改拒絕、無效安裝保持原程式、真實升級、重啟、啟動健康檢查、失敗回滾和外部版本/雜湊。每個目標還會重新安裝舊版，注入一次更新後啟動失敗，並從進程外確認舊載荷已恢復和重啟。工作流默認只驗收；顯式選擇 `promote` 且全部矩陣通過時，只有獨立的最小權限 job 可以將 prerelease 提升為穩定版。`v2.0.0` 之後必須提供較舊的已發布 tag，不能跳過升級驗收。完整的 RC、簽名憑據和穩定版流程見 [RELEASING.md](./RELEASING.md)。

### v2 數據策略

v2 將配置寫入新的 `v2/` 應用數據目錄。舊 Electron 配置和用戶文檔不會被讀取、遷移或刪除；API key 需要重新錄入並只存放在系統憑據庫中。更新前會在 `v2/updater-health/` 創建受限備份和原子事務狀態；新版本只有在 React 已掛載且完成原生 IPC 往返後才確認健康，否則獨立舊版本 guardian 會恢復原安裝載荷。

### Codex 對話遷移

Agent 面板首次啟動時會掃描當前用戶的 `CODEX_HOME`（未設置時使用 `~/.codex`）中的活動與歸檔 JSONL 會話，並以等冪方式寫入 `v2/conversations/`。歷史面板中的下載按鈕可以隨時重新掃描；已同步的檔案不會重複導入，後續新增或變化的會話會增量更新。

導入僅保留可續聊的用戶、助手和系統消息，同時保留標題、項目路徑、原始 Provider/模型和歸檔狀態；開發者指令、內部推理、工具調用輸出、Codex 憑據檔案和附件原始數據不會被讀取或進入對話上下文。用戶主動粘貼在正文中的敏感資訊會按原文保存，請在共享前自行檢查。選擇任意歷史對話後，可以直接切換到已配置的 OpenAI、Anthropic、Google、Ollama 或 OpenAI-compatible Provider 繼續工作。超長歷史會在發送時自動壓縮為便攜上下文窗口，原始記錄仍完整保存在本地。

Codex 的 shell/process 會話、審批狀態和正在運行的工具不會遷移；外部模型會基於已導入的可見消息和當前應用可用工具繼續執行。

### 許可證

本項目以 GNU Affero General Public License v3.0 only 發布。參見 [LICENSE](./LICENSE) 和 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。分發二進制檔案時必須同時提供該版本對應的完整源代碼。

[⬆ 返回頂部](#wps-agent-editor)

---

<a id="ja"></a>
## 🇯🇵 日本語

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [⬆ トップへ戻る](#wps-agent-editor)

WPS Agent Editor 2 は、Tauri v2、React、Rust をベースにしたクロスプラットフォームなドキュメントエディタ兼マルチエージェント・ワークベンチです。デスクトップ版はシステムのネイティブ WebView を使用し、Electron、Chromium、Node.js、OnlyOffice Document Server の同梱を完全に廃止しています。

### 組み込み機能

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer；一般的な PPTX 編集は Rust OOXML バックエンドが処理
- **テキスト & Markdown**: 組み込みエディタ
- **コード**: Monaco；実行およびデバッグにはローカルにインストールされた言語ツールチェーンを使用
- **Agent**: OpenAI、Anthropic、Google、Ollama、および OpenAI 互換プロバイダー

旧形式の `.doc`、`.ppt` および複雑なメディア変換には、システムにインストールされた WPS、Microsoft Office、または LibreOffice が必要です。JavaScript/TypeScript の実行にはシステムの Node.js が必要であり、その他の言語も同様にシステムのツールチェーンを使用します。不足している依存関係は明示的な `dependency-missing` エラーを返し、実行時に巨大なコンポーネントをバックグラウンドで無断ダウンロードすることはありません。

### 開発環境

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

### リリースターゲット

Release ビルドでは以下のデスクトップ成果物が生成されます：

- **Windows 10+**: x86_64 および ARM64 NSIS インストーラー
- **macOS**: Intel および Apple Silicon DMG
- **Linux**: x86_64 および ARM64 AppImage

主要なダウンロードパッケージの CI 上限は 100 MiB です。Git タグは `package.json`、Cargo、および `tauri.conf.json` のバージョンと一致する必要があります。安定版リリースにはさらに Windows Authenticode、macOS Developer ID / 公証、および Tauri アップデータ用 Ed25519 署名鍵が必要です。

Pull Request では、6 つのネイティブターゲット向けに短期間保持される未署名テストパッケージが生成されます。`v*-rc.*` タグは、チェックサム、SBOM、AGPL 対応ソースコードアーカイブ、GitHub ビルド構成証明を含む公開の未署名リリース候補（RC）をビルドしますが、アップデータ用メタデータの生成や自動更新チャンネルへの登録は行われません。本番タグビルドは、各プラットフォームでの署名、ファイル関連付け、コア文書、Agent ストリーミング応答、インストール、起動、コンテンツ検査、アンインストールのスモークテストに合格して初めて単一の finalize タスクへ進みます。finalize はアップデータメタデータ、拒絶テストフィクスチャ、チェックサム、SBOM、ソースアーカイブ、ビルド証明を一括生成し、まずプレリリースとして公開されます。

`Signed staging release smoke` は、厳格なタグを使用して 6 つのプラットフォームで署名改ざん拒否、破損インストールの復旧、実環境アップデート、再起動、起動ヘルスチェック、失敗ロールバック、外部バージョン/ハッシュの整合性を検証します。各ターゲットでは旧バージョンを再インストールし、アップデート後の起動失敗を意図的に注入して、プロセス外から以前のペイロードが正しく復元・再起動されることを確認します。ワークフローはデフォルトで検証のみを行い、明示的に `promote` が選択されマトリクスジョブがすべて成功した場合にのみ、分離された最小権限ジョブがプレリリースを安定版に昇格させます。`v2.0.0` 以降は、過去にリリースされたタグの指定が必須であり、アップグレード検証をスキップすることはできません。完全な RC、署名資格情報、安定版プロセスの詳細は [RELEASING.md](./RELEASING.md) を参照してください。

### v2 データ戦略

v2 では、設定が新しい `v2/` アプリケーションデータディレクトリに保存されます。旧 Electron の設定およびユーザードキュメントは読み取り、移行、削除されません。API キーは再入力が必要で、システム資格情報保管庫（Keychain / Credential Vault）にのみ安全に保管されます。更新前には `v2/updater-health/` に制限付きバックアップとアトミックなトランザクション状態が作成されます。新バージョンは React がマウントされネイティブ IPC の疎通が完了して初めて健全と判断され、それ以外の場合は独立した旧バージョン guardian プロセスが以前のインストールペイロードに自動ロールバックします。

### Codex 対話履歴の移行

Agent パネルを初めて起動すると、現在のユーザーの `CODEX_HOME`（未設定時は `~/.codex`）内のアクティブおよびアーカイブされた JSONL セッションがスキャンされ、冪等性を持って `v2/conversations/` に同期されます。履歴パネルのダウンロードボタンからいつでも再スキャンが可能です。同期済みのファイルが重複してインポートされることはなく、後から追加または変更された会話は差分更新されます。

インポート時は会話を再開可能なユーザー、アシスタント、システムメッセージのみを保持し、タイトル、プロジェクトパス、元のプロバイダー/モデル、アーカイブ状態も保持されます。開発者向けインストラクション、内部思考（Reasoning）、ツール呼び出しの出力、Codex 認証情報ファイル、および添付ファイルの生データは読み取られず、会話コンテキストに注入されることもありません。メッセージ本文に手動で貼り付けられた機密情報はそのまま保持されるため、共有前にご自身で確認してください。任意の履歴会話を選択した後、設定済みの OpenAI、Anthropic、Google、Ollama、または OpenAI 互換プロバイダーに即座に切り替えて作業を続行できます。長大な履歴は送信時に自動的にポータブルなコンテキストウィンドウへ圧縮されますが、ローカルの元データはそのまま完全な状態で保持されます。

Codex の shell/process セッション、承認ステータス、実行中のツールは移行されません。外部モデルはインポートされた可視メッセージと現在のアプリアベイラブルなツールに基づいて実行を継続します。

### ライセンス

本プロジェクトは GNU Affero General Public License v3.0 only の下で公開されています。[LICENSE](./LICENSE) および [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。バイナリを配布する場合は、そのバージョンに対応する完全なソースコードを同時に提供する必要があります。

[⬆ トップへ戻る](#wps-agent-editor)

---

<a id="ko"></a>
## 🇰🇷 한국어

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [⬆ 맨 위로](#wps-agent-editor)

WPS Agent Editor 2는 Tauri v2, React 및 Rust를 기반으로 구축된 크로스 플랫폼 문서 편집기이자 멀티 에이전트 워크벤치입니다. 데스크톱 애플리케이션은 네이티브 시스템 WebView를 사용하며 번들된 Electron, Chromium, Node.js 또는 OnlyOffice Document Server를 완전히 제거했습니다.

### 내장 기능

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; 일반적인 PPTX 편집은 Rust OOXML 백엔드에서 처리
- **텍스트 및 Markdown**: 내장 에디터
- **코드**: Monaco; 실행 및 디버깅은 로컬에 설치된 언어 툴체인을 사용
- **Agent**: OpenAI, Anthropic, Google, Ollama 및 OpenAI 호환 공급자(Provider)

기존 레거시 `.doc`, `.ppt` 및 복합 미디어 변환에는 시스템에 설치된 WPS, Microsoft Office 또는 LibreOffice가 필요합니다. JavaScript/TypeScript 실행에는 시스템 Node.js가 필요하며, 기타 언어 역시 시스템 툴체인을 사용합니다. 누락된 종속성은 런타임 중 대용량 구성 요소를 무단으로 다운로드하지 않고 식별 가능한 `dependency-missing` 오류를 반환합니다.

### 개발

요구 사항:

- Node.js 22+
- Rust stable 및 해당 컴파일 타깃
- [Tauri v2 플랫폼 필수 구성 요소](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

브라우저 UI만 실행:

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

### 배포 대상

Release 빌드는 다음 데스크톱 바이너리를 생성합니다:

- **Windows 10+**: x86_64 및 ARM64 NSIS 설치 프로그램
- **macOS**: Intel 및 Apple Silicon DMG
- **Linux**: x86_64 및 ARM64 AppImage

각 주요 다운로드 패키지의 CI 상한선은 100 MiB입니다. 태그는 `package.json`, Cargo 및 `tauri.conf.json`의 버전과 일치해야 합니다. 안정화 릴리스의 경우 Windows Authenticode, macOS Developer ID/공증 및 Tauri updater Ed25519 서명 키가 추가로 요구됩니다.

Pull Request는 6개 네이티브 타깃에 대해 단기 보존되는 미서명 테스트 패키지를 생성합니다. `v*-rc.*` 태그는 체크섬, SBOM, AGPL 대응 소스코드 아카이브 및 GitHub 빌드 증명을 포함한 공개 미서명 릴리스 후보(RC)를 빌드하지만, updater 메타데이터를 생성하지 않으며 자동 업데이트 채널에 진입하지 않습니다. 프로덕션 태그 빌드는 플랫폼별 서명, 파일 연결, 핵심 문서, Agent 스트리밍 응답, 설치, 실행, 콘텐츠 검사, 제거 스모크 테스트를 통과한 후에만 단일 finalize 작업에 진입합니다. finalize 작업은 updater 메타데이터, 거부 테스트 픽스처, 체크섬, SBOM, 소스 아카이브 및 빌드 증명을 통합 생성하고 먼저 prerelease로 게시합니다.

`Signed staging release smoke`는 정확한 태그를 사용하여 6개 플랫폼에서 서명 변조 거부, 손상된 설치 복구, 실제 업그레이드, 재부팅, 실행 상태 점검, 실패 롤백 및 외부 버전/해시 일치 여부를 검증합니다. 또한 각 대상 플랫폼은 이전 버전을 재설치하고, 업데이트 후 실행 실패를 주입하여 프로세스 외부에서 이전 페이로드가 정상 복원 및 재시작되는지 확인합니다. 워크플로는 기본적으로 검증만 수행하며, 명시적으로 `promote`를 선택하고 전체 매트릭스가 통과한 경우에만 최소 권한 격리 작업이 prerelease를 안정화 릴리스로 승격합니다. `v2.0.0` 이후에는 이전에 릴리스된 태그를 반드시 제공해야 하며 업그레이드 검증을 생략할 수 없습니다. 전체 RC, 서명 자격 증명 및 안정화 버전 프로세스는 [RELEASING.md](./RELEASING.md)를 참조하십시오.

### v2 데이터 전략

v2는 새로운 `v2/` 애플리케이션 데이터 디렉터리에 설정을 저장합니다. 기존 Electron 설정 및 사용자 문서는 읽거나 이전하거나 삭제하지 않습니다. API 키는 다시 입력해야 하며 시스템 자격 증명 보관함(Credential Vault)에만 안전하게 보관됩니다. 업데이트 전 `v2/updater-health/`에 제한된 백업과 원자적 트랜잭션 상태가 생성됩니다. 새 버전은 React가 마운트되고 네이티브 IPC 왕복을 완료해야만 정상 상태로 확인되며, 그렇지 않으면 독립된 이전 버전 guardian 프로세스가 이전 설치 페이로드로 롤백합니다.

### Codex 대화 마이그레이션

Agent 패널을 처음 실행할 때 현재 사용자의 `CODEX_HOME`(설정되지 않은 경우 `~/.codex`)에 있는 활성 및 아카이브된 JSONL 세션을 검색하여 멱등성(idempotent) 방식으로 `v2/conversations/`에 동기화합니다. 기록 패널의 다운로드 버튼을 통해 언제든지 다시 검색할 수 있습니다. 이미 동기화된 파일은 중복 가져오기되지 않으며, 새로 추가되거나 변경된 대화는 증분 업데이트됩니다.

가져오기는 재개 가능한 사용자, 어시스턴트, 시스템 메시지만 유지하며 제목, 프로젝트 경로, 원래 공급자/모델 및 아카이브 상태를 보존합니다. 개발자 지침, 내부 추론(Reasoning), 도구 호출 출력, Codex 자격 증명 파일 및 첨부 파일 원본 데이터는 읽거나 대화 컨텍스트에 포함되지 않습니다. 메시지 본문에 수동으로 붙여넣은 민감한 정보는 그대로 유지되므로 공유 전에 직접 확인하십시오. 대화 기록을 선택한 후 구성된 OpenAI, Anthropic, Google, Ollama 또는 OpenAI 호환 공급자로 즉시 전환하여 작업을 계속할 수 있습니다. 긴 기록은 전송 시 휴대용 컨텍스트 창으로 자동 압축되지만 원본 로컬 기록은 손상 없이 보존됩니다.

Codex의 shell/process 세션, 승인 상태 및 실행 중인 도구는 마이그레이션되지 않습니다. 외부 모델은 가져온 가시적인 메시지와 현재 앱에서 사용 가능한 도구를 기반으로 작업을 계속 실행합니다.

### 라이선스

본 프로젝트는 GNU Affero General Public License v3.0 only에 따라 배포됩니다. [LICENSE](./LICENSE) 및 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 참조하십시오. 바이너리를 배포할 때는 해당 버전에 해당하는 전체 소스코드를 함께 제공해야 합니다.

[⬆ 맨 위로](#wps-agent-editor)

---

<a id="es"></a>
## 🇪🇸 Español

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [⬆ Volver arriba](#wps-agent-editor)

WPS Agent Editor 2 es un editor de documentos multiplataforma y entorno de trabajo multi-agente basado en Tauri v2, React y Rust. La aplicación de escritorio utiliza el WebView nativo del sistema, eliminando por completo la inclusión de Electron, Chromium, Node.js o OnlyOffice Document Server.

### Capacidades integradas

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; la edición habitual de PPTX se realiza mediante un backend OOXML en Rust
- **Texto y Markdown**: Editor integrado
- **Código**: Monaco; la ejecución y depuración emplean las herramientas del sistema instaladas localmente
- **Agent**: OpenAI, Anthropic, Google, Ollama y proveedores compatibles con OpenAI

La conversión de formatos heredados (`.doc`, `.ppt`) y medios complejos requiere WPS, Microsoft Office o LibreOffice instalados en el sistema. La ejecución de JavaScript/TypeScript requiere Node.js del sistema; otros lenguajes utilizan de igual forma las herramientas locales del sistema. Las dependencias faltantes devuelven un error identificable `dependency-missing` en lugar de descargar silenciosamente componentes pesados durante la ejecución.

### Desarrollo

Requisitos:

- Node.js 22+
- Rust stable y los destinos de compilación correspondientes
- [Requisitos previos de la plataforma Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Ejecutar únicamente la interfaz web en navegador:

```bash
npm run dev:web
```

Verificación y pruebas:

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Objetivos de publicación

Las compilaciones de lanzamiento (Release) generan los siguientes artefactos de escritorio:

- **Windows 10+**: Instaladores NSIS para x86_64 y ARM64
- **macOS**: DMG para Intel y Apple Silicon
- **Linux**: AppImage para x86_64 y ARM64

El límite de CI para cada paquete de descarga principal es de 100 MiB. Las etiquetas Git (tags) deben coincidir estrictamente con las versiones en `package.json`, Cargo y `tauri.conf.json`. Las versiones estables requieren además Windows Authenticode, macOS Developer ID / notarización y las claves de firma Ed25519 de Tauri updater.

Las Pull Requests generan paquetes de prueba sin firmar de retención corta en seis plataformas nativas. Las etiquetas `v*-rc.*` compilan candidatos a versión (RC) públicos sin firmar con sumas de comprobación (checksums), SBOM, archivo de código fuente conforme a AGPL y atestados de compilación de GitHub, sin generar metadatos de actualización ni entrar en canales automáticos. Las compilaciones de etiquetas oficiales deben superar pruebas de humo de firma, asociación de archivos, documentos básicos, respuestas en streaming del agente, instalación, arranque, inspección de contenido y desinstalación antes de pasar a la tarea única de finalización (finalize). La fase de finalización genera de forma unificada los metadatos de actualización, pruebas de rechazo de instalación, sumas de comprobación, SBOM, archivos de código fuente y atestados de compilación, publicándose inicialmente como versión preliminar (prerelease).

`Signed staging release smoke` valida con etiquetas exactas en las seis plataformas el rechazo de firmas alteradas, recuperación de instalaciones corruptas, actualizaciones reales, reinicios, comprobaciones de estado de arranque, reversión por fallo y coincidencia de versión/hash externos. En cada entorno se reinstala la versión previa, se inyecta un fallo simulado tras la actualización y se verifica de forma externa al proceso que la carga útil anterior se restablezca y reinicie. Los flujos de trabajo se limitan por defecto a la verificación; solo cuando se selecciona explícitamente `promote` y se superan todas las pruebas de la matriz, un trabajo aislado con privilegios mínimos promueve la versión preliminar a versión estable. A partir de `v2.0.0`, es obligatorio proporcionar una versión anterior publicada y no se puede omitir la verificación de actualización. Consulte los procedimientos completos de RC, credenciales de firma y versiones estables en [RELEASING.md](./RELEASING.md).

### Estrategia de datos de v2

v2 almacena la configuración en un nuevo directorio de datos de aplicación `v2/`. Las configuraciones anteriores de Electron y los documentos de usuario no se leen, no se migran ni se eliminan; las claves de API deben introducirse de nuevo y se almacenan exclusivamente en el almacén de credenciales del sistema. Antes de cualquier actualización, se crea una copia de seguridad restringida y un estado de transacción atómica en `v2/updater-health/`; las nuevas versiones solo se consideran correctas después de que React se haya montado y completado un ciclo de comunicación IPC nativo; de lo contrario, un proceso guardián independiente restaura la versión anterior instalada.

### Migración de conversaciones de Codex

Al iniciar el panel de agentes por primera vez, la aplicación explora las sesiones JSONL activas y archivadas en el `CODEX_HOME` del usuario actual (por defecto `~/.codex` si no está configurado) y las sincroniza de forma idempotente en `v2/conversations/`. El botón de descarga del panel de historial permite volver a escanear en cualquier momento; los archivos ya sincronizados no se duplican, y las conversaciones nuevas o modificadas se actualizan de forma incremental.

La importación conserva únicamente los mensajes reanudables de usuario, asistente y sistema, junto con los títulos, rutas de proyecto, proveedor/modelo original y estado de archivo. Las instrucciones de desarrollador, razonamientos internos, salidas de ejecución de herramientas, archivos de credenciales de Codex y datos adjuntos sin procesar no se leen ni se inyectan en el contexto de la conversación. La información confidencial pegada manualmente en los mensajes se mantendrá intacta; revísela antes de compartir. Tras seleccionar cualquier conversación histórica, puede cambiar de inmediato a proveedores configurados como OpenAI, Anthropic, Google, Ollama o compatibles con OpenAI para continuar trabajando. Los historiales extensos se comprimen automáticamente en ventanas de contexto portátiles al enviarse, preservando intacto el registro original en local.

Las sesiones de shell/procesos de Codex, los estados de aprobación y las herramientas en ejecución no se migran; los modelos externos continuarán ejecutándose sobre la base de los mensajes visibles importados y las herramientas disponibles en la aplicación actual.

### Licencia

Este proyecto se distribuye exclusivamente bajo la licencia GNU Affero General Public License v3.0 (AGPL-3.0-only). Consulte [LICENSE](./LICENSE) y [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). La distribución de binarios requiere proporcionar de forma simultánea el código fuente completo correspondiente a dicha versión.

[⬆ Volver arriba](#wps-agent-editor)

---

<a id="fr"></a>
## 🇫🇷 Français

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [⬆ Retour en haut](#wps-agent-editor)

WPS Agent Editor 2 est un éditeur de documents multiplateforme et un environnement de travail multi-agents reposant sur Tauri v2, React et Rust. L'application de bureau utilise la WebView native du système, éliminant totalement l'intégration d'Electron, Chromium, Node.js ou OnlyOffice Document Server.

### Fonctionnalités intégrées

- **Word** : SuperDoc
- **Excel** : Fortune Sheet
- **PDF** : PDF.js
- **PowerPoint** : pptx-renderer ; l'édition courante des fichiers PPTX est assurée par un backend OOXML en Rust
- **Texte & Markdown** : Éditeur intégré
- **Code** : Monaco ; l'exécution et le débogage exploitent les chaînes d'outils logicielles installées sur la machine
- **Agent** : Fournisseurs OpenAI, Anthropic, Google, Ollama et compatibles OpenAI

La conversion des formats hérités (`.doc`, `.ppt`) et des médias complexes nécessite l'installation locale de WPS, Microsoft Office ou LibreOffice. L'exécution JavaScript/TypeScript nécessite Node.js sur le système hôte ; les autres langages s'appuient de la même manière sur leurs chaînes d'outils locales. Toute dépendance manquante déclenche une erreur explicite `dependency-missing` sans télécharger silencieusement de composants volumineux à l'exécution.

### Développement

Prérequis :

- Node.js 22+
- Rust stable et cibles de compilation associées
- [Prérequis de la plateforme Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Exécuter uniquement l'interface navigateur :

```bash
npm run dev:web
```

Vérification et tests :

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Cibles de publication

Les builds de production génèrent les exécutables de bureau suivants :

- **Windows 10+** : Installateurs NSIS pour x86_64 et ARM64
- **macOS** : DMG pour Intel et Apple Silicon
- **Linux** : AppImage pour x86_64 et ARM64

Chaque paquet de téléchargement principal est soumis à une limite CI stricte de 100 Mio. Les tags Git doivent correspondre exactement aux versions définies dans `package.json`, Cargo et `tauri.conf.json`. Les versions stables nécessitent en outre les signatures Windows Authenticode, Apple Developer ID avec notarisation, ainsi que les clés de signature Ed25519 du programme de mise à jour Tauri.

Les Pull Requests génèrent des paquets de test non signés à rétention courte sur les six cibles natives. Les tags `v*-rc.*` construisent des versions candidates (RC) publiques non signées accompagnées des sommes de contrôle, du SBOM, des archives du code source conformes AGPL et des attestations de build GitHub, sans produire de métadonnées de mise à jour ni intégrer les canaux de mise à jour automatique. Les builds de tags officiels doivent valider les tests de signature, d'associations de fichiers, de documents de base, de streaming Agent, d'installation, de démarrage, de contrôle de contenu et de désinstallation avant de passer à la tâche unique de finalisation (`finalize`). Cette dernière génère de manière consolidée les métadonnées de mise à jour, les jeux d'épreuves de rejet d'installation, les sommes de contrôle, le SBOM, les archives de code source et les attestations de build, publiant l'ensemble sous forme de préversion.

La suite `Signed staging release smoke` valide avec des tags stricts sur les six plateformes le rejet de falsification de signature, la récupération d'installations corrompues, les mises à niveau réelles, les redémarrages, les bilans de santé au lancement, le retour arrière (rollback) en cas d'échec et la conformité des versions/hachages externes. Chaque cible réinstalle également la version précédente, injecte un échec simulé au lancement après mise à jour et s'assure hors-processus que la charge utile antérieure est restaurée et relancée avec succès. Par défaut, le flux de travail n'effectue que des vérifications ; lorsqu'une promotion explicite est demandée et que l'intégralité de la matrice réussit, un travail isolé avec privilèges minimaux élève la préversion au statut de version stable. À partir de `v2.0.0`, un tag précédemment publié doit impérativement être fourni et la vérification de mise à niveau ne peut être ignorée. Consultez [RELEASING.md](./RELEASING.md) pour les détails complets sur les RC, les identifiants de signature et la procédure de version stable.

### Stratégie de données v2

v2 enregistre les configurations dans un nouveau répertoire de données d'application `v2/`. Les configurations Electron héritées et les documents utilisateurs ne sont ni consultés, ni migrés, ni supprimés. Les clés d'API doivent être saisies à nouveau et sont conservées exclusivement dans le trousseau de clés d'identification du système hôte. Avant toute mise à jour, une sauvegarde restreinte et un état de transaction atomique sont enregistrés sous `v2/updater-health/` ; les nouvelles versions ne sont déclarées saines qu'après le montage effectif de React et la validation d'un échange IPC natif complet, sans quoi un processus gardien indépendant restaure la version précédente.

### Migration des conversations Codex

Lors du premier lancement du panneau Agent, l'application analyse les sessions JSONL actives et archivées présentes dans le dossier `CODEX_HOME` de l'utilisateur (par défaut `~/.codex` si non défini) et les synchronise de manière idempotente dans `v2/conversations/`. Le bouton d'actualisation du panneau d'historique permet de relancer l'analyse à tout moment. Les fichiers déjà synchronisés ne sont pas réimportés et les conversations nouvelles ou modifiées font l'objet d'une mise à jour incrémentielle.

L'importation conserve uniquement les messages de l'utilisateur, de l'assistant et du système permettant de reprendre la conversation, tout en préservant le titre, le chemin du projet, le fournisseur/modèle d'origine et le statut d'archivage. Les instructions développeur, le raisonnement interne (Reasoning), les sorties d'appels d'outils, les fichiers de clés d'identification Codex et les données brutes de pièces jointes ne sont ni lus ni injectés dans le contexte de dialogue. Les informations sensibles collées directement dans le corps des messages restent enregistrées telles quelles : veillez à les contrôler avant tout partage. Après avoir sélectionné une conversation dans l'historique, vous pouvez basculer immédiatement vers un fournisseur configuré (OpenAI, Anthropic, Google, Ollama ou compatible OpenAI) pour poursuivre le travail. Les historiques trop longs sont automatiquement compressés dans une fenêtre contextuelle portable lors de l'envoi, tandis que l'enregistrement d'origine reste intégralement conservé sur la machine locale.

Les sessions de terminal/processus de Codex, les statuts d'approbation et les outils en cours d'exécution ne sont pas transférés ; les modèles externes poursuivent leur exécution à partir des messages visibles importés et des outils actuellement disponibles dans l'application.

### Licence

Ce projet est distribué sous la seule licence GNU Affero General Public License v3.0 (AGPL-3.0-only). Voir [LICENSE](./LICENSE) et [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). La distribution de binaires impose la mise à disposition simultanée de l'intégralité du code source correspondant à cette version.

[⬆ Retour en haut](#wps-agent-editor)

---

<a id="de"></a>
## 🇩🇪 Deutsch

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Русский](#ru) | [Português](#pt) | [العربية](#ar) | [⬆ Nach oben](#wps-agent-editor)

WPS Agent Editor 2 ist ein plattformübergreifender Dokumenteneditor und eine Multi-Agenten-Workbench auf Basis von Tauri v2, React und Rust. Die Desktop-Anwendung verwendet die native WebView des Systems und verzichtet vollständig auf gebündeltes Electron, Chromium, Node.js oder OnlyOffice Document Server.

### Integrierte Funktionen

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; gängige PPTX-Bearbeitungen werden von einem Rust-OOXML-Backend ausgeführt
- **Text & Markdown**: Integrierter Editor
- **Code**: Monaco; Ausführung und Debugging nutzen lokal installierte Sprach-Toolchains
- **Agent**: OpenAI, Anthropic, Google, Ollama und OpenAI-kompatible Provider

Die Konvertierung älterer Formate (`.doc`, `.ppt`) und komplexer Mediendateien erfordert ein systemweit installiertes WPS, Microsoft Office oder LibreOffice. Die Ausführung von JavaScript/TypeScript setzt systemweites Node.js voraus; andere Programmiersprachen nutzen ebenfalls die systemeigenen Toolchains. Fehlende Abhängigkeiten geben einen eindeutigen `dependency-missing`-Fehler aus, anstatt zur Laufzeit unbemerkt umfangreiche Pakete nachzuladen.

### Entwicklung

Voraussetzungen:

- Node.js 22+
- Rust stable und entsprechende Kompilierungsziele
- [Tauri v2 Plattform-Voraussetzungen](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Nur die Browser-Oberfläche ausführen:

```bash
npm run dev:web
```

Verifikation und Tests:

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Release-Ziele

Release-Builds erstellen folgende Desktop-Artefakte:

- **Windows 10+**: x86_64 und ARM64 NSIS-Installationsprogramme
- **macOS**: Intel und Apple Silicon DMG
- **Linux**: x86_64 und ARM64 AppImage

Für jedes primäre Download-Paket gilt ein striktes CI-Limit von 100 MiB. Tags müssen exakt mit den Versionen in `package.json`, Cargo und `tauri.conf.json` übereinstimmen. Stabile Releases erfordern zusätzlich Windows Authenticode, macOS Developer ID / Notarisierung und Tauri updater Ed25519-Signaturschlüssel.

Pull Requests erstellen zeitlich begrenzt aufbewahrte, unsignierte Testpakete für sechs native Plattformen. `v*-rc.*`-Tags erstellen öffentliche, unsignierte Release-Kandidaten (RC) mit Prüfsummen, SBOM, AGPL-konformem Quelltextarchiv und GitHub-Build-Attestierungen, generieren jedoch keine Updater-Metadaten und gelangen nicht in automatische Update-Kanäle. Offizielle Produktions-Tags müssen vor Erreichen des zentralen Finalize-Jobs Signatur-, Dateizuordnungs-, Kerndokument-, Agent-Streaming-, Installations-, Start-, Inhaltsprüfungs- und Deinstallations-Smoketests bestehen. Der Finalize-Schritt erzeugt einheitlich Updater-Metadaten, Fixtures zur Ablehnung fehlerhafter Installationen, Prüfsummen, SBOM, Quelltextarchive und Build-Attestierungen und veröffentlicht diese zunächst als Prerelease.

`Signed staging release smoke` prüft unter Verwendung exakter Tags auf sechs Plattformen die Zurückweisung manipulierter Signaturen, die Wiederherstellung beschädigter Installationen, echte Upgrades, Neustarts, Start-Zustandsprüfungen, Rollbacks bei Fehlern und Übereinstimmungen externer Versionen/Hashes. Jedes Ziel installiert zudem die Vorversion neu, injiziert einen künstlichen Startfehler nach dem Update und verifiziert prozessunabhängig die Wiederherstellung und den Neustart der vorherigen Version. Workflows dienen standardmäßig nur der Abnahme; nur bei ausdrücklicher Auswahl von `promote` und bestandener Gesamtmatrix befördert ein isolierter Job mit Mindestberechtigungen das Prerelease zu einem stabilen Release. Ab `v2.0.0` muss ein zuvor veröffentlichter Tag bereitgestellt werden; Upgrade-Prüfungen können nicht übersprungen werden. Detaillierte Abläufe zu RCs, Signaturanmeldedaten und stabilen Releases finden Sie in [RELEASING.md](./RELEASING.md).

### v2-Datenstrategie

v2 speichert Konfigurationen in einem neuen `v2/`-Anwendungsdatenverzeichnis. Alte Electron-Konfigurationen und Benutzerdokumente werden weder gelesen noch migriert oder gelöscht. API-Schlüssel müssen neu eingegeben werden und werden ausschließlich im Tresor für Anmeldedaten des Systems gespeichert. Vor Updates wird unter `v2/updater-health/` ein geschütztes Backup und ein atomarer Transaktionsstatus angelegt. Eine neue Version wird erst dann als funktionstüchtig eingestuft, wenn React gemountet ist und ein nativer IPC-Roundtrip erfolgreich abgeschlossen wurde; andernfalls stellt ein unabhängiger Guardian-Prozess das vorherige Installationspaket wieder her.

### Codex-Konversationsmigration

Beim ersten Start des Agent-Panels durchsucht die Anwendung aktive und archivierte JSONL-Sitzungen im Verzeichnis `CODEX_HOME` des aktuellen Benutzers (Standard: `~/.codex`) und synchronisiert diese idempotent nach `v2/conversations/`. Über den Download-Button im Verlaufs-Panel kann der Scan jederzeit wiederholt werden; synchronisierte Dateien werden nicht erneut importiert, und neu hinzugefügte oder geänderte Konversationen werden inkrementell aktualisiert.

Der Import behält ausschließlich fortsetzbare Benutzer-, Assistenten- und Systemnachrichten bei, zusammen mit Konversationstitel, Projektpfad, ursprünglichem Provider/Modell und Archivierungsstatus. Entwickleranweisungen, interne Denkprozesse (Reasoning), Ausgaben von Tool-Aufrufen, Codex-Anmeldedatendateien und rohe Anhangsdaten werden weder ausgelesen noch in den Gesprächskontext eingefügt. Manuell in den Text eingefügte sensible Informationen bleiben unverändert erhalten; bitte prüfen Sie diese vor einer Weitergabe. Nach Auswahl einer Konversation kann direkt zu einem konfigurierten Provider (OpenAI, Anthropic, Google, Ollama oder OpenAI-kompatibel) gewechselt werden. Überlange Verläufe werden beim Senden automatisch in portable Kontextfenster komprimiert, während die lokalen Originalaufzeichnungen vollständig erhalten bleiben.

Shell-/Prozess-Sitzungen, Freigabestatus und laufende Tools von Codex werden nicht migriert; externe Modelle setzen die Ausführung auf Grundlage der importierten sichtbaren Nachrichten und der in der aktuellen Anwendung verfügbaren Werkzeuge fort.

### Lizenz

Dieses Projekt wird ausschließlich unter der GNU Affero General Public License v3.0 (AGPL-3.0-only) lizenziert. Siehe [LICENSE](./LICENSE) und [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Bei der Weitergabe von Binärdateien muss gleichzeitig der vollständige, dieser Version entsprechende Quellcode bereitgestellt werden.

[⬆ Nach oben](#wps-agent-editor)

---

<a id="ru"></a>
## 🇷🇺 Русский

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Português](#pt) | [العربية](#ar) | [⬆ Наверх](#wps-agent-editor)

WPS Agent Editor 2 — это кроссплатформенный редактор документов и рабочая станция для мультиагентного взаимодействия на базе Tauri v2, React и Rust. Десктопное приложение использует системный WebView, полностью исключая поставку встроенных Electron, Chromium, Node.js или OnlyOffice Document Server.

### Встроенные возможности

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; базовое редактирование PPTX выполняется бэкендом Rust OOXML
- **Текст и Markdown**: встроенный редактор
- **Код**: Monaco; выполнение и отладка используют установленный в системе инструментарий языков
- **Agent**: OpenAI, Anthropic, Google, Ollama и OpenAI-совместимые провайдеры

Для конвертации устаревших форматов (`.doc`, `.ppt`) и сложных мультимедийных файлов требуется установленный в системе WPS, Microsoft Office или LibreOffice. Для исполнения JavaScript/TypeScript необходим системный Node.js; другие языки программирования аналогично используют системные цепочки инструментов. При отсутствии зависимостей возвращается понятная ошибка `dependency-missing`, без скрытой фоновой загрузки тяжелых компонентов во время работы.

### Разработка

Требования:

- Node.js 22+
- Rust stable и соответствующие целевые платформы сборки
- [Требования платформы Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Запуск только интерфейса в браузере:

```bash
npm run dev:web
```

Проверка и тестирование:

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Цели сборки релизов

Релизные сборки генерируют следующие бинарные пакеты:

- **Windows 10+**: установщики NSIS для x86_64 и ARM64
- **macOS**: DMG для Intel и Apple Silicon
- **Linux**: AppImage для x86_64 и ARM64

Максимальный лимит размера загружаемого пакета в CI составляет 100 МиБ. Теги Git должны строго совпадать с версиями в `package.json`, Cargo и `tauri.conf.json`. Стабильные релизы дополнительно требуют Windows Authenticode, macOS Developer ID / нотаризацию и ключи подписи Tauri updater Ed25519.

Pull Request создают неподписанные тестовые пакеты с кратким сроком хранения для шести нативных платформ. Теги `v*-rc.*` собирают публичные неподписанные кандидаты в релиз (RC) с контрольными суммами, SBOM, архивом исходных кодов по лицензии AGPL и аттестациями сборки GitHub, но не генерируют метаданные автообновления и не попадают в каналы автообновления. Официальные теги релизов должны пройти дымовые тесты подписи, сопоставления файлов, базовых документов, потоковых ответов агента, установки, запуска, проверки содержимого и удаления, прежде чем перейти к финальной задаче (`finalize`). На этапе finalize централизованно формируются метаданные обновлений, фикстуры отказа установки, контрольные суммы, SBOM, архивы исходного кода и подтверждения сборки, после чего пакет первоначально публикуется как предрелиз.

Тестовый набор `Signed staging release smoke` с точными тегами проверяет на шести платформах отклонение измененных подписей, восстановление поврежденных установок, реальные обновления, перезапуски, проверку работоспособности при старте, откат при сбоях и соответствие внешних версий/хешей. На каждой платформе повторно устанавливается старая версия, имитируется сбой при первом запуске после обновления и вне основного процесса проверяется успешное восстановление и запуск предыдущего рабочего пакета. По умолчанию рабочий процесс выполняет только верификацию; при явном выборе `promote` и успешном прохождении всей матрицы изолированное задание с минимальными привилегиями переводит предрелиз в статус стабильного. Начиная с `v2.0.0`, указание ранее выпущенного тега является обязательным, и пропуск проверки обновления не допускается. Полное описание процедур RC, подписей и стабильных релизов см. в [RELEASING.md](./RELEASING.md).

### Стратегия данных v2

v2 сохраняет конфигурации в новом каталоге данных приложения `v2/`. Старые конфигурации Electron и документы пользователей не читаются, не переносятся и не удаляются. Ключи API необходимо ввести заново, они хранятся исключительно в системном защищенном хранилище учетных данных. Перед обновлением в `v2/updater-health/` создается изолированная резервная копия и атомарное состояние транзакции. Новая версия считается исправной только после монтирования React и завершения нативного обмена IPC, иначе независимый сторожевой процесс (guardian) восстанавливает предыдущий дистрибутив.

### Миграция диалогов Codex

При первом запуске панели Agent приложение сканирует активные и архивные сессии JSONL в директории `CODEX_HOME` текущего пользователя (по умолчанию `~/.codex`) и идемпотентно синхронизирует их в `v2/conversations/`. Кнопка загрузки на панели истории позволяет выполнить повторное сканирование в любое время; синхронизированные файлы повторно не импортируются, а новые или измененные сессии обновляются инкрементально.

При импорте сохраняются только сообщения пользователя, ассистента и системы, пригодные для продолжения диалога, а также заголовок, путь к проекту, исходный провайдер/модель и статус архивации. Инструкции разработчика, внутренние цепочки рассуждений (Reasoning), вызовы инструментов, файлы аутентификации Codex и исходные данные вложений не считываются и не попадают в контекст общения. Конфиденциальные данные, вставленные пользователем вручную в текст сообщений, сохраняются как есть — проверяйте их перед экспортом или совместным использованием. Выбрав любой диалог из истории, можно сразу переключиться на настроенного провайдера (OpenAI, Anthropic, Google, Ollama или OpenAI-совместимого) для продолжения работы. Длинная история автоматически сжимается в портативное контекстное окно при отправке, при этом локальная исходная запись сохраняется полностью.

Сессии процессов/терминала Codex, статусы подтверждений и запущенные инструменты не переносятся; внешние модели продолжают выполнение задач на основе импортированных видимых сообщений и инструментов, доступных в текущем приложении.

### Лицензия

Этот проект распространяется исключительно под лицензией GNU Affero General Public License v3.0 (AGPL-3.0-only). См. [LICENSE](./LICENSE) и [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). При распространении скомпилированных файлов обязательно предоставление соответствующего полного исходного кода данной версии.

[⬆ Наверх](#wps-agent-editor)

---

<a id="pt"></a>
## 🇧🇷 Português

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [العربية](#ar) | [⬆ Voltar ao topo](#wps-agent-editor)

O WPS Agent Editor 2 é um editor de documentos multiplataforma e ambiente de trabalho multi-agente desenvolvido com base em Tauri v2, React e Rust. O aplicativo para desktop utiliza o WebView nativo do sistema, eliminando por completo o empacotamento de Electron, Chromium, Node.js ou OnlyOffice Document Server.

### Recursos Integrados

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; edições comuns de PPTX são processadas por um backend OOXML em Rust
- **Texto e Markdown**: Editor integrado
- **Código**: Monaco; execução e depuração utilizam as toolchains de linguagens instaladas localmente no sistema
- **Agent**: Provedores OpenAI, Anthropic, Google, Ollama e compatíveis com a API OpenAI

A conversão de formatos legados (`.doc`, `.ppt`) e mídias complexas requer o WPS, Microsoft Office ou LibreOffice instalado no sistema operacional. A execução de scripts JavaScript/TypeScript exige o Node.js do sistema; outras linguagens de programação utilizam igualmente suas cadeias de ferramentas locais. A ausência de dependências retorna um erro identificável `dependency-missing`, evitando o download silencioso de pacotes pesados durante o tempo de execução.

### Desenvolvimento

Requisitos:

- Node.js 22+
- Rust stable e os alvos de compilação correspondentes
- [Pré-requisitos da plataforma Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Executar apenas a interface no navegador:

```bash
npm run dev:web
```

Validação e testes:

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

### Destinos de Lançamento

As compilações de lançamento geram os seguintes artefatos para desktop:

- **Windows 10+**: Instaladores NSIS para x86_64 e ARM64
- **macOS**: DMG para arquiteturas Intel e Apple Silicon
- **Linux**: AppImage para x86_64 e ARM64

O limite de CI para cada pacote de download principal é de 100 MiB. As tags do Git devem corresponder rigorosamente às versões contidas no `package.json`, Cargo e `tauri.conf.json`. Versões estáveis exigem adicionalmente Windows Authenticode, Apple Developer ID / notarização e chaves de assinatura Ed25519 do atualizador do Tauri.

Pull Requests geram pacotes de teste não assinados com retenção temporária em seis plataformas nativas. Tags `v*-rc.*` compilam candidatos a lançamento (RC) públicos e não assinados, com somas de verificação (checksums), SBOM, arquivos de código-fonte em conformidade com AGPL e atestados de compilação do GitHub, mas sem gerar metadados de atualização nem ingressar nos canais automáticos. Compilações de tags de produção exigem aprovação em testes de fumaça (smoke tests) de assinatura, associação de arquivos, documentos principais, respostas de streaming do agente, instalação, inicialização, validação de conteúdo e desinstalação antes de seguir para a etapa de finalização unificada. O job finalize gera centralizadamente os metadados de atualização, cenários de rejeição de instalação incorreta, checksums, SBOM, arquivos de código-fonte e certificados de build, publicando inicialmente como pré-lançamento (prerelease).

O teste `Signed staging release smoke` valida com tags exatas nas seis plataformas a rejeição de assinaturas violadas, a recuperação de instalações corrompidas, atualizações em ambiente real, reinicializações, verificações de integridade ao iniciar, reversão em caso de falha e conformidade de versão/hash externo. Cada plataforma reinstala a versão anterior, injeta uma falha simulada na inicialização pós-atualização e confirma, fora do processo principal, a restauração e reinicialização seguras do pacote anterior. Por padrão, o fluxo de trabalho realiza apenas verificação; quando `promote` for explicitamente selecionado e toda a matriz for aprovada, um trabalho isolado de privilégio mínimo promove o pré-lançamento a estável. A partir da versão `v2.0.0`, é obrigatório fornecer uma tag lançada anteriormente, sendo impossível ignorar a verificação de atualização. Consulte os procedimentos detalhados de RC, credenciais de assinatura e lançamentos estáveis no [RELEASING.md](./RELEASING.md).

### Estratégia de Dados da v2

A v2 armazena suas configurações em um novo diretório de dados do aplicativo chamado `v2/`. Configurações anteriores do Electron e documentos de usuários não são lidos, migrados ou excluídos. Chaves de API precisam ser inseridas novamente e são armazenadas exclusivamente no cofre seguro de credenciais do sistema operacional. Antes de atualizações, um backup restrito e um estado transacional atômico são gravados em `v2/updater-health/`. Uma nova versão só é declarada íntegra após a montagem do React e a conclusão de uma comunicação IPC nativa de ida e volta; caso contrário, um processo guardião independente restaura a instalação anterior.

### Migração de Conversas do Codex

Ao iniciar o painel do Agent pela primeira vez, o aplicativo verifica as sessões ativas e arquivadas em JSONL na pasta `CODEX_HOME` do usuário atual (padrão `~/.codex` quando não definida) e as sincroniza de forma idempotente em `v2/conversations/`. O botão de sincronização no painel de histórico permite repetir o escaneamento a qualquer momento; arquivos já sincronizados não são duplicados, e conversas novas ou modificadas são atualizadas incrementalmente.

A importação preserva apenas mensagens retomáveis de usuário, assistente e sistema, juntamente com títulos de conversas, caminhos de projetos, provedor/modelo de origem e status de arquivamento. Instruções para desenvolvedores, raciocínios internos (Reasoning), saídas de chamadas de ferramentas, arquivos de credenciais do Codex e anexos brutos não são lidos nem injetados no contexto da conversa. Informações confidenciais coladas manualmente no corpo das mensagens serão salvas exatamente como enviadas; revise o conteúdo antes de compartilhá-lo. Ao selecionar qualquer conversa no histórico, é possível alternar instantaneamente para provedores configurados (OpenAI, Anthropic, Google, Ollama ou compatíveis) para dar continuidade ao trabalho. Históricos muito extensos são compactados automaticamente em janelas de contexto portáteis no envio, mantendo os registros originais intactos localmente.

Sessões de terminal/processos, estados de aprovação e ferramentas ativas em execução no Codex não são migrados; os modelos externos continuarão executando tarefas com base nas mensagens visíveis importadas e nas ferramentas disponíveis na aplicação atual.

### Licença

Este projeto é distribuído exclusivamente sob a licença GNU Affero General Public License v3.0 (AGPL-3.0-only). Veja [LICENSE](./LICENSE) e [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). A distribuição de binários exige a disponibilização concomitante do código-fonte completo correspondente à respectiva versão.

[⬆ Voltar ao topo](#wps-agent-editor)

---

<a id="ar"></a>
## 🇸🇦 العربية

[简体中文](#zh-cn) | [English](#en) | [繁體中文](#zh-tw) | [日本語](#ja) | [한국어](#ko) | [Español](#es) | [Français](#fr) | [Deutsch](#de) | [Русский](#ru) | [Português](#pt) | [⬆ العودة للأعلى](#wps-agent-editor)

WPS Agent Editor 2 هو محرر مستندات متعدد المنصات ومحطة عمل للوكلاء البرمجيين المتعددين (Multi-Agent Workbench) مبني على أنظمة Tauri v2 و React و Rust. يستخدم تطبيق سطح المكتب نظام العرض المدمج في بيئة التشغيل (System WebView)، دون تضمين حزم Electron أو Chromium أو Node.js أو OnlyOffice Document Server.

### الإمكانات المضمنة

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer؛ تتم معالجة عمليات تحرير ملفات PPTX الشائعة عبر الواجهة الخلفية Rust OOXML
- **النصوص و Markdown**: محرر مدمج
- **الأكواد البرمجية**: Monaco؛ تعتمد عمليات التنفيذ وتتبع الأخطاء على أدوات اللغات المثبتة محلياً على الجهاز
- **Agent**: مزودو OpenAI و Anthropic و Google و Ollama ومزودو النماذج المتوافقة مع معايير OpenAI

تتطلب معالجة التنسيقات القديمة (`.doc` و `.ppt`) وملفات الوسائط المعقدة وجود حزم WPS أو Microsoft Office أو LibreOffice مثبتة على نظام التشغيل. يتطلب تشغيل برمجيات JavaScript/TypeScript توفر Node.js على النظام، وكذلك تستخدم بقية اللغات أدوات النظام المحلية. في حالة نقص التبعيات، يُرجع النظام خطأً صريحاً باسم `dependency-missing` بدلاً من تنزيل حزم برمجية ضخمة دون إذن أثناء التشغيل.

### التطوير البرمجي

المتطلبات:

- Node.js 22+
- Rust stable وبيئات التصريف المقابلة
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

### أهداف النشر والإصدار

تنتج عمليات بناء الإصدارات (Release) حزم سطح المكتب التالية:

- **Windows 10+**: مثبتات NSIS لمعماريات x86_64 و ARM64
- **macOS**: حزم DMG لمعالجات Intel و Apple Silicon
- **Linux**: حزم AppImage لمعماريات x86_64 و ARM64

الحد الأقصى لحجم حزم التنزيل الرئيسية في بيئة CI هو 100 ميجابايت. يجب أن تتطابق علامات الإصدار (Git Tags) بدقة مع الإصدارات في `package.json` و Cargo و `tauri.conf.json`. تتطلب الإصدارات المستقرة شهادات Windows Authenticode، وتوثيق Apple Developer ID مع Notarization، ومفاتيح توقيع Ed25519 لأداة التحديث Tauri updater.

تُنشئ طلبات السحب (Pull Requests) حزم اختبار غير موقعة قصيرة الأجل لست منصات أصلية. تبني وسوم `v*-rc.*` نسخاً مرشحة للإصدار العام غير موقعة مع قيم التحقق (checksums) و SBOM وأرشيفات المصدر المتوافقة مع ترخيص AGPL وإثباتات بناء GitHub، لكنها لا تُنشئ بيانات التحديث الوصفية ولا تدخل قنوات التحديث التلقائي. يجب أن تجتاز الإصدارات الرسمية اختبارات التوقيع، وتعيين امتدادات الملفات، والمستندات الأساسية، والبث التفاعلي للوكيل، والتثبيت، وبدء التشغيل، وفحص المحتوى وإلغاء التثبيت قبل الانتقال إلى مهمة الإنهاء المركزية (finalize). تُنشئ مهمة الإنهاء الموحدة بيانات التحديث الوصفية واختبارات الرفض وقيم التجزئة وسجلات SBOM وأرشيف المصدر وشهادات البناء، ويتم نشرها مبدئياً كإصدار تمهيدي (prerelease).

تتحقق حزمة اختبارات `Signed staging release smoke` باستخدام وسوم دقيقة عبر المنصات الست من رفض التوقيعات المعدلة، واستعادة التثبيتات التالفة، والتحديثات الحية، وإعادة التشغيل، وفحوصات السلامة، والتراجع عند الفشل، ومطابقة التجزئة الخارجية. تعيد كل منصة تثبيت الإصدار السابق وتحقن فشلاً مصطنعاً في بدء التشغيل بعد التحديث للتحقق من استعادة الحزمة السابقة بنجاح من خارج العملية. يقتصر مسار العمل افتراضياً على التحقق؛ وعند التحديد الصريح لخيار الترقية (`promote`) ونجاح كافة مصفوفات الاختبار، تقوم مهمة معزولة بأدنى صلاحيات بترقية الإصدار التمهيدي إلى إصدار مستقر. بدءاً من الإصدار `v2.0.0`، يجب توفير وسم سابق منشور ولا يمكن تجاوز التحقق من الترقية. للاطلاع على إجراءات التوقيع والاعتماد الكاملة، راجع [RELEASING.md](./RELEASING.md).

### استراتيجية بيانات الإصدار الثاني (v2)

يحفظ الإصدار v2 الإعدادات في دليل بيانات التطبيق الجديد `v2/`. لا تتم قراءة إعدادات Electron القديمة أو مستندات المستخدم السابقة أو ترحيلها أو حذفها. يلزم إدخال مفاتيح API مجدداً ويتم تخزينها حصرياً في مخزن بيانات الاعتماد الآمن للنظام. قبل التحديث، يتم إنشاء نسخة احتياطية مقيدة وحالة معاملة ذرية في `v2/updater-health/`. لا يُعتبر الإصدار الجديد سليماً إلا بعد تحميل واجهة React واكتمال جولة اتصال IPC الأصلية، وإلا فإن عملية الحارس (guardian) المستقلة تستعيد حزمة التثبيت السابقة.

### ترحيل محادثات Codex

عند تشغيل لوحة الوكيل (Agent) للمرة الأولى، يقوم التطبيق بفحص جلسات JSONL النشطة والمؤرشفة في مجلد `CODEX_HOME` للمستخدم الحالي (افتراضياً `~/.codex`) ومزامنتها بأسلوب متكرر غير مكرر (idempotent) داخل `v2/conversations/`. يتيح زر التنزيل في لوحة السجل إعادة الفحص في أي وقت؛ ولا يتم استيراد الملفات المتزامنة سابقاً مرة أخرى، بينما يتم تحديث الجلسات الجديدة أو المعدلة بصورة تزايدية.

يقتصر الاستيراد على رسائل المستخدم والمساعد والنظام القابلة للاستئناف، مع الاحتفاظ بالعناوين ومسارات المشاريع والنموذج الأصلي وحالة الأرشفة. لا تتم قراءة أو إدخال تعليمات المطورين، وسلاسل التفكير الداخلي (Reasoning)، ومخرجات استدعاء الأدوات، وملفات اعتماد Codex، والبيانات الأولية للمرفقات في سياق المحادثة. تظل المعلومات الحساسة التي يلصقها المستخدم يدوياً في متن الرسائل محفوظة كما هي؛ يرجى مراجعتها قبل المشاركة. بعد تحديد أي محادثة سابقة، يمكنك التبديل مباشرة إلى أي مزود مهيأ (OpenAI أو Anthropic أو Google أو Ollama أو متوافق مع OpenAI) لمتابعة العمل. يتم ضغط المحادثات الطويلة تلقائياً في نوافذ سياق مدمجة عند الإرسال، مع بقاء السجلات المحلية الأصلية كاملة دون تغيير.

لا يتم نقل جلسات الطرفية/العمليات الخاصة بـ Codex أو حالات الموافقة أو الأدوات قيد التشغيل؛ وتواصل النماذج الخارجية العمل استناداً إلى الرسائل المرئية المستوردة والأدوات المتاحة حالياً داخل التطبيق.

### الترخيص

هذا المشروع مرخص بموجب رخصة جنو أفيرو العمومية الإصدار 3.0 فقط (GNU AGPL v3.0 only). راجع [LICENSE](./LICENSE) و [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). يتطلب توزيع الحزم الثنائية توفير الشفرة المصدرية الكاملة المقابلة لذلك الإصدار بالتزامن معها.

[⬆ العودة للأعلى](#wps-agent-editor)

# WPS Agent Editor

[简体中文](./README.md) | [English](./README_en.md) | **繁體中文** | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

WPS Agent Editor 2 是基於 Tauri v2、React 和 Rust 的跨平台文檔編輯器與多 Agent 工作台。桌面端使用系統 WebView，不再捆綁 Electron、Chromium、Node.js 或 OnlyOffice Document Server。

## 內建能力

- **Word**：SuperDoc
- **Excel**：Fortune Sheet
- **PDF**：PDF.js
- **PowerPoint**：pptx-renderer；常用 PPTX 編輯由 Rust OOXML 後端完成
- **文字與 Markdown**：內建編輯器
- **程式碼**：Monaco；執行和除錯使用本機已安裝的語言工具鏈
- **Agent**：OpenAI、Anthropic、Google、Ollama 和 OpenAI-compatible Provider

舊 `.doc`、`.ppt` 與複雜媒體轉換需要系統 WPS、Microsoft Office 或 LibreOffice。JavaScript/TypeScript 運行需要系統 Node.js；其他語言同樣使用系統工具鏈。缺失依賴會返回可識別的 `dependency-missing` 錯誤，不會在運行時靜默下載大型組件。

## 開發

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

## 發布目標

Release 構建以下桌面產物：

- **Windows 10+**：x86_64 與 ARM64 NSIS 安裝程式
- **macOS**：Intel 與 Apple Silicon DMG
- **Linux**：x86_64 與 ARM64 AppImage

每個主要下載包的 CI 上限為 100 MiB。Tag 必須與 `package.json`、Cargo 和 `tauri.conf.json` 的版本一致；穩定版還要求 Windows Authenticode、macOS Developer ID/公證及 Tauri updater Ed25519 金鑰。

Pull Request 會在六個原生目標上生成短期保留的未簽名測試包。`v*-rc.*` tag 構建公開的未簽名候選包，並生成校驗和、SBOM、AGPL 對應源代碼歸檔與 GitHub 構建證明，但不生成 updater 元數據，也不進入自動更新渠道。正式 tag 構建必須通過對應平台的簽名、檔案關聯、核心文檔、Agent 流式響應、安裝、啟動、內容檢查和卸載冒煙後才能進入單一 finalize 任務；finalize 統一生成 updater 元數據、拒絕安裝夾具、校驗和、SBOM、源代碼歸檔與構建證明，並先發布為 prerelease。

`Signed staging release smoke` 使用精確 tag 在六個平台驗證簽名篡改拒絕、無效安裝保持原程式、真實升級、重啟、啟動健康檢查、失敗回滾和外部版本/雜湊。每個目標還會重新安裝舊版，注入一次更新後啟動失敗，並從進程外確認舊載荷已恢復和重啟。工作流默認只驗收；顯式選擇 `promote` 且全部矩陣通過時，只有獨立的最小權限 job 可以將 prerelease 提升為穩定版。`v2.0.0` 之後必須提供較舊的已發布 tag，不能跳過升級驗收。完整的 RC、簽名憑據和穩定版流程見 [RELEASING.md](./RELEASING.md)。

## v2 數據策略

v2 將配置寫入新的 `v2/` 應用數據目錄。舊 Electron 配置和用戶文檔不會被讀取、遷移或刪除；API key 需要重新錄入並只存放在系統憑據庫中。更新前會在 `v2/updater-health/` 創建受限備份和原子事務狀態；新版本只有在 React 已掛載且完成原生 IPC 往返後才確認健康，否則獨立舊版本 guardian 會恢復原安裝載荷。

## Codex 對話遷移

Agent 面板首次啟動時會掃描當前用戶的 `CODEX_HOME`（未設置時使用 `~/.codex`）中的活動與歸檔 JSONL 會話，並以等冪方式寫入 `v2/conversations/`。歷史面板中的下載按鈕可以隨時重新掃描；已同步的檔案不會重複導入，後續新增或變化的會話會增量更新。

導入僅保留可續聊的用戶、助手和系統消息，同時保留標題、項目路徑、原始 Provider/模型和歸檔狀態；開發者指令、內部推理、工具調用輸出、Codex 憑據檔案和附件原始數據不會被讀取或進入對話上下文。用戶主動粘貼在正文中的敏感資訊會按原文保存，請在共享前自行檢查。選擇任意歷史對話後，可以直接切換到已配置的 OpenAI、Anthropic、Google、Ollama 或 OpenAI-compatible Provider 繼續工作。超長歷史會在發送時自動壓縮為便攜上下文窗口，原始記錄仍完整保存在本地。

Codex 的 shell/process 會話、審批狀態和正在運行的工具不會遷移；外部模型會基於已導入的可見消息和當前應用可用工具繼續執行。

## 許可證

本項目以 GNU Affero General Public License v3.0 only 發布。參見 [LICENSE](./LICENSE) 和 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。分發二進制檔案時必須同時提供該版本對應的完整源代碼。

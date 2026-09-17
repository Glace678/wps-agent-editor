# WPS Agent Editor

[简体中文](./README.md#zh-cn) | [English](./README_en.md) | **繁體中文** | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

**WPS Agent Editor 2** 是基於 **Tauri v2**、**React** 和 **Rust** 構建的新一代跨平台文檔編輯器與多 Agent AI 工作台。桌面端採用系統原生 WebView，徹底拋棄了捆綁 Electron、Chromium、Node.js 或 OnlyOffice Document Server 的臃腫架構。

---

## 多 AI 對話與多 Agent 協同架構

WPS Agent Editor 內建強大的多模型協同調度引擎，能將不同廠商的頂尖 AI 模型組織為高效的文檔處理團隊：

- **多元模型生態接入**：原生支援 OpenAI（GPT-4o、o1）、Anthropic（Claude 3.5 Sonnet）、Google Gemini、DeepSeek、Ollama（本地離線大模型）、火山引擎（豆包）以及任意相容 OpenAI 規範的自訂 API。
- **雙重協同工作流**：
  - **主導編排模式（Directed Mode）**：由主導 Agent（Director）全面拆解複雜任務，精準指派子任務（`delegate_task`）給各領域專家模型（如數據分析師、技術撰稿人、代碼審查員），自動彙整各模型結論並生成最終成果。
  - **並行協同模式（Parallel Mode）**：多個模型針對同一任務或文檔的不同板塊同步進行寫作、潤色或交叉驗證，具備實時串流與接力轉移（Handoff）機制。
- **視覺化協同時間線**：細粒度捕獲任務分工、模型間對話、思考推理歷程（Reasoning）、工具調用與成果交接，全程可觀測、可追溯。
- **智慧上下文與 Codex 遷移**：超長會話自動壓縮為可移植上下文視窗。首次啟動可自動、等冪同步使用者 `CODEX_HOME`（`~/.codex`）中的 JSONL 會話。

---

## 協同文檔處理能力

WPS Agent Editor 將對話式 AI 與文檔底層編輯操作進行了深度整合：

- **原子級文檔操作**：AI Agent 不僅產出文字，還能直接向文檔引擎發送原子級精確指令（插入、排版、替換、標註），即時修改文檔。
- **游標與選區感知**：實時追蹤 Agent 與使用者的游標焦點、文字選取範圍與修改區間。
- **版本控制與衝突解決**：內建修訂控制系統，能主動檢測並防止併發衝突，維護事務狀態，支援一鍵復原（Undo）。
- **人工介入與審批機制**：支援將敏感或關鍵修改配置為使用者確認（`approval-required`），審批通過後才正式生效。

---

## 支援的文件格式清單

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

---

## 開發指南

### 環境需求
- Node.js 22+
- Rust stable 與對應編譯目標
- [Tauri v2 平台前置依賴](https://v2.tauri.app/start/prerequisites/)

### 快速開始
```bash
# 安裝依賴
npm ci

# 桌面端開發模式啟動
npm run dev

# 僅運行瀏覽器網頁介面
npm run dev:web
```

### 驗證與測試
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

---

## 發布目標與安全

Release 構建生成輕量原生桌面安裝包：
- **Windows 10+**：x86_64 與 ARM64 NSIS 安裝程式
- **macOS**：Intel 與 Apple Silicon DMG
- **Linux**：x86_64 與 ARM64 AppImage

CI 嚴格限制每個主下載包不超過 100 MiB。經過嚴格的簽名防篡改、損壞復原、真實更新驗收冒煙測試。API Key 均儲存在作業系統安全憑證庫中。

---

## 許可證

本專案以 **GNU Affero General Public License v3.0 only**（AGPL-3.0-only）發布。詳見 [LICENSE](./LICENSE) 與 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

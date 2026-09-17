# WPS Agent Editor

[简体中文](./README.md#zh-cn) | **English** | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

**WPS Agent Editor 2** is a next-generation, cross-platform document editor and multi-agent AI workbench built on **Tauri v2**, **React**, and **Rust**. Powered by native system WebViews, it completely eliminates bloated bundled runtimes such as Electron, Chromium, Node.js, or OnlyOffice Document Server.

---

## Multi-AI Dialogue & Multi-Agent Collaboration

WPS Agent Editor features a powerful multi-model collaboration engine designed to orchestrate diverse AI models into a unified document-processing team:

- **Broad Provider Ecosystem**: Native integration with OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (local offline models), Volcengine (Doubao), and any custom OpenAI-compatible API.
- **Dual Collaboration Modes**:
  - **Directed Mode (Director Orchestration)**: A lead Agent breaks down complex workflows, delegates specialized sub-tasks (`delegate_task`) to domain-expert models (e.g., data analyst, technical writer, code reviewer), aggregates intermediate findings, and synthesizes the final output.
  - **Parallel Mode**: Multiple models analyze, draft, or critique different document sections concurrently with live event streaming and handoffs.
- **Visual Collaboration Timeline**: Fine-grained live event stream tracking task dispatch, model dialogue exchanges, reasoning processes, tool invocations, and handoffs.
- **Smart Context & Codex Migration**: Long conversations are dynamically compressed into portable context windows upon request. Seamlessly imports active and archived JSONL sessions from `CODEX_HOME` (`~/.codex`) idempotently.

---

## Collaborative Document Processing Capabilities

WPS Agent Editor bridges conversational AI directly with document editing primitives:

- **Atomic Document Operations**: AI agents don't just generate text—they dispatch precise structural operations (`insert`, `format`, `replace`, `annotate`) directly to document engines.
- **Cursor & Selection Awareness**: Track live agent and user cursor positions, active text selections, and modification ranges.
- **Revision Tracking & Conflict Resolution**: Built-in revision control detects conflicting concurrent edits, maintains atomic transaction states, and supports one-click rollback/undo.
- **Human-in-the-Loop Approvals**: Configure critical document mutations to require user verification before execution (`approval-required`).

---

## Supported File Types

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

---

## Development

### Prerequisites
- Node.js 22+
- Rust stable with target toolchains
- [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Quick Start
```bash
# Install dependencies
npm ci

# Launch desktop app in dev mode
npm run dev

# Run web browser interface only
npm run dev:web
```

### Verification & Testing
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

---

## Release Targets & Security

Release builds generate lightweight, native desktop packages:
- **Windows 10+**: x86_64 & ARM64 NSIS installers
- **macOS**: Intel & Apple Silicon DMG
- **Linux**: x86_64 & ARM64 AppImage

CI enforces a strict 100 MiB limit per primary package. Releases undergo automated signed staging smoke tests verifying tamper rejection, update recovery, live migrations, and rollback guards. API keys are strictly stored in operating system credential vaults.

---

## License

Distributed under the **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

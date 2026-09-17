# WPS Agent Editor

[简体中文](./README.md) | **English** | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

WPS Agent Editor 2 is a cross-platform document editor and multi-agent workbench built on Tauri v2, React, and Rust. The desktop application uses the native system WebView, completely eliminating bundled Electron, Chromium, Node.js, or OnlyOffice Document Server.

## Built-in Capabilities

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; common PPTX editing is handled by a Rust OOXML backend
- **Text & Markdown**: Built-in editor
- **Code**: Monaco; execution and debugging rely on locally installed language toolchains
- **Agent**: OpenAI, Anthropic, Google, Ollama, and OpenAI-compatible Providers

Legacy `.doc`, `.ppt`, and complex media conversions require system-installed WPS, Microsoft Office, or LibreOffice. JavaScript/TypeScript execution requires system Node.js; other languages similarly use system toolchains. Missing dependencies will return an explicit `dependency-missing` error rather than silently downloading heavy components at runtime.

## Development

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

## Release Targets

Release builds produce the following desktop artifacts:

- **Windows 10+**: x86_64 and ARM64 NSIS installers
- **macOS**: Intel and Apple Silicon DMG
- **Linux**: x86_64 and ARM64 AppImage

Each primary download package is capped at a CI limit of 100 MiB. Tags must match the versions in `package.json`, Cargo, and `tauri.conf.json`. Stable releases additionally require Windows Authenticode, macOS Developer ID / notarization, and Tauri updater Ed25519 signing keys.

Pull Requests generate short-retention unsigned test packages across six native targets. `v*-rc.*` tags build public unsigned release candidates with checksums, SBOM, AGPL-compliant source archives, and GitHub build attestations, but do not generate updater metadata or enter automated update channels. Production tags must pass signing, file association, core document checks, Agent streaming verification, installation, launch, content validation, and uninstallation smoke tests on respective platforms before reaching a single finalize job; finalize uniformly generates updater metadata, rejection test fixtures, checksums, SBOM, source archives, and build attestations, publishing first as a prerelease.

`Signed staging release smoke` uses exact tags across six platforms to verify signature tampering rejection, corrupt install recovery, live upgrades, restarts, launch health checks, failed rollbacks, and external version/hash matching. Each target also reinstalls the older version, injects a simulated failed post-update launch, and verifies out-of-process that the previous payload is restored and restarted. Workflows default to verification only; when explicitly promoted and all matrix jobs pass, an isolated least-privilege job elevates the prerelease to a stable release. After `v2.0.0`, an older released tag must be provided and upgrade verification cannot be skipped. See [RELEASING.md](./RELEASING.md) for full RC, signing credentials, and stable release procedures.

## v2 Data Strategy

v2 stores configuration in a new `v2/` application data directory. Legacy Electron configurations and user documents are not read, migrated, or deleted; API keys must be re-entered and are exclusively stored in the system credential vault. Before updates, a restricted backup and atomic transaction state are created in `v2/updater-health/`; new versions are only deemed healthy after React mounts and completes a native IPC roundtrip, otherwise an independent legacy guardian process rolls back to the previous installation payload.

## Codex Conversation Migration

Upon the first launch of the Agent panel, the application scans active and archived JSONL sessions in the current user's `CODEX_HOME` (defaults to `~/.codex` if unset) and idempotently syncs them into `v2/conversations/`. The download button in the history panel can rescan at any time; synchronized files are not re-imported, while subsequent additions or modifications are updated incrementally.

Importing preserves only resumable user, assistant, and system messages, alongside conversation titles, project paths, original provider/model, and archive status. Developer instructions, internal reasoning, tool call outputs, Codex credential files, and raw attachment data are neither read nor injected into conversation contexts. Sensitive information manually pasted into message bodies will be preserved as-is; please inspect before sharing. After selecting any historical conversation, you can immediately switch to configured OpenAI, Anthropic, Google, Ollama, or OpenAI-compatible providers to continue work. Oversized histories are automatically compressed into portable context windows upon sending, while local original records remain intact.

Codex shell/process sessions, approval states, and actively running tools are not migrated; external models will continue execution based on imported visible messages and currently available application tools.

## License

This project is licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Distributing binaries requires providing corresponding complete source code for that version.

# WPS Agent Editor v2 Architecture

## Runtime boundary

```text
React renderer
  -> typed desktopApi
  -> Tauri invoke / Channel / directed event
  -> Rust commands and domain services
  -> OS APIs, files, keyring, HTTP providers, optional local tools
```

The renderer owns DOM-bound editors: SuperDoc, Fortune Sheet, PDF.js, pptx-renderer and Monaco. Rust owns all privileged operations. There is no production localhost bridge, embedded Node runtime, generic shell plugin or general-purpose filesystem plugin.

## Rust domains

- `commands/files`: granted paths, dialogs, recent files, history, rename, trash, reveal and clipboard.
- `commands/documents`: raw binary I/O, Word/PPT preparation, OOXML presentation edits, fonts and conversion dependency probes.
- `commands/agents`: persisted agents, provider requests, cancellation and the renderer document-command bridge.
- `commands/providers`: bundled/custom catalog, endpoint overrides and OS-keyring credentials.
- `commands/process`: bounded code runner, debugger sessions and PTY terminal sessions.
- `commands/app`: window lifecycle, menu actions, language, theme and platform metadata.

All failures use a serializable `AppError { code, messageKey, details, retryable }`. Ordered agent, terminal and debugger streams use Tauri Channels and carry a window label plus run/session ID. Low-frequency menu and open-file notifications use directed window events.

## File security and binary I/O

File dialogs, directory listings, recent files and single-instance arguments register canonical paths in an in-memory grant registry. The compatibility API may display paths, but every privileged command resolves an opaque grant and rejects unknown paths, traversal and symlink escapes. Windows comparisons are case-insensitive; Unix comparisons are not.

User-selected `.exe` files are rejected by the native open policy before they can be restored, read, passed to the system shell, run, debugged or consumed as Agent attachments. Non-opening file operations such as reveal, rename and delete remain available.

Document bytes cross IPC as raw `Uint8Array`, never Base64 or JSON number arrays. Commands that require metadata and bytes use a versioned `WAE1` envelope. Writes snapshot the previous file, write a sibling temporary file, sync it and atomically replace the destination.

## Persistent state

Non-secret repositories are versioned JSON files below the platform app-data directory's `v2/` child. Writes are atomic. Credentials use Windows Credential Manager, macOS Keychain or Linux Secret Service with no plaintext fallback. v1 Electron data remains untouched and is never auto-imported.

## Documents and processes

DOCX/XLSX/PPTX/PDF and text/code use the bundled renderer engines. Current PPTX mutations are applied directly to OOXML while retaining unknown ZIP entries and relationships. Legacy formats use detected system WPS, Office or LibreOffice executables. On Windows, WMF/EMF presentation media is rasterized through the system PowerShell/System.Drawing stack with strict time, entry and output limits; failed images and non-Windows platforms retain the original media and report zero successful normalizations.

The code runner never downloads a compiler. It uses system toolchains, enforces a 30-second default timeout and 4 MiB output limit, and terminates the whole process tree on cancellation. The renderer and Agents never receive unrestricted shell access.

## Security and release

The main webview has a strict CSP: no remote navigation or scripts; only the required local, `blob:` and `data:` sources for workers, images and fonts are allowed. Release builds disable source maps, enable Rust LTO/strip/abort-on-panic, and are rejected if a primary artifact exceeds 100 MiB or contains Electron, Chromium, Node modules or OnlyOffice.

GitHub Actions builds seven architecture-specific artifacts. Pull Requests upload unsigned test bundles. Tag matrix jobs sign and smoke their native bundles, including file-association metadata, core document operations, Agent SSE, and a signed rejected-install fixture, then upload immutable parts. A single elevated finalize job checks the complete matrix and size limits, creates checksums and exact-tag updater metadata, SBOMs and provenance, then publishes a prerelease. Build jobs remain read-only and never retain checkout credentials.

The staging workflow runs that prerelease through exact-tag signature rejection, rejected-install preservation, upgrade, restart, renderer/native startup health confirmation, and independent version/hash checks on all seven targets. It then reinstalls the previous release, injects a post-update startup failure, and externally verifies that the previous payload was restored and relaunched. Only a separate promotion job, explicitly requested after the matrix succeeds, can switch the prerelease to the stable channel. `invalidInstallPreserved` remains distinct from the separately reported startup-health rollback.

After a signed payload has downloaded, the old application copies the complete installed payload (Windows install directory, macOS app bundle, or Linux AppImage) and an executable guardian under versioned `v2/updater-health/` storage. The transaction state is atomically replaced; Windows also captures and permission-checks its uninstall registry version. The guardian survives platform replacement, watches the new process, and restores the backup and platform metadata if the renderer does not complete an IPC health confirmation within five minutes or exits first. Rollback is intentionally fail-closed for non-writable installations, backups above 512 MiB, or unsupported filesystem entries.

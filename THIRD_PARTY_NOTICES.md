# Third-Party Notices

Office Agentic includes third-party software. The authoritative dependency inventory for each release is the two CycloneDX SBOM files (`sbom-npm.cdx.json` for the JavaScript/TypeScript stack and `sbom-rust.cdx.json` for the Rust crates), generated from the lockfiles (`package-lock.json`, `Cargo.lock`) and published alongside every release, together with the lockfiles in that release's source archive.

The tables below list the **material** components — the editor/runtime engines and the platform bridges — with their SPDX license identifiers. They are a human-readable index, not the full inventory; the SBOMs remain authoritative, and the auditable deviations from upstream sources are tracked in `patches/` (applied by `patch-package`).

## Material JavaScript / TypeScript components

| Component | License |
| --- | --- |
| SuperDoc and `@superdoc-dev/react` (patched, see `patches/`) | AGPL-3.0-only |
| MuPDF (`mupdf`) | AGPL-3.0-only OR commercial (Artifex dual license) |
| PDF.js (`pdfjs-dist`) | Apache-2.0 |
| `@aiden0z/pptx-renderer` (patched, see `patches/`) | Apache-2.0 |
| Fortune Sheet (`@fortune-sheet/core`, `@fortune-sheet/react`) | MIT |
| ExcelJS | MIT |
| React, React DOM | MIT |
| Monaco Editor | MIT |
| xterm.js (`@xterm/xterm`, `@xterm/addon-fit`) | MIT |
| Radix UI primitives | MIT |
| lucide-react | ISC |
| Mammoth | BSD-2-Clause |
| JSZip | MIT OR GPL-3.0-or-later |
| marked | MIT |
| turndown | MIT |
| DOMPurify | Apache-2.0 OR MPL-2.0 |
| zustand | MIT |

### Note on MuPDF

The npm `mupdf` package is distributed by Artifex under the GNU AGPL v3.0 with a commercial licensing alternative. Office Agentic is itself licensed AGPL-3.0-only and uses MuPDF under that option. Redistribution of Office Agentic and any use outside the AGPL terms must satisfy the AGPL; entities that cannot comply with the AGPL must obtain a commercial MuPDF license from Artifex.

## Material Rust crates

| Crate | License |
| --- | --- |
| Tauri and official Tauri plugins (dialog, log, updater, single-instance) | Apache-2.0 OR MIT |
| keyring | Apache-2.0 OR MIT |
| portable-pty | MIT |
| trash | MIT |
| pdf-extract | MIT |
| ttf-parser | Apache-2.0 OR MIT |
| fontdb | MIT OR Apache-2.0 |
| arboard | Apache-2.0 OR MIT |
| quick-xml | MIT |
| reqwest (rustls TLS) | Apache-2.0 OR MIT |
| tungstenite | Apache-2.0 OR MIT |
| serde / serde_json | Apache-2.0 OR MIT |
| sha1 / sha2 / hmac | Apache-2.0 OR MIT |
| encoding_rs | Apache-2.0 OR MIT |

Copyright remains with the respective authors. Their license texts are distributed according to each package's requirements. This notice does not replace those licenses.

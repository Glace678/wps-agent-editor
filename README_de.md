# WPS Agent Editor

[简体中文](./README.md#zh-cn) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | **Deutsch** | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

**WPS Agent Editor 2** ist ein plattformübergreifender Dokumenteneditor der nächsten Generation und eine Multi-Agenten-KI-Workbench auf Basis von **Tauri v2**, **React** und **Rust**. Durch die Nutzung der systemeigenen WebView verzichtet die Anwendung vollständig auf ressourcenintensive Laufzeitumgebungen wie Electron, Chromium, Node.js oder OnlyOffice Document Server.

---

## Multi-KI-Dialog & Multi-Agenten-Kollaboration

WPS Agent Editor verfügt über eine leistungsfähige Multi-Modell-Orchestrierungs-Engine, um verschiedene KI-Modelle zu einem schlagkräftigen Team für Dokumentenverarbeitung zusammenzuführen:

- **Breites Provider-Ökosystem**: Native Unterstützung für OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (lokale Offline-Modelle), Volcengine (Doubao) sowie jede OpenAI-kompatible Schnittstelle.
- **Zwei Kollaborationsmodi**:
  - **Direktoren-Modus (Directed Mode)**: Ein führender Agent zerlegt komplexe Aufgaben, delegiert Teilaufgaben (`delegate_task`) an spezialisierte Expertenmodelle (Datenanalyst, technischer Redakteur, Code-Reviewer), konsolidiert Teilergebnisse und verfasst das Endergebnis.
  - **Paralleler Modus (Parallel Mode)**: Mehrere Modelle bearbeiten, analysieren oder überprüfen gleichzeitig unterschiedliche Abschnitte desselben Dokuments mit Live-Streaming und nahtloser Übergabe (Handoff).
- **Visuelle Kollaborations-Zeitleiste**: Lückenlose Verfolgung von Aufgabenzuweisungen, Dialogen zwischen Modellen, Denkprozessen (Reasoning), Tool-Ausführungen und Übergaben.
- **Intelligentes Kontextmanagement & Codex-Migration**: Lange Verläufe werden bei Bedarf automatisch in portable Kontextfenster komprimiert. Idempotente Synchronisation vorhandener JSONL-Sitzungen aus `CODEX_HOME` (`~/.codex`).

---

## Kollaborative Dokumentenverarbeitung

Die Verbindung von dialogorientierter KI mit nativer Dokumentenmanipulation:

- **Atomare Dokumentenoperationen**: Agenten generieren nicht nur Text, sondern übermitteln präzise strukturelle Befehle (`Einfügen`, `Formatieren`, `Ersetzen`, `Kommentieren`) direkt an die Dokumenten-Engines.
- **Cursor- & Auswahlverfolgung**: Echtzeiterfassung von Cursorpositionen, Textauswahlen und Bearbeitungsbereichen von Benutzern und Agenten.
- **Revisionskontrolle & Konfliktlösung**: Automatische Konflikterkennung bei gleichzeitiger Bearbeitung, transaktionale Zustandssicherung und One-Click-Rückgängigmachen (Undo).
- **Menschliche Freigabe (Human-in-the-Loop)**: Konfigurierbare Genehmigungsworkflows (`approval-required`) vor dem Ausführen kritischer Dokumentänderungen.

---

## Unterstützte Dateiformate

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

---

## Entwicklung

### Voraussetzungen
- Node.js 22+
- Rust stable und entsprechende Kompilierungsziele
- [Tauri v2 Voraussetzungen](https://v2.tauri.app/start/prerequisites/)

### Schnellstart
```bash
# Abhängigkeiten installieren
npm ci

# Desktop-Anwendung im Dev-Modus starten
npm run dev

# Nur Web-Oberfläche ausführen
npm run dev:web
```

### Verifikation & Tests
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

---

## Release-Ziele & Sicherheit

Release-Builds erzeugen schlanke, native Installationspakete:
- **Windows 10+**: x86_64 & ARM64 NSIS-Installationsprogramme
- **macOS**: Intel & Apple Silicon DMG
- **Linux**: x86_64 & ARM64 AppImage

Strikte CI-Grenze von 100 MiB pro Paket. Umfangreiche Integritätsprüfungen und Rollback-Sicherungen. API-Schlüssel werden geschützt im Anmeldeinformationsspeicher des Betriebssystems aufbewahrt.

---

## Lizenz

Veröffentlicht unter der **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). Siehe [LICENSE](./LICENSE) und [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

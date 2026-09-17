# WPS Agent Editor

[简体中文](./README.md) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | **Deutsch** | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

WPS Agent Editor 2 ist ein plattformübergreifender Dokumenteneditor und eine Multi-Agenten-Workbench auf Basis von Tauri v2, React und Rust. Die Desktop-Anwendung verwendet die native WebView des Systems und verzichtet vollständig auf gebündeltes Electron, Chromium, Node.js oder OnlyOffice Document Server.

## Integrierte Funktionen

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; gängige PPTX-Bearbeitungen werden von einem Rust-OOXML-Backend ausgeführt
- **Text & Markdown**: Integrierter Editor
- **Code**: Monaco; Ausführung und Debugging nutzen lokal installierte Sprach-Toolchains
- **Agent**: OpenAI, Anthropic, Google, Ollama und OpenAI-kompatible Provider

Die Konvertierung älterer Formate (`.doc`, `.ppt`) und komplexer Mediendateien erfordert ein systemweit installiertes WPS, Microsoft Office oder LibreOffice. Die Ausführung von JavaScript/TypeScript setzt systemweites Node.js voraus; andere Programmiersprachen nutzen ebenfalls die systemeigenen Toolchains. Fehlende Abhängigkeiten geben einen eindeutigen `dependency-missing`-Fehler aus, anstatt zur Laufzeit unbemerkt umfangreiche Pakete nachzuladen.

## Entwicklung

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

## Release-Ziele

Release-Builds erstellen folgende Desktop-Artefakte:

- **Windows 10+**: x86_64 und ARM64 NSIS-Installationsprogramme
- **macOS**: Intel und Apple Silicon DMG
- **Linux**: x86_64 und ARM64 AppImage

Für jedes primäre Download-Paket gilt ein striktes CI-Limit von 100 MiB. Tags müssen exakt mit den Versionen in `package.json`, Cargo und `tauri.conf.json` übereinstimmen. Stabile Releases erfordern zusätzlich Windows Authenticode, macOS Developer ID / Notarisierung und Tauri updater Ed25519-Signaturschlüssel.

Pull Requests erstellen zeitlich begrenzt aufbewahrte, unsignierte Testpakete für sechs native Plattformen. `v*-rc.*`-Tags erstellen öffentliche, unsignierte Release-Kandidaten (RC) mit Prüfsummen, SBOM, AGPL-konformem Quelltextarchiv und GitHub-Build-Attestierungen, generieren jedoch keine Updater-Metadaten und gelangen nicht in automatische Update-Kanäle. Offizielle Produktions-Tags müssen vor Erreichen des zentralen Finalize-Jobs Signatur-, Dateizuordnungs-, Kerndokument-, Agent-Streaming-, Installations-, Start-, Inhaltsprüfungs- und Deinstallations-Smoketests bestehen. Der Finalize-Schritt erzeugt einheitlich Updater-Metadaten, Fixtures zur Ablehnung fehlerhafter Installationen, Prüfsummen, SBOM, Quelltextarchive und Build-Attestierungen und veröffentlicht diese zunächst als Prerelease.

`Signed staging release smoke` prüft unter Verwendung exakter Tags auf sechs Plattformen die Zurückweisung manipulierter Signaturen, die Wiederherstellung beschädigter Installationen, echte Upgrades, Neustarts, Start-Zustandsprüfungen, Rollbacks bei Fehlern und Übereinstimmungen externer Versionen/Hashes. Jedes Ziel installiert zudem die Vorversion neu, injiziert einen künstlichen Startfehler nach dem Update und verifiziert prozessunabhängig die Wiederherstellung und den Neustart der vorherigen Version. Workflows dienen standardmäßig nur der Abnahme; nur bei ausdrücklicher Auswahl von `promote` und bestandener Gesamtmatrix befördert ein isolierter Job mit Mindestberechtigungen das Prerelease zu einem stabilen Release. Ab `v2.0.0` muss ein zuvor veröffentlichter Tag bereitgestellt werden; Upgrade-Prüfungen können nicht übersprungen werden. Detaillierte Abläufe zu RCs, Signaturanmeldedaten und stabilen Releases finden Sie in [RELEASING.md](./RELEASING.md).

## v2-Datenstrategie

v2 speichert Konfigurationen in einem neuen `v2/`-Anwendungsdatenverzeichnis. Alte Electron-Konfigurationen und Benutzerdokumente werden weder gelesen noch migriert oder gelöscht. API-Schlüssel müssen neu eingegeben werden und werden ausschließlich im Tresor für Anmeldedaten des Systems gespeichert. Vor Updates wird unter `v2/updater-health/` ein geschütztes Backup und ein atomarer Transaktionsstatus angelegt. Eine neue Version wird erst dann als funktionstüchtig eingestuft, wenn React gemountet ist und ein nativer IPC-Roundtrip erfolgreich abgeschlossen wurde; andernfalls stellt ein unabhängiger Guardian-Prozess das vorherige Installationspaket wieder her.

## Codex-Konversationsmigration

Beim ersten Start des Agent-Panels durchsucht die Anwendung aktive und archivierte JSONL-Sitzungen im Verzeichnis `CODEX_HOME` des aktuellen Benutzers (Standard: `~/.codex`) und synchronisiert diese idempotent nach `v2/conversations/`. Über den Download-Button im Verlaufs-Panel kann der Scan jederzeit wiederholt werden; synchronisierte Dateien werden nicht erneut importiert, und neu hinzugefügte oder geänderte Konversationen werden inkrementell aktualisiert.

Der Import behält ausschließlich fortsetzbare Benutzer-, Assistenten- und Systemnachrichten bei, zusammen mit Konversationstitel, Projektpfad, ursprünglichem Provider/Modell und Archivierungsstatus. Entwickleranweisungen, interne Denkprozesse (Reasoning), Ausgaben von Tool-Aufrufen, Codex-Anmeldedatendateien und rohe Anhangsdaten werden weder ausgelesen noch in den Gesprächskontext eingefügt. Manuell in den Text eingefügte sensible Informationen bleiben unverändert erhalten; bitte prüfen Sie diese vor einer Weitergabe. Nach Auswahl einer Konversation kann direkt zu einem konfigurierten Provider (OpenAI, Anthropic, Google, Ollama oder OpenAI-kompatibel) gewechselt werden. Überlange Verläufe werden beim Senden automatisch in portable Kontextfenster komprimiert, während die lokalen Originalaufzeichnungen vollständig erhalten bleiben.

Shell-/Prozess-Sitzungen, Freigabestatus und laufende Tools von Codex werden nicht migriert; externe Modelle setzen die Ausführung auf Grundlage der importierten sichtbaren Nachrichten und der in der aktuellen Anwendung verfügbaren Werkzeuge fort.

## Lizenz

Dieses Projekt wird ausschließlich unter der GNU Affero General Public License v3.0 (AGPL-3.0-only) lizenziert. Siehe [LICENSE](./LICENSE) und [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Bei der Weitergabe von Binärdateien muss gleichzeitig der vollständige, dieser Version entsprechende Quellcode bereitgestellt werden.

# WPS Agent Editor

[简体中文](./README.md#zh-cn) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | **Français** | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

**WPS Agent Editor 2** est un éditeur documentaire nouvelle génération et un environnement de travail d'IA multi-agents multiplateforme bâti sur **Tauri v2**, **React** et **Rust**. S'appuyant sur la WebView native du système d'exploitation, il se dispense entièrement des environnements lourds comme Electron, Chromium, Node.js ou OnlyOffice Document Server.

---

## Dialogue Multi-IA & Orchestration Multi-Agents

WPS Agent Editor embarque un moteur de collaboration multi-modèles conçu pour faire coopérer divers modèles d'IA en une véritable équipe d'ingénierie documentaire :

- **Écosystème Étendu de Fournisseurs** : Intégration native avec OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (modèles locaux hors ligne), Volcengine (Doubao) et toute API compatible OpenAI.
- **Deux Modes de Collaboration** :
  - **Mode Dirigé (Orchestration par Directeur)** : Un agent chef d'orchestre planifie les opérations complexes, délègue les sous-tâches (`delegate_task`) aux modèles experts les plus qualifiés (analyste de données, rédacteur, relecteur de code) et consolide le résultat final.
  - **Mode Parallèle** : Plusieurs modèles travaillent de concert sur différentes sections du document en streaming continu avec passage de relais (Handoff) instantané.
- **Chronologie Visuelle des Événements** : Traçabilité complète des attributions de tâches, dialogues entre modèles, chaînes de raisonnement (Reasoning), appels d'outils et transferts d'état.
- **Gestion Intelligente du Contexte & Migration Codex** : Compression dynamique des longs historiques dans des fenêtres contextuelles adaptées. Importation transparente et idempotente des sessions JSONL depuis `CODEX_HOME` (`~/.codex`).

---

## Traitement Collaboratif de Documents

L'IA générative interagit directement avec le cœur d'édition des documents :

- **Opérations Documentaires Atomiques** : Les agents ne se contentent pas de rédiger du texte ; ils émettent des instructions structurelles précises (`insertion`, `mise en page`, `remplacement`, `annotations`) directement aux moteurs de documents.
- **Sensibilité au Curseur & aux Sélections** : Localisation en temps réel des curseurs, des sélections de texte et des zones d'édition des agents et de l'utilisateur.
- **Gestion des Révisions & Résolution des Conflits** : Détection active des modifications simultanées concurrentes, intégrité transactionnelle et annulation (Undo) en un clic.
- **Validation Humaine (Human-in-the-Loop)** : Possibilité d'assujettir les modifications sensibles à une validation explicite de l'utilisateur (`approval-required`).

---

## Formats de Fichiers Pris en Charge

| Catégorie | Extensions | Moteur & Fonctionnalités |
| :--- | :--- | :--- |
| **Documents Word** | `.docx`, `.doc`, `.odt` | Moteur riche **SuperDoc**. Rendu fidèle des styles, tableaux et images. Conversion automatique des anciens formats. |
| **Feuilles de Calcul** | `.xlsx`, `.xls`, `.csv`, `.ods` | Propulsé par **Fortune Sheet**. Calcul haute performance, formules étendues, multi-onglets et mise en forme. |
| **Présentations PPT** | `.pptx`, `.ppt`, `.odp` | Rendu visuel par **pptx-renderer** et modifications des diapositives via un backend rapide en **Rust OOXML**. |
| **Documents PDF** | `.pdf` | Double moteur **PDF.js** et **MuPDF**. Affichage instantané et annotations persistantes éditables (surlignage, stylo, texte). |
| **Texte & Markdown** | `.md`, `.markdown`, `.txt`, `.log` | Éditeur léger intégré avec prévisualisation temps réel et ouverture ultra-rapide. |
| **Code Source** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat`, etc. | Environnement professionnel **Monaco Editor**. Coloration syntaxique, autocomplétion et exécution/débogage via les compilateurs locaux. |
| **Aperçu d'Images** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | Visionneuse d'images native performante. |

*Remarque : La conversion des formats historiques `.doc` et `.ppt` s'effectue via les suites bureautiques locales (WPS, Office ou LibreOffice). L'exécution du code sollicite les chaînes d'outils locales. Tout manque entraîne une erreur claire `dependency-missing` sans téléchargement silencieux.*

---

## Développement

### Prérequis
- Node.js 22+
- Rust stable et cibles de compilation
- [Prérequis Tauri v2](https://v2.tauri.app/start/prerequisites/)

### Démarrage Rapide
```bash
# Installation des dépendances
npm ci

# Lancement de l'application de bureau
npm run dev

# Exécution de l'interface navigateur uniquement
npm run dev:web
```

### Vérification & Tests
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

---

## Déploiement & Sécurité

Les versions distribuables génèrent des binaires natifs légers :
- **Windows 10+** : Installateurs NSIS pour x86_64 et ARM64
- **macOS** : DMG pour Intel et Apple Silicon
- **Linux** : AppImage pour x86_64 et ARM64

Plafond CI strict de 100 Mio par paquet principal. Tests approfondis de protection des signatures et de récupération. Les clés d'API sont stockées de façon étanche dans le trousseau de clés sécurisé du système d'exploitation.

---

## Licence

Distribué sous licence **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). Voir [LICENSE](./LICENSE) et [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

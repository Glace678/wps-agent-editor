# WPS Agent Editor

[简体中文](./README.md) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | **Français** | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

WPS Agent Editor 2 est un éditeur de documents multiplateforme et un environnement de travail multi-agents reposant sur Tauri v2, React et Rust. L'application de bureau utilise la WebView native du système, éliminant totalement l'intégration d'Electron, Chromium, Node.js ou OnlyOffice Document Server.

## Fonctionnalités intégrées

- **Word** : SuperDoc
- **Excel** : Fortune Sheet
- **PDF** : PDF.js
- **PowerPoint** : pptx-renderer ; l'édition courante des fichiers PPTX est assurée par un backend OOXML en Rust
- **Texte & Markdown** : Éditeur intégré
- **Code** : Monaco ; l'exécution et le débogage exploitent les chaînes d'outils logicielles installées sur la machine
- **Agent** : Fournisseurs OpenAI, Anthropic, Google, Ollama et compatibles OpenAI

La conversion des formats hérités (`.doc`, `.ppt`) et des médias complexes nécessite l'installation locale de WPS, Microsoft Office ou LibreOffice. L'exécution JavaScript/TypeScript nécessite Node.js sur le système hôte ; les autres langages s'appuient de la même manière sur leurs chaînes d'outils locales. Toute dépendance manquante déclenche une erreur explicite `dependency-missing` sans télécharger silencieusement de composants volumineux à l'exécution.

## Développement

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

## Cibles de publication

Les builds de production génèrent les exécutables de bureau suivants :

- **Windows 10+** : Installateurs NSIS pour x86_64 et ARM64
- **macOS** : DMG pour Intel et Apple Silicon
- **Linux** : AppImage pour x86_64 et ARM64

Chaque paquet de téléchargement principal est soumis à une limite CI stricte de 100 Mio. Les tags Git doivent correspondre exactement aux versions définies dans `package.json`, Cargo et `tauri.conf.json`. Les versions stables nécessitent en outre les signatures Windows Authenticode, Apple Developer ID avec notarisation, ainsi que les clés de signature Ed25519 du programme de mise à jour Tauri.

Les Pull Requests génèrent des paquets de test non signés à rétention courte sur les six cibles natives. Les tags `v*-rc.*` construisent des versions candidates (RC) publiques non signées accompagnées des sommes de contrôle, du SBOM, des archives du code source conformes AGPL et des attestations de build GitHub, sans produire de métadonnées de mise à jour ni intégrer les canaux de mise à jour automatique. Les builds de tags officiels doivent valider les tests de signature, d'associations de fichiers, de documents de base, de streaming Agent, d'installation, de démarrage, de contrôle de contenu et de désinstallation avant de passer à la tâche unique de finalisation (`finalize`). Cette dernière génère de manière consolidée les métadonnées de mise à jour, les jeux d'épreuves de rejet d'installation, les sommes de contrôle, le SBOM, les archives de code source et les attestations de build, publiant l'ensemble sous forme de préversion.

La suite `Signed staging release smoke` valide avec des tags stricts sur les six plateformes le rejet de falsification de signature, la récupération d'installations corrompues, les mises à niveau réelles, les redémarrages, les bilans de santé au lancement, le retour arrière (rollback) en cas d'échec et la conformité des versions/hachages externes. Chaque cible réinstalle également la version précédente, injecte un échec simulé au lancement après mise à jour et s'assure hors-processus que la charge utile antérieure est restaurée et relancée avec succès. Par défaut, le flux de travail n'effectue que des vérifications ; lorsqu'une promotion explicite est demandée et que l'intégralité de la matrice réussit, un travail isolé avec privilèges minimaux élève la préversion au statut de version stable. À partir de `v2.0.0`, un tag précédemment publié doit impérativement être fourni et la vérification de mise à niveau ne peut être ignorée. Consultez [RELEASING.md](./RELEASING.md) pour les détails complets sur les RC, les identifiants de signature et la procédure de version stable.

## Stratégie de données v2

v2 enregistre les configurations dans un nouveau répertoire de données d'application `v2/`. Les configurations Electron héritées et les documents utilisateurs ne sont ni consultés, ni migrés, ni supprimés. Les clés d'API doivent être saisies à nouveau et sont conservées exclusivement dans le trousseau de clés d'identification du système hôte. Avant toute mise à jour, une sauvegarde restreinte et un état de transaction atomique sont enregistrés sous `v2/updater-health/` ; les nouvelles versions ne sont déclarées saines qu'après le montage effectif de React et la validation d'un échange IPC natif complet, sans quoi un processus gardien indépendant restaure la version précédente.

## Migration des conversations Codex

Lors du premier lancement du panneau Agent, l'application analyse les sessions JSONL actives et archivées présentes dans le dossier `CODEX_HOME` de l'utilisateur (par défaut `~/.codex` si non défini) et les synchronise de manière idempotente dans `v2/conversations/`. Le bouton d'actualisation du panneau d'historique permet de relancer l'analyse à tout moment. Les fichiers déjà synchronisés ne sont pas réimportés et les conversations nouvelles ou modifiées font l'objet d'une mise à jour incrémentielle.

L'importation conserve uniquement les messages de l'utilisateur, de l'assistant et du système permettant de reprendre la conversation, tout en préservant le titre, le chemin du projet, le fournisseur/modèle d'origine et le statut d'archivage. Les instructions développeur, le raisonnement interne (Reasoning), les sorties d'appels d'outils, les fichiers de clés d'identification Codex et les données brutes de pièces jointes ne sont ni lus ni injectés dans le contexte de dialogue. Les informations sensibles collées directement dans le corps des messages restent enregistrées telles quelles : veillez à les contrôler avant tout partage. Après avoir sélectionné une conversation dans l'historique, vous pouvez basculer immédiatement vers un fournisseur configuré (OpenAI, Anthropic, Google, Ollama ou compatible OpenAI) pour poursuivre le travail. Les historiques trop longs sont automatiquement compressés dans une fenêtre contextuelle portable lors de l'envoi, tandis que l'enregistrement d'origine reste intégralement conservé sur la machine locale.

Les sessions de terminal/processus de Codex, les statuts d'approbation et les outils en cours d'exécution ne sont pas transférés ; les modèles externes poursuivent leur exécution à partir des messages visibles importés et des outils actuellement disponibles dans l'application.

## Licence

Ce projet est distribué sous la seule licence GNU Affero General Public License v3.0 (AGPL-3.0-only). Voir [LICENSE](./LICENSE) et [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). La distribution de binaires impose la mise à disposition simultanée de l'intégralité du code source correspondant à cette version.

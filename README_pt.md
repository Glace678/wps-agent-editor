# WPS Agent Editor

[简体中文](./README.md#zh-cn) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | **Português** | [العربية](./README_ar.md)

---

O **WPS Agent Editor 2** é um editor de documentos multiplataforma de última geração e ambiente de trabalho para múltiplos agentes de IA desenvolvido com **Tauri v2**, **React** e **Rust**. Ao utilizar o WebView nativo do sistema, elimina completamente empacotamentos pesados como Electron, Chromium, Node.js ou OnlyOffice Document Server.

---

## Diálogo Multi-IA e Colaboração Multi-Agente

O WPS Agent Editor traz um robusto motor de orquestração multi-modelo projetado para coordenar diferentes IAs como uma equipe de produção documental integrada:

- **Amplo Ecossistema de Provedores**: Integração nativa com OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (modelos locais offline), Volcengine (Doubao) e qualquer API compatível com o padrão OpenAI.
- **Dois Modos de Colaboração**:
  - **Modo Dirigido (Orquestração por Diretor)**: Um agente diretor planeja fluxos de trabalho complexos, delega subtarefas (`delegate_task`) a modelos especialistas (analista de dados, redator técnico, revisor de código), consolida as entregas e formula a resposta final.
  - **Modo Paralelo**: Múltiplos modelos analisam, escrevem ou validam diferentes partes do documento simultaneamente, com streaming ao vivo e transferência contínua de tarefas (Handoff).
- **Linha do Tempo Visual de Colaboração**: Rastreamento em tempo real de atribuições de tarefas, conversas entre modelos, raciocínio interno (Reasoning), chamadas de ferramentas e transições de estado.
- **Contexto Inteligente e Migração do Codex**: Compressão automática de históricos extensos em janelas de contexto portáteis. Sincronização idempotente e rápida de sessões JSONL a partir de `CODEX_HOME` (`~/.codex`).

---

## Processamento Colaborativo de Documentos

Integração direta entre IA generativa e a manipulação nativa de documentos:

- **Operações Atômicas em Documentos**: Os agentes não geram apenas texto puro; eles emitem instruções estruturais atômicas (`inserir`, `formatar`, `substituir`, `anotar`) diretamente para os motores dos documentos.
- **Detecção de Cursor e Seleção**: Acompanhamento em tempo real de posições de cursor, textos destacados e áreas de edição tanto dos agentes quanto do usuário.
- **Controle de Revisões e Resolução de Conflitos**: Deteção automática de conflitos em edições concorrentes, persistência atômica de transações e suporte a desfazer (Undo) com um clique.
- **Aprovação Humana (Human-in-the-Loop)**: Configuração de ações críticas que exigem confirmação explícita do usuário (`approval-required`) antes da aplicação no documento.

---

## Formatos de Arquivo Suportados

| Categoria | Extensões | Motor e Recursos |
| :--- | :--- | :--- |
| **Documentos Word** | `.docx`, `.doc`, `.odt` | Desenvolvido com **SuperDoc**. Suporte completo a estilos, tabelas, imagens e layout. Conversão automática de formatos antigos. |
| **Planilhas Eletrônicas** | `.xlsx`, `.xls`, `.csv`, `.ods` | Alimentado por **Fortune Sheet**. Fórmulas abrangentes, múltiplas planilhas, estilos de célula e cálculo veloz. |
| **Apresentações** | `.pptx`, `.ppt`, `.odp` | Visualização por **pptx-renderer** e edição de slides via backend rápido em **Rust OOXML**. |
| **Documentos PDF** | `.pdf` | Motor duplo com **PDF.js** e **MuPDF**. Visualização rápida e anotações editáveis permanentes (destaque, caneta, caixas de texto). |
| **Texto e Markdown** | `.md`, `.markdown`, `.txt`, `.log` | Editor leve integrado com pré-visualização em tempo real e abertura instantânea. |
| **Código-Fonte** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat`, etc. | Ambiente profissional **Monaco Editor**. Destaque sintático, autocompletar inteligente e execução/depuração via toolchains locais. |
| **Visualização de Imagens** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | Visualizador nativo rápido. |

*Nota: A conversão de formatos legados `.doc` e `.ppt` utiliza WPS, Microsoft Office ou LibreOffice instalados no computador. A execução de código depende das ferramentas locais instaladas (Node.js, Python, Cargo). Dependências ausentes retornam erro amigável `dependency-missing` sem downloads indesejados.*

---

## Desenvolvimento

### Pré-requisitos
- Node.js 22+
- Rust stable e alvos de compilação
- [Pré-requisitos do Tauri v2](https://v2.tauri.app/start/prerequisites/)

### Início Rápido
```bash
# Instalação de dependências
npm ci

# Iniciar aplicativo desktop em modo de desenvolvimento
npm run dev

# Executar apenas interface no navegador
npm run dev:web
```

### Validação e Testes
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

---

## Alvos de Lançamento e Segurança

Compilações de lançamento geram binários nativos e leves:
- **Windows 10+**: Instaladores NSIS para x86_64 e ARM64
- **macOS**: DMG para Intel e Apple Silicon
- **Linux**: AppImage para x86_64 e ARM64

Limite rigoroso de CI de 100 MiB por instalador principal. Testes automáticos de integridade de assinatura e recuperação de falhas. As chaves de API são armazenadas exclusivamente no cofre de credenciais do sistema operacional.

---

## Licença

Distribuído sob a licença **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). Consulte [LICENSE](./LICENSE) e [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

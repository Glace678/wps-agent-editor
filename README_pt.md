# WPS Agent Editor

[简体中文](./README.md) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | [Español](./README_es.md) | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | **Português** | [العربية](./README_ar.md)

---

O WPS Agent Editor 2 é um editor de documentos multiplataforma e ambiente de trabalho multi-agente desenvolvido com base em Tauri v2, React e Rust. O aplicativo para desktop utiliza o WebView nativo do sistema, eliminando por completo o empacotamento de Electron, Chromium, Node.js ou OnlyOffice Document Server.

## Recursos Integrados

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; edições comuns de PPTX são processadas por um backend OOXML em Rust
- **Texto e Markdown**: Editor integrado
- **Código**: Monaco; execução e depuração utilizam as toolchains de linguagens instaladas localmente no sistema
- **Agent**: Provedores OpenAI, Anthropic, Google, Ollama e compatíveis com a API OpenAI

A conversão de formatos legados (`.doc`, `.ppt`) e mídias complexas requer o WPS, Microsoft Office ou LibreOffice instalado no sistema operacional. A execução de scripts JavaScript/TypeScript exige o Node.js do sistema; outras linguagens de programação utilizam igualmente suas cadeias de ferramentas locais. A ausência de dependências retorna um erro identificável `dependency-missing`, evitando o download silencioso de pacotes pesados durante o tempo de execução.

## Desenvolvimento

Requisitos:

- Node.js 22+
- Rust stable e os alvos de compilação correspondentes
- [Pré-requisitos da plataforma Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Executar apenas a interface no navegador:

```bash
npm run dev:web
```

Validação e testes:

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

## Destinos de Lançamento

As compilações de lançamento geram os seguintes artefatos para desktop:

- **Windows 10+**: Instaladores NSIS para x86_64 e ARM64
- **macOS**: DMG para arquiteturas Intel e Apple Silicon
- **Linux**: AppImage para x86_64 e ARM64

O limite de CI para cada pacote de download principal é de 100 MiB. As tags do Git devem corresponder rigorosamente às versões contidas no `package.json`, Cargo e `tauri.conf.json`. Versões estáveis exigem adicionalmente Windows Authenticode, Apple Developer ID / notarização e chaves de assinatura Ed25519 do atualizador do Tauri.

Pull Requests geram pacotes de teste não assinados com retenção temporária em seis plataformas nativas. Tags `v*-rc.*` compilam candidatos a lançamento (RC) públicos e não assinados, com somas de verificação (checksums), SBOM, arquivos de código-fonte em conformidade com AGPL e atestados de compilação do GitHub, mas sem gerar metadados de atualização nem ingressar nos canais automáticos. Compilações de tags de produção exigem aprovação em testes de fumaça (smoke tests) de assinatura, associação de arquivos, documentos principais, respostas de streaming do agente, instalação, inicialização, validação de conteúdo e desinstalação antes de seguir para a etapa de finalização unificada. O job finalize gera centralizadamente os metadados de atualização, cenários de rejeição de instalação incorreta, checksums, SBOM, arquivos de código-fonte e certificados de build, publicando inicialmente como pré-lançamento (prerelease).

O teste `Signed staging release smoke` valida com tags exatas nas seis plataformas a rejeição de assinaturas violadas, a recuperação de instalações corrompidas, atualizações em ambiente real, reinicializações, verificações de integridade ao iniciar, reversão em caso de falha e conformidade de versão/hash externo. Cada plataforma reinstala a versão anterior, injeta uma falha simulada na inicialização pós-atualização e confirma, fora do processo principal, a restauração e reinicialização seguras do pacote anterior. Por padrão, o fluxo de trabalho realiza apenas verificação; quando `promote` for explicitamente selecionado e toda a matriz for aprovada, um trabalho isolado de privilégio mínimo promove o pré-lançamento a estável. A partir da versão `v2.0.0`, é obrigatório fornecer uma tag lançada anteriormente, sendo impossível ignorar a verificação de atualização. Consulte os procedimentos detalhados de RC, credenciais de assinatura e lançamentos estáveis no [RELEASING.md](./RELEASING.md).

## Estratégia de Dados da v2

A v2 armazena suas configurações em um novo diretório de dados do aplicativo chamado `v2/`. Configurações anteriores do Electron e documentos de usuários não são lidos, migrados ou excluídos. Chaves de API precisam ser inseridas novamente e são armazenadas exclusivamente no cofre seguro de credenciais do sistema operacional. Antes de atualizações, um backup restrito e um estado transacional atômico são gravados em `v2/updater-health/`. Uma nova versão só é declarada íntegra após a montagem do React e a conclusão de uma comunicação IPC nativa de ida e volta; caso contrário, um processo guardião independente restaura a instalação anterior.

## Migração de Conversas do Codex

Ao iniciar o painel do Agent pela primeira vez, o aplicativo verifica as sessões ativas e arquivadas em JSONL na pasta `CODEX_HOME` do usuário atual (padrão `~/.codex` quando não definida) e as sincroniza de forma idempotente em `v2/conversations/`. O botão de sincronização no painel de histórico permite repetir o escaneamento a qualquer momento; arquivos já sincronizados não são duplicados, e conversas novas ou modificadas são atualizadas incrementalmente.

A importação preserva apenas mensagens retomáveis de usuário, assistente e sistema, juntamente com títulos de conversas, caminhos de projetos, provedor/modelo de origem e status de arquivamento. Instruções para desenvolvedores, raciocínios internos (Reasoning), saídas de chamadas de ferramentas, arquivos de credenciais do Codex e anexos brutos não são lidos nem injetados no contexto da conversa. Informações confidenciais coladas manualmente no corpo das mensagens serão salvas exatamente como enviadas; revise o conteúdo antes de compartilhá-lo. Ao selecionar qualquer conversa no histórico, é possível alternar instantaneamente para provedores configurados (OpenAI, Anthropic, Google, Ollama ou compatíveis) para dar continuidade ao trabalho. Históricos muito extensos são compactados automaticamente em janelas de contexto portáteis no envio, mantendo os registros originais intactos localmente.

Sessões de terminal/processos, estados de aprovação e ferramentas ativas em execução no Codex não são migrados; os modelos externos continuarão executando tarefas com base nas mensagens visíveis importadas e nas ferramentas disponíveis na aplicação atual.

## Licença

Este projeto é distribuído exclusivamente sob a licença GNU Affero General Public License v3.0 (AGPL-3.0-only). Veja [LICENSE](./LICENSE) e [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). A distribuição de binários exige a disponibilização concomitante do código-fonte completo correspondente à respectiva versão.

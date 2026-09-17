# WPS Agent Editor

[简体中文](./README.md) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | **Español** | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

WPS Agent Editor 2 es un editor de documentos multiplataforma y entorno de trabajo multi-agente basado en Tauri v2, React y Rust. La aplicación de escritorio utiliza el WebView nativo del sistema, eliminando por completo la inclusión de Electron, Chromium, Node.js o OnlyOffice Document Server.

## Capacidades integradas

- **Word**: SuperDoc
- **Excel**: Fortune Sheet
- **PDF**: PDF.js
- **PowerPoint**: pptx-renderer; la edición habitual de PPTX se realiza mediante un backend OOXML en Rust
- **Texto y Markdown**: Editor integrado
- **Código**: Monaco; la ejecución y depuración emplean las herramientas del sistema instaladas localmente
- **Agent**: OpenAI, Anthropic, Google, Ollama y proveedores compatibles con OpenAI

La conversión de formatos heredados (`.doc`, `.ppt`) y medios complejos requiere WPS, Microsoft Office o LibreOffice instalados en el sistema. La ejecución de JavaScript/TypeScript requiere Node.js del sistema; otros lenguajes utilizan de igual forma las herramientas locales del sistema. Las dependencias faltantes devuelven un error identificable `dependency-missing` en lugar de descargar silenciosamente componentes pesados durante la ejecución.

## Desarrollo

Requisitos:

- Node.js 22+
- Rust stable y los destinos de compilación correspondientes
- [Requisitos previos de la plataforma Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

Ejecutar únicamente la interfaz web en navegador:

```bash
npm run dev:web
```

Verificación y pruebas:

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

## Objetivos de publicación

Las compilaciones de lanzamiento (Release) generan los siguientes artefactos de escritorio:

- **Windows 10+**: Instaladores NSIS para x86_64 y ARM64
- **macOS**: DMG para Intel y Apple Silicon
- **Linux**: AppImage para x86_64 y ARM64

El límite de CI para cada paquete de descarga principal es de 100 MiB. Las etiquetas Git (tags) deben coincidir estrictamente con las versiones en `package.json`, Cargo y `tauri.conf.json`. Las versiones estables requieren además Windows Authenticode, macOS Developer ID / notarización y las claves de firma Ed25519 de Tauri updater.

Las Pull Requests generan paquetes de prueba sin firmar de retención corta en seis plataformas nativas. Las etiquetas `v*-rc.*` compilan candidatos a versión (RC) públicos sin firmar con sumas de comprobación (checksums), SBOM, archivo de código fuente conforme a AGPL y atestados de compilación de GitHub, sin generar metadatos de actualización ni entrar en canales automáticos. Las compilaciones de etiquetas oficiales deben superar pruebas de humo de firma, asociación de archivos, documentos básicos, respuestas en streaming del agente, instalación, arranque, inspección de contenido y desinstalación antes de pasar a la tarea única de finalización (finalize). La fase de finalización genera de forma unificada los metadatos de actualización, pruebas de rechazo de instalación, sumas de comprobación, SBOM, archivos de código fuente y atestados de compilación, publicándose inicialmente como versión preliminar (prerelease).

`Signed staging release smoke` valida con etiquetas exactas en las seis plataformas el rechazo de firmas alteradas, recuperación de instalaciones corruptas, actualizaciones reales, reinicios, comprobaciones de estado de arranque, reversión por fallo y coincidencia de versión/hash externos. En cada entorno se reinstala la versión previa, se inyecta un fallo simulado tras la actualización y se verifica de forma externa al proceso que la carga útil anterior se restablezca y reinicie. Los flujos de trabajo se limitan por defecto a la verificación; solo cuando se selecciona explícitamente `promote` y se superan todas las pruebas de la matriz, un trabajo aislado con privilegios mínimos promueve la versión preliminar a versión estable. A partir de `v2.0.0`, es obligatorio proporcionar una versión anterior publicada y no se puede omitir la verificación de actualización. Consulte los procedimientos completos de RC, credenciales de firma y versiones estables en [RELEASING.md](./RELEASING.md).

## Estrategia de datos de v2

v2 almacena la configuración en un nuevo directorio de datos de aplicación `v2/`. Las configuraciones anteriores de Electron y los documentos de usuario no se leen, no se migran ni se eliminan; las claves de API deben introducirse de nuevo y se almacenan exclusivamente en el almacén de credenciales del sistema. Antes de cualquier actualización, se crea una copia de seguridad restringida y un estado de transacción atómica en `v2/updater-health/`; las nuevas versiones solo se consideran correctas después de que React se haya montado y completado un ciclo de comunicación IPC nativo; de lo contrario, un proceso guardián independiente restaura la versión anterior instalada.

## Migración de conversaciones de Codex

Al iniciar el panel de agentes por primera vez, la aplicación explora las sesiones JSONL activas y archivadas en el `CODEX_HOME` del usuario actual (por defecto `~/.codex` si no está configurado) y las sincroniza de forma idempotente en `v2/conversations/`. El botón de descarga del panel de historial permite volver a escanear en cualquier momento; los archivos ya sincronizados no se duplican, y las conversaciones nuevas o modificadas se actualizan de forma incremental.

La importación conserva únicamente los mensajes reanudables de usuario, asistente y sistema, junto con los títulos, rutas de proyecto, proveedor/modelo original y estado de archivo. Las instrucciones de desarrollador, razonamientos internos, salidas de ejecución de herramientas, archivos de credenciales de Codex y datos adjuntos sin procesar no se leen ni se inyectan en el contexto de la conversación. La información confidencial pegada manualmente en los mensajes se mantendrá intacta; revísela antes de compartir. Tras seleccionar cualquier conversación histórica, puede cambiar de inmediato a proveedores configurados como OpenAI, Anthropic, Google, Ollama o compatibles con OpenAI para continuar trabajando. Los historiales extensos se comprimen automáticamente en ventanas de contexto portátiles al enviarse, preservando intacto el registro original en local.

Las sesiones de shell/procesos de Codex, los estados de aprobación y las herramientas en ejecución no se migran; los modelos externos continuarán ejecutándose sobre la base de los mensajes visibles importados y las herramientas disponibles en la aplicación actual.

## Licencia

Este proyecto se distribuye exclusivamente bajo la licencia GNU Affero General Public License v3.0 (AGPL-3.0-only). Consulte [LICENSE](./LICENSE) y [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). La distribución de binarios requiere proporcionar de forma simultánea el código fuente completo correspondiente a dicha versión.

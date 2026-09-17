# WPS Agent Editor

[简体中文](./README.md#zh-cn) | [English](./README_en.md) | [繁體中文](./README_zh-TW.md) | [日本語](./README_ja.md) | [한국어](./README_ko.md) | **Español** | [Français](./README_fr.md) | [Deutsch](./README_de.md) | [Русский](./README_ru.md) | [Português](./README_pt.md) | [العربية](./README_ar.md)

---

**WPS Agent Editor 2** es un editor de documentos multiplataforma de nueva generación y un banco de trabajo de IA multi-agente construido con **Tauri v2**, **React** y **Rust**. Al aprovechar la WebView nativa del sistema operativo, prescinde por completo de los pesados paquetes de Electron, Chromium, Node.js o OnlyOffice Document Server.

---

## Diálogo Multi-IA y Colaboración Multi-Agente

WPS Agent Editor incorpora un sofisticado motor de orquestación multi-modelo concebido para coordinar diversos modelos de IA como un equipo de trabajo documental unificado:

- **Ecosistema Amplio de Proveedores**: Integración nativa con OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet), Google Gemini, DeepSeek, Ollama (modelos locales sin conexión), Volcengine (Doubao) y cualquier API compatible con OpenAI.
- **Dos Modos de Colaboración**:
  - **Modo Dirigido (Orquestación por Director)**: Un agente líder descompone flujos de trabajo complejos, delega subtareas (`delegate_task`) a modelos especializados (analista de datos, redactor técnico, revisor de código), recopila los resultados y genera la entrega final.
  - **Modo Paralelo**: Varios modelos redactan, analizan o revisan simultáneamente diversas secciones del documento con transmisión en tiempo real y traspaso fluido de tareas (Handoff).
- **Línea de Tiempo Visual de Colaboración**: Registro en directo que monitoriza asignaciones, diálogos entre modelos, razonamientos internos (Reasoning), llamadas a herramientas y transferencias de estado.
- **Contexto Inteligente y Migración de Codex**: Compresión automática de historiales largos en ventanas de contexto portátiles. Sincronización idempotente y transparente de sesiones JSONL desde `CODEX_HOME` (`~/.codex`).

---

## Capacidades de Procesamiento Colaborativo de Documentos

Conexión directa entre la IA conversacional y el núcleo de edición de documentos:

- **Operaciones Atómicas en Documentos**: Los agentes no solo generan texto; envían operaciones estructurales atómicas (`insertar`, `formatear`, `reemplazar`, `anotar`) directamente a los motores documentales.
- **Detección de Cursor y Selección**: Seguimiento en tiempo real de cursores, textos seleccionados y rangos de modificación tanto de los agentes como del usuario.
- **Control de Revisiones y Resolución de Conflictos**: Detección automática de colisiones en edición simultánea, persistencia transaccional y reversión (Undo) con un solo clic.
- **Aprobación Humana en el Bucle (Human-in-the-Loop)**: Configuración de acciones críticas que requieren autorización previa del usuario (`approval-required`) antes de aplicarse al documento.

---

## Formatos de Archivo Compatibles

| Categoría | Extensiones | Motor y Características |
| :--- | :--- | :--- |
| **Documentos Word** | `.docx`, `.doc`, `.odt` | Basado en **SuperDoc**. Soporte integral de estilos, tablas, imágenes y maquetación. Conversión automática de formatos antiguos. |
| **Hojas de Cálculo** | `.xlsx`, `.xls`, `.csv`, `.ods` | Basado en **Fortune Sheet**. Amplio catálogo de fórmulas, pestañas múltiples, estilos de celda y cálculo de alto rendimiento. |
| **Presentaciones** | `.pptx`, `.ppt`, `.odp` | Visualización fluida con **pptx-renderer** y edición estructural de diapositivas con backend de alta velocidad en **Rust OOXML**. |
| **Documentos PDF** | `.pdf` | Motor dual con **PDF.js** y **MuPDF**. Visualización nítida y anotaciones editables persistentes (resaltador, pluma, notas de texto). |
| **Texto y Markdown** | `.md`, `.markdown`, `.txt`, `.log` | Editor ligero integrado con vista previa instantánea y carga ultrarrápida. |
| **Código Fuente** | `.js`, `.ts`, `.tsx`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.cpp`, `.html`, `.css`, `.json`, `.yaml`, `.sh`, `.bat`, etc. | Potenciado por **Monaco Editor**. Resaltado de sintaxis, autocompletado inteligente y ejecución/depuración con herramientas nativas instaladas. |
| **Previsualización de Imágenes** | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.ico`, `.tif`, `.tiff` | Visor nativo optimizado. |

*Nota: La conversión de formatos clásicos `.doc` y `.ppt` utiliza WPS, Microsoft Office o LibreOffice presentes en el sistema. La ejecución de código depende de las cadenas de herramientas locales (Node.js, Python, Cargo, etc.). Ante dependencias no instaladas, se emite un error explícito `dependency-missing` sin descargas ocultas.*

---

## Desarrollo

### Requisitos
- Node.js 22+
- Rust stable y destinos de compilación
- [Requisitos previos de Tauri v2](https://v2.tauri.app/start/prerequisites/)

### Inicio Rápido
```bash
# Instalar dependencias
npm ci

# Ejecutar la aplicación de escritorio
npm run dev

# Ejecutar únicamente la interfaz web
npm run dev:web
```

### Verificación y Pruebas
```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

---

## Publicación y Seguridad

Los ejecutables se generan de forma nativa y liviana:
- **Windows 10+**: Instaladores NSIS para x86_64 y ARM64
- **macOS**: DMG para Intel y Apple Silicon
- **Linux**: AppImage para x86_64 y ARM64

Límite de CI estricto de 100 MiB por paquete principal. Pruebas automáticas de rechazo de firmas alteradas y recuperación ante fallos. Todas las claves de API se almacenan de manera segura en el almacén de credenciales del sistema operativo.

---

## Licencia

Distribuido bajo licencia **GNU Affero General Public License v3.0 only** (AGPL-3.0-only). Consulte [LICENSE](./LICENSE) y [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

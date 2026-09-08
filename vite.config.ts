import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import type { OutputChunk } from 'rollup'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST
const devServerIdentityPath = '/__wps_agent_editor_dev_server'

function normalizeProjectRoot(projectRoot: string): string {
  const normalized = projectRoot.replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function devServerIdentityPlugin(): Plugin {
  const canonicalRoot = realpathSync.native(__dirname)
  const rootHash = createHash('sha256')
    .update(normalizeProjectRoot(canonicalRoot))
    .digest('hex')

  return {
    name: 'wps-agent-editor-dev-server-identity',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(devServerIdentityPath, (request, response, next) => {
        if (request.method !== 'GET') {
          next()
          return
        }

        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.end(JSON.stringify({ app: 'wps-agent-editor', rootHash }))
      })
    },
  }
}

const engineModuleMarkers = [
  ['mupdf', '/node_modules/mupdf/'],
  ['xterm', '/node_modules/@xterm/'],
  ['superdoc', '/node_modules/superdoc/'],
  ['superdoc', '/node_modules/@superdoc-dev/'],
  ['fortune-sheet', '/node_modules/@fortune-sheet/'],
  ['pptx-renderer', '/node_modules/@aiden0z/pptx-renderer/'],
  ['pdfjs', '/node_modules/pdfjs-dist/'],
] as const

function chunkEngines(chunk: OutputChunk): string[] {
  const engines = new Set<string>()
  for (const moduleId of Object.keys(chunk.modules)) {
    const normalized = moduleId.replaceAll('\\', '/').toLowerCase()
    for (const [engine, marker] of engineModuleMarkers) {
      if (normalized.includes(marker)) engines.add(engine)
    }
  }
  return [...engines].sort()
}

function bundleContractPlugin(): Plugin {
  return {
    name: 'wps-agent-editor-bundle-contract',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((output): output is OutputChunk => output.type === 'chunk')
      const entry = chunks.find((chunk) => chunk.isEntry
        && chunk.facadeModuleId?.replaceAll('\\', '/').endsWith('/src/renderer/index.html'))
      if (!entry) return

      const chunkContract = Object.fromEntries(chunks.map((chunk) => [
        chunk.fileName,
        {
          isEntry: chunk.isEntry,
          isDynamicEntry: chunk.isDynamicEntry,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          engines: chunkEngines(chunk),
        },
      ]))
      this.emitFile({
        type: 'asset',
        fileName: '.vite/bundle-contract.json',
        source: `${JSON.stringify({ schemaVersion: 1, entry: entry.fileName, chunks: chunkContract }, null, 2)}\n`,
      })
    },
  }
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react(), devServerIdentityPlugin(), bundleContractPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // SuperDoc is patched in place for Word fidelity. Loading its ESM files
  // directly prevents Vite's dependency cache from serving stale code.
  optimizeDeps: {
    exclude: ['superdoc', '@superdoc-dev/react', 'mupdf'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  worker: {
    format: 'es',
  },
  clearScreen: false,
  server: {
    host: host || '127.0.0.1',
    port: 1420,
    strictPort: true,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // MuPDF.js 1.28.1 is ESM-only and initializes its WASM runtime with
    // top-level await. Tauri ships a modern system WebView, so preserve that
    // syntax instead of advertising the former Safari 13 browser target.
    target: 'esnext',
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/renderer/index.html'),
    },
  },
})

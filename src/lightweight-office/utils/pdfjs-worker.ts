import {
  ensurePdfJsRuntimePolyfills,
  getPdfWorkerPolyfillSource,
} from './typed-array-polyfill'

interface PdfJsWorkerRuntime {
  GlobalWorkerOptions: { workerSrc: string }
}

const workerSources = new Map<string, string>()

export function configurePdfJsWorker(runtime: PdfJsWorkerRuntime, workerUrl: string): void {
  ensurePdfJsRuntimePolyfills()
  const absolute = typeof window === 'undefined'
    ? workerUrl
    : new URL(workerUrl, window.location.href).href
  let source = workerSources.get(absolute)
  if (!source) {
    const workerModule = `${getPdfWorkerPolyfillSource()}\nimport ${JSON.stringify(absolute)};\n`
    source = URL.createObjectURL(new Blob([workerModule], { type: 'text/javascript' }))
    workerSources.set(absolute, source)
  }
  runtime.GlobalWorkerOptions.workerSrc = source
}

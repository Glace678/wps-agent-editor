import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker.js?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker'
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'

type MonacoEnvironmentGlobal = typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (moduleId: string, label: string) => Worker
  }
}

export function configureMonacoEnvironment(): void {
  ;(globalThis as MonacoEnvironmentGlobal).MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker()
      return new EditorWorker()
    },
  }
}

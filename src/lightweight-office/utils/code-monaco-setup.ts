import * as monaco from 'monaco-editor'

let themesRegistered = false
let languageDefaultsConfigured = false

export function configureMonaco(): void {
  if (!themesRegistered) {
    monaco.editor.defineTheme('officeagentic-code-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '075DB7', fontStyle: 'bold' },
        { token: 'type', foreground: '087E8B' },
        { token: 'type.identifier', foreground: '087E8B' },
        { token: 'string', foreground: '187A2F' },
        { token: 'number', foreground: 'B24A00' },
        { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
        { token: 'regexp', foreground: 'A31575' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#202124',
        'editor.lineHighlightBackground': '#F3F6F8',
        'editor.selectionBackground': '#ADD6FF',
        'editor.inactiveSelectionBackground': '#DCEBFA',
        'editorGutter.background': '#F8F9FA',
        'editorLineNumber.foreground': '#7A818A',
        'editorLineNumber.activeForeground': '#202124',
        'editorIndentGuide.background1': '#D9DEE3',
      },
    })
    monaco.editor.defineTheme('officeagentic-code-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '65A9FF', fontStyle: 'bold' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'type.identifier', foreground: '4EC9B0' },
        { token: 'string', foreground: '9CDC8C' },
        { token: 'number', foreground: 'F2A65A' },
        { token: 'comment', foreground: '8B949E', fontStyle: 'italic' },
        { token: 'regexp', foreground: 'D16D9E' },
      ],
      colors: {
        'editor.background': '#181A1F',
        'editor.foreground': '#DDE1E6',
        'editor.lineHighlightBackground': '#22252B',
        'editor.selectionBackground': '#264F78',
        'editor.inactiveSelectionBackground': '#303A46',
        'editorGutter.background': '#15171B',
        'editorLineNumber.foreground': '#7D8590',
        'editorLineNumber.activeForeground': '#E6EDF3',
        'editorIndentGuide.background1': '#30343B',
      },
    })
    themesRegistered = true
  }

  if (!languageDefaultsConfigured) {
    const options: monaco.typescript.CompilerOptions = {
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
      target: monaco.typescript.ScriptTarget.ESNext,
      module: monaco.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.typescript.JsxEmit.ReactJSX,
      noEmit: true,
    }
    monaco.typescript.typescriptDefaults.setCompilerOptions(options)
    monaco.typescript.javascriptDefaults.setCompilerOptions(options)
    monaco.typescript.typescriptDefaults.setEagerModelSync(true)
    monaco.typescript.javascriptDefaults.setEagerModelSync(true)
    languageDefaultsConfigured = true
  }
}

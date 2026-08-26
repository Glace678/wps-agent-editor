import { getCodeLanguage } from './code-languages'

export interface CodeFileTabVisual {
  id: string
  badge: string
  title: string
  backgroundColor: string
  foregroundColor: string
  borderColor?: string
  accentColor?: string
}

type CodeFileTabVisualBase = Omit<CodeFileTabVisual, 'title'>

const LANGUAGE_VISUALS: Record<string, CodeFileTabVisualBase> = {
  cpp: { id: 'cpp', badge: 'C++', backgroundColor: '#00599c', foregroundColor: '#ffffff' },
  'objective-c': { id: 'objective-c', badge: 'OC', backgroundColor: '#2563a6', foregroundColor: '#ffffff' },
  csharp: { id: 'csharp', badge: 'C#', backgroundColor: '#68217a', foregroundColor: '#ffffff' },
  fsharp: { id: 'fsharp', badge: 'F#', backgroundColor: '#2563a6', foregroundColor: '#ffffff' },
  vb: { id: 'visual-basic', badge: 'VB', backgroundColor: '#4c2c92', foregroundColor: '#ffffff' },
  java: { id: 'java', badge: 'J', backgroundColor: '#b45309', foregroundColor: '#ffffff' },
  kotlin: { id: 'kotlin', badge: 'Kt', backgroundColor: '#6d28d9', foregroundColor: '#ffffff' },
  scala: { id: 'scala', badge: 'Sc', backgroundColor: '#c62828', foregroundColor: '#ffffff' },
  typescript: { id: 'typescript', badge: 'TS', backgroundColor: '#3178c6', foregroundColor: '#ffffff' },
  javascript: {
    id: 'javascript',
    badge: 'JS',
    backgroundColor: '#f7df1e',
    foregroundColor: '#242424',
    borderColor: '#d4bd00',
  },
  python: {
    id: 'python',
    badge: 'Py',
    backgroundColor: '#3776ab',
    foregroundColor: '#ffffff',
    accentColor: '#ffd343',
  },
  go: { id: 'go', badge: 'Go', backgroundColor: '#007d91', foregroundColor: '#ffffff' },
  rust: { id: 'rust', badge: 'Rs', backgroundColor: '#5a3e32', foregroundColor: '#ffffff' },
  swift: { id: 'swift', badge: 'Sw', backgroundColor: '#c2410c', foregroundColor: '#ffffff' },
  dart: { id: 'dart', badge: 'Dt', backgroundColor: '#087ea4', foregroundColor: '#ffffff' },
  ruby: { id: 'ruby', badge: 'Rb', backgroundColor: '#b91c1c', foregroundColor: '#ffffff' },
  php: { id: 'php', badge: 'PHP', backgroundColor: '#4f5b93', foregroundColor: '#ffffff' },
  perl: { id: 'perl', badge: 'Pl', backgroundColor: '#39457e', foregroundColor: '#ffffff' },
  lua: { id: 'lua', badge: 'Lua', backgroundColor: '#1e3a8a', foregroundColor: '#ffffff' },
  r: { id: 'r', badge: 'R', backgroundColor: '#2563a6', foregroundColor: '#ffffff' },
  julia: { id: 'julia', badge: 'Jl', backgroundColor: '#607d3b', foregroundColor: '#ffffff' },
  elixir: { id: 'elixir', badge: 'Ex', backgroundColor: '#5b2c6f', foregroundColor: '#ffffff' },
  clojure: { id: 'clojure', badge: 'Clj', backgroundColor: '#3f7f54', foregroundColor: '#ffffff' },
  coffee: { id: 'coffeescript', badge: 'Cf', backgroundColor: '#5b3a29', foregroundColor: '#ffffff' },
  sol: { id: 'solidity', badge: 'Sol', backgroundColor: '#4b5563', foregroundColor: '#ffffff' },
  pascal: { id: 'pascal', badge: 'Pas', backgroundColor: '#1d4e89', foregroundColor: '#ffffff' },
  mips: { id: 'assembly', badge: 'ASM', backgroundColor: '#6b3f69', foregroundColor: '#ffffff' },
  sql: { id: 'sql', badge: 'SQL', backgroundColor: '#0f766e', foregroundColor: '#ffffff' },
  mysql: { id: 'mysql', badge: 'SQL', backgroundColor: '#00618a', foregroundColor: '#ffffff' },
  pgsql: { id: 'postgresql', badge: 'SQL', backgroundColor: '#336791', foregroundColor: '#ffffff' },
  graphql: { id: 'graphql', badge: 'GQL', backgroundColor: '#b21478', foregroundColor: '#ffffff' },
  html: { id: 'html', badge: '<>', backgroundColor: '#c2410c', foregroundColor: '#ffffff' },
  css: { id: 'css', badge: '#', backgroundColor: '#1572b6', foregroundColor: '#ffffff' },
  scss: { id: 'scss', badge: 'SC', backgroundColor: '#a8326f', foregroundColor: '#ffffff' },
  less: { id: 'less', badge: 'LE', backgroundColor: '#1d365d', foregroundColor: '#ffffff' },
  json: { id: 'json', badge: '{}', backgroundColor: '#374151', foregroundColor: '#ffffff' },
  xml: { id: 'xml', badge: 'XML', backgroundColor: '#b45309', foregroundColor: '#ffffff' },
  yaml: { id: 'yaml', badge: 'YML', backgroundColor: '#991b1b', foregroundColor: '#ffffff' },
  ini: { id: 'config', badge: 'CFG', backgroundColor: '#4b5563', foregroundColor: '#ffffff' },
  protobuf: { id: 'protobuf', badge: 'PB', backgroundColor: '#2563a6', foregroundColor: '#ffffff' },
  hcl: { id: 'terraform', badge: 'TF', backgroundColor: '#5c4ee5', foregroundColor: '#ffffff' },
  dockerfile: { id: 'docker', badge: 'D', backgroundColor: '#1267b2', foregroundColor: '#ffffff' },
  shell: { id: 'shell', badge: '>_', backgroundColor: '#2e7d32', foregroundColor: '#ffffff' },
  powershell: { id: 'powershell', badge: '>_', backgroundColor: '#2867b2', foregroundColor: '#ffffff' },
  bat: { id: 'batch', badge: 'BAT', backgroundColor: '#4b5563', foregroundColor: '#ffffff' },
  tcl: { id: 'tcl', badge: 'Tcl', backgroundColor: '#0f766e', foregroundColor: '#ffffff' },
  systemverilog: { id: 'systemverilog', badge: 'SV', backgroundColor: '#4c2c92', foregroundColor: '#ffffff' },
  wgsl: { id: 'wgsl', badge: 'WG', backgroundColor: '#374151', foregroundColor: '#ffffff' },
  plaintext: { id: 'build-config', badge: 'CFG', backgroundColor: '#4b5563', foregroundColor: '#ffffff' },
}

const LABEL_VISUALS: Record<string, CodeFileTabVisualBase> = {
  c: { id: 'c', badge: 'C', backgroundColor: '#283593', foregroundColor: '#ffffff' },
  'c/c++ header': { id: 'c-header', badge: 'H', backgroundColor: '#3f6f9f', foregroundColor: '#ffffff' },
  'c++ header': { id: 'cpp-header', badge: 'H++', backgroundColor: '#00599c', foregroundColor: '#ffffff' },
  'c++ template': { id: 'cpp-template', badge: 'T++', backgroundColor: '#00599c', foregroundColor: '#ffffff' },
  'c/c++ inline': { id: 'cpp-inline', badge: 'I++', backgroundColor: '#00599c', foregroundColor: '#ffffff' },
  'cuda c++': { id: 'cuda', badge: 'Cu', backgroundColor: '#4d7c0f', foregroundColor: '#ffffff' },
  'cuda header': { id: 'cuda-header', badge: 'Cu', backgroundColor: '#4d7c0f', foregroundColor: '#ffffff' },
  groovy: { id: 'groovy', badge: 'Gr', backgroundColor: '#3d6b78', foregroundColor: '#ffffff' },
  jenkinsfile: { id: 'jenkins', badge: 'Jk', backgroundColor: '#b91c1c', foregroundColor: '#ffffff' },
  vue: { id: 'vue', badge: 'V', backgroundColor: '#087f5b', foregroundColor: '#ffffff' },
  svelte: { id: 'svelte', badge: 'S', backgroundColor: '#c43d15', foregroundColor: '#ffffff' },
  sass: { id: 'sass', badge: 'Sa', backgroundColor: '#a8326f', foregroundColor: '#ffffff' },
  environment: { id: 'environment', badge: 'ENV', backgroundColor: '#3f6212', foregroundColor: '#ffffff' },
  makefile: { id: 'makefile', badge: 'Mk', backgroundColor: '#4b5563', foregroundColor: '#ffffff' },
  cmake: { id: 'cmake', badge: 'CM', backgroundColor: '#1d4e89', foregroundColor: '#ffffff' },
}

const FALLBACK_VISUAL: CodeFileTabVisualBase = {
  id: 'code',
  badge: '</>',
  backgroundColor: '#4b5563',
  foregroundColor: '#ffffff',
}

export function getCodeFileTabVisual(filePath: string): CodeFileTabVisual | null {
  const definition = getCodeLanguage(filePath)
  if (!definition) return null

  const visual = LABEL_VISUALS[definition.label.toLowerCase()]
    ?? LANGUAGE_VISUALS[definition.language]
    ?? FALLBACK_VISUAL

  return {
    ...visual,
    title: definition.label,
  }
}

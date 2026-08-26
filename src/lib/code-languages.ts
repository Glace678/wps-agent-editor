export interface CodeLanguageDefinition {
  language: string
  label: string
  runnable?: boolean
}

const CODE_LANGUAGE_BY_EXTENSION: Record<string, CodeLanguageDefinition> = {
  c: { language: 'cpp', label: 'C', runnable: true },
  h: { language: 'cpp', label: 'C/C++ Header' },
  cc: { language: 'cpp', label: 'C++', runnable: true },
  cpp: { language: 'cpp', label: 'C++', runnable: true },
  cxx: { language: 'cpp', label: 'C++', runnable: true },
  hh: { language: 'cpp', label: 'C++ Header' },
  hpp: { language: 'cpp', label: 'C++ Header' },
  hxx: { language: 'cpp', label: 'C++ Header' },
  ipp: { language: 'cpp', label: 'C++ Header' },
  tpp: { language: 'cpp', label: 'C++ Template' },
  inl: { language: 'cpp', label: 'C/C++ Inline' },
  cu: { language: 'cpp', label: 'CUDA C++' },
  cuh: { language: 'cpp', label: 'CUDA Header' },
  m: { language: 'objective-c', label: 'Objective-C' },
  mm: { language: 'objective-c', label: 'Objective-C++' },
  cs: { language: 'csharp', label: 'C#' },
  fs: { language: 'fsharp', label: 'F#' },
  fsx: { language: 'fsharp', label: 'F# Script' },
  vb: { language: 'vb', label: 'Visual Basic' },
  java: { language: 'java', label: 'Java', runnable: true },
  kt: { language: 'kotlin', label: 'Kotlin', runnable: true },
  kts: { language: 'kotlin', label: 'Kotlin Script', runnable: true },
  scala: { language: 'scala', label: 'Scala' },
  groovy: { language: 'java', label: 'Groovy' },
  ts: { language: 'typescript', label: 'TypeScript', runnable: true },
  tsx: { language: 'typescript', label: 'TypeScript React', runnable: true },
  mts: { language: 'typescript', label: 'TypeScript Module', runnable: true },
  cts: { language: 'typescript', label: 'TypeScript CommonJS', runnable: true },
  js: { language: 'javascript', label: 'JavaScript', runnable: true },
  jsx: { language: 'javascript', label: 'JavaScript React', runnable: true },
  mjs: { language: 'javascript', label: 'JavaScript Module', runnable: true },
  cjs: { language: 'javascript', label: 'CommonJS', runnable: true },
  py: { language: 'python', label: 'Python', runnable: true },
  pyw: { language: 'python', label: 'Python' },
  pyi: { language: 'python', label: 'Python Type Stub' },
  go: { language: 'go', label: 'Go', runnable: true },
  rs: { language: 'rust', label: 'Rust', runnable: true },
  swift: { language: 'swift', label: 'Swift', runnable: true },
  dart: { language: 'dart', label: 'Dart', runnable: true },
  rb: { language: 'ruby', label: 'Ruby', runnable: true },
  php: { language: 'php', label: 'PHP', runnable: true },
  pl: { language: 'perl', label: 'Perl', runnable: true },
  pm: { language: 'perl', label: 'Perl Module' },
  lua: { language: 'lua', label: 'Lua', runnable: true },
  r: { language: 'r', label: 'R', runnable: true },
  jl: { language: 'julia', label: 'Julia', runnable: true },
  ex: { language: 'elixir', label: 'Elixir' },
  exs: { language: 'elixir', label: 'Elixir Script' },
  clj: { language: 'clojure', label: 'Clojure' },
  cljs: { language: 'clojure', label: 'ClojureScript' },
  coffee: { language: 'coffee', label: 'CoffeeScript' },
  sol: { language: 'sol', label: 'Solidity' },
  pas: { language: 'pascal', label: 'Pascal' },
  asm: { language: 'mips', label: 'Assembly' },
  s: { language: 'mips', label: 'Assembly' },
  sql: { language: 'sql', label: 'SQL' },
  mysql: { language: 'mysql', label: 'MySQL' },
  pgsql: { language: 'pgsql', label: 'PostgreSQL' },
  graphql: { language: 'graphql', label: 'GraphQL' },
  gql: { language: 'graphql', label: 'GraphQL' },
  html: { language: 'html', label: 'HTML' },
  htm: { language: 'html', label: 'HTML' },
  xhtml: { language: 'html', label: 'XHTML' },
  vue: { language: 'html', label: 'Vue' },
  svelte: { language: 'html', label: 'Svelte' },
  css: { language: 'css', label: 'CSS' },
  scss: { language: 'scss', label: 'SCSS' },
  sass: { language: 'scss', label: 'Sass' },
  less: { language: 'less', label: 'Less' },
  json: { language: 'json', label: 'JSON' },
  jsonc: { language: 'json', label: 'JSON with Comments' },
  xml: { language: 'xml', label: 'XML' },
  svg: { language: 'xml', label: 'SVG' },
  yaml: { language: 'yaml', label: 'YAML' },
  yml: { language: 'yaml', label: 'YAML' },
  toml: { language: 'ini', label: 'TOML' },
  ini: { language: 'ini', label: 'INI' },
  cfg: { language: 'ini', label: 'Configuration' },
  conf: { language: 'ini', label: 'Configuration' },
  properties: { language: 'ini', label: 'Properties' },
  proto: { language: 'protobuf', label: 'Protocol Buffers' },
  tf: { language: 'hcl', label: 'Terraform' },
  hcl: { language: 'hcl', label: 'HCL' },
  dockerfile: { language: 'dockerfile', label: 'Dockerfile' },
  sh: { language: 'shell', label: 'Shell', runnable: true },
  bash: { language: 'shell', label: 'Bash', runnable: true },
  zsh: { language: 'shell', label: 'Zsh', runnable: true },
  fish: { language: 'shell', label: 'Fish', runnable: true },
  ps1: { language: 'powershell', label: 'PowerShell', runnable: true },
  bat: { language: 'bat', label: 'Batch', runnable: true },
  cmd: { language: 'bat', label: 'Command Script', runnable: true },
  tcl: { language: 'tcl', label: 'Tcl' },
  sv: { language: 'systemverilog', label: 'SystemVerilog' },
  svh: { language: 'systemverilog', label: 'SystemVerilog Header' },
  wgsl: { language: 'wgsl', label: 'WGSL' },
}

const CODE_LANGUAGE_BY_FILENAME: Record<string, CodeLanguageDefinition> = {
  dockerfile: { language: 'dockerfile', label: 'Dockerfile' },
  makefile: { language: 'shell', label: 'Makefile' },
  'cmakelists.txt': { language: 'plaintext', label: 'CMake' },
  jenkinsfile: { language: 'java', label: 'Jenkinsfile' },
  rakefile: { language: 'ruby', label: 'Rakefile', runnable: true },
  gemfile: { language: 'ruby', label: 'Gemfile' },
  podfile: { language: 'ruby', label: 'Podfile' },
}

export const CODE_FILE_EXTENSIONS = Object.freeze(Object.keys(CODE_LANGUAGE_BY_EXTENSION))
export const CODE_SPECIAL_FILE_NAMES = Object.freeze([
  'Dockerfile',
  'Makefile',
  'CMakeLists.txt',
  'Jenkinsfile',
  'Rakefile',
  'Gemfile',
  'Podfile',
  '.env',
  '.env.*',
])

export const CODE_FILE_FILTER_GROUPS = Object.freeze({
  cCpp: Object.freeze([
    'c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx', 'ipp', 'tpp', 'inl', 'cu', 'cuh',
  ]),
  python: Object.freeze(['py', 'pyw', 'pyi']),
  javascriptTypescript: Object.freeze([
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts',
  ]),
  javaJvm: Object.freeze(['java', 'kt', 'kts', 'scala', 'groovy']),
})

function fileNameOf(filePath: string): string {
  return filePath.split(/[/\\]/).pop()?.toLowerCase() ?? ''
}

export function getCodeLanguage(filePath: string): CodeLanguageDefinition | null {
  const name = fileNameOf(filePath)
  if (!name) return null
  if (CODE_LANGUAGE_BY_FILENAME[name]) return CODE_LANGUAGE_BY_FILENAME[name]
  if (name === '.env' || name.startsWith('.env.')) {
    return { language: 'ini', label: 'Environment' }
  }
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return null
  return CODE_LANGUAGE_BY_EXTENSION[name.slice(dot + 1)] ?? null
}

export function isCodeFile(filePath: string): boolean {
  return getCodeLanguage(filePath) !== null
}

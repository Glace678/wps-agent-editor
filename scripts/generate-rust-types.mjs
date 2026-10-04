import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'src', 'types', 'generated')
const temporaryOutput = resolve(root, 'src', 'types', '.generated-rust-dto-tmp')
const expectedSuffix = join('src', 'types', 'generated')
if (!output.endsWith(expectedSuffix)) throw new Error(`Refusing to replace unexpected path: ${output}`)
if (!temporaryOutput.endsWith(join('src', 'types', '.generated-rust-dto-tmp'))) {
  throw new Error(`Refusing to use unexpected temporary path: ${temporaryOutput}`)
}

// The complete set of Rust DTO types the frontend expects to import. The temp
// output must contain (at least) all of these with non-empty, structurally valid
// files; an empty or truncated cargo run is rejected before we touch the good
// output. Keep this in sync when ts-rs bindings are intentionally added/removed.
const EXPECTED_DTOS = new Set([
  'AgentAttachment', 'AgentCacheUsage', 'AgentChatRequest', 'AgentCollaborationEvent',
  'AgentConfig', 'AgentDocumentEvent', 'AgentDocumentResult', 'AgentRunTaskRequest',
  'AgentTaskResult', 'AppError', 'AuthStatus', 'ChatMessage', 'ChatRole',
  'CodeRunResult', 'CodexImportFailure', 'CodexImportResult', 'CommandSuccess',
  'ConversationMessage', 'ConversationRecord', 'ConversationSaveRequest',
  'ConversationSource', 'ConversationSummary', 'CustomProviderConfig', 'DebugBreakpoint',
  'DebugCommand', 'DebugStartResult', 'DependencyStatus', 'ExecutedToolCall',
  'FileDialogKind', 'FileEntry', 'FileOperationResult', 'FileSessionSaveRequest',
  'FileSessionSnapshot', 'FileStatInfo', 'FileVersion', 'GrantedPath', 'OpenedFile',
  'PathAccessRequest', 'PreparedOfficeConverter', 'PreparedOfficeMetadata',
  'PresentationEditMetadata', 'PresentationEditOperation',
  'PresentationEditResponseMetadata', 'PresentationSlideText', 'ProviderDefinition',
  'ProviderModel', 'ProviderProtocol', 'RecentFile', 'RecoveryNotice', 'SystemFont',
  'TerminalStartResult', 'UpdateInfo',
])

const cargoCandidates = [
  process.env.CARGO,
  process.platform === 'win32' && process.env.USERPROFILE
    ? join(process.env.USERPROFILE, '.cargo', 'bin', 'cargo.exe')
    : undefined,
  'cargo',
].filter(Boolean)
const cargo = cargoCandidates.find((candidate) => !candidate.includes(sep) || existsSync(candidate))
if (!cargo) throw new Error('Cargo was not found; Rust DTO bindings cannot be generated')

await rm(temporaryOutput, { recursive: true, force: true })
await mkdir(temporaryOutput, { recursive: true })
const result = spawnSync(
  cargo,
  ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'export_bindings'],
  {
    cwd: root,
    env: { ...process.env, TS_RS_EXPORT_DIR: temporaryOutput },
    encoding: 'utf8',
    windowsHide: true,
  },
)
if (result.status !== 0) {
  await rm(temporaryOutput, { recursive: true, force: true })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  process.exit(result.status ?? 1)
}

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...await collect(path))
    else if (entry.name.endsWith('.ts') && entry.name !== 'index.ts') paths.push(path)
  }
  return paths
}

const files = (await collect(temporaryOutput)).sort()

// Validate the produced bindings before replacing the good output.
if (files.length === 0) {
  await rm(temporaryOutput, { recursive: true, force: true })
  throw new Error('cargo export_bindings produced no .ts DTO files; leaving the existing output untouched')
}
const produced = new Set(files.map((file) => basename(file, '.ts')))
const missing = [...EXPECTED_DTOS].filter((name) => !produced.has(name))
if (missing.length > 0) {
  await rm(temporaryOutput, { recursive: true, force: true })
  throw new Error(`Generated bindings are incomplete; missing expected DTOs: ${missing.sort().join(', ')}`)
}
for (const file of files) {
  const source = await readFile(file, 'utf8')
  if (!source.trim() || !/export\s+(type|interface)/.test(source)) {
    await rm(temporaryOutput, { recursive: true, force: true })
    throw new Error(`Generated DTO file is empty or has no export: ${relative(temporaryOutput, file)}`)
  }
}
const extra = [...produced].filter((name) => !EXPECTED_DTOS.has(name))
if (extra.length > 0) {
  console.log(`note: unexpected DTO(s) produced (add to EXPECTED_DTOS if intentional): ${extra.sort().join(', ')}`)
}

await Promise.all(files.map(async (file) => {
  const source = await readFile(file, 'utf8')
  const normalized = `${source.split(/\r?\n/).map((line) => line.trimEnd()).join('\n').trimEnd()}\n`
  await writeFile(file, normalized)
}))
const exports = files.map((file) => {
  const modulePath = `./${relative(temporaryOutput, file).replaceAll('\\', '/').replace(/\.ts$/, '')}`
  return `export type * from '${modulePath}'`
})
await writeFile(join(temporaryOutput, 'index.ts'), `// Generated by ts-rs. Do not edit.\n${exports.join('\n')}\n`)

// Swap the directories on the same filesystem, keeping the previous output as a
// rollback backup. On Windows a watched directory can be transiently locked
// (EPERM/EBUSY), so the old-output move is retried with a short backoff. If the
// new-output rename ultimately fails we restore the backup instead of leaving an
// empty/missing generated dir.
const backup = `${output}.bak-${process.pid}`
await rm(backup, { recursive: true, force: true })
const hadExisting = existsSync(output)

const LOCK_ERRORS = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])
let lastError
for (let attempt = 0; attempt < 10; attempt += 1) {
  lastError = null
  try {
    if (hadExisting) await rename(output, backup)
    break
  } catch (error) {
    lastError = error
    if (!LOCK_ERRORS.has(error.code)) throw error
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
if (lastError) {
  await rm(backup, { recursive: true, force: true })
  throw new Error(`Could not move the existing generated types out of the way (still locked): ${lastError.message}`)
}

try {
  await rename(temporaryOutput, output)
} catch (error) {
  if (hadExisting) {
    await rm(output, { recursive: true, force: true })
    await rename(backup, output)
  }
  throw error
}
await rm(backup, { recursive: true, force: true })
console.log(`Generated ${files.length} Rust DTO bindings`)

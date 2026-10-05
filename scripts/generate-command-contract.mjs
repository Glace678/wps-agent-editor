import { readFile, writeFile, rename } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { stripComments } from './lib/comment-utils.mjs'

const root = resolve(import.meta.dirname, '..')
const rustPath = resolve(root, 'src-tauri/src/lib.rs')
const mappingPath = resolve(root, 'src/platform/commands.ts')
const outputPath = resolve(root, 'src/platform/generated-command-names.ts')
const write = process.argv.includes('--write')

// Strip Rust/JS comments before extracting, so a command-looking token inside a
// comment or string literal is not mistaken for a real registration.
const rust = await readFile(rustPath, 'utf8')
const mapping = await readFile(mappingPath, 'utf8')
const handler = stripComments(rust).match(/tauri::generate_handler!\s*\[([\s\S]*?)\]/)?.[1]
if (!handler) throw new Error('Could not find tauri::generate_handler! in src-tauri/src/lib.rs')

// Each comma-separated entry must look like `commands::<path>::<command>`. The
// module path may contain digits (e.g. commands::v2::foo). Any entry we cannot
// parse is a hard error rather than being silently dropped.
const registered = []
const unrecognized = []
for (const entry of handler.split(',')) {
  const trimmed = entry.trim()
  if (!trimmed) continue
  const match = /^commands::[a-z0-9_]+(?:::[a-z0-9_]+)*::([a-z][a-z0-9_]*)$/.exec(trimmed)
  if (match) registered.push(match[1])
  else unrecognized.push(trimmed)
}
if (unrecognized.length) {
  throw new Error(`Unrecognized tauri::generate_handler! entries (expected commands::<path>::<name>): ${unrecognized.join(', ')}`)
}
registered.sort()

// TypeScript command-name mappings: support single quotes, double quotes, and
// no-interpolation template literals.
const mapped = [...stripComments(mapping).matchAll(/:\s*(?:'([a-z][a-z0-9_]*)'|"([a-z][a-z0-9_]*)"|`([a-z][a-z0-9_]*)`)/g)]
  .map((match) => match[1] ?? match[2] ?? match[3])
  .sort()

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]
}

const registeredDuplicates = duplicates(registered)
const mappedDuplicates = duplicates(mapped)
const registeredSet = new Set(registered)
const mappedSet = new Set(mapped)
const missing = registered.filter((command) => !mappedSet.has(command))
const extra = mapped.filter((command) => !registeredSet.has(command))

if (registeredDuplicates.length || mappedDuplicates.length || missing.length || extra.length) {
  const details = [
    registeredDuplicates.length ? `Duplicate Rust registrations: ${registeredDuplicates.join(', ')}` : '',
    mappedDuplicates.length ? `Duplicate TypeScript mappings: ${mappedDuplicates.join(', ')}` : '',
    missing.length ? `Missing TypeScript mappings: ${missing.join(', ')}` : '',
    extra.length ? `Unregistered TypeScript mappings: ${extra.join(', ')}` : '',
  ].filter(Boolean)
  throw new Error(details.join('\n'))
}

const generated = [
  '// Generated from tauri::generate_handler!. Do not edit.',
  'export const REGISTERED_DESKTOP_COMMANDS = [',
  ...registered.map((command) => `  '${command}',`),
  '] as const',
  '',
  'export type RegisteredDesktopCommand = (typeof REGISTERED_DESKTOP_COMMANDS)[number]',
  '',
].join('\n')

// Atomic write: write to a same-directory temp file first, then rename over the
// target. A crash/disk-full mid-write leaves the previous output intact instead of
// truncating it.
async function writeAtomic(filePath, content) {
  const tmp = `${filePath}.tmp-${process.pid}`
  await writeFile(tmp, content)
  await rename(tmp, filePath)
}

if (write) {
  await writeAtomic(outputPath, generated)
  console.log(`Generated ${registered.length} desktop command names`)
} else {
  // Normalize CRLF so Windows checkouts with core.autocrlf=true still compare equal.
  const existing = (await readFile(outputPath, 'utf8').catch(() => '')).replace(/\r\n/g, '\n')
  if (existing !== generated) {
    throw new Error('Desktop command manifest is stale; run npm run generate:commands')
  }
  console.log(`Desktop command contract passed (${registered.length} commands)`)
}

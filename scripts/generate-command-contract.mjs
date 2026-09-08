import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const rustPath = resolve(root, 'src-tauri/src/lib.rs')
const mappingPath = resolve(root, 'src/platform/commands.ts')
const outputPath = resolve(root, 'src/platform/generated-command-names.ts')
const write = process.argv.includes('--write')

const rust = await readFile(rustPath, 'utf8')
const mapping = await readFile(mappingPath, 'utf8')
const handler = rust.match(/tauri::generate_handler!\s*\[([\s\S]*?)\]/)?.[1]
if (!handler) throw new Error('Could not find tauri::generate_handler! in src-tauri/src/lib.rs')

const registered = [...handler.matchAll(/commands::[a-z_]+::([a-z][a-z0-9_]*)/g)]
  .map((match) => match[1])
  .sort()
const mapped = [...mapping.matchAll(/:\s*'([a-z][a-z0-9_]*)'/g)]
  .map((match) => match[1])
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

if (write) {
  await writeFile(outputPath, generated)
  console.log(`Generated ${registered.length} desktop command names`)
} else {
  const existing = await readFile(outputPath, 'utf8').catch(() => '')
  if (existing !== generated) {
    throw new Error('Desktop command manifest is stale; run npm run generate:commands')
  }
  console.log(`Desktop command contract passed (${registered.length} commands)`)
}

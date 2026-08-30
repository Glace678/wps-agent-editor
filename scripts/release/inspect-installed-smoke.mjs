import { lstat, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { parseArguments } from './release-smoke-lib.mjs'

const args = parseArguments(process.argv.slice(2))
if (!args.root) throw new Error('Usage: inspect-installed-smoke.mjs --root <installed-or-extracted-bundle>')
const root = resolve(args.root)
const forbidden = [
  { pattern: /(^|\/)node_modules(\/|$)/i, reason: 'complete node_modules tree' },
  { pattern: /(^|\/)(electron|chromium)(\/|$|[-_.])/i, reason: 'Electron/Chromium runtime' },
  { pattern: /(^|\/)(onlyoffice|documentserver|document-server)(\/|$|[-_.])/i, reason: 'OnlyOffice runtime' },
  { pattern: /(^|\/)(node(?:\.exe)?|libnode(?:\.so|\.dylib|\.dll))(?:$|[-_.])/i, reason: 'bundled Node runtime' },
  { pattern: /(^|\/)(?:icudtl\.dat|v8_context_snapshot\.bin|snapshot_blob\.bin|resources\.pak|chrome_[^/]*\.pak)$/i, reason: 'Chromium runtime payload' },
  { pattern: /(^|\/)[^/]+\.dSYM(?:\/|$)|\.(?:map|pdb|ilk|debug)$/i, reason: 'source map or debug symbols' },
  { pattern: /(^|\/)app\.asar(?:$|\.)/i, reason: 'Electron application archive' },
]

const violations = []
let files = 0
let totalBytes = 0
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    const display = relative(root, path).split(sep).join('/')
    const match = forbidden.find((rule) => rule.pattern.test(display))
    if (match) violations.push(`${display} (${match.reason})`)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await walk(path)
    else if (entry.isFile()) {
      files += 1
      totalBytes += (await lstat(path)).size
    }
  }
}

await walk(root)
if (violations.length) {
  throw new Error(`Forbidden heavyweight or debug content found below ${root}:\n${violations.join('\n')}`)
}
console.log(JSON.stringify({ root, files, unpackedMiB: Number((totalBytes / 1024 / 1024).toFixed(2)), forbiddenContentFound: false }))

// npm audit gate: fail on high/critical advisories, except those listed in
// audit-exceptions.json with a non-expired `expires` date and a recorded reason.
// Exceptions are time-boxed so an upstream advisory can unblock an emergency
// release without silently weakening the gate forever.
//
// audit-exceptions.json:
// {
//   "exceptions": [
//     { "id": "GHSA-xxxx-xxxx-xxxx", "expires": "2026-11-01",
//       "reason": "upstream fix pending; tracked in #123" }
//   ]
// }
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const mode = process.argv[2] === '--mode' ? process.argv[3] : null
if (!['full', 'production'].includes(mode)) {
  throw new Error('Usage: node check-npm-audit.mjs --mode <full|production>')
}

const root = resolve(import.meta.dirname, '..')
const exceptionsPath = resolve(root, 'audit-exceptions.json')

const auditArgs = ['audit', '--json']
if (mode === 'production') auditArgs.push('--omit=dev')
// Run npm through its CLI JS with the current node binary: on Windows,
// spawning npm.cmd directly requires shell:true (which weakens argument
// quoting and emits a deprecation warning), whereas node ships npm-cli.js
// right next to its own executable. Fall back to shell spawning only when
// the bundled CLI cannot be located.
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const spawnOptions = { encoding: 'utf8', cwd: root }
let result
if (existsSync(npmCli)) {
  result = spawnSync(process.execPath, [npmCli, ...auditArgs], spawnOptions)
} else {
  result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', auditArgs, {
    ...spawnOptions,
    shell: process.platform === 'win32',
  })
}
if (result.error) throw result.error
let payload
try {
  payload = JSON.parse(result.stdout)
} catch (error) {
  throw new Error(`npm audit did not return JSON: ${error.message}\n${result.stderr}`)
}

let exceptionsFile = { exceptions: [] }
try {
  exceptionsFile = JSON.parse(await readFile(exceptionsPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw new Error(`Cannot read audit-exceptions.json: ${error.message}`)
}
if (!Array.isArray(exceptionsFile.exceptions)) {
  throw new Error('audit-exceptions.json must contain an exceptions array')
}

const today = new Date().toISOString().slice(0, 10)
const activeExceptions = new Map()
const expired = []
for (const entry of exceptionsFile.exceptions) {
  assert.equal(typeof entry?.id, 'string', 'Each audit exception needs a string id')
  assert.match(entry.id, /^(GHSA-[0-9a-z]{4}(?:-[0-9a-z]{4}){2}|pkg:.+)$/i,
    `Audit exception id must be a GHSA advisory id or pkg:<name>; received ${entry.id}`)
  assert.match(String(entry.expires), /^\d{4}-\d{2}-\d{2}$/,
    `Audit exception ${entry.id} needs an expires date (YYYY-MM-DD)`)
  assert.equal(typeof entry.reason, 'string', `Audit exception ${entry.id} needs a reason`)
  const id = entry.id.toLowerCase()
  if (entry.expires < today) {
    expired.push(id)
    continue
  }
  if (activeExceptions.has(id)) throw new Error(`Duplicate active audit exception: ${id}`)
  activeExceptions.set(id, entry)
}

// Map each high/critical vulnerability to the advisory ids that cause it.
const blocking = []
const matchedExceptions = new Set()
const vulnerabilities = payload.vulnerabilities ?? {}

function advisoryIdFromEntry(entry) {
  if (typeof entry?.url === 'string') {
    const match = entry.url.match(/(GHSA-[0-9a-z]{4}(?:-[0-9a-z]{4}){2})/i)
    if (match) return match[1].toLowerCase()
  }
  if (typeof entry?.source === 'string') {
    const match = entry.source.match(/(GHSA-[0-9a-z]{4}(?:-[0-9a-z]{4}){2})/i)
    if (match) return match[1].toLowerCase()
  }
  return null
}

// Resolve one via entry to advisory ids: object entries carry their own
// advisory, while string entries name the dependency the finding actually
// comes from and are resolved against that dependency's via list.
function idsForVia(name, via, seen = new Set()) {
  if (seen.has(name)) return null
  // Copy the ancestry set so a dependency reached through one sibling is not
  // treated as visited when reached independently through another sibling.
  const localSeen = new Set(seen)
  localSeen.add(name)
  if (!Array.isArray(via)) return [`pkg:${name}`]
  const ids = []
  for (const entry of via) {
    if (entry && typeof entry === 'object') {
      const id = advisoryIdFromEntry(entry)
      if (id) ids.push(id)
    } else if (typeof entry === 'string') {
      const nested = vulnerabilities[entry]
      if (nested) {
        const nestedIds = idsForVia(entry, nested.via, localSeen)
        if (nestedIds) ids.push(...nestedIds)
      } else {
        ids.push(`pkg:${entry}`)
      }
    }
  }
  return ids.length ? [...new Set(ids)] : [`pkg:${name}`]
}

for (const [name, detail] of Object.entries(vulnerabilities)) {
  if (!['high', 'critical'].includes(detail.severity)) continue
  const ids = idsForVia(name, detail.via)
  for (const id of ids) matchedExceptions.add(id)
  const unexcepted = ids.filter((id) => !activeExceptions.has(id))
  if (unexcepted.length === 0) continue
  blocking.push({
    name,
    severity: detail.severity,
    ids: unexcepted,
    range: detail.range ?? '',
    fixAvailable: detail.fixAvailable ?? false,
  })
}

const unused = [...activeExceptions.keys()].filter((id) => !matchedExceptions.has(id))

console.log(`npm audit (${mode}) — ${blocking.length} unexcepted high/critical finding(s)`)
if (blocking.length > 0) {
  for (const item of blocking) {
    console.log(
      `- ${item.severity} ${item.name}${item.range ? ` ${item.range}` : ''} ` +
        `[${item.ids.join(', ')}] fix=${item.fixAvailable === true ? 'available' : JSON.stringify(item.fixAvailable)}`,
    )
  }
  console.log(
    '\nTo time-box a finding, add it to audit-exceptions.json with an expires date and reason.',
  )
  process.exit(1)
}

if (expired.length) console.log(`Ignored ${expired.length} expired audit exception(s): ${expired.join(', ')}`)
if (unused.length) console.log(`Note: ${unused.length} active exception(s) not currently matched: ${unused.join(', ')}`)

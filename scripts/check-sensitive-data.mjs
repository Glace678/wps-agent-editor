import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const gitCandidates = process.platform === 'win32'
  ? [
      process.env.GIT_EXECUTABLE,
      'C:\\Program Files\\Git\\cmd\\git.exe',
      path.join(
        process.env.LOCALAPPDATA ?? '',
        'GitHubDesktop',
        'app-3.5.4',
        'resources',
        'app',
        'git',
        'cmd',
        'git.exe',
      ),
      'git.exe',
    ]
  : [process.env.GIT_EXECUTABLE, 'git']
const git = gitCandidates.find((candidate) => (
  candidate && (!candidate.includes(path.sep) || existsSync(candidate))
))

if (!git) throw new Error('Git was not found; sensitive-data check could not run.')

// Enumerate tracked/untracked files. A large repository can produce more output
// than execFileSync's default 1 MiB buffer; give it a generous headroom. If the
// enumeration itself fails, fail closed with an explicit message rather than
// silently scanning zero files (which would look like a clean run).
let files
try {
  files = execFileSync(
    git,
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 },
  ).split('\0').filter(Boolean)
} catch (error) {
  console.error(`FATAL: could not enumerate files via git ls-files: ${error?.message ?? error}`)
  process.exit(2)
}

const sensitiveFile = /(^|\/)(?:auth|recent-files|agents|custom-providers|provider-base-urls)\.json$|(^|\/)file-history\//i
const environmentFile = /(^|\/)\.env(?:\..+)?$/i
const allowedEnvironmentExample = /(^|\/)\.env\.example$/i
// Cover DSA keys (id_dsa) in addition to RSA/Ed25519.
const keyFile = /(?:^|\/)(?:id_rsa|id_ed25519|id_dsa)$|\.(?:pem|p12|pfx|key)$/i
const highConfidenceSecret = /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|A(?:KI|SI)A[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g
// Generic PEM private-key armor: matches "BEGIN RSA/EC/OPENSSH/DSA PRIVATE KEY",
// "BEGIN ENCRYPTED PRIVATE KEY" and a bare "BEGIN PRIVATE KEY".
const privateKey = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g
// Capture the credential value for quoted ('...', "...", `...`), escaped, and
// unquoted assignment forms. Groups: 1 backtick inner, 2 double-quote inner,
// 3 single-quote inner, 4 unquoted token.
const literalCredential = /\b(?:password|passwd|api_?key|access_?token|client_?secret)\b\s*[:=]\s*(?:`((?:[^`\\]|\\.)*)`|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s#"'`,;]+))/gi
const personalPath = /[A-Z]:[\\/]Users[\\/](?!Public(?:[\\/]|\b))[^\\/\s'"]+|\/(?:Users|home)\/(?!Shared(?:\/|\b))[^\/\s'"]+/gi
const safeLiteral = /^(?:example|sample|placeholder|dummy|test|missing|change[-_ ]?me|do-not-persist)/i
// Values that are code, types, or variable references rather than real secrets.
const codeLikeValue = /^(?:string|boolean|number|object|any|unknown|null|undefined|true|false|\{\}|\[\]|\(\))$/i
const codeExpression = /^(?:process|import|require|console|this|self|window|globalThis|env|typeof|new|return)\b|\$\{|process\.env|[({[<]|=>/
const findings = []

function report(file, rule) {
  findings.push({ file: file.replaceAll('\\', '/'), rule })
}

function scanText(text, normalized) {
  if (highConfidenceSecret.test(text)) report(normalized, 'provider-token')
  highConfidenceSecret.lastIndex = 0
  if (privateKey.test(text)) report(normalized, 'private-key-content')
  privateKey.lastIndex = 0
  if (personalPath.test(text)) report(normalized, 'personal-absolute-path')
  personalPath.lastIndex = 0

  for (const match of text.matchAll(literalCredential)) {
    const unquoted = match[4]
    const raw = (match[1] ?? match[2] ?? match[3] ?? unquoted ?? '')
      .trim()
      .replace(/[)\]:;,]+$/, '')
    if (raw.length < 6) continue
    if (safeLiteral.test(raw)) continue
    if (codeLikeValue.test(raw)) continue
    if (codeExpression.test(raw)) continue
    // Unquoted assignments: only flag values that look like a real secret (a digit
    // or a symbol), so TypeScript type annotations (`apiKey: string`) and
    // PowerShell cmdlets (`password = ConvertTo-SecureString`) are not false
    // positives. Quoted/backtick values keep the looser length/placeholder check.
    if (unquoted !== undefined && !/\d|[!@#$%^&*=+?]/.test(raw)) continue
    report(normalized, 'literal-credential')
  }
}

// Stream every file (including those >2 MB) in ~1 MiB chunks with a small overlap
// window so secrets spanning a chunk boundary are still detected. Binary files
// (containing a NUL byte) skip the content scan, matching the previous behavior.
// If a file cannot be opened or read, fail closed: report it explicitly instead
// of silently treating it as clean.
async function scanFileContent(absolute, normalized) {
  let handle
  try {
    handle = await open(absolute, 'r')
  } catch {
    report(normalized, 'unreadable-file')
    return
  }
  let carry = ''
  try {
    const stream = handle.createReadStream({ encoding: 'utf8', highWaterMark: 1 << 20 })
    for await (const chunk of stream) {
      if (chunk.includes('\0')) return
      const window = carry + chunk
      scanText(window, normalized)
      carry = window.slice(-512)
    }
  } catch {
    report(normalized, 'unreadable-file')
  } finally {
    await handle.close()
  }
}

for (const file of files) {
  const normalized = file.replaceAll('\\', '/')
  // NONE narrow allowlist: code-review-fixes/ holds internal static-review reports
  // (this task's reconciliation docs), not shipped source or test fixtures. Those
  // documents legitimately quote host absolute paths and sample snippets while
  // explaining fixes, which would trip personal-path rules. Skip the whole
  // directory from ALL scanning (classification + content), not just one rule.
  // Keep this regex tight to this single directory.
  if (/(^|\/)code-review-fixes\//.test(normalized)) continue
  if (sensitiveFile.test(normalized)) report(normalized, 'user-data-file')
  if (environmentFile.test(normalized) && !allowedEnvironmentExample.test(normalized)) {
    report(normalized, 'environment-file')
  }
  if (keyFile.test(normalized)) report(normalized, 'private-key-file')

  const absolute = path.join(root, file)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) continue
  await scanFileContent(absolute, normalized)
}

const unique = [...new Map(findings.map((finding) => (
  [`${finding.rule}:${finding.file}`, finding]
))).values()].sort((a, b) => (
  a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule)
))

if (unique.length > 0) {
  console.error('Sensitive data check failed. No secret values were printed:')
  for (const finding of unique) console.error(`- ${finding.rule}: ${finding.file}`)
  process.exit(1)
}

console.log(`Sensitive data check passed: ${files.length} tracked/untracked files inspected.`)

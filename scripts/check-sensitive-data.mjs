import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
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

// B4: git ls-files excludes .gitignore'd files — precisely where local
// secrets end up. Explicitly cover (a) known build-output directories and
// (b) ignored .env* files at the repo root. node_modules is intentionally
// not content-scanned (postinstall patches are verified separately by
// scripts/check-engine-patches.mjs).
const gitVisibleCount = files.length
const seenFiles = new Set(files.map((file) => file.replaceAll('\\', '/')))
function walkDirectory(relativeDir, list, depth = 0) {
  const absoluteDir = path.join(root, relativeDir)
  let entries
  try {
    entries = readdirSync(absoluteDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const entryRelative = path
      .join(relativeDir, entry.name)
      .replaceAll('\\', '/')
    if (entry.isDirectory()) {
      // Skip Vite caches and dependency trees inside build output.
      if (depth < 12 && entry.name !== 'node_modules' && entry.name !== '.vite') {
        walkDirectory(entryRelative, list, depth + 1)
      }
    } else if (!seenFiles.has(entryRelative)) {
      seenFiles.add(entryRelative)
      list.push(entryRelative)
    }
  }
}
const extraIgnoredFiles = []
for (const buildDir of ['out', 'dist']) {
  if (existsSync(path.join(root, buildDir))) walkDirectory(buildDir, extraIgnoredFiles)
}
try {
  for (const entry of readdirSync(root)) {
    if (/^\.env(?:\..+)?$/.test(entry) && !seenFiles.has(entry)) {
      seenFiles.add(entry)
      extraIgnoredFiles.push(entry)
    }
  }
} catch {
  /* root unreadable: the main enumeration below still runs */
}
files.push(...extraIgnoredFiles)

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
// B2: safe placeholders must end at a known placeholder word; a real secret
// pasted after "test-" ("test-9f8a2b…") no longer matches. Length-capped too.
const safeLiteral = /^(?:example|sample|placeholder|dummy|test|missing|change[-_ ]?me|do-not-persist)(?:[-_ ](?:key|token|secret|password|passwd|value|here|string|me|\d+))*$/i
// Values that are code, types, or variable references rather than real secrets.
const codeLikeValue = /^(?:string|boolean|number|object|any|unknown|null|undefined|true|false|\{\}|\[\]|\(\))$/i
// B2: dropped the leading-bracket `[({[<]` exemption — a real credential
// wrapped in parens must be reported. Only recognisable code references skip:
// keyword references, template expressions, function/method calls (`t(…)`,
// `store.api_key(…)`) and single identifiers wrapped in JSX braces (`{apiKey}`).
const codeExpression = /^(?:process|import|require|console|this|self|window|globalThis|env|typeof|new|return)\b|\$\{|process\.env|=>|^[A-Za-z_$][\w$.]*\s*\(|^\{[A-Za-z_$][\w$.]*\}$/
// PowerShell cmdlet shape (`ConvertTo-SecureString`, PascalCase Verb-Noun) —
// code, not a credential.
const powershellCmdlet = /^[A-Z][a-z]+(?:[A-Z][a-z]+)?-[A-Z][a-zA-Z]+(?:-[A-Z][a-zA-Z]+)*$/
// B2: unquoted values shorter than this with no digit/symbol are treated as
// identifiers; longer values are real passwords even without symbols.
const UNQUOTED_MIN_LENGTH = 12

// Rule sets per file class (B4). The heuristic literal/path rules are aimed at
// source files; build output (out/, dist/) and third-party patch files are
// scanned only for unambiguous provider tokens and private-key armor.
const RULES_TOKENS = ['provider-token', 'private-key-content']
const RULES_SOURCE = [
  ...RULES_TOKENS,
  'personal-absolute-path',
  'literal-credential',
  'user-data-file',
  'environment-file',
  'key-file',
]
const findings = []

function report(file, rule) {
  findings.push({ file: file.replaceAll('\\', '/'), rule })
}

function scanText(text, normalized, { exemptPersonalPath = false, rules = RULES_SOURCE } = {}) {
  if (rules.includes('provider-token') && highConfidenceSecret.test(text)) {
    report(normalized, 'provider-token')
  }
  highConfidenceSecret.lastIndex = 0
  if (rules.includes('private-key-content') && privateKey.test(text)) {
    report(normalized, 'private-key-content')
  }
  privateKey.lastIndex = 0
  // B3: review-doc directories may quote host paths legitimately, but they
  // are NOT exempt from token/key scanning.
  if (
    rules.includes('personal-absolute-path')
    && !exemptPersonalPath
    && personalPath.test(text)
  ) {
    report(normalized, 'personal-absolute-path')
  }
  personalPath.lastIndex = 0

  if (!rules.includes('literal-credential')) return
  for (const match of text.matchAll(literalCredential)) {
    const unquoted = match[4]
    const raw = (match[1] ?? match[2] ?? match[3] ?? unquoted ?? '')
      .trim()
      .replace(/[)\]:;,]+$/, '')
    if (raw.length < 6) continue
    if (raw.length <= 32 && safeLiteral.test(raw)) continue
    if (codeLikeValue.test(raw)) continue
    if (codeExpression.test(raw)) continue
    if (powershellCmdlet.test(raw)) continue
    // Unquoted assignments: short values with no digit/symbol are identifiers
    // (type annotations); anything long enough to be a real password is
    // flagged even without symbols (B2).
    if (unquoted !== undefined) {
      const hasDigitOrSymbol = /\d|[!@#$%^&*=+?\-]/.test(raw)
      if (!hasDigitOrSymbol && raw.length < UNQUOTED_MIN_LENGTH) continue
    }
    report(normalized, 'literal-credential')
  }
}

// Stream every file (including those >2 MB) in ~1 MiB chunks with a small overlap
// window so secrets spanning a chunk boundary are still detected. Binary files
// (containing a NUL byte) skip the content scan, matching the previous behavior.
// If a file cannot be opened or read, fail closed: report it explicitly instead
// of silently treating it as clean.
async function scanFileContent(absolute, normalized, options) {
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
      scanText(window, normalized, options)
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
  // B3: review-doc exemptions anchored to the repo root (the old regex also
  // matched any nested path). Those directories keep full token/key scanning;
  // only their legitimately quoted host paths skip the personal-path rule.
  const exemptPersonalPath = /^(?:code-review-fixes|code-review-fixes-2)\//.test(normalized)
    || normalized === '全量审查修复对账文档.md'
  // B4: build output and third-party patch files get token/key scanning only;
  // heuristic literal/path rules stay reserved for source files.
  const isBuildOutput = /^(?:out|dist)\//.test(normalized)
  const isPatchFile = /^patches\/.+\.(?:patch|diff)$/.test(normalized)
  const rules = isBuildOutput || isPatchFile ? RULES_TOKENS : RULES_SOURCE

  if (rules.includes('user-data-file') && sensitiveFile.test(normalized)) {
    report(normalized, 'user-data-file')
  }
  if (rules.includes('environment-file')
    && environmentFile.test(normalized)
    && !allowedEnvironmentExample.test(normalized)) {
    report(normalized, 'environment-file')
  }
  if (rules.includes('key-file') && keyFile.test(normalized)) {
    report(normalized, 'private-key-file')
  }

  const absolute = path.join(root, file)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) continue
  await scanFileContent(absolute, normalized, { exemptPersonalPath, rules })
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

const ignoredNote = extraIgnoredFiles.length > 0
  ? ` + ${extraIgnoredFiles.length} .gitignore'd files (build dirs out/dist, root .env*)`
  : ''
console.log(
  `Sensitive data check passed: ${gitVisibleCount} git-visible files${ignoredNote} inspected.`,
)

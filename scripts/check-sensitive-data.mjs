import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
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

const files = execFileSync(
  git,
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8', windowsHide: true },
).split('\0').filter(Boolean)

const sensitiveFile = /(^|\/)(?:auth|recent-files|agents|custom-providers|provider-base-urls)\.json$|(^|\/)file-history\//i
const environmentFile = /(^|\/)\.env(?:\..+)?$/i
const allowedEnvironmentExample = /(^|\/)\.env\.example$/i
const keyFile = /(?:^|\/)(?:id_rsa|id_ed25519)$|\.(?:pem|p12|pfx|key)$/i
const packagedBinary = /\.(?:exe|msi|dmg|appimage|asar|blockmap)$/i
const generatedUserData = /(^|\/)(?:tmp|artifact-drafts|artifact-review-history|artifact-producer-recipes)(?:\/|$)/i
const highConfidenceSecret = /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|A(?:KI|SI)A[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g
const signedCredentialURL = /[?&](?:X-Amz-(?:Credential|Signature)|X-Goog-(?:Credential|Signature)|sig|signature)=/i
const privateKey = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
const literalCredential = /\b(?:password|passwd|api_?key|access_?token|client_?secret)\b\s*[:=]\s*(['"])([^'"]+)\1/gi
const personalPath = /[A-Z]:[\\/]Users[\\/](?!Public(?:[\\/]|\b))[^\\/\s'"]+|\/(?:Users|home)\/(?!Shared(?:\/|\b))[^\/\s'"]+/gi
const safeLiteral = /^(?:example|sample|placeholder|dummy|test|missing|change[-_ ]?me|do-not-persist)/i
const findings = []

function report(file, rule) {
  findings.push({ file: file.replaceAll('\\', '/'), rule })
}

for (const file of files) {
  const normalized = file.replaceAll('\\', '/')
  if (sensitiveFile.test(normalized)) report(normalized, 'user-data-file')
  if (environmentFile.test(normalized) && !allowedEnvironmentExample.test(normalized)) {
    report(normalized, 'environment-file')
  }
  if (keyFile.test(normalized)) report(normalized, 'private-key-file')
  if (packagedBinary.test(normalized)) report(normalized, 'packaged-binary')
  if (generatedUserData.test(normalized)) report(normalized, 'generated-user-data')

  const absolute = path.join(root, file)
  if (!existsSync(absolute) || !statSync(absolute).isFile() || statSync(absolute).size > 2_000_000) {
    continue
  }
  const buffer = readFileSync(absolute)
  if (buffer.includes(0)) continue
  const content = buffer.toString('utf8')

  if (highConfidenceSecret.test(content)) report(normalized, 'provider-token')
  highConfidenceSecret.lastIndex = 0
  if (privateKey.test(content)) report(normalized, 'private-key-content')
  privateKey.lastIndex = 0
  if (personalPath.test(content)) report(normalized, 'personal-absolute-path')
  personalPath.lastIndex = 0
  if (signedCredentialURL.test(content)) report(normalized, 'signed-credential-url')

  for (const match of content.matchAll(literalCredential)) {
    if (!safeLiteral.test(match[2])) report(normalized, 'literal-credential')
  }
  literalCredential.lastIndex = 0
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

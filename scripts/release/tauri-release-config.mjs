import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const output = resolve(process.argv[2] || 'src-tauri/tauri.release.conf.json')
const publicKey = process.env.WAE_UPDATER_PUBLIC_KEY?.trim()
const repository = process.env.GITHUB_REPOSITORY?.trim()
const target = process.env.WAE_BUILD_TARGET?.trim()
if (!publicKey) throw new Error('WAE_UPDATER_PUBLIC_KEY is required')
if (!repository || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
  throw new Error('GITHUB_REPOSITORY must be an owner/name pair')
}

const supportedTargets = new Set([
  'i686-pc-windows-msvc',
  'x86_64-pc-windows-msvc',
  'aarch64-pc-windows-msvc',
  'x86_64-apple-darwin',
  'aarch64-apple-darwin',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu',
])
if (!supportedTargets.has(target)) throw new Error(`Unsupported or missing WAE_BUILD_TARGET: ${target || '<empty>'}`)

let decodedPublicKey
try {
  decodedPublicKey = Buffer.from(publicKey, 'base64').toString('utf8')
} catch {
  throw new Error('WAE_UPDATER_PUBLIC_KEY is not valid base64')
}
if (!/^untrusted comment: minisign public key [0-9A-F]+\r?\nRWQ[^\r\n]+\r?\n?$/i.test(decodedPublicKey)) {
  throw new Error('WAE_UPDATER_PUBLIC_KEY is not a valid Minisign public key')
}

const config = {
  bundle: {
    createUpdaterArtifacts: true,
  },
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`],
      windows: { installMode: 'passive' },
    },
  },
}

const thumbprint = process.env.WAE_WINDOWS_CERTIFICATE_THUMBPRINT?.trim()
if (target.endsWith('-pc-windows-msvc')) {
  if (!/^[0-9A-F]{40}$/i.test(thumbprint || '')) {
    throw new Error('WAE_WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-digit certificate thumbprint for Windows releases')
  }
  config.bundle.windows = {
    certificateThumbprint: thumbprint,
    digestAlgorithm: 'sha256',
    timestampUrl: 'http://timestamp.comodoca.com',
  }
}

if (target === 'x86_64-apple-darwin' || target === 'aarch64-apple-darwin') {
  config.bundle.macOS = {
    minimumSystemVersion: target === 'x86_64-apple-darwin' ? '10.15' : '11.0',
  }
}

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`)
console.log(`Wrote release-only Tauri configuration to ${output}`)

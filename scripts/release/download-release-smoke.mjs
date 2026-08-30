import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { parseArguments, releaseArtifactSpec } from './release-smoke-lib.mjs'

const args = parseArguments(process.argv.slice(2))
const repository = args.repository || process.env.GITHUB_REPOSITORY
if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
  throw new Error('GITHUB_REPOSITORY or --repository owner/name is required')
}
if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  throw new Error('GH_TOKEN or GITHUB_TOKEN is required to download release assets')
}

const spec = releaseArtifactSpec(args.tag, args.platform, args.arch, args.directory || 'smoke-artifacts')
await mkdir(spec.directory, { recursive: true })

const names = [...new Set([
  spec.primaryName,
  spec.updaterName,
  spec.signatureName,
  spec.invalidInstallName,
  spec.invalidInstallSignatureName,
  'SHA256SUMS',
  'latest.json',
  'latest-tampered.json',
  'latest-invalid-install.json',
])]
const commandArgs = ['release', 'download', spec.tag, '--repo', repository, '--dir', spec.directory]
for (const name of names) commandArgs.push('--pattern', name)

const result = spawnSync('gh', commandArgs, {
  encoding: 'utf8',
  env: {
    ...process.env,
    GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`gh release download failed for ${spec.tag} (${spec.platform}-${spec.arch}):\n${result.stderr || result.stdout}`)
}

console.log(`Downloaded ${names.join(', ')} from ${repository}@${spec.tag}`)

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const [platform, arch, sourceArg, outputArg = 'artifacts'] = process.argv.slice(2)
if (!platform || !arch || !sourceArg) {
  throw new Error('Usage: node collect-artifacts.mjs <windows|macos|linux> <arch> <bundle-dir> [output-dir]')
}

const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const version = packageJson.version
const sourceDir = resolve(sourceArg)
const outputDir = resolve(outputArg)
await mkdir(outputDir, { recursive: true })
const invalidInstallName = `updater-invalid-install-${platform}-${arch}.bin`
const invalidInstallSignatureName = `${invalidInstallName}.sig`
for (const name of [invalidInstallName, invalidInstallSignatureName]) {
  const path = join(outputDir, name)
  try {
    await readFile(path)
  } catch {
    throw new Error(`Missing signed updater invalid-install fixture: ${path}`)
  }
}

const { readdir } = await import('node:fs/promises')
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else files.push(path)
  }
  return files
}

const files = await walk(sourceDir)
const baseName = `${platform}-${arch}`
const primaryMatchers = {
  windows: [(path) => /[\\/]nsis[\\/].*\.exe$/i.test(path)],
  macos: [(path) => /\.dmg$/i.test(path)],
  linux: [(path) => /\.AppImage$/i.test(path) && !path.endsWith('.sig')],
}
const primarySuffix = { windows: '-setup.exe', macos: '.dmg', linux: '.AppImage' }[platform]
if (!primaryMatchers[platform] || !primarySuffix) throw new Error(`Unsupported platform: ${platform}`)

const primarySource = files.find(primaryMatchers[platform][0])
if (!primarySource) throw new Error(`No primary ${platform} bundle found below ${sourceDir}`)
const primaryName = `${baseName}${primarySuffix}`
await cp(primarySource, join(outputDir, primaryName))

const updaterMatchers = {
  windows: (path) => /[\\/]nsis[\\/].*\.exe$/i.test(path),
  macos: (path) => /\.app\.tar\.gz$/i.test(path),
  linux: (path) => /\.AppImage$/i.test(path) && !path.endsWith('.sig'),
}
const updaterSuffix = { windows: '-setup.exe', macos: '.app.tar.gz', linux: '.AppImage' }[platform]
const updaterSource = files.find(updaterMatchers[platform])
if (!updaterSource) throw new Error(`No updater artifact found for ${platform}-${arch}`)

const updaterName = platform === 'macos' ? `${baseName}${updaterSuffix}` : primaryName
if (resolve(updaterSource) !== resolve(primarySource) || updaterName !== primaryName) {
  await cp(updaterSource, join(outputDir, updaterName))
}

const signatureSource = files.find((path) => path === `${updaterSource}.sig`)
if (!signatureSource) throw new Error(`No updater signature found beside ${basename(updaterSource)}`)
const signatureName = `${updaterName}.sig`
await cp(signatureSource, join(outputDir, signatureName))

const updaterKey = {
  'windows-x86': 'windows-i686',
  'windows-x86_64': 'windows-x86_64',
  'windows-aarch64': 'windows-aarch64',
  'macos-x86_64': 'darwin-x86_64',
  'macos-aarch64': 'darwin-aarch64',
  'linux-x86_64': 'linux-x86_64',
  'linux-aarch64': 'linux-aarch64',
}[`${platform}-${arch}`]
if (!updaterKey) throw new Error(`No updater key for ${platform}-${arch}`)

await writeFile(join(outputDir, `release-part-${platform}-${arch}.json`), `${JSON.stringify({
  version,
  platform,
  arch,
  updaterKey,
  primary: primaryName,
  updater: updaterName,
  signature: signatureName,
  invalidInstall: invalidInstallName,
  invalidInstallSignature: invalidInstallSignatureName,
}, null, 2)}\n`)

console.log(`Collected ${primaryName} and signed updater artifact for ${updaterKey}`)

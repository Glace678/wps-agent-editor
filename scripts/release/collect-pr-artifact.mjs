import { cp, mkdir, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [platform, arch, sourceArg, outputArg = 'pr-artifact'] = process.argv.slice(2)
if (!platform || !arch || !sourceArg) {
  throw new Error('Usage: node collect-pr-artifact.mjs <windows|macos|linux> <arch> <bundle-dir> [output-dir]')
}

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

const sourceDirectory = resolve(sourceArg)
const outputDirectory = resolve(outputArg)
const files = await walk(sourceDirectory)
const matcher = {
  windows: (path) => /[\\/]nsis[\\/].*\.exe$/i.test(path),
  macos: (path) => /\.dmg$/i.test(path),
  linux: (path) => /\.AppImage$/i.test(path) && !path.endsWith('.sig'),
}[platform]
const suffix = { windows: '-setup.exe', macos: '.dmg', linux: '.AppImage' }[platform]
if (!matcher || !suffix) throw new Error(`Unsupported PR package platform: ${platform}`)

const source = files.find(matcher)
if (!source) throw new Error(`No ${platform}-${arch} primary bundle found below ${sourceDirectory}`)
const outputName = `${platform}-${arch}${suffix}`
await mkdir(outputDirectory, { recursive: true })
await cp(source, join(outputDirectory, outputName))
console.log(`Collected unsigned PR test artifact ${outputName}`)

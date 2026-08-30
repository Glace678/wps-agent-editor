import { execFileSync, spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const targets = {
  'i686-pc-windows-msvc': { package: 'win32-ia32', executable: 'esbuild.exe' },
  'x86_64-pc-windows-msvc': { package: 'win32-x64', executable: 'esbuild.exe' },
  'aarch64-pc-windows-msvc': { package: 'win32-arm64', executable: 'esbuild.exe' },
  'x86_64-apple-darwin': { package: 'darwin-x64', executable: 'bin/esbuild' },
  'aarch64-apple-darwin': { package: 'darwin-arm64', executable: 'bin/esbuild' },
  'x86_64-unknown-linux-gnu': { package: 'linux-x64', executable: 'bin/esbuild' },
  'aarch64-unknown-linux-gnu': { package: 'linux-arm64', executable: 'bin/esbuild' },
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function hostTarget() {
  const arch = process.arch === 'ia32' ? 'i686' : process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  if (process.platform === 'linux') return `${arch}-unknown-linux-gnu`
  throw new Error(`Unsupported esbuild sidecar host: ${process.platform}-${process.arch}`)
}

function canExecuteTarget(target) {
  const host = hostTarget()
  if (target === host) return true
  // x64 Windows can execute the 32-bit Windows sidecar through WoW64. Other
  // foreign architectures require a native runner (or an emulator), so the
  // package/version checks below are intentionally file-based there.
  return process.platform === 'win32' &&
    host === 'x86_64-pc-windows-msvc' &&
    target === 'i686-pc-windows-msvc'
}

async function packageVersion() {
  const value = JSON.parse(await readFile('node_modules/esbuild/package.json', 'utf8'))
  if (typeof value.version !== 'string') throw new Error('Cannot determine the pinned esbuild version')
  return value.version
}

async function downloadPackage(name, version, executable) {
  const directory = await mkdtemp(join(tmpdir(), 'wae-esbuild-'))
  try {
    const npm = npmInvocation()
    const output = execFileSync(
      npm.command,
      [...npm.args, 'pack', `@esbuild/${name}@${version}`, '--pack-destination', directory],
      { encoding: 'utf8', windowsHide: true },
    ).trim().split(/\r?\n/).at(-1)
    if (!output) throw new Error(`npm pack did not return an archive for @esbuild/${name}`)
    const archive = join(directory, basename(output))
    const extracted = spawnSync('tar', ['-xzf', archive, '-C', directory], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (extracted.status !== 0) throw new Error(extracted.stderr || 'Cannot extract esbuild package')
    return await cpToStableTemp(join(directory, 'package', executable), name)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function npmInvocation() {
  // Calling npm.cmd/npm.ps1 through child_process is shell- and Node-version
  // dependent on Windows. Invoke the npm CLI JS entrypoint with this exact
  // Node executable instead, while honoring npm's own npm_execpath when set.
  const configured = process.env.npm_execpath
  if (configured && existsSync(configured)) {
    return { command: process.execPath, args: [configured] }
  }
  if (process.platform === 'win32') {
    const bundled = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (existsSync(bundled)) return { command: process.execPath, args: [bundled] }
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [] }
}

async function cpToStableTemp(source, name) {
  const directory = await mkdtemp(join(tmpdir(), `wae-esbuild-${name}-`))
  const destination = join(directory, process.platform === 'win32' ? 'esbuild.exe' : 'esbuild')
  await cp(source, destination)
  return destination
}

async function main() {
  const target = argument('--target') ?? hostTarget()
  const definition = targets[target]
  if (!definition) throw new Error(`Unsupported esbuild sidecar target: ${target}`)
  const version = await packageVersion()
  const installed = resolve('node_modules', '@esbuild', definition.package, definition.executable)
  const downloaded = !existsSync(installed)
  const source = downloaded
    ? await downloadPackage(definition.package, version, definition.executable)
    : installed
  const suffix = target.includes('windows') ? '.exe' : ''
  const destination = resolve('src-tauri', 'binaries', `esbuild-${target}${suffix}`)
  await mkdir(resolve('src-tauri', 'binaries'), { recursive: true })
  await cp(source, destination)
  if (downloaded) await rm(resolve(source, '..'), { recursive: true, force: true })
  if (canExecuteTarget(target)) {
    const versionOutput = execFileSync(destination, ['--version'], { encoding: 'utf8', windowsHide: true }).trim()
    if (versionOutput !== version) throw new Error(`esbuild sidecar version mismatch: ${versionOutput} != ${version}`)
    console.log(`Prepared esbuild ${version} for ${target} (version verified)`)
  } else {
    const metadata = await stat(destination)
    if (!metadata.isFile() || metadata.size <= 0) {
      throw new Error(`Prepared esbuild sidecar is empty for ${target}`)
    }
    console.log(`Prepared esbuild ${version} for ${target} (execution deferred to native runner)`)
  }
}

await main()

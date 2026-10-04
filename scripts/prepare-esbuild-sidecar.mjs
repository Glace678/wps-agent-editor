import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

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

// Read the integrity (SHA-512) that npm ci resolved for this platform package
// from package-lock.json. We refuse to download a tarball we cannot pin.
async function loadLockEntry(name) {
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
  const key = `node_modules/@esbuild/${name}`
  const entry = lock.packages?.[key]
  if (!entry || typeof entry.integrity !== 'string') {
    throw new Error(`package-lock.json has no integrity entry for ${key}; refusing an unverified esbuild download`)
  }
  if (!entry.integrity.startsWith('sha512-')) {
    throw new Error(`package-lock.json integrity for ${key} is not sha512: ${entry.integrity}`)
  }
  return entry
}

function parseOctalField(buf) {
  const text = buf.toString('utf8').split('\0')[0].trim()
  return text ? parseInt(text, 8) : 0
}

function parseCString(buf) {
  const nul = buf.indexOf(0)
  return buf.toString('utf8', 0, nul === -1 ? buf.length : nul)
}

// Extract a gzip tarball into destDir while rejecting path traversal, absolute
// paths, and any symlink/hardlink members. Only regular files are written.
async function safeExtractTar(archiveBytes, destDir) {
  const data = gunzipSync(archiveBytes)
  const root = resolve(destDir)
  let offset = 0
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    if (header.every((b) => b === 0)) break
    const name = parseCString(header.subarray(0, 100))
    const size = parseOctalField(header.subarray(124, 136))
    const typeByte = header[156]
    const typeflag = typeByte ? String.fromCharCode(typeByte) : '0'
    const prefix = parseCString(header.subarray(345, 500))
    const fullName = prefix ? `${prefix}/${name}` : name
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > data.length) throw new Error(`Truncated tar entry: ${fullName}`)
    if (isAbsolute(fullName) || fullName.startsWith('/')) {
      throw new Error(`Refusing absolute tar path: ${fullName}`)
    }
    if (fullName.split('/').includes('..')) {
      throw new Error(`Refusing parent-directory tar path: ${fullName}`)
    }
    const target = resolve(root, fullName)
    const rel = relative(root, target)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Tar path escapes staging directory: ${fullName}`)
    }
    if (typeflag === '1' || typeflag === '2') {
      throw new Error(`Refusing hard/symlink tar entry: ${fullName}`)
    }
    if (typeflag === '5') {
      // Directory members are created implicitly by writing files.
    } else if (typeflag === '0' || typeflag === '') {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, Buffer.from(data.subarray(dataStart, dataEnd)))
    } else if (typeflag === 'x' || typeflag === 'g') {
      // pax/gnu extended-header metadata; not payload.
    } else {
      throw new Error(`Refusing unsupported tar entry type '${typeflag}' for ${fullName}`)
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
}

async function downloadPackage(name, version, executable) {
  const directory = await mkdtemp(join(tmpdir(), 'wae-esbuild-'))
  try {
    const lockEntry = await loadLockEntry(name)
    const npm = npmInvocation()
    const output = execFileSync(
      npm.command,
      [...npm.args, 'pack', `@esbuild/${name}@${version}`, '--pack-destination', directory],
      { encoding: 'utf8', windowsHide: true },
    ).trim().split(/\r?\n/).at(-1)
    if (!output) throw new Error(`npm pack did not return an archive for @esbuild/${name}`)
    const archive = join(directory, basename(output))
    const archiveBytes = await readFile(archive)
    // Verify the downloaded tarball against the lock's SHA-512 before trusting it.
    const actualIntegrity = 'sha512-' + createHash('sha512').update(archiveBytes).digest('base64')
    if (actualIntegrity !== lockEntry.integrity) {
      throw new Error(
        `esbuild tarball integrity mismatch for @esbuild/${name}@${version}: ` +
        `expected ${lockEntry.integrity}, got ${actualIntegrity}`,
      )
    }
    await safeExtractTar(archiveBytes, directory)
    const binary = join(directory, 'package', executable)
    // Re-check containment through realpath so no symlink or junction can point
    // the copied binary outside the isolated staging directory.
    const rootReal = await realpath(directory)
    const binaryReal = await realpath(binary)
    if (binaryReal !== rootReal && !binaryReal.startsWith(rootReal + sep)) {
      throw new Error(`Extracted esbuild binary escapes staging directory: ${binary}`)
    }
    const metadata = await stat(binaryReal)
    if (!metadata.isFile()) throw new Error(`Extracted esbuild binary is not a regular file: ${binary}`)
    return await cpToStableTemp(binaryReal, name)
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
  // Fast path: an already-prepared sidecar of the pinned version is reused,
  // avoiding the copy + version exec on every dev start.
  if (existsSync(destination) && canExecuteTarget(target)) {
    try {
      const existing = execFileSync(destination, ['--version'], { encoding: 'utf8', windowsHide: true }).trim()
      if (existing === version) {
        console.log(`Reusing prepared esbuild ${version} for ${target}`)
        if (downloaded) await rm(resolve(source, '..'), { recursive: true, force: true })
        return
      }
    } catch {
      // fall through and re-prepare
    }
  }
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

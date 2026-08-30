import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { supportedReleaseTargets } from './release-smoke-lib.mjs'

const [platform, arch, outputArg = 'artifacts'] = process.argv.slice(2)
const target = `${platform}-${arch}`
if (!supportedReleaseTargets.includes(target)) {
  throw new Error(`Unsupported updater invalid-install fixture target: ${target}`)
}

function writeOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0') + '\0'
  header.write(encoded, offset, length, 'ascii')
}

function createTarWithoutAppImage() {
  const body = Buffer.from('WPS Agent Editor signed invalid-install fixture\n', 'utf8')
  const header = Buffer.alloc(512)
  header.write('invalid-install-fixture.txt', 0, 100, 'ascii')
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, body.length)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = header.reduce((total, byte) => total + byte, 0)
  const checksumText = checksum.toString(8).padStart(6, '0') + '\0 '
  header.write(checksumText, 148, 8, 'ascii')
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512)
  return Buffer.concat([header, body, padding, Buffer.alloc(1024)])
}

const payload = platform === 'linux'
  ? gzipSync(createTarWithoutAppImage(), { level: 9, mtime: 0 })
  : Buffer.from(`WPS Agent Editor signed non-installable updater fixture for ${target}\n`, 'utf8')
const outputDirectory = resolve(outputArg)
const outputPath = resolve(outputDirectory, `updater-invalid-install-${target}.bin`)
await mkdir(outputDirectory, { recursive: true })
await writeFile(outputPath, payload, { flag: 'w' })
console.log(`Created signed invalid-install fixture: ${outputPath} (${payload.length} bytes)`)

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const output = resolve(process.argv[2] || 'src-tauri/tauri.unsigned.conf.json')
const target = process.env.WAE_BUILD_TARGET?.trim()
const config = {
  bundle: {
    createUpdaterArtifacts: false,
  },
  plugins: {
    updater: {
      endpoints: [],
    },
  },
}

if (target === 'x86_64-apple-darwin' || target === 'aarch64-apple-darwin') {
  config.bundle.macOS = {
    minimumSystemVersion: target === 'x86_64-apple-darwin' ? '10.15' : '11.0',
    signingIdentity: null,
  }
}

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`)
console.log(`Wrote unsigned Tauri configuration to ${output}`)

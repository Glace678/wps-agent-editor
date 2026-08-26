/**
 * Launch the built app briefly, list files via IPC, open a docx, capture console.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = require('electron')

const sampleDoc =
  [
    path.join(os.homedir(), 'Desktop', '12122.docx'),
    path.join(os.homedir(), 'OneDrive', 'Desktop', '论文.docx'),
  ].find((p) => fs.existsSync(p))

if (!sampleDoc) {
  console.error('No sample docx found')
  process.exit(1)
}

console.log('sample', sampleDoc)
console.log('electron', electronPath)

// Use packaged app path or electron with out/
const appPath = root
const child = spawn(electronPath, [appPath, '--smoke-test', sampleDoc], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    SMOKE_TEST_FILE: sampleDoc,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let out = ''
const onData = (buf) => {
  const s = buf.toString()
  out += s
  process.stdout.write(s)
}
child.stdout.on('data', onData)
child.stderr.on('data', onData)

const timer = setTimeout(() => {
  console.log('\n--- timeout, killing ---')
  child.kill()
}, 15000)

child.on('exit', (code) => {
  clearTimeout(timer)
  console.log('exit', code)
  // summary
  for (const key of [
    'LightweightOffice',
    'WordEditor',
    'ExcelEditor',
    'FileManager',
    'error',
    'Error',
    '暂不支持',
    '无法加载',
    'getDocKind',
  ]) {
    if (out.includes(key)) console.log('log contains:', key)
  }
})

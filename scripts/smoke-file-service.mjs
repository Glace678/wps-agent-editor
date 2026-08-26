/**
 * Smoke-test file listing + type detection without full Electron UI.
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Inline the same logic as file.service.ts (compiled-equivalent)
const SUPPORTED_EXTENSIONS = new Set([
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.pdf', '.txt', '.md', '.csv', '.odt', '.ods',
])

function getDocKind(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  if (['docx', 'doc', 'odt'].includes(ext)) return 'word'
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'excel'
  if (ext === 'pdf') return 'pdf'
  if (['txt', 'md'].includes(ext)) return 'text'
  return 'unknown'
}

function getFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (['.docx', '.doc', '.odt', '.txt', '.md'].includes(ext)) return 'word'
  if (['.xlsx', '.xls', '.ods', '.csv'].includes(ext)) return 'cell'
  if (['.pptx', '.ppt'].includes(ext)) return 'slide'
  if (ext === '.pdf') return 'pdf'
  return 'unknown'
}

async function listDirectory(dirPath) {
  const normalized = path.normalize(dirPath)
  const entries = await fs.readdir(normalized, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const fullPath = path.join(normalized, entry.name)
    try {
      const stat = await fs.stat(fullPath)
      const ext = entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase()
      if (entry.isDirectory() || SUPPORTED_EXTENSIONS.has(ext)) {
        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          extension: ext,
          kind: entry.isDirectory() ? 'dir' : getDocKind(fullPath),
          fileType: entry.isDirectory() ? 'dir' : getFileType(fullPath),
          size: stat.size,
        })
      }
    } catch (e) {
      results.push({ name: entry.name, error: e.code || e.message })
    }
  }
  return results
}

const dirs = [
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'OneDrive', 'Desktop'),
]

for (const dir of dirs) {
  console.log('\n====', dir)
  try {
    const list = await listDirectory(dir)
    const files = list.filter((x) => !x.isDirectory && !x.error)
    const skipped = list.filter((x) => x.error)
    console.log('files', files.length, 'skipped', skipped.length)
    for (const f of files.slice(0, 12)) {
      console.log(`  ${f.extension.padEnd(6)} kind=${f.kind.padEnd(8)} type=${f.fileType.padEnd(6)} ${f.name}`)
    }
    if (skipped.length) console.log('skipped samples', skipped.slice(0, 5))

    // try reading first office file as base64 like LW handler
    const office = files.find((f) => ['.docx', '.xlsx'].includes(f.extension))
    if (office) {
      const buf = await fs.readFile(office.path)
      console.log('read ok', office.name, 'bytes', buf.length, 'b64len', buf.toString('base64').length)
      // magic
      console.log('magic', [...buf.subarray(0, 4)])
    }
  } catch (e) {
    console.log('ERR', e.message)
  }
}

// xlsx package smoke
try {
  const XLSX = require('xlsx')
  const sampleXlsx = path.join(os.homedir(), 'Desktop')
  const entries = await fs.readdir(sampleXlsx)
  const x = entries.find((n) => n.toLowerCase().endsWith('.xlsx'))
  if (x) {
    const wb = XLSX.readFile(path.join(sampleXlsx, x))
    console.log('\nxlsx parse ok', x, 'sheets', wb.SheetNames)
  } else {
    console.log('\nno xlsx on Desktop for parse test')
  }
} catch (e) {
  console.log('xlsx err', e.message)
}

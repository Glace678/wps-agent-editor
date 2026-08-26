import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Mirror getDocKind
function getDocKind(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  if (['docx', 'doc', 'odt'].includes(ext)) return 'word'
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'excel'
  if (ext === 'pdf') return 'pdf'
  if (['txt', 'md'].includes(ext)) return 'text'
  return 'unknown'
}

function getDocKindFixed(filePath) {
  const name = filePath.split(/[/\\]/).pop() || ''
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (['docx', 'doc', 'odt'].includes(ext)) return 'word'
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'excel'
  if (ext === 'pdf') return 'pdf'
  if (['txt', 'md'].includes(ext)) return 'text'
  return 'unknown'
}

const samples = [
  path.join(os.homedir(), 'Desktop', '12122.docx'),
  path.join(os.homedir(), 'OneDrive', 'Desktop', '论文.docx'),
  'C:\\Users\\name.with.dots\\report.xlsx',
  'C:\\foo\\bar\\file.docx',
  '\\\\?\\C:\\Users\\test\\a.docx',
]

console.log('--- getDocKind comparison ---')
for (const p of samples) {
  console.log({
    path: p,
    old: getDocKind(p),
    fixed: getDocKindFixed(p),
  })
}

const jsPath = path.join(root, 'out/renderer/assets/index-C40mjhgw.js')
const js = fs.readFileSync(jsPath, 'utf8')
console.log('--- bundle checks ---')
console.log({
  hasGetDocKind: js.includes('getDocKind'),
  hasUnsupported: js.includes('暂不支持此格式'),
  hasSuperDoc: js.includes('SuperDoc'),
  hasWordEditor: js.includes('WordEditor') || js.includes('加载 Word'),
  hasExcelEditor: js.includes('加载表格'),
  sizeMB: +(fs.statSync(jsPath).size / 1024 / 1024).toFixed(2),
})

const assets = fs.readdirSync(path.join(root, 'out/renderer/assets'))
console.log('assets', assets)

// Check package.json in asar main vs out
const mainJs = fs.readFileSync(path.join(root, 'out/main/main.js'), 'utf8')
const setMatch = mainJs.match(/SUPPORTED_EXTENSIONS =[\s\S]*?new Set\(\[([\s\S]*?)\]\)/)
console.log('supported set snippet:', setMatch?.[1]?.replace(/\s+/g, ' ').trim())

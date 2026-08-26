/**
 * Prototype: pure-JS .doc text extraction (word-extractor style FIB/piece table)
 */
import CFB from 'cfb'
import fs from 'fs'
import path from 'path'
import JSZip from 'jszip'

function readU32(buf, off) {
  return buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)
}
function readU16(buf, off) {
  return buf[off] | (buf[off + 1] << 8)
}

function binaryToUnicode(bytes) {
  // CP1252-ish specials for common Word binary ranges; rest via latin1
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if (c === 0x82) out += '\u201A'
    else if (c === 0x84) out += '\u201E'
    else if (c === 0x85) out += '\u2026'
    else if (c === 0x91) out += '\u2018'
    else if (c === 0x92) out += '\u2019'
    else if (c === 0x93) out += '\u201C'
    else if (c === 0x94) out += '\u201D'
    else if (c === 0x96) out += '\u2013'
    else if (c === 0x97) out += '\u2014'
    else out += String.fromCharCode(c)
  }
  return out
}

function cleanText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/\x07/g, '\t')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractPieces(wordDoc, tableBuf) {
  const pieces = []
  let pos = readU32(wordDoc, 0x01a2) // fcClx

  // skip grpprl blocks (flag 1)
  while (pos < tableBuf.length) {
    const flag = tableBuf[pos]
    if (flag !== 1) break
    pos += 1
    const skip = readU16(tableBuf, pos)
    pos += 2 + skip
  }

  const flag = tableBuf[pos]
  pos += 1
  if (flag !== 2) throw new Error(`Invalid piece table flag: ${flag}`)

  const pieceTableSize = readU32(tableBuf, pos)
  pos += 4
  const pieceCount = (pieceTableSize - 4) / 12
  if (!Number.isInteger(pieceCount) || pieceCount <= 0 || pieceCount > 100000) {
    throw new Error(`Invalid piece count: ${pieceCount}`)
  }

  let startCp = 0
  for (let x = 0; x < pieceCount; x++) {
    const offset = pos + (pieceCount + 1) * 4 + x * 8 + 2
    let startFilePos = readU32(tableBuf, offset)
    let unicode = false
    if ((startFilePos & 0x40000000) === 0) {
      unicode = true
    } else {
      startFilePos = Math.floor((startFilePos & ~0x40000000) / 2)
    }
    const lStart = readU32(tableBuf, pos + x * 4)
    const lEnd = readU32(tableBuf, pos + (x + 1) * 4)
    const cpLen = lEnd - lStart
    const bpc = unicode ? 2 : 1
    const size = cpLen * bpc
    const slice = wordDoc.subarray(startFilePos, startFilePos + size)
    let text
    if (unicode) {
      text = Buffer.from(slice).toString('utf16le')
    } else {
      text = binaryToUnicode(slice)
    }
    pieces.push({ startCp, endCp: startCp + text.length, text })
    startCp += text.length
  }
  return pieces
}

function extractDocText(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  // ZIP magic = already docx misnamed
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    return { kind: 'docx', text: null }
  }
  // CFB magic
  if (!(u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0)) {
    throw new Error('不是有效的 .doc（OLE）文件')
  }

  const cfb = CFB.read(u8, { type: 'array' })
  const wdEntry = CFB.find(cfb, 'WordDocument')
  if (!wdEntry?.content) throw new Error('缺少 WordDocument 流')
  const wordDoc = wdEntry.content instanceof Uint8Array
    ? wdEntry.content
    : new Uint8Array(wdEntry.content)

  const magic = readU16(wordDoc, 0)
  if (magic !== 0xa5ec) throw new Error(`无效 Word 魔数: 0x${magic.toString(16)}`)

  const flags = readU16(wordDoc, 0x0a)
  const tableName = (flags & 0x0200) !== 0 ? '1Table' : '0Table'
  const tableEntry = CFB.find(cfb, tableName)
  if (!tableEntry?.content) throw new Error(`缺少表流 ${tableName}`)
  const tableBuf = tableEntry.content instanceof Uint8Array
    ? tableEntry.content
    : new Uint8Array(tableEntry.content)

  const ccpText = readU32(wordDoc, 0x004c)
  const pieces = extractPieces(wordDoc, tableBuf)

  // body text = first ccpText code units
  let remaining = ccpText
  let body = ''
  for (const piece of pieces) {
    if (remaining <= 0) break
    const take = Math.min(remaining, piece.text.length)
    body += piece.text.slice(0, take)
    remaining -= take
  }

  return { kind: 'doc', text: cleanText(body), ccpText, pieceCount: pieces.length }
}

function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function textToDocxBuffer(text) {
  const paragraphs = text.split(/\n/).map((line) => {
    if (!line) {
      return '<w:p><w:pPr/><w:r><w:t></w:t></w:r></w:p>'
    }
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
  })

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.folder('_rels').file('.rels', rels)
  zip.folder('word').file('document.xml', documentXml)
  zip.folder('word').folder('_rels').file('document.xml.rels', docRels)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

const p = process.argv[2]
if (!p) throw new Error('Usage: node scripts/test-doc-extract.mjs <input.doc> [output.docx]')
const buf = fs.readFileSync(p)
const r = extractDocText(buf)
console.log({ kind: r.kind, ccpText: r.ccpText, pieceCount: r.pieceCount, textLen: r.text?.length })
const docx = await textToDocxBuffer(r.text || '')
console.log('docx bytes', docx.length)
if (process.argv[3]) {
  fs.writeFileSync(process.argv[3], docx)
  console.log('wrote converted document')
}

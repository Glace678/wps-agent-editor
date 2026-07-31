/**
 * 纯 JS 兼容旧版 Word 二进制 .doc（OLE/CFB）
 * - 不调用本机 Word / WPS / LibreOffice
 * - 解析 piece table 提取正文，再生成最小 OOXML .docx 供 SuperDoc 编辑
 */
import CFB from 'cfb'
import JSZip from 'jszip'
import { getExtension } from './file-io'

function readU16(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8)
}

function readU32(buf: Uint8Array, off: number): number {
  return (
    (buf[off]! |
      (buf[off + 1]! << 8) |
      (buf[off + 2]! << 16) |
      (buf[off + 3]! << 24)) >>>
    0
  )
}

function isZipDocx(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function isOleDoc(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  )
}

function decodeAnsiWordBytes(bytes: Uint8Array): string {
  // 中文 Word 常见 CP936；Chromium TextDecoder 支持 gbk / gb18030
  try {
    return new TextDecoder('gbk').decode(bytes)
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes)
    } catch {
      let out = ''
      for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i]!
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
  }
}

function decodeUtf16Le(bytes: Uint8Array): string {
  // 保证偶数字节
  const even = bytes.length & 1 ? bytes.subarray(0, bytes.length - 1) : bytes
  return new TextDecoder('utf-16le').decode(even)
}

function cleanWordText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x07/g, '\t')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    // 常见域/嵌入对象残留
    .replace(/\bEMBED\s+\S+/gi, '')
    .replace(/\bHYPERLINK\b[^\n]*/gi, '')
    .replace(/\bFORMTEXT\b/gi, '')
    .replace(/\bXE\b[^\n]*/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface Piece {
  text: string
}

/** 从 table 流解析 piece table（MS-DOC CLX / Pcdt） */
function extractPieces(wordDoc: Uint8Array, tableBuf: Uint8Array): Piece[] {
  let pos = readU32(wordDoc, 0x01a2) // fcClx
  if (pos >= tableBuf.length) {
    throw new Error('fcClx 越界，无法解析 piece table')
  }

  // 跳过 grpprl（flag=1）
  while (pos < tableBuf.length) {
    const flag = tableBuf[pos]!
    if (flag !== 1) break
    pos += 1
    if (pos + 2 > tableBuf.length) throw new Error('piece table 截断')
    const skip = readU16(tableBuf, pos)
    pos += 2 + skip
  }

  if (pos >= tableBuf.length || tableBuf[pos] !== 2) {
    throw new Error('piece table 标志无效')
  }
  pos += 1

  const pieceTableSize = readU32(tableBuf, pos)
  pos += 4
  const pieceCount = (pieceTableSize - 4) / 12
  if (!Number.isInteger(pieceCount) || pieceCount <= 0 || pieceCount > 200000) {
    throw new Error(`piece 数量异常: ${pieceCount}`)
  }

  const pieces: Piece[] = []
  for (let x = 0; x < pieceCount; x++) {
    const pcdOffset = pos + (pieceCount + 1) * 4 + x * 8 + 2
    if (pcdOffset + 4 > tableBuf.length) throw new Error('PCD 越界')

    let startFilePos = readU32(tableBuf, pcdOffset)
    let unicode = false
    if ((startFilePos & 0x40000000) === 0) {
      unicode = true
    } else {
      startFilePos = Math.floor((startFilePos & ~0x40000000) / 2)
    }

    const lStart = readU32(tableBuf, pos + x * 4)
    const lEnd = readU32(tableBuf, pos + (x + 1) * 4)
    const cpLen = lEnd - lStart
    if (cpLen < 0 || cpLen > 50_000_000) throw new Error('piece 长度异常')

    const bpc = unicode ? 2 : 1
    const size = cpLen * bpc
    if (startFilePos < 0 || startFilePos + size > wordDoc.length) {
      // 容错：截断到流末尾
      const available = Math.max(0, wordDoc.length - startFilePos)
      const slice = wordDoc.subarray(startFilePos, startFilePos + available)
      const text = unicode ? decodeUtf16Le(slice) : decodeAnsiWordBytes(slice)
      pieces.push({ text })
      continue
    }

    const slice = wordDoc.subarray(startFilePos, startFilePos + size)
    const text = unicode ? decodeUtf16Le(slice) : decodeAnsiWordBytes(slice)
    pieces.push({ text })
  }
  return pieces
}

function extractOleDocBodyText(bytes: Uint8Array): string {
  const cfb = CFB.read(bytes, { type: 'array' })
  const wdEntry = CFB.find(cfb, 'WordDocument')
  if (!wdEntry?.content) throw new Error('不是有效的 Word 97-2003 文档（缺少 WordDocument）')

  const wordDoc =
    wdEntry.content instanceof Uint8Array
      ? wdEntry.content
      : new Uint8Array(wdEntry.content as ArrayLike<number>)

  if (readU16(wordDoc, 0) !== 0xa5ec) {
    throw new Error('WordDocument 魔数不正确')
  }

  const flags = readU16(wordDoc, 0x0a)
  const tableName = (flags & 0x0200) !== 0 ? '1Table' : '0Table'
  const tableEntry = CFB.find(cfb, tableName)
  if (!tableEntry?.content) throw new Error(`缺少 ${tableName} 流`)

  const tableBuf =
    tableEntry.content instanceof Uint8Array
      ? tableEntry.content
      : new Uint8Array(tableEntry.content as ArrayLike<number>)

  // FibRgLw97.ccpText（与经典 FIB 布局固定偏移兼容）
  const ccpText = readU32(wordDoc, 0x004c)
  const pieces = extractPieces(wordDoc, tableBuf)

  let remaining = ccpText > 0 ? ccpText : Number.POSITIVE_INFINITY
  let body = ''
  for (const piece of pieces) {
    if (remaining <= 0) break
    if (remaining === Number.POSITIVE_INFINITY) {
      body += piece.text
      continue
    }
    const take = Math.min(remaining, piece.text.length)
    body += piece.text.slice(0, take)
    remaining -= take
  }

  // 若 ccpText 偏移在该文件上不可靠，退回全部 piece 文本
  const cleaned = cleanWordText(body)
  if (cleaned.length >= 8) return cleaned

  const fallback = cleanWordText(pieces.map((p) => p.text).join(''))
  if (!fallback) throw new Error('未能从 .doc 中提取到可读文本')
  return fallback
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 将纯文本打包为最小合法 docx（OOXML） */
export async function textToDocxBytes(text: string): Promise<Uint8Array> {
  const paragraphs = (text.length ? text.split('\n') : ['']).map((line) => {
    if (!line) return '<w:p/>'
    return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
  })

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  mc:Ignorable="w14 w15 wp14">
  <w:body>
    ${paragraphs.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
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
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`

  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.folder('_rels')!.file('.rels', rels)
  const word = zip.folder('word')!
  word.file('document.xml', documentXml)
  word.folder('_rels')!.file('document.xml.rels', docRels)

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export type PrepareWordResult = {
  /** 始终为可被 SuperDoc 打开的 docx 字节 */
  bytes: Uint8Array
  /** 展示用文件名（.doc 会变成 .docx） */
  displayName: string
  /** 是否由旧版 .doc 兼容层生成 */
  fromLegacyDoc: boolean
  /** 兼容提示 */
  notice?: string
}

/**
 * 将任意 Word 文件字节准备为 SuperDoc 可编辑的 docx
 */
export async function prepareWordBytes(
  filePath: string,
  buffer: ArrayBuffer,
): Promise<PrepareWordResult> {
  const rawName = filePath.split(/[/\\]/).pop() || 'document.docx'
  const ext = getExtension(filePath)
  const bytes = new Uint8Array(buffer)

  // 已是 OOXML（含误用 .doc 扩展名的 docx）
  if (isZipDocx(bytes) || ext === 'docx' || ext === 'odt') {
    // odt 仍交给 SuperDoc 尝试；失败由编辑器 onException 处理
    return {
      bytes,
      displayName: ext === 'doc' ? rawName.replace(/\.doc$/i, '.docx') : rawName,
      fromLegacyDoc: false,
    }
  }

  if (ext === 'doc' || isOleDoc(bytes)) {
    const text = extractOleDocBodyText(bytes)
    const docxBytes = await textToDocxBytes(text)
    return {
      bytes: docxBytes,
      displayName: rawName.replace(/\.doc$/i, '.docx'),
      fromLegacyDoc: true,
      notice:
        '已用内置兼容层打开旧版 .doc（保留正文文本）。复杂排版/图片可能简化；保存将写入 .docx。',
    }
  }

  // 其它情况原样交给 SuperDoc
  return { bytes, displayName: rawName, fromLegacyDoc: false }
}

/** .doc 保存时应写到的 .docx 路径 */
export function resolveSavePathForWord(filePath: string): string {
  if (getExtension(filePath) === 'doc') {
    return filePath.replace(/\.doc$/i, '.docx')
  }
  return filePath
}

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

function extractOleDocRawText(bytes: Uint8Array): string {
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
  if (body.trim().length >= 8) return body

  const fallback = pieces.map((p) => p.text).join('')
  if (!fallback.trim()) throw new Error('未能从 .doc 中提取到可读文本')
  return fallback
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// 表格结构还原
//
// Word 97 二进制正文流以段落标记组织表格：
//   - 单元格文本以 0x07（cell mark）结尾；单元格的最后一段若为空，
//     该空段的 0x07 就是 cell mark，随后紧跟一个空 0x07 作为行标记（row mark）
//   - 单元格内多个段落使用普通的 \r 段落标记
//   - 表格行结束于 row mark；正文段落（\r 结尾且不属于任何单元格）结束整个表格
// 据此用「前瞻 + 紧邻标记」启发式把流重建为段落/表格块：
//   - 段落 run 只有紧跟在 cell/row 标记之后且含有非空文本，才并入后续单元格
//     （对应章节标题 + 内容同居一格的实验报告模板）
//   - 全空的段落 run 是表格之间的正文分隔，保持为正文
// ---------------------------------------------------------------------------

type DocBlock =
  | { kind: 'para'; text: string }
  | { kind: 'table'; rows: string[][][] }

interface RawUnit {
  text: string
  term: '\r' | 'cell' | 'ff'
}

function splitRawUnits(raw: string): RawUnit[] {
  const units: RawUnit[] = []
  let buf = ''
  for (const ch of raw) {
    if (ch === '\r') {
      units.push({ text: buf, term: '\r' })
      buf = ''
    } else if (ch === '\x07') {
      units.push({ text: buf, term: 'cell' })
      buf = ''
    } else if (ch === '\x0c') {
      units.push({ text: buf, term: 'ff' })
      buf = ''
    } else if (ch === '\x0b') {
      buf += '\n' // Shift+Enter 软换行保留为段内换行
    } else {
      buf += ch
    }
  }
  if (buf) units.push({ text: buf, term: '\r' })
  return units
}

function cleanParagraphText(text: string): string {
  return text
    .split('\n')
    .map((line) => line
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
      .replace(/\bEMBED\s+\S+/gi, '')
      .replace(/\bHYPERLINK\b/gi, '')
      .replace(/\bFORMTEXT\b/gi, '')
      .replace(/\bXE\b/gi, '')
      .replace(/[ \t]+$/g, ''))
    .join('\n')
}

export function buildDocBlocks(raw: string): DocBlock[] {
  const units = splitRawUnits(raw)
  const blocks: DocBlock[] = []
  let rows: string[][][] = []
  let row: string[][] = []
  let pending: string[] = []
  let pendingAttachable = false
  let lastWasMark = false

  const emitBody = (text: string) => {
    const cleaned = cleanParagraphText(text)
    const previous = blocks[blocks.length - 1]
    if (!cleaned.trim() && previous?.kind === 'para' && !previous.text.trim()) return
    blocks.push({ kind: 'para', text: cleaned })
  }
  const flushPending = () => {
    for (const text of pending) emitBody(text)
    pending = []
  }
  const flushRow = () => {
    if (row.length) rows.push(row)
    row = []
  }
  const flushTable = () => {
    flushRow()
    if (rows.length) blocks.push({ kind: 'table', rows })
    rows = []
  }

  for (const unit of units) {
    if (unit.term === 'cell') {
      const attachable = pending.length > 0 && pendingAttachable && pending.some((t) => t.trim())
      if (pending.length > 0 && !attachable) {
        // pending 是正文：正文段落意味着前面的表格已经结束，先落正文再开新行
        flushTable()
        flushPending()
      }
      if (unit.text.trim()) {
        // 非空 cell mark：本段是单元格的最后一段，前面的 run 一并并入
        row.push(attachable ? [...pending, unit.text] : [unit.text])
      } else {
        // 空 cell mark：若前面是可并入的段落 run，它是该单元格的收尾段
        if (attachable) row.push([...pending, ''])
        // 行标记：结束当前行
        flushRow()
      }
      pending = []
      lastWasMark = true
    } else if (unit.term === 'ff') {
      flushTable()
      flushPending()
      if (unit.text.trim()) emitBody(unit.text)
      lastWasMark = false
    } else {
      if (pending.length === 0) pendingAttachable = lastWasMark
      pending.push(unit.text)
      lastWasMark = false
    }
  }
  flushTable()
  flushPending()
  return blocks
}

function paragraphXml(text: string): string {
  if (!text) return '<w:p/>'
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function cellXml(paragraphs: string[], widthTwips: number, span: number): string {
  const lines = paragraphs
    .flatMap((text) => cleanParagraphText(text).split('\n'))
    .map((line) => line.trim() ? line : '')
  while (lines.length && !lines[0]) lines.shift()
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  if (!lines.length) lines.push('')

  const gridSpan = span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''
  return `<w:tc><w:tcPr><w:tcW w:w="${widthTwips}" w:type="dxa"/>${gridSpan}<w:vAlign w:val="center"/></w:tcPr>${lines.map(paragraphXml).join('')}</w:tc>`
}

/**
 * 单元格跨列分配：行内前 k-1 个单元格各占 1 个网格列，最后一个单元格吞并
 * 剩余列。这让「课程名称 | 算法分析与设计(跨 6 列)」与「实验时间 | 2026 |
 * 年 | 4 | 月 | 1 | 日」共享同一列网格——标签列边界逐行对齐，值填满右侧，
 * 与真实 Word 的合并单元格排版一致。
 */
function spansForCells(cellCount: number, columnCount: number): number[] {
  if (cellCount >= columnCount) return Array.from({ length: cellCount }, () => 1)
  const spans = Array.from({ length: cellCount }, () => 1)
  spans[cellCount - 1] = columnCount - (cellCount - 1)
  return spans
}

function tableXml(rows: string[][][]): string {
  const columnCount = Math.max(1, ...rows.map((cells) => cells.length))
  const baseWidth = Math.floor(9026 / columnCount)
  const columnWidths = Array.from(
    { length: columnCount },
    (_, index) => index === columnCount - 1
      ? 9026 - baseWidth * (columnCount - 1)
      : baseWidth,
  )
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
    .join('')

  const rowXml = rows.map((cells) => {
    const spans = spansForCells(cells.length, columnCount)
    const cellsXml = cells
      .map((cell, index) => {
        const start = spans.slice(0, index).reduce((sum, value) => sum + value, 0)
        const width = columnWidths
          .slice(start, start + spans[index])
          .reduce((sum, value) => sum + value, 0)
        return cellXml(cell, width, spans[index])
      })
      .join('')
    return `<w:tr><w:trPr><w:trHeight w:val="397" w:hRule="atLeast"/></w:trPr>${cellsXml}</w:tr>`
  }).join('')

  return `<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="57" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="57" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${columnWidths
    .map((width) => `<w:gridCol w:w="${width}"/>`)
    .join('')}</w:tblGrid>${rowXml}</w:tbl>`
}

/** 表格正上方的短段落按模板标题样式渲染（居中，首个标题加大加粗） */
function coverParagraphXml(text: string, isTitle: boolean): string {
  if (isTitle) {
    return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  }
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function documentXmlForBlocks(blocks: DocBlock[]): string {
  // 标记紧邻表格上方的非空段落（跳过中间空行）为封面/标题组
  const coverIndexes = new Set<number>()
  blocks.forEach((block, index) => {
    if (block.kind !== 'table') return
    const group: number[] = []
    for (let i = index - 1; i >= 0 && i >= index - 6; i--) {
      const previous = blocks[i]
      if (previous.kind !== 'para') break
      if (!previous.text.trim()) {
        if (group.length > 0) break // 标题组已收满，上方空行即边界
        continue // 表格与标题之间的空行
      }
      group.unshift(i)
      if (group.length >= 2) break
    }
    group.forEach((i) => coverIndexes.add(i))
  })

  const body = blocks.map((block, index) => {
    if (block.kind === 'table') {
      // 表格后必须跟一个段落，相邻表格也需要段落分隔
      return `${tableXml(block.rows)}\n    <w:p/>`
    }
    if (coverIndexes.has(index)) {
      // 组内最靠上的一条且足够短 → 标题样式
      const isTitle = !coverIndexes.has(index - 1) && block.text.trim().length <= 10
      return coverParagraphXml(block.text, isTitle)
    }
    return paragraphXml(block.text)
  }).join('\n    ')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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
    ${body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`
}

async function packDocx(documentXml: string): Promise<Uint8Array> {
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

/** 将纯文本打包为最小合法 docx（OOXML） */
export async function textToDocxBytes(text: string): Promise<Uint8Array> {
  const blocks: DocBlock[] = text.split('\n').map((line) => ({ kind: 'para' as const, text: line }))
  return packDocx(documentXmlForBlocks(blocks))
}

/** 将段落/表格块打包为 docx（OOXML），保留表格结构 */
export async function blocksToDocxBytes(blocks: DocBlock[]): Promise<Uint8Array> {
  return packDocx(documentXmlForBlocks(blocks))
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
    // 表格结构还原：piece table 文本流中的 0x07 单元格标记重建为 OOXML 表格
    const raw = extractOleDocRawText(bytes)
    const blocks = buildDocBlocks(raw)
    const hasTable = blocks.some((block) => block.kind === 'table')
    const docxBytes = await blocksToDocxBytes(blocks)
    return {
      bytes: docxBytes,
      displayName: rawName.replace(/\.doc$/i, '.docx'),
      fromLegacyDoc: true,
      notice: hasTable
        ? '已用内置兼容层打开旧版 .doc（保留正文文本与表格）。复杂排版/图片可能简化；保存将写入 .docx。'
        : '已用内置兼容层打开旧版 .doc（保留正文文本）。复杂排版/图片可能简化；保存将写入 .docx。',
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

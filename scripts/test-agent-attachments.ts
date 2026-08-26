import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import {
  addAttachmentContextToMessages,
  buildAttachmentContext,
} from '../electron/services/agent-attachment.service'
import type { AgentAttachment } from '../src/types/agent'
import { selectAgentAttachmentPaths } from '../src/lib/agent-attachment-picker'

function attachment(filePath: string): AgentAttachment {
  return { path: filePath, name: path.basename(filePath), source: 'picker' }
}

function createMinimalPdf(text: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${34 + text.length} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'ascii'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}

async function main(): Promise<void> {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-agent-attachments-'))
  try {
  const textPath = path.join(fixtureDirectory, 'request.md')
  await fs.writeFile(textPath, '# Attachment fixture\nPlease summarize the quarterly data.', 'utf8')

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['Region', 'Revenue'], ['East', 4200]]),
    'Quarter 1',
  )
  const spreadsheetPath = path.join(fixtureDirectory, 'quarter.xlsx')
  await fs.writeFile(
    spreadsheetPath,
    XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  )

  const presentation = new JSZip()
  presentation.file(
    'ppt/slides/slide1.xml',
    '<p:sld xmlns:p="p" xmlns:a="a"><a:t>Roadmap milestone</a:t></p:sld>',
  )
  const presentationPath = path.join(fixtureDirectory, 'roadmap.pptx')
  await fs.writeFile(presentationPath, await presentation.generateAsync({ type: 'nodebuffer' }))

  const document = new JSZip()
  document.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`)
  document.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`)
  document.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>Word attachment paragraph</w:t></w:r></w:p></w:body>
    </w:document>`)
  document.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`)
  const documentPath = path.join(fixtureDirectory, 'brief.docx')
  await fs.writeFile(documentPath, await document.generateAsync({ type: 'nodebuffer' }))

  const pdfPath = path.join(fixtureDirectory, 'summary.pdf')
  await fs.writeFile(pdfPath, createMinimalPdf('PDF attachment summary'))

  const context = await buildAttachmentContext([
    attachment(textPath),
    attachment(spreadsheetPath),
    attachment(presentationPath),
    attachment(documentPath),
    attachment(pdfPath),
  ])
  assert.match(context, /Attachment fixture/)
  assert.match(context, /Quarter 1/)
  assert.match(context, /East,4200/)
  assert.match(context, /Roadmap milestone/)
  assert.match(context, /Word attachment paragraph/)
  assert.match(context, /PDF attachment summary/)
  assert.equal(context.includes(fixtureDirectory), false, 'provider context must not contain an absolute local path')
  assert.doesNotMatch(context, /\spath=/, 'provider context must not contain a path attribute')

  const messages = await addAttachmentContextToMessages([{
    role: 'user' as const,
    content: 'Use these files.',
    attachments: [attachment(textPath)],
  }])
  assert.match(messages[0].content, /^Use these files\./)
  assert.match(messages[0].content, /<attachment name="request\.md"/)

  const missingContext = await buildAttachmentContext([
    attachment(path.join(fixtureDirectory, 'missing.txt')),
  ])
  assert.match(missingContext, /status="unavailable"/)

  assert.deepEqual(await selectAgentAttachmentPaths({
    selectAttachments: async () => [textPath, spreadsheetPath],
    selectFile: async () => null,
  }), [textPath, spreadsheetPath])
  assert.deepEqual(await selectAgentAttachmentPaths({
    selectFile: async () => textPath,
  }), [textPath])
  assert.deepEqual(await selectAgentAttachmentPaths({
    selectAttachments: async () => { throw new Error('No IPC handler') },
    selectFile: async () => spreadsheetPath,
  }), [spreadsheetPath])

  console.log('PASS agent attachment text, Word, Excel, PowerPoint, and PDF extraction')
  console.log('PASS attachment context injection and unavailable-file handling')
  console.log('PASS attachment picker uses multi-file API and falls back across stale Electron runtimes')
  } finally {
    await fs.rm(fixtureDirectory, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

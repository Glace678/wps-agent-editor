import crypto from 'node:crypto'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { diffChars } from 'diff'
import { DOMParser, XMLSerializer, type Node as XmlNode } from '@xmldom/xmldom'
import type {
  ArtifactKind,
  ArtifactOperation,
  ExcelArtifactLocation,
} from '../../src/types/artifact-review'

interface DifferenceObservation {
  key: string
  scope: 'block' | 'object' | 'cell' | 'sheet' | 'page' | 'slide' | 'code'
  index: number
  secondary?: number
  name?: string
  beforeText?: string
  afterText?: string
  originalStart?: number
  originalEnd?: number
  candidateStart?: number
  candidateEnd?: number
}

export interface ArtifactDifferenceReport {
  kind: ArtifactKind
  sourceHash: string
  candidateHash: string
  observations: DifferenceObservation[]
  operationMatches: Record<string, string[]>
}

function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (typeof current === 'bigint') return current.toString()
    if (current instanceof Uint8Array) return Buffer.from(current).toString('base64')
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return Object.fromEntries(Object.entries(current as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    }
    return current
  })
}

function assertContainerSignature(kind: ArtifactKind, data: Buffer): void {
  if (kind === 'code') {
    try {
      const body = data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? data.subarray(3) : data
      new TextDecoder('utf-8', { fatal: true }).decode(body)
    } catch {
      throw new Error('ARTIFACT_CODE_UTF8_INVALID')
    }
    return
  }
  if (kind === 'pdf') {
    if (data.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('ARTIFACT_PDF_INVALID')
    return
  }
  if (data.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new Error(`ARTIFACT_${kind.toUpperCase()}_CONTAINER_INVALID`)
  }
}

function decodeCodeArtifact(data: Buffer): string {
  const body = data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? data.subarray(3) : data
  return new TextDecoder('utf-8', { fatal: true }).decode(body)
}

function codeObservations(source: Buffer, candidate: Buffer): DifferenceObservation[] {
  const before = decodeCodeArtifact(source)
  const after = decodeCodeArtifact(candidate)
  const observations: DifferenceObservation[] = []
  let originalOffset = 0
  let candidateOffset = 0
  let hunk: DifferenceObservation | null = null
  const flush = () => {
    if (!hunk) return
    hunk.originalEnd = originalOffset
    hunk.candidateEnd = candidateOffset
    observations.push(hunk)
    hunk = null
  }
  const changes = diffChars(before, after)
  for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
    const change = changes[changeIndex]
    if (!change.added && !change.removed) {
      const bridgesAdjacentChanges = Boolean(
        hunk
        && change.value.length <= 16
        && changes[changeIndex + 1]
        && (changes[changeIndex + 1].added || changes[changeIndex + 1].removed),
      )
      if (bridgesAdjacentChanges && hunk) {
        hunk.beforeText = `${hunk.beforeText ?? ''}${change.value}`
        hunk.afterText = `${hunk.afterText ?? ''}${change.value}`
        originalOffset += change.value.length
        candidateOffset += change.value.length
        continue
      }
      flush()
      originalOffset += change.value.length
      candidateOffset += change.value.length
      continue
    }
    if (!hunk) {
      hunk = {
        key: `code:hunk:${observations.length}`,
        scope: 'code',
        index: originalOffset,
        secondary: candidateOffset,
        beforeText: '',
        afterText: '',
        originalStart: originalOffset,
        originalEnd: originalOffset,
        candidateStart: candidateOffset,
        candidateEnd: candidateOffset,
      }
    }
    if (change.removed) {
      hunk.beforeText = `${hunk.beforeText ?? ''}${change.value}`
      originalOffset += change.value.length
    } else if (change.added) {
      hunk.afterText = `${hunk.afterText ?? ''}${change.value}`
      candidateOffset += change.value.length
    }
  }
  flush()
  return observations
}

function textContent(node: XmlNode): string {
  let result = ''
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 || child.nodeType === 4) result += child.nodeValue ?? ''
    else result += textContent(child)
  }
  return result
}

async function wordObservations(source: Buffer, candidate: Buffer): Promise<DifferenceObservation[]> {
  const [sourceZip, candidateZip] = await Promise.all([JSZip.loadAsync(source), JSZip.loadAsync(candidate)])
  const sourceDocument = await sourceZip.file('word/document.xml')?.async('string')
  const candidateDocument = await candidateZip.file('word/document.xml')?.async('string')
  if (!sourceDocument || !candidateDocument) throw new Error('ARTIFACT_WORD_DOCUMENT_XML_MISSING')
  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  const readBlocks = (xml: string) => {
    const document = parser.parseFromString(xml, 'application/xml')
    const nodes = Array.from(document.getElementsByTagName('w:p'))
    return nodes.map((node) => ({ text: textContent(node), signature: sha256(serializer.serializeToString(node)) }))
  }
  const before = readBlocks(sourceDocument)
  const after = readBlocks(candidateDocument)
  const observations: DifferenceObservation[] = []

  // LCS prevents a paragraph insertion from making every following paragraph look changed.
  const rows = before.length + 1
  const columns = after.length + 1
  const lcs = new Uint32Array(rows * columns)
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      const index = left * columns + right
      lcs[index] = before[left].signature === after[right].signature
        ? 1 + lcs[(left + 1) * columns + right + 1]
        : Math.max(lcs[(left + 1) * columns + right], lcs[left * columns + right + 1])
    }
  }
  let left = 0
  let right = 0
  let hunk = 0
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left].signature === after[right].signature) {
      left += 1
      right += 1
      continue
    }
    const startLeft = left
    const startRight = right
    const removed: string[] = []
    const added: string[] = []
    while (left < before.length || right < after.length) {
      if (left < before.length && right < after.length && before[left].signature === after[right].signature) break
      const moveRight = right < after.length
        && (left >= before.length || lcs[left * columns + right + 1] >= lcs[(left + 1) * columns + right])
      if (moveRight) added.push(after[right++].text)
      else if (left < before.length) removed.push(before[left++].text)
    }
    observations.push({
      key: `word:block:${hunk++}`,
      scope: 'block',
      index: startRight,
      secondary: startLeft,
      beforeText: removed.join('\n'),
      afterText: added.join('\n'),
    })
  }

  const ignored = new Set(['word/document.xml', '[Content_Types].xml'])
  const relevant = (zip: JSZip) => Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && (
      /^word\/(header|footer|comments|footnotes|endnotes)\d*\.xml$/i.test(name)
      || /^word\/(media|embeddings)\//i.test(name)
      || name === 'word/settings.xml'
      || name === 'word/styles.xml'
    ))
  const entries = new Set([...relevant(sourceZip), ...relevant(candidateZip)])
  for (const name of entries) {
    if (ignored.has(name)) continue
    const [a, b] = await Promise.all([
      sourceZip.file(name)?.async('nodebuffer'),
      candidateZip.file(name)?.async('nodebuffer'),
    ])
    if (a && b && a.equals(b)) continue
    observations.push({ key: `word:object:${name}`, scope: 'object', index: 0, name })
  }
  return observations
}

interface WorkbookSnapshot {
  cells: Map<string, string>
  sheets: string[]
  structures: Map<string, string>
}

async function workbookSnapshot(data: Buffer): Promise<WorkbookSnapshot> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(data as unknown as ExcelJS.Buffer)
  const cells = new Map<string, string>()
  const structures = new Map<string, string>()
  const sheets: string[] = []
  workbook.eachSheet((sheet) => {
    sheets.push(sheet.name)
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cells.set(`${sheet.name}!${cell.address}`, stableValue({
          value: cell.value,
          formula: cell.formula,
          style: cell.style,
          numFmt: cell.numFmt,
          merge: cell.isMerged ? cell.master.address : undefined,
        }))
      })
    })
    const model = sheet.model as unknown as { merges?: string[]; rowBreaks?: unknown[]; pageSetup?: unknown; properties?: unknown }
    structures.set(sheet.name, stableValue({
      merges: model.merges ?? [],
      rowBreaks: model.rowBreaks ?? [],
      pageSetup: model.pageSetup,
      properties: model.properties,
      images: sheet.getImages().map((image) => ({ imageId: image.imageId, range: image.range })),
    }))
  })
  return { cells, sheets, structures }
}

async function excelObservations(source: Buffer, candidate: Buffer): Promise<DifferenceObservation[]> {
  const [before, after] = await Promise.all([workbookSnapshot(source), workbookSnapshot(candidate)])
  const observations: DifferenceObservation[] = []
  const sheetNames = new Set([...before.sheets, ...after.sheets])
  for (const sheetName of sheetNames) {
    if (!before.sheets.includes(sheetName) || !after.sheets.includes(sheetName)
      || before.structures.get(sheetName) !== after.structures.get(sheetName)) {
      observations.push({ key: `excel:sheet:${sheetName}`, scope: 'sheet', index: after.sheets.indexOf(sheetName), name: sheetName })
    }
  }
  const addresses = new Set([...before.cells.keys(), ...after.cells.keys()])
  for (const key of addresses) {
    if (before.cells.get(key) === after.cells.get(key)) continue
    const separator = key.lastIndexOf('!')
    const sheetName = key.slice(0, separator)
    const address = key.slice(separator + 1)
    const row = Number(address.match(/\d+/)?.[0] ?? 0)
    observations.push({ key: `excel:cell:${key}`, scope: 'cell', index: after.sheets.indexOf(sheetName), secondary: row, name: key })
  }
  return observations
}

async function pdfPageFingerprints(data: Buffer): Promise<Array<{ text: string; operators: string }>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0])
  const document = await task.promise
  const result: Array<{ text: string; operators: string }> = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const [content, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()])
      const text = content.items.map((item) => 'str' in item ? item.str : '').join('\n')
      result.push({ text: sha256(text), operators: sha256(stableValue({ fnArray: operators.fnArray, argsArray: operators.argsArray })) })
      page.cleanup()
    }
  } finally {
    await document.destroy()
  }
  return result
}

async function pdfObservations(source: Buffer, candidate: Buffer): Promise<DifferenceObservation[]> {
  if (/\/ByteRange\s*\[/i.test(source.toString('latin1')) && !source.equals(candidate)) {
    throw new Error('ARTIFACT_PDF_SIGNATURE_INVALIDATED')
  }
  const [before, after] = await Promise.all([pdfPageFingerprints(source), pdfPageFingerprints(candidate)])
  const observations: DifferenceObservation[] = []
  const count = Math.max(before.length, after.length)
  for (let index = 0; index < count; index += 1) {
    if (before[index]?.text === after[index]?.text && before[index]?.operators === after[index]?.operators) continue
    observations.push({ key: `pdf:page:${index + 1}`, scope: 'page', index: index + 1 })
  }
  return observations
}

async function presentationObservations(source: Buffer, candidate: Buffer): Promise<DifferenceObservation[]> {
  const [before, after] = await Promise.all([JSZip.loadAsync(source), JSZip.loadAsync(candidate)])
  const observations: DifferenceObservation[] = []
  const slideNames = new Set([
    ...Object.keys(before.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)),
    ...Object.keys(after.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)),
  ])
  for (const name of slideNames) {
    const [a, b] = await Promise.all([before.file(name)?.async('nodebuffer'), after.file(name)?.async('nodebuffer')])
    if (a && b && a.equals(b)) continue
    const slideIndex = Math.max(0, Number(name.match(/slide(\d+)\.xml$/i)?.[1] ?? 1) - 1)
    observations.push({ key: `ppt:slide:${slideIndex}`, scope: 'slide', index: slideIndex, name })
  }
  const mediaNames = new Set([
    ...Object.keys(before.files).filter((name) => /^ppt\/media\/.+/i.test(name) && !before.files[name].dir),
    ...Object.keys(after.files).filter((name) => /^ppt\/media\/.+/i.test(name) && !after.files[name].dir),
  ])
  for (const name of mediaNames) {
    const [a, b] = await Promise.all([before.file(name)?.async('nodebuffer'), after.file(name)?.async('nodebuffer')])
    if (a && b && a.equals(b)) continue
    observations.push({ key: `ppt:media:${name}`, scope: 'object', index: 0, name })
  }
  return observations
}

function columnNumber(label: string): number {
  let value = 0
  for (const char of label.toUpperCase()) value = value * 26 + char.charCodeAt(0) - 64
  return value
}

function excelRangeContains(location: ExcelArtifactLocation, sheet: string, address: string): boolean {
  const locationSheet = location.sheetName ?? location.sheetId
  if (locationSheet && locationSheet !== sheet) return false
  const match = location.range.replace(/\$/g, '').match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i)
  const cell = address.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/i)
  if (!match || !cell) return false
  const startColumn = columnNumber(match[1])
  const endColumn = columnNumber(match[3] ?? match[1])
  const startRow = Number(match[2])
  const endRow = Number(match[4] ?? match[2])
  const targetColumn = columnNumber(cell[1])
  const targetRow = Number(cell[2])
  return targetColumn >= Math.min(startColumn, endColumn)
    && targetColumn <= Math.max(startColumn, endColumn)
    && targetRow >= Math.min(startRow, endRow)
    && targetRow <= Math.max(startRow, endRow)
}

function operationMatchesObservation(operation: ArtifactOperation, observation: DifferenceObservation): boolean {
  const location = operation.location
  switch (location.kind) {
    case 'word':
      if (observation.scope === 'object') return ['object', 'page-region', 'format'].includes(operation.visual)
      if (observation.scope !== 'block') return false
      if (location.blockIndex !== undefined) {
        return location.blockIndex === observation.index || location.blockIndex === observation.secondary
      }
      if (location.search) {
        return Boolean(observation.beforeText?.includes(location.search) || observation.afterText?.includes(location.search))
      }
      return Boolean(
        operation.before?.text && observation.beforeText?.includes(operation.before.text)
        || operation.after?.text && observation.afterText?.includes(operation.after.text)
        || location.blockId,
      )
    case 'excel': {
      if (observation.scope === 'sheet') {
        return operation.type === 'structure'
          && (location.sheetName === observation.name || location.sheetIndex === observation.index)
      }
      if (observation.scope !== 'cell' || !observation.name) return false
      const separator = observation.name.lastIndexOf('!')
      return excelRangeContains(location, observation.name.slice(0, separator), observation.name.slice(separator + 1))
    }
    case 'pdf':
      return observation.scope === 'page' && location.pageNumber === observation.index
    case 'presentation':
      if (observation.scope === 'object') return operation.visual === 'object'
      return observation.scope === 'slide' && location.slideIndex === observation.index
    case 'code':
      if (observation.scope !== 'code') return false
      const touches = (start: number, end: number, observedStart?: number, observedEnd?: number) => {
        if (observedStart === undefined || observedEnd === undefined) return false
        if (start === end) return start >= observedStart && start <= observedEnd
        if (observedStart === observedEnd) return observedStart >= start && observedStart <= end
        return Math.max(start, observedStart) < Math.min(end, observedEnd)
      }
      return touches(
        location.originalRange.start.offset,
        location.originalRange.end.offset,
        observation.originalStart,
        observation.originalEnd,
      ) || touches(
        location.candidateRange.start.offset,
        location.candidateRange.end.offset,
        observation.candidateStart,
        observation.candidateEnd,
      )
  }
}

export async function compareArtifactCandidate(
  kind: ArtifactKind,
  source: Buffer,
  candidate: Buffer,
  operations: ArtifactOperation[],
): Promise<ArtifactDifferenceReport> {
  assertContainerSignature(kind, source)
  assertContainerSignature(kind, candidate)
  const sourceHash = sha256(source)
  const candidateHash = sha256(candidate)
  if (sourceHash === candidateHash) throw new Error('ARTIFACT_CANDIDATE_UNCHANGED')

  const observations = kind === 'word'
    ? await wordObservations(source, candidate)
    : kind === 'excel'
      ? await excelObservations(source, candidate)
      : kind === 'pdf'
        ? await pdfObservations(source, candidate)
        : kind === 'presentation'
          ? await presentationObservations(source, candidate)
          : codeObservations(source, candidate)
  if (observations.length === 0) throw new Error('ARTIFACT_DIFFERENCE_NOT_OBSERVED')

  if (kind === 'code') {
    const sourceText = decodeCodeArtifact(source)
    const candidateText = decodeCodeArtifact(candidate)
    const codeOperations = operations.slice().sort((left, right) => {
      if (left.location.kind !== 'code' || right.location.kind !== 'code') return 0
      return left.location.originalRange.start.offset - right.location.originalRange.start.offset
        || left.location.originalRange.end.offset - right.location.originalRange.end.offset
        || left.id.localeCompare(right.id)
    })
    let reconstructed = sourceText
    for (let index = 0; index < codeOperations.length; index += 1) {
      const operation = codeOperations[index]
      if (operation.location.kind !== 'code') throw new Error(`ARTIFACT_LOCATION_KIND_MISMATCH:${operation.id}`)
      const location = operation.location
      if (index > 0) {
        const previous = codeOperations[index - 1]
        if (previous.location.kind === 'code'
          && location.originalRange.start.offset < previous.location.originalRange.end.offset) {
          throw new Error(`ARTIFACT_CODE_RANGE_OVERLAP:${operation.id}`)
        }
      }
      const beforeText = sourceText.slice(location.originalRange.start.offset, location.originalRange.end.offset)
      const afterText = candidateText.slice(location.candidateRange.start.offset, location.candidateRange.end.offset)
      if (sha256(beforeText) !== location.beforeDigest || sha256(afterText) !== location.afterDigest) {
        throw new Error(`ARTIFACT_CODE_DIGEST_MISMATCH:${operation.id}`)
      }
      if (operation.before?.text !== undefined && operation.before.text !== beforeText) {
        throw new Error(`ARTIFACT_CODE_BEFORE_MISMATCH:${operation.id}`)
      }
      if (operation.after?.text !== undefined && operation.after.text !== afterText) {
        throw new Error(`ARTIFACT_CODE_AFTER_MISMATCH:${operation.id}`)
      }
      const contextBefore = sourceText.slice(Math.max(0, location.originalRange.start.offset - 96), location.originalRange.start.offset)
      const contextAfter = sourceText.slice(location.originalRange.end.offset, location.originalRange.end.offset + 96)
      if (location.contextBeforeDigest && sha256(contextBefore) !== location.contextBeforeDigest) {
        throw new Error(`ARTIFACT_CODE_CONTEXT_MISMATCH:${operation.id}`)
      }
      if (location.contextAfterDigest && sha256(contextAfter) !== location.contextAfterDigest) {
        throw new Error(`ARTIFACT_CODE_CONTEXT_MISMATCH:${operation.id}`)
      }
      if (beforeText === afterText) throw new Error(`ARTIFACT_CODE_OPERATION_NO_CHANGE:${operation.id}`)
    }
    for (const operation of [...codeOperations].reverse()) {
      if (operation.location.kind !== 'code') continue
      const start = operation.location.originalRange.start.offset
      const end = operation.location.originalRange.end.offset
      const afterText = operation.after?.text
        ?? candidateText.slice(operation.location.candidateRange.start.offset, operation.location.candidateRange.end.offset)
      reconstructed = reconstructed.slice(0, start) + afterText + reconstructed.slice(end)
    }
    if (reconstructed !== candidateText) {
      throw new Error('ARTIFACT_UNDECLARED_DIFFERENCE:code:replay-mismatch')
    }
  }

  const operationMatches: Record<string, string[]> = Object.fromEntries(operations.map(({ id }) => [id, []]))
  for (const observation of observations) {
    const matching = operations.filter((operation) => operationMatchesObservation(operation, observation))
    if (matching.length === 0) throw new Error(`ARTIFACT_UNDECLARED_DIFFERENCE:${observation.key}`)
    if (kind === 'code' && matching.length !== 1) throw new Error(`ARTIFACT_CODE_DIFFERENCE_AMBIGUOUS:${observation.key}`)
    for (const operation of matching) operationMatches[operation.id].push(observation.key)
  }
  for (const operation of operations) {
    if (operationMatches[operation.id].length === 0) {
      throw new Error(`ARTIFACT_OPERATION_HAS_NO_DIFFERENCE:${operation.id}`)
    }
  }
  return { kind, sourceHash, candidateHash, observations, operationMatches }
}

export function hashArtifact(data: Buffer): string {
  return sha256(data)
}

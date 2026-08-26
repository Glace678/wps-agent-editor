import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { diffChars } from 'diff'
import { DOMParser, XMLSerializer, type Node as XmlNode } from '@xmldom/xmldom'
import type { ArtifactKind, ArtifactOperation } from '../../src/types/artifact-review'

function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, current) => {
    if (current instanceof Uint8Array) return Buffer.from(current).toString('base64')
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return Object.fromEntries(Object.entries(current as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    }
    return current
  })
}

function cloneValue<T>(value: T): T {
  return value == null ? value : structuredClone(value)
}

function textContent(node: XmlNode): string {
  let result = ''
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 || child.nodeType === 4) result += child.nodeValue ?? ''
    else result += textContent(child)
  }
  return result
}

function bytesEqual(a: Buffer | undefined, b: Buffer | undefined): boolean {
  if (!a || !b) return a === b
  return a.equals(b)
}

interface CodeTextDocument {
  text: string
  hasBom: boolean
}

interface CodeTextHunk {
  start: number
  removed: string
  added: string
}

function decodeCodeText(data: Buffer): CodeTextDocument {
  const hasBom = data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf
  return {
    text: new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? data.subarray(3) : data),
    hasBom,
  }
}

function encodeCodeText(text: string, hasBom: boolean): Buffer {
  const encoded = Buffer.from(text, 'utf8')
  return hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded]) : encoded
}

function codeTextHunks(before: string, after: string): CodeTextHunk[] {
  const hunks: CodeTextHunk[] = []
  let offset = 0
  let active: CodeTextHunk | null = null
  const flush = () => {
    if (active) hunks.push(active)
    active = null
  }
  const changes = diffChars(before, after)
  for (let index = 0; index < changes.length; index += 1) {
    const part = changes[index]
    if (!part.added && !part.removed) {
      const bridgesAdjacentChanges = Boolean(
        active
        && part.value.length <= 16
        && changes[index + 1]
        && (changes[index + 1].added || changes[index + 1].removed),
      )
      if (bridgesAdjacentChanges && active) {
        active.removed += part.value
        active.added += part.value
        offset += part.value.length
        continue
      }
      flush()
      offset += part.value.length
      continue
    }
    active ??= { start: offset, removed: '', added: '' }
    if (part.removed) {
      active.removed += part.value
      offset += part.value.length
    } else if (part.added) {
      active.added += part.value
    }
  }
  flush()
  return hunks
}

function allTextOccurrences(value: string, needle: string): number[] {
  if (!needle) return []
  const matches: number[] = []
  let offset = 0
  while (offset <= value.length - needle.length) {
    const found = value.indexOf(needle, offset)
    if (found < 0) break
    matches.push(found)
    offset = found + Math.max(1, needle.length)
  }
  return matches
}

function exactCodeTargetPosition(
  recordedFinal: string,
  current: string,
  start: number,
  removed: string,
): number {
  if (start < 0 || start + removed.length > recordedFinal.length
    || recordedFinal.slice(start, start + removed.length) !== removed) {
    throw new Error('ARTIFACT_HISTORY_CODE_RECORDED_RANGE_INVALID')
  }
  const contextBefore = recordedFinal.slice(Math.max(0, start - 128), start)
  const contextAfter = recordedFinal.slice(start + removed.length, start + removed.length + 128)
  if (removed) {
    const raw = allTextOccurrences(current, removed)
    if (raw.length === 1) return raw[0]
    const contextual = raw.filter((position) => (
      (!contextBefore || current.slice(Math.max(0, position - contextBefore.length), position) === contextBefore)
      && (!contextAfter || current.slice(position + removed.length, position + removed.length + contextAfter.length) === contextAfter)
    ))
    if (contextual.length !== 1) throw new Error('ARTIFACT_HISTORY_CODE_TARGET_CONFLICT')
    return contextual[0]
  }
  const candidates: number[] = []
  for (let position = 0; position <= current.length; position += 1) {
    if (contextBefore && current.slice(Math.max(0, position - contextBefore.length), position) !== contextBefore) continue
    if (contextAfter && current.slice(position, position + contextAfter.length) !== contextAfter) continue
    candidates.push(position)
  }
  if (candidates.length !== 1) throw new Error('ARTIFACT_HISTORY_CODE_TARGET_CONFLICT')
  return candidates[0]
}

function recordedCodeOperationTarget(recordedFinal: string, operation: ArtifactOperation): {
  start: number
  text: string
} {
  if (operation.location.kind !== 'code') throw new Error('ARTIFACT_HISTORY_CODE_LOCATION_INVALID')
  const afterText = operation.after?.text ?? ''
  const expectedStart = operation.location.candidateRange.start.offset
  if (afterText && recordedFinal.slice(expectedStart, expectedStart + afterText.length) === afterText) {
    return { start: expectedStart, text: afterText }
  }
  if (afterText) {
    const occurrences = allTextOccurrences(recordedFinal, afterText)
    if (occurrences.length !== 1) throw new Error('ARTIFACT_HISTORY_CODE_RECORDED_TARGET_AMBIGUOUS')
    return { start: occurrences[0], text: afterText }
  }
  if (expectedStart < 0 || expectedStart > recordedFinal.length) {
    throw new Error('ARTIFACT_HISTORY_CODE_RECORDED_RANGE_INVALID')
  }
  return { start: expectedStart, text: '' }
}

function rebaseCode(finalData: Buffer, currentData: Buffer, desiredData: Buffer): Buffer {
  const recorded = decodeCodeText(finalData)
  const current = decodeCodeText(currentData)
  const desired = decodeCodeText(desiredData)
  if (recorded.hasBom !== desired.hasBom) throw new Error('ARTIFACT_HISTORY_CODE_ENCODING_CHANGED')
  const hunks = codeTextHunks(recorded.text, desired.text)
  const located = hunks.map((hunk) => ({
    ...hunk,
    currentStart: exactCodeTargetPosition(recorded.text, current.text, hunk.start, hunk.removed),
  }))
  const sorted = [...located].sort((left, right) => right.currentStart - left.currentStart)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const currentHunk = sorted[index]
    if (currentHunk.currentStart + currentHunk.removed.length > previous.currentStart) {
      throw new Error('ARTIFACT_HISTORY_CODE_TARGET_OVERLAP')
    }
  }
  let result = current.text
  for (const hunk of sorted) {
    if (result.slice(hunk.currentStart, hunk.currentStart + hunk.removed.length) !== hunk.removed) {
      throw new Error('ARTIFACT_HISTORY_CODE_TARGET_CONFLICT')
    }
    result = result.slice(0, hunk.currentStart) + hunk.added + result.slice(hunk.currentStart + hunk.removed.length)
  }
  return encodeCodeText(result, current.hasBom)
}

interface SequenceHunk<T> {
  start: number
  removed: T[]
  added: T[]
}

function sequenceHunks<T>(before: T[], after: T[], key: (value: T) => string): SequenceHunk<T>[] {
  const rows = before.length + 1
  const columns = after.length + 1
  const lcs = new Uint32Array(rows * columns)
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      lcs[left * columns + right] = key(before[left]) === key(after[right])
        ? 1 + lcs[(left + 1) * columns + right + 1]
        : Math.max(lcs[(left + 1) * columns + right], lcs[left * columns + right + 1])
    }
  }
  const hunks: SequenceHunk<T>[] = []
  let left = 0
  let right = 0
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && key(before[left]) === key(after[right])) {
      left += 1
      right += 1
      continue
    }
    const start = left
    const removed: T[] = []
    const added: T[] = []
    while (left < before.length || right < after.length) {
      if (left < before.length && right < after.length && key(before[left]) === key(after[right])) break
      const moveRight = right < after.length
        && (left >= before.length || lcs[left * columns + right + 1] >= lcs[(left + 1) * columns + right])
      if (moveRight) added.push(after[right++])
      else if (left < before.length) removed.push(before[left++])
    }
    hunks.push({ start, removed, added })
  }
  return hunks
}

function uniqueHunkPosition(
  currentKeys: string[],
  baseKeys: string[],
  hunk: SequenceHunk<{ signature: string }>,
): number {
  const removed = hunk.removed.map(({ signature }) => signature)
  const previous = baseKeys[hunk.start - 1]
  const next = baseKeys[hunk.start + removed.length]
  const rawCandidates: number[] = []
  for (let index = 0; index <= currentKeys.length - removed.length; index += 1) {
    if (removed.some((signature, offset) => currentKeys[index + offset] !== signature)) continue
    rawCandidates.push(index)
  }
  if (removed.length > 0 && rawCandidates.length === 1) return rawCandidates[0]
  const candidates: number[] = []
  for (const index of rawCandidates) {
    if (previous && currentKeys[index - 1] !== previous) continue
    if (next && currentKeys[index + removed.length] !== next) continue
    candidates.push(index)
  }
  if (candidates.length !== 1) throw new Error('ARTIFACT_HISTORY_WORD_TARGET_CONFLICT')
  return candidates[0]
}

async function rebaseWord(finalData: Buffer, currentData: Buffer, desiredData: Buffer): Promise<Buffer> {
  const [finalZip, currentZip, desiredZip] = await Promise.all([
    JSZip.loadAsync(finalData), JSZip.loadAsync(currentData), JSZip.loadAsync(desiredData),
  ])
  const [finalXml, currentXml, desiredXml] = await Promise.all([
    finalZip.file('word/document.xml')?.async('string'),
    currentZip.file('word/document.xml')?.async('string'),
    desiredZip.file('word/document.xml')?.async('string'),
  ])
  if (!finalXml || !currentXml || !desiredXml) throw new Error('ARTIFACT_WORD_DOCUMENT_XML_MISSING')
  const parser = new DOMParser()
  const serializer = new XMLSerializer()
  const parseParagraphs = (xml: string) => {
    const document = parser.parseFromString(xml, 'application/xml')
    const paragraphs = Array.from(document.getElementsByTagName('w:p')).map((node) => ({
      node,
      signature: serializer.serializeToString(node),
      text: textContent(node),
    }))
    return { document, paragraphs }
  }
  const final = parseParagraphs(finalXml)
  const current = parseParagraphs(currentXml)
  const desired = parseParagraphs(desiredXml)
  const hunks = sequenceHunks(final.paragraphs, desired.paragraphs, ({ signature }) => signature)
  const baseKeys = final.paragraphs.map(({ signature }) => signature)
  for (const hunk of [...hunks].reverse()) {
    const liveParagraphs = Array.from(current.document.getElementsByTagName('w:p')).map((node) => ({
      node,
      signature: serializer.serializeToString(node),
    }))
    const position = uniqueHunkPosition(liveParagraphs.map(({ signature }) => signature), baseKeys, hunk)
    const reference = liveParagraphs[position]?.node ?? null
    const parent = reference?.parentNode
      ?? liveParagraphs[position - 1]?.node.parentNode
      ?? current.document.getElementsByTagName('w:body')[0]
    if (!parent) throw new Error('ARTIFACT_HISTORY_WORD_PARENT_MISSING')
    for (let index = 0; index < hunk.removed.length; index += 1) {
      const target = liveParagraphs[position + index]?.node
      if (!target || target.parentNode !== parent) throw new Error('ARTIFACT_HISTORY_WORD_TARGET_CONFLICT')
      parent.removeChild(target)
    }
    const next = Array.from(current.document.getElementsByTagName('w:p'))[position] ?? null
    for (const added of hunk.added) {
      parent.insertBefore(added.node.cloneNode(true), next)
    }
  }
  currentZip.file('word/document.xml', serializer.serializeToString(current.document))
  await patchChangedZipEntries(finalZip, currentZip, desiredZip, new Set(['word/document.xml']))
  return currentZip.generateAsync({ type: 'nodebuffer' })
}

async function patchChangedZipEntries(
  finalZip: JSZip,
  currentZip: JSZip,
  desiredZip: JSZip,
  ignored = new Set<string>(),
): Promise<void> {
  const entries = new Set([...Object.keys(finalZip.files), ...Object.keys(desiredZip.files)])
  for (const name of entries) {
    if (ignored.has(name) || finalZip.files[name]?.dir || desiredZip.files[name]?.dir) continue
    const [base, desired, current] = await Promise.all([
      finalZip.file(name)?.async('nodebuffer'),
      desiredZip.file(name)?.async('nodebuffer'),
      currentZip.file(name)?.async('nodebuffer'),
    ])
    if (bytesEqual(base, desired)) continue
    if (!bytesEqual(base, current)) throw new Error(`ARTIFACT_HISTORY_PACKAGE_TARGET_CONFLICT:${name}`)
    if (desired) currentZip.file(name, desired)
    else currentZip.remove(name)
  }
}

interface ExcelCellSnapshot {
  signature: string
  value: ExcelJS.CellValue
  style: Partial<ExcelJS.Style>
  numFmt: string
}

function excelCells(workbook: ExcelJS.Workbook): Map<string, ExcelCellSnapshot> {
  const result = new Map<string, ExcelCellSnapshot>()
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
      const snapshot = {
        value: cloneValue(cell.value),
        style: cloneValue(cell.style),
        numFmt: cell.numFmt,
      }
      result.set(`${sheet.name}\u0000${cell.address}`, { ...snapshot, signature: stableValue(snapshot) })
    }))
  })
  return result
}

function excelStructures(workbook: ExcelJS.Workbook): string {
  return stableValue(workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    merges: (sheet.model as unknown as { merges?: string[] }).merges ?? [],
    images: sheet.getImages().map((image) => ({ imageId: image.imageId, range: image.range })),
  })))
}

async function loadWorkbook(data: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(data as unknown as ExcelJS.Buffer)
  return workbook
}

async function rebaseExcel(finalData: Buffer, currentData: Buffer, desiredData: Buffer): Promise<Buffer> {
  const [final, current, desired] = await Promise.all([
    loadWorkbook(finalData), loadWorkbook(currentData), loadWorkbook(desiredData),
  ])
  if (excelStructures(final) !== excelStructures(desired)) {
    if (excelStructures(final) !== excelStructures(current)) throw new Error('ARTIFACT_HISTORY_EXCEL_STRUCTURE_CONFLICT')
    throw new Error('ARTIFACT_HISTORY_EXCEL_STRUCTURE_REBASE_UNSUPPORTED')
  }
  const finalCells = excelCells(final)
  const currentCells = excelCells(current)
  const desiredCells = excelCells(desired)
  const keys = new Set([...finalCells.keys(), ...desiredCells.keys()])
  for (const key of keys) {
    const base = finalCells.get(key)
    const replacement = desiredCells.get(key)
    if (base?.signature === replacement?.signature) continue
    if (currentCells.get(key)?.signature !== base?.signature) {
      throw new Error(`ARTIFACT_HISTORY_EXCEL_TARGET_CONFLICT:${key.replace('\u0000', '!')}`)
    }
    const [sheetName, address] = key.split('\u0000')
    const cell = current.getWorksheet(sheetName)?.getCell(address)
    if (!cell) throw new Error(`ARTIFACT_HISTORY_EXCEL_SHEET_MISSING:${sheetName}`)
    cell.value = replacement ? cloneValue(replacement.value) : null
    cell.style = replacement ? cloneValue(replacement.style) : {}
    if (replacement) cell.numFmt = replacement.numFmt
  }
  current.calcProperties.fullCalcOnLoad = true
  return Buffer.from(await current.xlsx.writeBuffer())
}

async function rebasePackage(finalData: Buffer, currentData: Buffer, desiredData: Buffer): Promise<Buffer> {
  const [finalZip, currentZip, desiredZip] = await Promise.all([
    JSZip.loadAsync(finalData), JSZip.loadAsync(currentData), JSZip.loadAsync(desiredData),
  ])
  await patchChangedZipEntries(finalZip, currentZip, desiredZip)
  return currentZip.generateAsync({ type: 'nodebuffer' })
}

export async function rebaseHistoryCandidate(
  kind: ArtifactKind,
  recordedFinalData: Buffer,
  currentData: Buffer,
  desiredData: Buffer,
): Promise<Buffer> {
  if (recordedFinalData.equals(desiredData)) return currentData
  if (recordedFinalData.equals(currentData)) return desiredData
  if (kind === 'word') return rebaseWord(recordedFinalData, currentData, desiredData)
  if (kind === 'excel') return rebaseExcel(recordedFinalData, currentData, desiredData)
  if (kind === 'presentation') return rebasePackage(recordedFinalData, currentData, desiredData)
  if (kind === 'code') return rebaseCode(recordedFinalData, currentData, desiredData)
  throw new Error('ARTIFACT_HISTORY_PDF_REBASE_UNSUPPORTED')
}

export async function findHistoryOperationConflicts(
  kind: ArtifactKind,
  recordedFinalData: Buffer,
  currentData: Buffer,
  operations: ArtifactOperation[],
): Promise<string[]> {
  if (recordedFinalData.equals(currentData)) return []
  if (kind === 'excel') {
    const [final, current] = await Promise.all([loadWorkbook(recordedFinalData), loadWorkbook(currentData)])
    const finalCells = excelCells(final)
    const currentCells = excelCells(current)
    return operations.filter((operation) => {
      if (operation.location.kind !== 'excel') return true
      const sheet = operation.location.sheetName ?? operation.location.sheetId
      const range = operation.location.range.replace(/\$/g, '').match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i)
      if (!sheet || !range) return true
      const column = (label: string) => [...label.toUpperCase()].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0)
      const startColumn = column(range[1])
      const endColumn = column(range[3] ?? range[1])
      const startRow = Number(range[2])
      const endRow = Number(range[4] ?? range[2])
      for (let row = startRow; row <= endRow; row += 1) {
        for (let col = startColumn; col <= endColumn; col += 1) {
          let label = ''
          for (let value = col; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label
          const key = `${sheet}\u0000${label}${row}`
          if (finalCells.get(key)?.signature !== currentCells.get(key)?.signature) return true
        }
      }
      return false
    }).map(({ id }) => id)
  }
  if (kind === 'word') {
    const readParagraphs = async (data: Buffer) => {
      const xml = await (await JSZip.loadAsync(data)).file('word/document.xml')?.async('string')
      if (!xml) throw new Error('ARTIFACT_WORD_DOCUMENT_XML_MISSING')
      const document = new DOMParser().parseFromString(xml, 'application/xml')
      const serializer = new XMLSerializer()
      return Array.from(document.getElementsByTagName('w:p')).map((node) => ({
        signature: serializer.serializeToString(node), text: textContent(node),
      }))
    }
    const [final, current] = await Promise.all([readParagraphs(recordedFinalData), readParagraphs(currentData)])
    return operations.filter((operation) => {
      if (operation.location.kind !== 'word') return true
      const needle = operation.after?.text ?? operation.before?.text ?? operation.location.search
      const index = needle ? final.findIndex(({ text }) => text.includes(needle)) : operation.location.blockIndex ?? -1
      if (index < 0 || !final[index]) return true
      const matches = current.filter(({ signature }) => signature === final[index].signature)
      return matches.length !== 1
    }).map(({ id }) => id)
  }
  if (kind === 'presentation') {
    const [finalZip, currentZip] = await Promise.all([JSZip.loadAsync(recordedFinalData), JSZip.loadAsync(currentData)])
    const conflicts: string[] = []
    for (const operation of operations) {
      if (operation.location.kind !== 'presentation') { conflicts.push(operation.id); continue }
      const name = `ppt/slides/slide${operation.location.slideIndex + 1}.xml`
      const [base, current] = await Promise.all([
        finalZip.file(name)?.async('nodebuffer'), currentZip.file(name)?.async('nodebuffer'),
      ])
      if (!bytesEqual(base, current)) conflicts.push(operation.id)
    }
    return conflicts
  }
  if (kind === 'code') {
    const recorded = decodeCodeText(recordedFinalData)
    const current = decodeCodeText(currentData)
    return operations.filter((operation) => {
      try {
        const target = recordedCodeOperationTarget(recorded.text, operation)
        exactCodeTargetPosition(recorded.text, current.text, target.start, target.text)
        return false
      } catch {
        return true
      }
    }).map(({ id }) => id)
  }
  return operations.map(({ id }) => id)
}

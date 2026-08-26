import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom'
import JSZip from 'jszip'

const execFileAsync = promisify(execFile)
const CONVERSION_TIMEOUT_MS = 120_000
const CONVERSION_OUTPUT_LIMIT = 8 * 1024 * 1024
const WORDPROCESSINGML_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const CELL_BORDER_SIDES = ['top', 'left', 'bottom', 'right'] as const
const TABLE_BORDER_SIDES = [...CELL_BORDER_SIDES, 'insideH', 'insideV'] as const

export type WordConverter = 'libreoffice' | 'word' | 'wps'

export interface PreparedWord {
  data: Buffer
  convertedFromLegacy: boolean
  converter: WordConverter | null
  nativeConversionFailed: boolean
  normalizedLegacyImageCount: number
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function isZipPackage(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b
}

function readXmlAttribute(source: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`\\b${escapedName}=(['"])(.*?)\\1`, 'i'))
  return match?.[2] ?? null
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function cssLengthToEmu(style: string, property: 'width' | 'height'): number | null {
  const match = style.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([0-9.]+)\\s*(pt|in|cm|mm|px)?`, 'i'))
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const emuPerUnit: Record<string, number> = {
    pt: 12_700,
    in: 914_400,
    cm: 360_000,
    mm: 36_000,
    px: 9_525,
  }
  return Math.max(1, Math.round(value * (emuPerUnit[match[2]?.toLowerCase() || 'pt'] || 12_700)))
}

function drawingXml(
  relationshipId: string,
  widthEmu: number,
  heightEmu: number,
  documentPropertyId: number,
  description: string,
): string {
  const name = `Converted image ${documentPropertyId}`
  const safeName = escapeXmlAttribute(name)
  const safeDescription = escapeXmlAttribute(description)
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${documentPropertyId}" name="${safeName}" descr="${safeDescription}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${safeName}" descr="${safeDescription}"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
}

function normalizeLegacyImagesInXml(xml: string): { xml: string; count: number } {
  const existingIds = [...xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite)
  let nextDocumentPropertyId = Math.max(0, ...existingIds) + 1
  let count = 0

  const normalized = xml.replace(
    /<w:(pict|object)\b[\s\S]*?<\/w:\1>/g,
    (container) => {
      const imageData = container.match(/<v:imagedata\b[^>]*>/i)?.[0]
      const shape = container.match(/<v:shape\b[^>]*>/i)?.[0]
      if (!imageData || !shape) return container

      const relationshipId = readXmlAttribute(imageData, 'r:id')
      const style = readXmlAttribute(shape, 'style') || ''
      const widthEmu = cssLengthToEmu(style, 'width')
      const heightEmu = cssLengthToEmu(style, 'height')
      if (!relationshipId || !widthEmu || !heightEmu) return container

      const description = readXmlAttribute(shape, 'alt')
        || readXmlAttribute(imageData, 'o:title')
        || 'Embedded image'
      const replacement = drawingXml(
        relationshipId,
        widthEmu,
        heightEmu,
        nextDocumentPropertyId++,
        description,
      )
      count += 1
      return replacement
    },
  )
  return { xml: normalized, count }
}

async function normalizeWordPackage(
  data: Buffer,
): Promise<{
  data: Buffer
  convertedImageCount: number
  normalizedTableCount: number
  removedUnderlineRunCount: number
}> {
  const zip = await JSZip.loadAsync(data)
  const stylesXml = await zip.file('word/styles.xml')?.async('string')
  const borderOnlyTableStyleIds = stylesXml
    ? findBorderOnlyTableStyleIds(stylesXml)
    : new Set<string>()
  const settingsXml = await zip.file('word/settings.xml')?.async('string')
  const preserveTrailingUnderlineSpaces = Boolean(settingsXml?.match(/<w:ulTrailSpace\b/i))
  const partNames = Object.keys(zip.files).filter((name) =>
    /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name),
  )
  let convertedImageCount = 0
  let normalizedTableCount = 0
  let removedUnderlineRunCount = 0

  for (const partName of partNames) {
    const part = zip.file(partName)
    if (!part) continue
    const sourceXml = await part.async('string')
    const imageNormalization = normalizeLegacyImagesInXml(sourceXml)
    const documentNormalization = normalizeWordprocessingXml(
      imageNormalization.xml,
      borderOnlyTableStyleIds,
      !preserveTrailingUnderlineSpaces,
    )
    const changed = imageNormalization.count > 0
      || documentNormalization.normalizedTableCount > 0
      || documentNormalization.removedUnderlineRunCount > 0
    if (!changed) continue

    zip.file(partName, documentNormalization.xml)
    convertedImageCount += imageNormalization.count
    normalizedTableCount += documentNormalization.normalizedTableCount
    removedUnderlineRunCount += documentNormalization.removedUnderlineRunCount
  }

  if (convertedImageCount === 0 && normalizedTableCount === 0 && removedUnderlineRunCount === 0) {
    return { data, convertedImageCount, normalizedTableCount, removedUnderlineRunCount }
  }
  return {
    data: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    convertedImageCount,
    normalizedTableCount,
    removedUnderlineRunCount,
  }
}

function directElements(parent: XmlNode): XmlElement[] {
  const children: XmlElement[] = []
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) children.push(child as XmlElement)
  }
  return children
}

function directChildren(parent: XmlNode, name: string): XmlElement[] {
  return directElements(parent).filter((child) => child.nodeName === name)
}

function directChild(parent: XmlNode | null, name: string): XmlElement | null {
  if (!parent) return null
  return directChildren(parent, name)[0] || null
}

function wordAttribute(element: XmlElement | null, name: string): string | null {
  return element?.getAttributeNS(WORDPROCESSINGML_NAMESPACE, name)
    || element?.getAttribute(`w:${name}`)
    || null
}

function setWordAttribute(element: XmlElement, name: string, value: string): void {
  element.setAttributeNS(WORDPROCESSINGML_NAMESPACE, `w:${name}`, value)
}

function numberWordAttribute(element: XmlElement | null, name: string, fallback: number): number {
  const parsed = Number(wordAttribute(element, name))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function descendants(parent: XmlNode, name: string): XmlElement[] {
  const nodes = (parent as XmlElement | XmlDocument).getElementsByTagName(name)
  const elements: XmlElement[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes.item(index)
    if (node) elements.push(node)
  }
  return elements
}

function createWordElement(document: XmlDocument, name: string): XmlElement {
  return document.createElementNS(WORDPROCESSINGML_NAMESPACE, `w:${name}`)
}

function copyBorder(
  document: XmlDocument,
  name: typeof CELL_BORDER_SIDES[number],
  source: XmlElement | null,
): XmlElement {
  const target = createWordElement(document, name)
  if (!source) {
    setWordAttribute(target, 'val', 'nil')
    return target
  }

  for (let index = 0; index < source.attributes.length; index += 1) {
    const attribute = source.attributes.item(index)
    if (!attribute) continue
    if (attribute.namespaceURI) {
      target.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
    } else {
      target.setAttribute(attribute.name, attribute.value)
    }
  }
  return target
}

function ensureCellProperties(document: XmlDocument, cell: XmlElement): XmlElement {
  const existing = directChild(cell, 'w:tcPr')
  if (existing) return existing
  const properties = createWordElement(document, 'tcPr')
  cell.insertBefore(properties, cell.firstChild)
  return properties
}

function ensureCellBorders(document: XmlDocument, cellProperties: XmlElement): XmlElement {
  const existing = directChild(cellProperties, 'w:tcBorders')
  if (existing) return existing

  const borders = createWordElement(document, 'tcBorders')
  const followingPropertyNames = new Set([
    'w:shd',
    'w:noWrap',
    'w:tcMar',
    'w:textDirection',
    'w:tcFitText',
    'w:vAlign',
    'w:hideMark',
    'w:headers',
  ])
  let insertionPoint: XmlNode | null = null
  for (let child = cellProperties.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && followingPropertyNames.has(child.nodeName)) {
      insertionPoint = child
      break
    }
  }
  cellProperties.insertBefore(borders, insertionPoint)
  return borders
}

function replaceCellBorder(
  document: XmlDocument,
  cellBorders: XmlElement,
  side: typeof CELL_BORDER_SIDES[number],
  source: XmlElement | null,
): void {
  const existing = directChild(cellBorders, `w:${side}`)
  const replacement = copyBorder(document, side, source)
  if (existing) {
    cellBorders.replaceChild(replacement, existing)
    return
  }

  const sideIndex = CELL_BORDER_SIDES.indexOf(side)
  const insertionPoint = CELL_BORDER_SIDES.slice(sideIndex + 1)
    .map((nextSide) => directChild(cellBorders, `w:${nextSide}`))
    .find(Boolean) || null
  cellBorders.insertBefore(replacement, insertionPoint)
}

function neutralizeTableBorders(document: XmlDocument, borders: XmlElement): void {
  for (const side of TABLE_BORDER_SIDES) {
    const existing = directChild(borders, `w:${side}`)
    const replacement = createWordElement(document, side)
    setWordAttribute(replacement, 'val', 'nil')
    if (existing) borders.replaceChild(replacement, existing)
    else borders.appendChild(replacement)
  }
}

function tableNeedsBorderNormalization(table: XmlElement): boolean {
  const tableProperties = directChild(table, 'w:tblPr')
  const tableBorders = directChild(tableProperties, 'w:tblBorders')
  if (!tableBorders) return false

  const tableHasVisibleBorder = TABLE_BORDER_SIDES.some((side) => {
    const value = wordAttribute(directChild(tableBorders, `w:${side}`), 'val')
    return value !== null && value !== 'nil' && value !== 'none'
  })
  if (!tableHasVisibleBorder) return false

  return directChildren(table, 'w:tr').some((row) =>
    directChildren(row, 'w:tc').some((cell) => {
      const cellBorders = directChild(directChild(cell, 'w:tcPr'), 'w:tcBorders')
      return CELL_BORDER_SIDES.some((side) => {
        const value = wordAttribute(directChild(cellBorders, `w:${side}`), 'val')
        return value === 'nil' || value === 'none'
      })
    }),
  )
}

function normalizeTableBorders(
  document: XmlDocument,
  table: XmlElement,
  borderOnlyTableStyleIds: ReadonlySet<string>,
): boolean {
  if (!tableNeedsBorderNormalization(table)) return false

  const tableProperties = directChild(table, 'w:tblPr')
  const tableBorders = directChild(tableProperties, 'w:tblBorders')
  if (!tableBorders) return false

  const rows = directChildren(table, 'w:tr')
  const grid = directChild(table, 'w:tblGrid')
  const gridColumnCount = grid ? directChildren(grid, 'w:gridCol').length : 0
  const inferredColumnCount = rows.reduce((maximum, row) => {
    const rowProperties = directChild(row, 'w:trPr')
    const before = numberWordAttribute(directChild(rowProperties, 'w:gridBefore'), 'val', 0)
    const count = directChildren(row, 'w:tc').reduce((total, cell) => {
      const properties = directChild(cell, 'w:tcPr')
      return total + Math.max(1, numberWordAttribute(directChild(properties, 'w:gridSpan'), 'val', 1))
    }, before)
    const after = numberWordAttribute(directChild(rowProperties, 'w:gridAfter'), 'val', 0)
    return Math.max(maximum, count + after)
  }, 0)
  const columnCount = Math.max(gridColumnCount, inferredColumnCount, 1)

  rows.forEach((row, rowIndex) => {
    const rowProperties = directChild(row, 'w:trPr')
    let columnIndex = numberWordAttribute(directChild(rowProperties, 'w:gridBefore'), 'val', 0)

    for (const cell of directChildren(row, 'w:tc')) {
      const cellProperties = ensureCellProperties(document, cell)
      const cellBorders = ensureCellBorders(document, cellProperties)
      const span = Math.max(1, numberWordAttribute(directChild(cellProperties, 'w:gridSpan'), 'val', 1))
      const lastColumnIndex = columnIndex + span
      const inheritedBorderNames: Record<typeof CELL_BORDER_SIDES[number], string> = {
        top: rowIndex === 0 ? 'top' : 'insideH',
        bottom: rowIndex === rows.length - 1 ? 'bottom' : 'insideH',
        left: columnIndex === 0 ? 'left' : 'insideV',
        right: lastColumnIndex >= columnCount ? 'right' : 'insideV',
      }

      for (const side of CELL_BORDER_SIDES) {
        const directBorder = directChild(cellBorders, `w:${side}`)
        const inheritedBorder = directChild(tableBorders, `w:${inheritedBorderNames[side]}`)
        replaceCellBorder(document, cellBorders, side, directBorder || inheritedBorder)
      }
      columnIndex = lastColumnIndex
    }

  })

  const tableStyle = directChild(tableProperties, 'w:tblStyle')
  const tableStyleId = wordAttribute(tableStyle, 'val')
  const canRemoveBorderSources = !tableStyleId || borderOnlyTableStyleIds.has(tableStyleId)
  if (canRemoveBorderSources) {
    if (tableStyle) tableProperties?.removeChild(tableStyle)
    tableProperties?.removeChild(tableBorders)
    for (const row of rows) {
      for (const exceptionProperties of directChildren(row, 'w:tblPrEx')) {
        const exceptionBorders = directChild(exceptionProperties, 'w:tblBorders')
        if (exceptionBorders) exceptionProperties.removeChild(exceptionBorders)
      }
    }
  } else {
    neutralizeTableBorders(document, tableBorders)
    for (const row of rows) {
      for (const exceptionProperties of directChildren(row, 'w:tblPrEx')) {
        const exceptionBorders = directChild(exceptionProperties, 'w:tblBorders')
        if (exceptionBorders) neutralizeTableBorders(document, exceptionBorders)
      }
    }
  }
  return true
}

function removeInvisibleUnderlineRuns(document: XmlDocument): number {
  let removed = 0
  for (const paragraph of descendants(document, 'w:p')) {
    const textElements = descendants(paragraph, 'w:t')
    if (textElements.length === 0) continue
    if (textElements.some((text) => (text.textContent || '').trim().length > 0)) continue
    if (['w:tab', 'w:br', 'w:drawing', 'w:object', 'w:pict'].some((name) => descendants(paragraph, name).length > 0)) {
      continue
    }

    for (const run of descendants(paragraph, 'w:r')) {
      const runText = descendants(run, 'w:t').map((text) => text.textContent || '').join('')
      if (!runText || runText.trim().length > 0) continue
      const underline = directChild(directChild(run, 'w:rPr'), 'w:u')
      const underlineValue = wordAttribute(underline, 'val')
      if (!underline || underlineValue === 'nil' || underlineValue === 'none') continue
      run.parentNode?.removeChild(run)
      removed += 1
    }
  }
  return removed
}

function parseWordprocessingXml(xml: string): XmlDocument {
  let parseError: Error | null = null
  const document = new DOMParser({
    onError(level, message) {
      if (level !== 'warning' && !parseError) parseError = new Error(message)
    },
  }).parseFromString(xml, 'application/xml')
  if (parseError) throw parseError
  return document
}

function findBorderOnlyTableStyleIds(xml: string): Set<string> {
  const document = parseWordprocessingXml(xml)
  const allowedStyleChildren = new Set([
    'w:name',
    'w:basedOn',
    'w:qFormat',
    'w:uiPriority',
    'w:tblPr',
  ])
  const styleIds = new Set<string>()

  for (const style of descendants(document, 'w:style')) {
    if (wordAttribute(style, 'type') !== 'table') continue
    const styleId = wordAttribute(style, 'styleId')
    const tableProperties = directChild(style, 'w:tblPr')
    if (!styleId || !tableProperties || !directChild(tableProperties, 'w:tblBorders')) continue
    if (directChildren(tableProperties, 'w:tblBorders').length !== 1) continue
    if (directChildren(style, 'w:tblStylePr').length > 0) continue

    const tablePropertyElements = directElements(tableProperties)
    const onlyBorderFormatting = directChildren(style, 'w:tblPr').length === 1
      && tablePropertyElements.length === 1
      && tablePropertyElements[0].nodeName === 'w:tblBorders'
      && directChildren(style, 'w:pPr').length === 0
      && directChildren(style, 'w:rPr').length === 0
      && directChildren(style, 'w:tcPr').length === 0
      && directChildren(style, 'w:trPr').length === 0
      && directElements(style).every((child) => allowedStyleChildren.has(child.nodeName))
    if (onlyBorderFormatting) styleIds.add(styleId)
  }
  return styleIds
}

function normalizeWordprocessingXml(
  xml: string,
  borderOnlyTableStyleIds: ReadonlySet<string>,
  removeTrailingUnderlineSpaces: boolean,
): {
  xml: string
  normalizedTableCount: number
  removedUnderlineRunCount: number
} {
  const document = parseWordprocessingXml(xml)

  const normalizedTableCount = descendants(document, 'w:tbl')
    .reduce(
      (count, table) => count + Number(
        normalizeTableBorders(document, table, borderOnlyTableStyleIds),
      ),
      0,
    )
  const removedUnderlineRunCount = removeTrailingUnderlineSpaces
    ? removeInvisibleUnderlineRuns(document)
    : 0
  if (normalizedTableCount === 0 && removedUnderlineRunCount === 0) {
    return { xml, normalizedTableCount, removedUnderlineRunCount }
  }

  return {
    xml: new XMLSerializer().serializeToString(document),
    normalizedTableCount,
    removedUnderlineRunCount,
  }
}

async function findOnPath(command: string): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const { stdout } = await execFileAsync(locator, [command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    })
    return String(stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null
  } catch {
    return null
  }
}

async function findLibreOfficeExecutable(): Promise<string | null> {
  const candidates = process.platform === 'win32'
    ? [
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'LibreOffice', 'program', 'soffice.com'),
        process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'LibreOffice', 'program', 'soffice.exe'),
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'LibreOffice', 'program', 'soffice.com'),
        process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'LibreOffice', 'program', 'soffice.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
      : ['/usr/bin/libreoffice', '/usr/bin/soffice', '/snap/bin/libreoffice']

  for (const candidate of candidates) {
    if (candidate && await pathExists(candidate)) return candidate
  }

  return await findOnPath('libreoffice')
    || await findOnPath(process.platform === 'win32' ? 'soffice.com' : 'soffice')
}

async function findConvertedDocx(outputDirectory: string): Promise<string | null> {
  const entries = await fs.readdir(outputDirectory, { withFileTypes: true })
  const converted = entries.find(
    (entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.docx',
  )
  return converted ? path.join(outputDirectory, converted.name) : null
}

async function assertValidDocx(filePath: string): Promise<Buffer> {
  const data = await fs.readFile(filePath)
  if (!isZipPackage(data)) throw new Error('Converter did not create a valid DOCX package')
  return data
}

async function convertWithLibreOffice(
  executable: string,
  sourcePath: string,
  outputDirectory: string,
): Promise<Buffer> {
  const profileDirectory = path.join(outputDirectory, 'libreoffice-profile')
  await fs.mkdir(profileDirectory, { recursive: true })
  await execFileAsync(
    executable,
    [
      `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
      '--headless',
      '--convert-to',
      'docx',
      '--outdir',
      outputDirectory,
      sourcePath,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: CONVERSION_TIMEOUT_MS,
      maxBuffer: CONVERSION_OUTPUT_LIMIT,
    },
  )

  const convertedPath = await findConvertedDocx(outputDirectory)
  if (!convertedPath) throw new Error('LibreOffice did not create a DOCX file')
  return assertValidDocx(convertedPath)
}

function buildWindowsWordConversionScript(): string {
  return `
$ErrorActionPreference = 'Stop'
$sourcePath = $env:WPS_AGENT_WORD_SOURCE
$targetPath = $env:WPS_AGENT_WORD_TARGET
$lastError = ''

foreach ($progId in @('KWPS.Application', 'Word.Application')) {
  $app = $null
  $document = $null
  try {
    $type = [Type]::GetTypeFromProgID($progId)
    if ($null -eq $type) { continue }
    $app = [Activator]::CreateInstance($type)
    try { $app.Visible = $false } catch {}
    try { $app.DisplayAlerts = 0 } catch {}
    try { $app.AutomationSecurity = 3 } catch {}
    $document = $app.Documents.Open($sourcePath, $false, $true, $false)
    try {
      $document.SaveAs2($targetPath, 12)
    } catch {
      $document.SaveAs($targetPath, 12)
    }
    $document.Close(0)
    $document = $null
    $app.Quit()
    $app = $null
    Write-Output $progId
    exit 0
  } catch {
    $lastError = $_.Exception.Message
    if (Test-Path -LiteralPath $targetPath) {
      Remove-Item -LiteralPath $targetPath -Force -ErrorAction SilentlyContinue
    }
  } finally {
    if ($null -ne $document) {
      try { $document.Close(0) } catch {}
      try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) } catch {}
    }
    if ($null -ne $app) {
      try { $app.Quit() } catch {}
      try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
  }
}

throw "No compatible Windows Word converter was available. $lastError"
`
}

async function convertWithWindowsOffice(
  sourcePath: string,
  outputDirectory: string,
): Promise<{ data: Buffer; converter: WordConverter }> {
  const targetPath = path.join(outputDirectory, 'converted.docx')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', buildWindowsWordConversionScript()],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: CONVERSION_TIMEOUT_MS,
      maxBuffer: CONVERSION_OUTPUT_LIMIT,
      env: {
        ...process.env,
        WPS_AGENT_WORD_SOURCE: sourcePath,
        WPS_AGENT_WORD_TARGET: targetPath,
      },
    },
  )

  return {
    data: await assertValidDocx(targetPath),
    converter: String(stdout).includes('KWPS.Application') ? 'wps' : 'word',
  }
}

async function convertLegacyWord(sourcePath: string): Promise<PreparedWord> {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'wps-agent-word-'))
  const workingSource = path.join(outputDirectory, 'source.doc')
  const failures: unknown[] = []

  try {
    // Work from a private copy so conversion never closes or rewrites a document
    // that the user currently has open in Word or WPS.
    await fs.copyFile(sourcePath, workingSource)

    if (process.platform === 'win32') {
      try {
        const converted = await convertWithWindowsOffice(workingSource, outputDirectory)
        const normalized = await normalizeWordPackage(converted.data)
        return {
          data: normalized.data,
          convertedFromLegacy: true,
          converter: converted.converter,
          nativeConversionFailed: false,
          normalizedLegacyImageCount: normalized.convertedImageCount,
        }
      } catch (error) {
        failures.push(error)
      }
    }

    const libreOffice = await findLibreOfficeExecutable()
    if (libreOffice) {
      try {
        const normalized = await normalizeWordPackage(
          await convertWithLibreOffice(libreOffice, workingSource, outputDirectory),
        )
        return {
          data: normalized.data,
          convertedFromLegacy: true,
          converter: 'libreoffice',
          nativeConversionFailed: false,
          normalizedLegacyImageCount: normalized.convertedImageCount,
        }
      } catch (error) {
        failures.push(error)
      }
    }

    if (failures.length > 0) {
      console.warn('[WordConverter] Native DOC conversion failed:', failures)
    }
    throw new Error('WORD_CONVERTER_UNAVAILABLE')
  } finally {
    await fs.rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function prepareWord(filePath: string): Promise<PreparedWord> {
  const normalized = path.normalize(filePath)
  const extension = path.extname(normalized).toLowerCase()
  const sourceData = await fs.readFile(normalized)

  // A few producers write OOXML bytes with a legacy .doc suffix.
  if (extension === '.docx' || extension === '.odt' || isZipPackage(sourceData)) {
    const normalizedPackage = await normalizeWordPackage(sourceData)
    if (normalizedPackage.normalizedTableCount > 0 || normalizedPackage.removedUnderlineRunCount > 0) {
      console.log('[WordConverter] Normalized Word layout compatibility:', {
        tables: normalizedPackage.normalizedTableCount,
        invisibleUnderlineRuns: normalizedPackage.removedUnderlineRunCount,
      })
    }
    return {
      data: normalizedPackage.data,
      convertedFromLegacy: false,
      converter: null,
      nativeConversionFailed: false,
      normalizedLegacyImageCount: normalizedPackage.convertedImageCount,
    }
  }

  if (extension === '.doc') {
    try {
      return await convertLegacyWord(normalized)
    } catch (error) {
      console.warn('[WordConverter] Falling back to the built-in DOC parser:', error)
      return {
        data: sourceData,
        convertedFromLegacy: false,
        converter: null,
        nativeConversionFailed: true,
        normalizedLegacyImageCount: 0,
      }
    }
  }

  throw new TypeError(`Unsupported Word format: ${extension || '(none)'}`)
}

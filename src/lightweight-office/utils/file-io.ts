import { desktopApi, toUint8Array } from '@/platform'
import {
  CODE_FILE_EXTENSIONS,
  CODE_SPECIAL_FILE_NAMES,
  isCodeFile,
} from '@/lib/code-languages'

export const WORD_FILE_EXTENSIONS = Object.freeze(['docx', 'doc', 'odt'])
export const SPREADSHEET_FILE_EXTENSIONS = Object.freeze(['xlsx', 'xls', 'csv', 'ods'])
export const PRESENTATION_FILE_EXTENSIONS = Object.freeze(['pptx', 'ppt', 'odp'])
export const PDF_FILE_EXTENSIONS = Object.freeze(['pdf'])
export const TEXT_FILE_EXTENSIONS = Object.freeze(['txt', 'md', 'markdown', 'log'])
export const IMAGE_FILE_EXTENSIONS = Object.freeze([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'heic', 'ico', 'tif', 'tiff',
])

/** Every extension and special filename routed to an editor by getDocKind. */
export const SUPPORTED_FILE_EXTENSIONS = Object.freeze([
  ...WORD_FILE_EXTENSIONS,
  ...SPREADSHEET_FILE_EXTENSIONS,
  ...PRESENTATION_FILE_EXTENSIONS,
  ...PDF_FILE_EXTENSIONS,
  ...TEXT_FILE_EXTENSIONS,
  ...CODE_FILE_EXTENSIONS,
].filter((extension, index, extensions) => extensions.indexOf(extension) === index))

export function isImageFile(filePath: string): boolean {
  const ext = getExtension(filePath)
  return IMAGE_FILE_EXTENSIONS.includes(ext)
}

export const SUPPORTED_SPECIAL_FILE_NAMES = CODE_SPECIAL_FILE_NAMES

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const bytes = toUint8Array(data)
  // 拷贝为独立 ArrayBuffer，避免 shared/detached/worker transfer 问题。
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export interface PresentationFileBuffer {
  buffer: ArrayBuffer
  convertedFromLegacy: boolean
  converter: 'libreoffice' | 'powerpoint' | 'wps' | null
  normalizedWmfCount: number
}

export interface WordFileBuffer {
  buffer: ArrayBuffer
  convertedFromLegacy: boolean
  converter: 'libreoffice' | 'word' | 'wps' | null
  nativeConversionFailed: boolean
  normalizedLegacyImageCount: number
  normalizedTableCount: number
  removedUnderlineRunCount: number
}

export async function readWordBuffer(filePath: string): Promise<WordFileBuffer> {
  const result = await desktopApi.documents.prepareWord(filePath)
  return {
    buffer: toArrayBuffer(result.data),
    convertedFromLegacy: result.convertedFromLegacy,
    converter: result.converter,
    nativeConversionFailed: result.nativeConversionFailed,
    normalizedLegacyImageCount: result.normalizedLegacyImageCount,
    normalizedTableCount: result.normalizedTableCount,
    removedUnderlineRunCount: result.removedUnderlineRunCount,
  }
}

export async function readPresentationBuffer(filePath: string): Promise<PresentationFileBuffer> {
  const result = await desktopApi.documents.preparePresentation(filePath)
  return {
    buffer: toArrayBuffer(result.data),
    convertedFromLegacy: result.convertedFromLegacy,
    converter: result.converter,
    normalizedWmfCount: result.normalizedWmfCount,
  }
}

/** Read XLSX directly or convert XLS/ODS through an available system Office suite. */
export async function readSpreadsheetBuffer(filePath: string): Promise<ArrayBuffer> {
  const extension = getExtension(filePath)
  if (extension === 'csv') return readFileBuffer(filePath)
  return toArrayBuffer(await desktopApi.documents.prepareSpreadsheet(filePath))
}

/** 读取文件为 ArrayBuffer（主进程已改为二进制传输，不再走 base64） */
export async function readFileBuffer(filePath: string): Promise<ArrayBuffer> {
  return toArrayBuffer(await desktopApi.documents.readFile(filePath))
}

/** 读取为 Uint8Array，适合直接交给 pdf.js 等库 */
export async function readFileBytes(filePath: string): Promise<Uint8Array> {
  const data = await desktopApi.documents.readFile(filePath)
  // 再拷贝一份，防止 worker transfer 弄脏原始缓冲
  const bytes = toUint8Array(data)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

export async function saveFileBuffer(filePath: string, buffer: ArrayBuffer): Promise<void> {
  await desktopApi.documents.saveBinary(filePath, new Uint8Array(buffer))
}

/** 从完整路径安全提取扩展名（不含点），兼容 Windows 路径 */
export function getExtension(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() || ''
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function getDocKind(filePath: string): 'word' | 'excel' | 'slide' | 'pdf' | 'text' | 'code' | 'unknown' {
  const ext = getExtension(filePath)
  // SuperDoc 编辑 OOXML；旧格式先由 Rust 调用系统 Office 转换器生成 OOXML。
  if (WORD_FILE_EXTENSIONS.includes(ext)) return 'word'
  if (SPREADSHEET_FILE_EXTENSIONS.includes(ext)) return 'excel'
  if (PRESENTATION_FILE_EXTENSIONS.includes(ext)) return 'slide'
  if (PDF_FILE_EXTENSIONS.includes(ext)) return 'pdf'
  if (isCodeFile(filePath)) return 'code'
  if (TEXT_FILE_EXTENSIONS.includes(ext)) return 'text'
  return 'unknown'
}

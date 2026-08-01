import { isCodeFile } from '@/lib/code-languages'

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // 分块拼接，避免大文件栈溢出
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function toArrayBuffer(data: Uint8Array | ArrayBuffer | string): ArrayBuffer {
  if (typeof data === 'string') {
    return base64ToArrayBuffer(data)
  }
  if (data instanceof ArrayBuffer) {
    return data
  }
  // Uint8Array / Buffer-like view：拷贝为独立 ArrayBuffer，避免 shared/detached 问题
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

export interface PresentationFileBuffer {
  buffer: ArrayBuffer
  convertedFromLegacy: boolean
  converter: 'libreoffice' | 'powerpoint' | 'wps' | null
}

export async function readPresentationBuffer(filePath: string): Promise<PresentationFileBuffer> {
  const result = await window.api.lw.readPresentation(filePath)
  return {
    buffer: toArrayBuffer(result.data),
    convertedFromLegacy: result.convertedFromLegacy,
    converter: result.converter,
  }
}

/** 读取文件为 ArrayBuffer（主进程已改为二进制传输，不再走 base64） */
export async function readFileBuffer(filePath: string): Promise<ArrayBuffer> {
  const { data } = await window.api.lw.readFile(filePath)
  return toArrayBuffer(data)
}

/** 读取为 Uint8Array，适合直接交给 pdf.js 等库 */
export async function readFileBytes(filePath: string): Promise<Uint8Array> {
  const { data } = await window.api.lw.readFile(filePath)
  if (typeof data === 'string') {
    return new Uint8Array(base64ToArrayBuffer(data))
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  // 再拷贝一份，防止 worker transfer 弄脏原始缓冲
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

export async function saveFileBuffer(filePath: string, buffer: ArrayBuffer): Promise<void> {
  await window.api.lw.saveFile(filePath, arrayBufferToBase64(buffer))
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
  // SuperDoc 对 OOXML .docx 支持最好；旧版 .doc 仍路由到 Word 编辑器并显示明确错误
  if (['docx', 'doc', 'odt'].includes(ext)) return 'word'
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'excel'
  if (['pptx', 'ppt'].includes(ext)) return 'slide'
  if (ext === 'pdf') return 'pdf'
  if (isCodeFile(filePath)) return 'code'
  if (['txt', 'md', 'markdown', 'log'].includes(ext)) return 'text'
  return 'unknown'
}

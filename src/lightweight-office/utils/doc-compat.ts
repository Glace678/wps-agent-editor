import JSZip from 'jszip'
import { getExtension } from './file-io'

export type PrepareWordResult = {
  bytes: Uint8Array
  displayName: string
  fromLegacyDoc: boolean
}

function isZipPackage(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (
      (bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08)
    )
}

/**
 * A DOCX is an OPC package, not just any ZIP. Reject arbitrary/empty/corrupt
 * archives that merely share the ZIP magic so they are not handed to the editor.
 */
async function looksLikeDocxPackage(bytes: Uint8Array): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files)
    if (!zip.file('[Content_Types].xml')) return false
    // A WordprocessingML main document part is mandatory.
    return names.some((name) => /^word\/document\.xml$/i.test(name))
  } catch {
    return false
  }
}

/** Validate the OOXML bytes prepared by the Rust conversion service. */
export async function prepareWordBytes(
  filePath: string,
  buffer: ArrayBuffer,
  convertedFromLegacy = false,
): Promise<PrepareWordResult> {
  const bytes = new Uint8Array(buffer)
  if (!isZipPackage(bytes)) {
    throw new Error('The desktop conversion service did not return a DOCX package')
  }
  if (!(await looksLikeDocxPackage(bytes))) {
    throw new Error('The converted file is not a valid Word (.docx) package')
  }
  const rawName = filePath.split(/[/\\]/).pop() || 'document.docx'
  const extension = getExtension(filePath)
  return {
    bytes,
    displayName: ['doc', 'odt'].includes(extension)
      ? rawName.replace(/\.(?:doc|odt)$/i, '.docx')
      : rawName,
    fromLegacyDoc: convertedFromLegacy,
  }
}

/** Converted formats are saved to a new DOCX target chosen by the user. */
export function resolveSavePathForWord(filePath: string): string {
  return ['doc', 'odt'].includes(getExtension(filePath))
    ? filePath.replace(/\.(?:doc|odt)$/i, '.docx')
    : filePath
}

/**
 * When saving a converted .doc/.odt as .docx, the derived target may collide
 * with an existing DOCX. Never silently overwrite it: if the candidate exists,
 * append " (1)", " (2)"… before the extension until a free name is found.
 * `exists` lets the caller inject its own existence check (no I/O lives here).
 */
export async function resolveUniqueWordSavePath(
  target: string,
  exists: (path: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(target))) return target
  const lastSep = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'))
  const dir = lastSep >= 0 ? target.slice(0, lastSep + 1) : ''
  const file = lastSep >= 0 ? target.slice(lastSep + 1) : target
  const match = file.match(/^(.*?)(\.[^.]+)$/)
  const stem = match?.[1] ?? file
  const ext = match?.[2] ?? ''
  for (let i = 1; i < 1000; i++) {
    const candidate = `${dir}${stem} (${i})${ext}`
    if (!(await exists(candidate))) return candidate
  }
  return target
}

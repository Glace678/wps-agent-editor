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

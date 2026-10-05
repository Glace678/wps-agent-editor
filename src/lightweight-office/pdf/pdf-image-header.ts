import type { PdfImageAnnotationRecord } from './mupdf-protocol'

// 图片字节/像素上限的唯一出处在 worker/wae-limits（worker 侧 WAE 校验与 UI 预检必须一致），
// 这里仅 re-export 以兼容既有从本模块引入的调用方。
export { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from './worker/wae-limits'

export function detectImageMime(bytes: Uint8Array): PdfImageAnnotationRecord['mimeType'] | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  ) return 'image/webp'
  return null
}

/**
 * Read pixel dimensions straight from the image header without decoding pixels.
 * Lets callers reject decompression-bomb-sized images before the expensive
 * createImageBitmap decode ever runs. Returns null when the header cannot be parsed.
 */
export function readImageHeaderDimensions(
  bytes: Uint8Array,
  mimeType: string,
): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/png') {
      // 8-byte signature | 4-byte length | "IHDR" | 4-byte width (BE) | 4-byte height (BE)
      if (bytes.length < 24) return null
      if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null
      const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
      const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
      return { width, height }
    }
    if (mimeType === 'image/jpeg') {
      let offset = 2 // skip SOI marker
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) return null
        const marker = bytes[offset + 1]
        // SOF markers (exclude DHT/C4, JPG/C8, DAC/CC) carry the frame dimensions.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = (bytes[offset + 5] << 8) | bytes[offset + 6]
          const width = (bytes[offset + 7] << 8) | bytes[offset + 8]
          return { width, height }
        }
        const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3]
        if (segLen < 2) return null
        offset += 2 + segLen
      }
      return null
    }
    if (mimeType === 'image/webp') {
      if (bytes.length < 16) return null
      const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
      if (fourcc === 'VP8X') {
        if (bytes.length < 30) return null
        const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
        const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
        return { width, height }
      }
      if (fourcc === 'VP8L') {
        if (bytes.length < 25) return null
        const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24]
        const width = 1 + (((b2 & 0x3f) << 8) | b1)
        const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
        return { width, height }
      }
      if (fourcc === 'VP8 ') {
        if (bytes.length < 30) return null
        const width = bytes[26] | ((bytes[27] & 0x3f) << 8)
        const height = bytes[28] | ((bytes[29] & 0x3f) << 8)
        return { width, height }
      }
      return null
    }
  } catch {
    return null
  }
  return null
}

export async function readImageDimensions(data: ArrayBuffer, mimeType: string): Promise<{ width: number; height: number }> {
  // Prefer cheap header parsing so oversized images are rejected before decoding.
  const header = readImageHeaderDimensions(new Uint8Array(data), mimeType)
  if (header && header.width > 0 && header.height > 0) return header
  const blob = new Blob([data], { type: mimeType })
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    try {
      return { width: bitmap.width, height: bitmap.height }
    } finally {
      bitmap.close()
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('Could not decode the image'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

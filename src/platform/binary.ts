import type { BinaryLike } from '@/types/desktop-api'
import { AppError } from './app-error'

const WAE1_MAGIC = new Uint8Array([0x57, 0x41, 0x45, 0x31])
const WAE1_HEADER_BYTES = 8
const MAX_WAE1_METADATA_BYTES = 1024 * 1024

export interface Wae1Envelope<T> {
  metadata: T
  payload: Uint8Array
}

export function encodeWae1(metadata: unknown, payload: BinaryLike): Uint8Array {
  const metadataJson = JSON.stringify(metadata)
  if (metadataJson === undefined) {
    throw new AppError({ code: 'invalid-binary', message: 'WAE1 metadata is not serializable' })
  }
  const metadataBytes = new TextEncoder().encode(metadataJson)
  if (metadataBytes.byteLength > MAX_WAE1_METADATA_BYTES) {
    throw new AppError({ code: 'invalid-binary', message: 'WAE1 metadata exceeds 1 MiB' })
  }
  const bytes = toUint8Array(payload)
  const output = new Uint8Array(WAE1_HEADER_BYTES + metadataBytes.byteLength + bytes.byteLength)
  output.set(WAE1_MAGIC, 0)
  new DataView(output.buffer).setUint32(4, metadataBytes.byteLength, true)
  output.set(metadataBytes, WAE1_HEADER_BYTES)
  output.set(bytes, WAE1_HEADER_BYTES + metadataBytes.byteLength)
  return output
}

export function decodeWae1<T>(value: unknown): Wae1Envelope<T> {
  const bytes = toUint8Array(value)
  if (
    bytes.byteLength < WAE1_HEADER_BYTES
    || WAE1_MAGIC.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new AppError({ code: 'invalid-binary', message: 'Binary IPC response is not WAE1' })
  }
  const metadataLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(4, true)
  if (metadataLength > MAX_WAE1_METADATA_BYTES || WAE1_HEADER_BYTES + metadataLength > bytes.byteLength) {
    throw new AppError({ code: 'invalid-binary', message: 'WAE1 metadata length is invalid' })
  }
  try {
    const json = new TextDecoder('utf-8', { fatal: true })
      .decode(bytes.subarray(WAE1_HEADER_BYTES, WAE1_HEADER_BYTES + metadataLength))
    return {
      metadata: JSON.parse(json) as T,
      payload: bytes.subarray(WAE1_HEADER_BYTES + metadataLength),
    }
  } catch (error) {
    throw new AppError({ code: 'invalid-binary', message: 'WAE1 metadata is invalid JSON' }, error)
  }
}

export function base64ToBytes(value: string, maxBytes?: number): Uint8Array {
  if (maxBytes !== undefined) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new AppError({ code: 'invalid-argument', message: 'Invalid Base64 byte limit' })
    }
    const maxEncodedLength = Math.ceil(maxBytes / 3) * 4
    if (value.length > maxEncodedLength) {
      throw new AppError({ code: 'file-too-large', message: `Base64 payload exceeds ${maxBytes} bytes` })
    }
  }
  try {
    const binary = atob(value)
    if (maxBytes !== undefined && binary.length > maxBytes) {
      throw new AppError({ code: 'file-too-large', message: `Base64 payload exceeds ${maxBytes} bytes` })
    }
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError({ code: 'invalid-binary', message: 'Invalid base64 document payload' }, error)
  }
}

export function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  throw new AppError({
    code: 'invalid-binary',
    message: 'Desktop command returned an unsupported binary payload',
    details: { receivedType: Object.prototype.toString.call(value) },
  })
}

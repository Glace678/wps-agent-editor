export type PdfRotation = 0 | 90 | 180 | 270

export interface PdfPageInfo {
  index: number
  width: number
  height: number
}

export interface PdfNormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfFontDescriptor {
  fontId: string
  familyName: string
  faceIndex: number
  weight: number
  style: 'normal' | 'italic' | 'oblique'
}

export interface PdfTextAnnotationRecord {
  id: string
  type: 'text'
  pageIndex: number
  rect: PdfNormalizedRect
  text: string
  font: PdfFontDescriptor
  fontSize: number
  underline: boolean
  color: string
}

export interface PdfImageAnnotationRecord {
  id: string
  type: 'image'
  pageIndex: number
  rect: PdfNormalizedRect
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  previewPng?: ArrayBuffer
}

export type PdfAnnotationRecord = PdfTextAnnotationRecord | PdfImageAnnotationRecord

export interface PdfOpenResult {
  needsPassword: boolean
  encrypted: boolean
  canAnnotate: boolean
  hasSignatures: boolean
  pages: PdfPageInfo[]
  annotations: PdfAnnotationRecord[]
  canUndo: boolean
  canRedo: boolean
  dirty: boolean
}

export interface PdfMutationResult {
  annotations: PdfAnnotationRecord[]
  canUndo: boolean
  canRedo: boolean
  dirty: boolean
}

export type PdfWorkerRequest =
  | {
      type: 'open'
      requestId: string
      documentId: string
      data: ArrayBuffer
    }
  | {
      type: 'authenticate'
      requestId: string
      documentId: string
      password: string
    }
  | {
      type: 'render'
      requestId: string
      documentId: string
      pageIndex: number
      targetWidth: number
      rotation: PdfRotation
    }
  | {
      type: 'extractText'
      requestId: string
      documentId: string
    }
  | {
      type: 'upsertText'
      requestId: string
      documentId: string
      annotation: PdfTextAnnotationRecord
      fontData?: ArrayBuffer
    }
  | {
      type: 'createImage'
      requestId: string
      documentId: string
      annotation: PdfImageAnnotationRecord
      imageData: ArrayBuffer
    }
  | {
      type: 'updateImage'
      requestId: string
      documentId: string
      annotation: PdfImageAnnotationRecord
    }
  | {
      type: 'updateGeometry'
      requestId: string
      documentId: string
      annotation: PdfAnnotationRecord
    }
  | {
      type: 'deleteAnnotation'
      requestId: string
      documentId: string
      annotationId: string
    }
  | {
      type: 'undo' | 'redo' | 'save' | 'close'
      requestId: string
      documentId: string
    }

export interface PdfRenderResult {
  pageIndex: number
  width: number
  height: number
  png: ArrayBuffer
}

export interface PdfSaveResult {
  data: ArrayBuffer
}

export type PdfWorkerSuccess = {
  requestId: string
  documentId: string
  ok: true
  result: unknown
}

export type PdfWorkerFailure = {
  requestId: string
  documentId: string
  ok: false
  error: {
    code: string
    message: string
  }
}

export type PdfWorkerResponse = PdfWorkerSuccess | PdfWorkerFailure

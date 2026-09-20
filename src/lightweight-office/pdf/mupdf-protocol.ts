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
  /** Original body-text baseline, in PDF points below the top of rect. */
  baseline?: number
  /** Body paragraphs retain their original leading and first-line indent (PDF points). */
  lineHeight?: number
  firstLineIndent?: number
  paragraph?: boolean
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
      type: 'loadTextLayer'
      requestId: string
      documentId: string
      pageIndex: number
    }
  | {
      type: 'upsertText'
      requestId: string
      documentId: string
      annotation: PdfTextAnnotationRecord
      fontData?: ArrayBuffer
    }
  | {
      // 修改正文段落：按源行范围抹除原字，再在段落位置写入 WAE FreeText。
      // text 为空表示仅抹除原文。
      type: 'replaceBodyText'
      requestId: string
      documentId: string
      pageIndex: number
      redactionRect: PdfNormalizedRect
      redactionRects?: PdfNormalizedRect[]
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

/** 一行可选文字（坐标已归一化到页面 CropBox 的 0..1，未旋转坐标系） */
export interface PdfTextLine {
  text: string
  x: number
  y: number
  width: number
  height: number
  /** 正文行的字体信息（用于“点原文直接改”时的就地编辑匹配） */
  fontFamily?: string
  fontSize?: number
  /** Baseline offset from the top of this line, in PDF points. */
  baseline?: number
  fontBold?: boolean
  fontItalic?: boolean
  color?: string
}

export interface PdfTextLayer {
  pageIndex: number
  lines: PdfTextLine[]
  paragraphs: PdfTextParagraph[]
}

/** A contiguous body paragraph, with source lines retained for precise redaction. */
export interface PdfTextParagraph extends PdfTextLine {
  lines: PdfTextLine[]
  lineHeight?: number
  firstLineIndent?: number
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

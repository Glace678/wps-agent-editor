import type {
  PresentationEditOperation as RustPresentationEditOperation,
  PresentationEditResponseMetadata,
  PresentationSlideText as RustPresentationSlideText,
} from './generated'

export type PresentationSlideText = RustPresentationSlideText
export type PresentationEditOperation = RustPresentationEditOperation

export interface PresentationEditRequest {
  data: Uint8Array | ArrayBuffer
  operation: PresentationEditOperation
}

export interface PresentationEditResult extends Omit<
  PresentationEditResponseMetadata,
  'hasData' | 'converter'
> {
  data?: Uint8Array | ArrayBuffer
  converter: 'powerpoint' | 'wps'
}

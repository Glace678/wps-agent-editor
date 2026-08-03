export interface PresentationSlideText {
  title: string
  body: string
}

export type PresentationEditOperation =
  | { type: 'inspect'; slideIndex: number }
  | { type: 'add'; afterSlideIndex: number }
  | { type: 'updateText'; slideIndex: number; title: string; body: string }
  | { type: 'updateNodeText'; slideIndex: number; nodeId: string; text: string }
  | { type: 'duplicate'; slideIndex: number }
  | { type: 'delete'; slideIndex: number }
  | { type: 'importOutline'; afterSlideIndex: number; slides: PresentationSlideText[] }
  | { type: 'reuseSlides'; afterSlideIndex: number; sourcePath: string }

export interface PresentationEditRequest {
  data: Uint8Array | ArrayBuffer
  operation: PresentationEditOperation
}

export interface PresentationEditResult {
  data?: Uint8Array | ArrayBuffer
  slideCount: number
  currentSlideIndex: number
  slide?: PresentationSlideText
  converter: 'powerpoint' | 'wps'
  normalizedWmfCount: number
}

import type {
  PdfAnnotationRecord,
  PdfImageAnnotationRecord,
  PdfMutationResult,
  PdfOpenResult,
  PdfRenderResult,
  PdfRotation,
  PdfSaveResult,
  PdfTextAnnotationRecord,
  PdfWorkerRequest,
  PdfWorkerResponse,
} from './mupdf-protocol'

interface PendingRequest {
  documentId: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

type PdfWorkerRequestInput = PdfWorkerRequest extends infer Request
  ? Request extends PdfWorkerRequest
    ? Omit<Request, 'requestId' | 'documentId'>
    : never
  : never

export class MuPdfClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export class MuPdfWorkerClient {
  private readonly worker: Worker
  private readonly pending = new Map<string, PendingRequest>()
  private disposed = false

  constructor(readonly documentId: string) {
    this.worker = new Worker(new URL('./mupdf.worker.ts', import.meta.url), {
      type: 'module',
      name: `wae-pdf-${documentId}`,
    })
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleWorkerError)
  }

  private readonly handleMessage = (event: MessageEvent<PdfWorkerResponse>) => {
    const response = event.data
    const pending = this.pending.get(response.requestId)
    if (!pending || pending.documentId !== response.documentId) return
    this.pending.delete(response.requestId)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new MuPdfClientError(response.error.code, response.error.message))
  }

  private readonly handleWorkerError = (event: ErrorEvent) => {
    const error = new MuPdfClientError(
      'pdf-worker-crashed',
      event.message || 'The PDF worker stopped unexpectedly',
    )
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private request<TResult>(
    request: PdfWorkerRequestInput,
    transfer: Transferable[] = [],
  ): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(new MuPdfClientError('pdf-worker-closed', 'The PDF worker is closed'))
    }
    const requestId = crypto.randomUUID()
    const payload = { ...request, requestId, documentId: this.documentId } as PdfWorkerRequest
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(requestId, {
        documentId: this.documentId,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      try {
        this.worker.postMessage(payload, transfer)
      } catch (error) {
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }

  open(data: ArrayBuffer): Promise<PdfOpenResult> {
    return this.request({ type: 'open', data }, [data])
  }

  authenticate(password: string): Promise<{
    authenticated: boolean
    document?: PdfOpenResult
  }> {
    return this.request({ type: 'authenticate', password })
  }

  render(pageIndex: number, targetWidth: number, rotation: PdfRotation): Promise<PdfRenderResult> {
    return this.request({ type: 'render', pageIndex, targetWidth, rotation })
  }

  extractText(): Promise<string> {
    return this.request({ type: 'extractText' })
  }

  upsertText(
    annotation: PdfTextAnnotationRecord,
    fontData?: ArrayBuffer,
  ): Promise<PdfMutationResult> {
    return this.request(
      { type: 'upsertText', annotation, fontData },
      fontData ? [fontData] : [],
    )
  }

  createImage(
    annotation: PdfImageAnnotationRecord,
    imageData: ArrayBuffer,
  ): Promise<PdfMutationResult> {
    return this.request({ type: 'createImage', annotation, imageData }, [imageData])
  }

  updateImage(annotation: PdfImageAnnotationRecord): Promise<PdfMutationResult> {
    return this.request({ type: 'updateImage', annotation })
  }

  updateGeometry(annotation: PdfAnnotationRecord): Promise<PdfMutationResult> {
    return this.request({ type: 'updateGeometry', annotation })
  }

  deleteAnnotation(annotationId: string): Promise<PdfMutationResult> {
    return this.request({ type: 'deleteAnnotation', annotationId })
  }

  undo(): Promise<PdfMutationResult> {
    return this.request({ type: 'undo' })
  }

  redo(): Promise<PdfMutationResult> {
    return this.request({ type: 'redo' })
  }

  save(): Promise<PdfSaveResult> {
    return this.request({ type: 'save' })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleWorkerError)
    this.worker.terminate()
    const error = new MuPdfClientError('pdf-worker-closed', 'The PDF worker is closed')
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

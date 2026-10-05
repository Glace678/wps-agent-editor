import type {
  PdfAnnotationRecord,
  PdfImageAnnotationRecord,
  PdfMutationResult,
  PdfOpenResult,
  PdfRenderResult,
  PdfRotation,
  PdfSaveResult,
  PdfTextAnnotationRecord,
  PdfTextLayer,
  PdfWorkerRequest,
  PdfWorkerResponse,
} from './mupdf-protocol'

interface PendingRequest {
  documentId: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

// 每请求超时看门狗：worker 串行队列一旦在畸形 PDF 上卡住，UI 不应无限 loading。
// 取宽裕值，只兜“worker 无响应”，不误杀大文档渲染。
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000

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
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  // 文字层不可变且按页复用；记忆化 Promise 让 StrictMode 双挂载/多调用方共享同一请求，
  // 避免「响应被某一任调用方丢弃后不再重试」的竞态
  private readonly textLayerCache = new Map<number, Promise<PdfTextLayer>>()
  private disposed = false
  // Crash gate: once the worker errors it cannot service further requests, so any
  // later postMessage would hang forever. Fail closed instead of pending.
  private workerFailed = false

  constructor(readonly documentId: string) {
    this.worker = new Worker(new URL('./mupdf.worker.ts', import.meta.url), {
      type: 'module',
      name: `wae-pdf-${documentId}`,
    })
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleWorkerError)
    this.worker.addEventListener('messageerror', this.handleMessageError)
  }

  private readonly handleMessage = (event: MessageEvent<PdfWorkerResponse>) => {
    const response = event.data
    const pending = this.pending.get(response.requestId)
    if (!pending || pending.documentId !== response.documentId) return
    this.pending.delete(response.requestId)
    this.clearTimer(response.requestId)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new MuPdfClientError(response.error.code, response.error.message))
  }

  private readonly handleWorkerError = (event: ErrorEvent) => {
    this.workerFailed = true
    const error = new MuPdfClientError(
      'pdf-worker-crashed',
      event.message || 'The PDF worker stopped unexpectedly',
    )
    this.rejectAllPending(error)
  }

  private readonly handleMessageError = () => {
    // structured-clone 失败（worker→client 的响应无法反序列化）走 messageerror 而非 error。
    // 此时无法定位具体 requestId，把所有挂起请求统一拒绝以免永久挂起；worker 本身仍存活，
    // 故不置 workerFailed，后续请求仍可服务。
    const error = new MuPdfClientError(
      'message-error',
      'A PDF worker message could not be deserialized',
    )
    this.rejectAllPending(error)
  }

  private clearTimer(requestId: string): void {
    const timer = this.timers.get(requestId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(requestId)
    }
  }

  private rejectAllPending(error: MuPdfClientError): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private request<TResult>(
    request: PdfWorkerRequestInput,
    transfer: Transferable[] = [],
  ): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(new MuPdfClientError('pdf-worker-closed', 'The PDF worker is closed'))
    }
    if (this.workerFailed) {
      return Promise.reject(new MuPdfClientError('pdf-worker-crashed', 'The PDF worker stopped unexpectedly'))
    }
    const requestId = crypto.randomUUID()
    const payload = { ...request, requestId, documentId: this.documentId } as PdfWorkerRequest
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(requestId, {
        documentId: this.documentId,
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      const timer = setTimeout(() => {
        if (!this.pending.has(requestId)) return
        this.pending.delete(requestId)
        this.timers.delete(requestId)
        reject(new MuPdfClientError(
          'request-timeout',
          `The PDF request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS / 1000}s`,
        ))
      }, DEFAULT_REQUEST_TIMEOUT_MS)
      this.timers.set(requestId, timer)
      try {
        this.worker.postMessage(payload, transfer)
      } catch (error) {
        this.pending.delete(requestId)
        this.clearTimer(requestId)
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

  loadTextLayer(pageIndex: number): Promise<PdfTextLayer> {
    const cached = this.textLayerCache.get(pageIndex)
    if (cached) return cached
    const promise = this.request<PdfTextLayer>({ type: 'loadTextLayer', pageIndex })
    this.textLayerCache.set(pageIndex, promise)
    // 失败后移出缓存，允许后续重试
    promise.catch(() => {
      if (this.textLayerCache.get(pageIndex) === promise) this.textLayerCache.delete(pageIndex)
    })
    return promise
  }

  /** 正文行被替换后，该页文字层已失效，必须丢弃缓存以便重新提取。 */
  invalidateTextLayer(pageIndex: number): void {
    this.textLayerCache.delete(pageIndex)
  }

  replaceBodyText(
    pageIndex: number,
    redactionRect: PdfTextAnnotationRecord['rect'],
    annotation: PdfTextAnnotationRecord,
    fontData?: ArrayBuffer,
    redactionRects?: PdfTextAnnotationRecord['rect'][],
  ): Promise<PdfMutationResult> {
    return this.request(
      { type: 'replaceBodyText', pageIndex, redactionRect, redactionRects, annotation, fontData },
      fontData ? [fontData] : [],
    )
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
    this.worker.removeEventListener('messageerror', this.handleMessageError)
    this.worker.terminate()
    const error = new MuPdfClientError('pdf-worker-closed', 'The PDF worker is closed')
    this.rejectAllPending(error)
    this.textLayerCache.clear()
  }
}

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

/** A mutation whose response arrived after its watchdog timeout. */
export interface LateMutation {
  requestId: string
  result: PdfMutationResult
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
  // wps_09 B-5: a request timeout means the worker's serial queue is not
  // processing (typically wedged on a malformed PDF). Without this gate every
  // following request would post into the same wedged queue and each wait its
  // own 120s. Once degraded, further requests fail-fast; the viewer recreates
  // the client and reopens the document instead.
  private degraded = false
  // Mutations that timed out but may still complete in the worker; their late
  // responses are delivered to these listeners for reconciliation (wps_04 F6).
  private readonly timedOutMutations = new Map<string, string>()
  private readonly lateMutationListeners = new Set<(event: LateMutation) => void>()
  private readonly degradedListeners = new Set<() => void>()

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
    if (!pending || pending.documentId !== response.documentId) {
      // No live requester: this is a late response. For a timed-out mutation
      // deliver it for reconciliation instead of silently dropping it
      // (wps_04 F6).
      if (
        response.ok
        && this.timedOutMutations.get(response.requestId) === response.documentId
      ) {
        this.timedOutMutations.delete(response.requestId)
        const late: LateMutation = {
          requestId: response.requestId,
          result: response.result as PdfMutationResult,
        }
        for (const listener of this.lateMutationListeners) listener(late)
      }
      return
    }
    this.pending.delete(response.requestId)
    this.clearTimer(response.requestId)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new MuPdfClientError(response.error.code, response.error.message))
  }

  /** Subscribe to mutation results that arrive after their request timed out. */
  onLateMutation(listener: (event: LateMutation) => void): () => void {
    this.lateMutationListeners.add(listener)
    return () => this.lateMutationListeners.delete(listener)
  }

  /** Subscribe to the worker becoming wedged so the viewer can reopen. */
  onDegraded(listener: () => void): () => void {
    this.degradedListeners.add(listener)
    return () => this.degradedListeners.delete(listener)
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
    // wps_09 B-5: treated as degraded — pending requests are rejected and later
    // requests fail-fast so the viewer can recreate the client, instead of the
    // previous behavior where only the current batch failed and new requests
    // kept posting into an unreliable channel.
    this.markDegraded(new MuPdfClientError(
      'message-error',
      'A PDF worker message could not be deserialized',
    ))
  }

  /** Whether the worker is wedged and the viewer must recreate the client. */
  get isDegraded(): boolean {
    return this.degraded
  }

  /**
   * Flip to degraded and fail-fast every request still queued behind the
   * wedged one. Timed-out mutations stay tracked so an edit that still lands
   * can reconcile via the late-mutation channel.
   */
  private markDegraded(
    error: MuPdfClientError = new MuPdfClientError(
      'worker-degraded',
      'The PDF worker stopped responding; please reopen the document.',
    ),
  ): void {
    if (this.degraded) return
    this.degraded = true
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const listener of this.degradedListeners) listener()
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
    // A dead/crashed worker can no longer deliver these late responses.
    this.timedOutMutations.clear()
  }

  private request<TResult>(
    request: PdfWorkerRequestInput,
    transfer: Transferable[] = [],
    mutation = false,
  ): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(new MuPdfClientError('pdf-worker-closed', 'The PDF worker is closed'))
    }
    if (this.workerFailed) {
      return Promise.reject(new MuPdfClientError('pdf-worker-crashed', 'The PDF worker stopped unexpectedly'))
    }
    if (this.degraded) {
      return Promise.reject(new MuPdfClientError(
        'worker-degraded',
        'The PDF worker stopped responding; please reopen the document',
      ))
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
        if (mutation) {
          // The worker's serial queue may still execute this edit; remember
          // the request so its eventual result reconciles the UI (wps_04 F6).
          this.timedOutMutations.set(requestId, this.documentId)
        }
        // Fail every queued/future request at once instead of letting each
        // wait its own timeout (wps_09 B-5). This request rejects separately
        // below; mutation reconciliation stays possible because markDegraded
        // deliberately does not clear timedOutMutations.
        this.markDegraded()
        const suffix = mutation
          ? ' The operation may still have been applied; the view reconciles automatically when the worker finishes it.'
          : ''
        reject(new MuPdfClientError(
          'request-timeout',
          `The PDF request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS / 1000}s.${suffix}`,
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
      true,
    )
  }

  upsertText(
    annotation: PdfTextAnnotationRecord,
    fontData?: ArrayBuffer,
  ): Promise<PdfMutationResult> {
    return this.request(
      { type: 'upsertText', annotation, fontData },
      fontData ? [fontData] : [],
      true,
    )
  }

  createImage(
    annotation: PdfImageAnnotationRecord,
    imageData: ArrayBuffer,
  ): Promise<PdfMutationResult> {
    return this.request({ type: 'createImage', annotation, imageData }, [imageData], true)
  }

  updateImage(annotation: PdfImageAnnotationRecord): Promise<PdfMutationResult> {
    return this.request({ type: 'updateImage', annotation }, [], true)
  }

  updateGeometry(annotation: PdfAnnotationRecord): Promise<PdfMutationResult> {
    return this.request({ type: 'updateGeometry', annotation }, [], true)
  }

  deleteAnnotation(annotationId: string): Promise<PdfMutationResult> {
    return this.request({ type: 'deleteAnnotation', annotationId }, [], true)
  }

  undo(): Promise<PdfMutationResult> {
    return this.request({ type: 'undo' }, [], true)
  }

  redo(): Promise<PdfMutationResult> {
    return this.request({ type: 'redo' }, [], true)
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
    this.degradedListeners.clear()
    this.lateMutationListeners.clear()
  }
}

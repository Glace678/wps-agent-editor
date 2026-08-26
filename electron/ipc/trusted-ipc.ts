import {
  ipcMain,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import {
  canonicalRendererDocument,
  isTrustedRendererDocument,
} from '../security/renderer-boundary'

interface TrustedRenderer {
  contents: WebContents
  documentUrl: string
}

const trustedRenderers = new Map<number, TrustedRenderer>()

export function registerTrustedRenderer(contents: WebContents, rendererUrl: string): void {
  const documentUrl = canonicalRendererDocument(rendererUrl)
  if (!documentUrl) throw new Error('INVALID_TRUSTED_RENDERER_URL')

  trustedRenderers.set(contents.id, { contents, documentUrl })
  contents.once('destroyed', () => {
    const current = trustedRenderers.get(contents.id)
    if (current?.contents === contents) trustedRenderers.delete(contents.id)
  })
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const trusted = trustedRenderers.get(event.sender.id)
  const senderFrame = event.senderFrame
  if (
    !trusted
    || trusted.contents !== event.sender
    || event.sender.isDestroyed()
    || !senderFrame
    || senderFrame !== event.sender.mainFrame
    || !isTrustedRendererDocument(senderFrame.url, trusted.documentUrl)
  ) {
    throw new Error('UNTRUSTED_IPC_SENDER')
  }
}

type IpcMainHandler = Parameters<typeof ipcMain.handle>[1]

export function handleTrustedIpc(
  channel: string,
  listener: IpcMainHandler,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event)
    return listener(event, ...args)
  })
}

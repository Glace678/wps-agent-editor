/**
 * 内嵌本地 Bridge — 文档 HTTP 服务 + 保存回调
 * 完全离线，随 Electron 主进程启动
 */
import express, { type Express } from 'express'
import cors from 'cors'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { Server } from 'node:http'

const configuredPort = Number.parseInt(process.env.WPS_BRIDGE_PORT ?? '', 10)
const BRIDGE_PORT = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
  ? configuredPort
  : 13001
const keyToPath = new Map<string, string>()

let server: Server | null = null
let expressApp: Express | null = null

function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'oo-cache')
}

export function registerDocumentKey(key: string, filePath: string): void {
  keyToPath.set(key, path.normalize(filePath))
}

export function getBridgeUrl(): string {
  return `http://127.0.0.1:${BRIDGE_PORT}`
}

export async function startLocalBridge(): Promise<void> {
  if (server) return

  await fs.mkdir(getCacheDir(), { recursive: true })

  expressApp = express()
  expressApp.use(cors())
  expressApp.use(express.json({ limit: '100mb' }))

  expressApp.get('/health', (_req, res) => {
    res.json({ status: 'ok', offline: true })
  })

  expressApp.get('/documents/:fileName', async (req, res) => {
    const filePath = req.query.path as string
    if (!filePath) return res.status(400).json({ error: 'Missing path' })

    try {
      const normalized = path.normalize(filePath)
      await fs.access(normalized)
      const cachePath = path.join(getCacheDir(), path.basename(normalized))
      await fs.copyFile(normalized, cachePath)

      const ext = path.extname(normalized).slice(1)
      const mimeTypes: Record<string, string> = {
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc: 'application/msword',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        xls: 'application/vnd.ms-excel',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        pdf: 'application/pdf',
        txt: 'text/plain',
        csv: 'text/csv',
        md: 'text/markdown',
      }
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
      const buffer = await fs.readFile(cachePath)
      res.send(buffer)
    } catch (err) {
      console.error('[Bridge] serve error:', err)
      res.status(404).json({ error: 'File not found' })
    }
  })

  expressApp.post('/callback', async (req, res) => {
    const { status, url, key } = req.body
    if ((status === 2 || status === 6) && url && key) {
      const originalPath = keyToPath.get(key)
      if (originalPath) {
        try {
          const response = await fetch(url)
          const buffer = Buffer.from(await response.arrayBuffer())
          await fs.writeFile(originalPath, buffer)
          console.log('[Bridge] Saved offline:', originalPath)
        } catch (err) {
          console.error('[Bridge] save error:', err)
        }
      }
    }
    res.json({ error: 0 })
  })

  expressApp.post('/register', (req, res) => {
    const { key, filePath } = req.body
    if (key && filePath) {
      registerDocumentKey(key, filePath)
      res.json({ success: true })
    } else {
      res.status(400).json({ error: 'Missing key or filePath' })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server = expressApp!.listen(BRIDGE_PORT, '127.0.0.1', () => {
      console.log(`[Bridge] Offline document server at ${getBridgeUrl()}`)
      resolve()
    })
    server.on('error', reject)
  })
}

export async function stopLocalBridge(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
    expressApp = null
  }
}

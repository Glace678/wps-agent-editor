/**
 * OnlyOffice Bridge Server
 * 为 Document Server 提供文档下载地址和保存回调
 */
import express from 'express'
import cors from 'cors'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10)
const JWT_SECRET = process.env.OO_JWT_SECRET || 'your-secret-key'
const CACHE_DIR = path.join(process.cwd(), '.oo-cache')

const app = express()
app.use(cors())
app.use(express.json({ limit: '100mb' }))

await fs.mkdir(CACHE_DIR, { recursive: true })

// 文档下载端点 — Document Server 通过此 URL 获取文件
app.get('/documents/:fileName', async (req, res) => {
  const filePath = req.query.path as string
  if (!filePath) {
    return res.status(400).json({ error: 'Missing path query parameter' })
  }

  try {
    const normalized = path.normalize(filePath)
    await fs.access(normalized)

    // 缓存副本供 Document Server 访问
    const cachePath = path.join(CACHE_DIR, path.basename(normalized))
    await fs.copyFile(normalized, cachePath)

    const ext = path.extname(normalized).slice(1)
    const mimeTypes: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      pdf: 'application/pdf',
      txt: 'text/plain',
      csv: 'text/csv',
    }

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(normalized))}"`)
    const buffer = await fs.readFile(cachePath)
    res.send(buffer)
  } catch (err) {
    console.error('Document serve error:', err)
    res.status(404).json({ error: 'File not found' })
  }
})

// OnlyOffice 保存回调
app.post('/callback', async (req, res) => {
  const { status, url, key } = req.body
  console.log(`[Callback] status=${status}, key=${key}`)

  // status 2 = 文档已编辑待保存, 6 = 强制保存
  if ((status === 2 || status === 6) && url) {
    try {
      const originalPath = keyToPath.get(key)
      if (originalPath) {
        const response = await fetch(url)
        const buffer = Buffer.from(await response.arrayBuffer())
        await fs.writeFile(originalPath, buffer)
        console.log(`[Callback] Saved: ${originalPath}`)
      }
    } catch (err) {
      console.error('[Callback] Save error:', err)
    }
  }

  res.json({ error: 0 })
})

// 注册文档 key → 文件路径映射
const keyToPath = new Map<string, string>()

app.post('/register', (req, res) => {
  const { key, filePath } = req.body
  if (key && filePath) {
    keyToPath.set(key, path.normalize(filePath))
    res.json({ success: true })
  } else {
    res.status(400).json({ error: 'Missing key or filePath' })
  }
})

// 生成 JWT token
app.post('/token', (req, res) => {
  const { payload } = req.body
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })
  res.json({ token })
})

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', cacheDir: CACHE_DIR })
})

app.listen(PORT, () => {
  console.log(`OnlyOffice Bridge Server running on http://localhost:${PORT}`)
  console.log(`Cache directory: ${CACHE_DIR}`)
})
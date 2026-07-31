import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedAt: number
  extension: string
}

const SUPPORTED_EXTENSIONS = new Set([
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.pdf', '.txt', '.md', '.csv', '.odt', '.ods',
])

export function normalizePath(p: string): string {
  return path.normalize(p)
}

export function getHomeDir(): string {
  return os.homedir()
}

export function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return SUPPORTED_EXTENSIONS.has(ext)
}

export async function listDirectory(dirPath: string): Promise<FileEntry[]> {
  const normalized = normalizePath(dirPath)
  const entries = await fs.readdir(normalized, { withFileTypes: true })

  const results: FileEntry[] = []
  for (const entry of entries) {
    const fullPath = path.join(normalized, entry.name)
    try {
      const stat = await fs.stat(fullPath)
      const ext = entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase()
      if (entry.isDirectory() || SUPPORTED_EXTENSIONS.has(ext)) {
        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          extension: ext,
        })
      }
    } catch {
      // 跳过无权限文件
    }
  }

  return results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export async function searchFiles(
  rootPath: string,
  query: string,
  maxDepth = 4,
  maxResults = 100,
): Promise<FileEntry[]> {
  const results: FileEntry[] = []
  const lowerQuery = query.toLowerCase()

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || results.length >= maxResults) return

    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await walk(fullPath, depth + 1)
        }
      } else if (entry.name.toLowerCase().includes(lowerQuery)) {
        const ext = path.extname(entry.name).toLowerCase()
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          try {
            const stat = await fs.stat(fullPath)
            results.push({
              name: entry.name,
              path: fullPath,
              isDirectory: false,
              size: stat.size,
              modifiedAt: stat.mtimeMs,
              extension: ext,
            })
          } catch { /* skip */ }
        }
      }
    }
  }

  await walk(normalizePath(rootPath), 0)
  return results
}

export async function readFileBuffer(filePath: string): Promise<Buffer> {
  return fs.readFile(normalizePath(filePath))
}

export function getFileType(filePath: string): 'word' | 'cell' | 'slide' | 'pdf' | 'unknown' {
  const ext = path.extname(filePath).toLowerCase()
  if (['.docx', '.doc', '.odt', '.txt', '.md'].includes(ext)) return 'word'
  if (['.xlsx', '.xls', '.ods', '.csv'].includes(ext)) return 'cell'
  if (['.pptx', '.ppt'].includes(ext)) return 'slide'
  if (ext === '.pdf') return 'pdf'
  return 'unknown'
}
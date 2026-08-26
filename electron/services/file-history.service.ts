import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'
import { normalizePath } from './file.service'

export interface FileVersion {
  /** 快照在磁盘上的文件名，如 "1753500000000.docx" */
  id: string
  savedAt: number
  size: number
}

interface HistoryIndexEntry extends FileVersion {
  /** 快照时源文件的 mtime，用于跳过内容未变化的重复快照 */
  sourceMtimeMs: number
}

const MAX_VERSIONS = 10
const MAX_SNAPSHOT_SIZE = 50 * 1024 * 1024
const MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000
const VERSION_ID_PATTERN = /^\d+(\.[a-z0-9]+)?$/i

function historyDirFor(normalized: string): string {
  const key = crypto.createHash('sha1').update(normalized.toLowerCase()).digest('hex')
  return path.join(app.getPath('userData'), 'file-history', key)
}

async function readIndex(dir: string): Promise<HistoryIndexEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf-8')) as HistoryIndexEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeIndex(dir: string, entries: HistoryIndexEntry[]): Promise<void> {
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(entries, null, 2))
}

// 打开/保存/恢复可能并发触发同一文件的快照，按历史目录串行化避免 index.json 写坏
const chains = new Map<string, Promise<void>>()

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const run = prev.then(() => task(), () => task())
  const tail = run.then(() => undefined, () => undefined)
  chains.set(key, tail)
  // 链结算且没有新任务接上时移除条目，避免 Map 随打开过的文件数无限增长
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key)
  })
  return run
}

async function snapshotLocked(normalized: string, dir: string, force: boolean): Promise<boolean> {
  try {
    let stat
    try {
      stat = await fs.stat(normalized)
    } catch {
      return false
    }
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_SIZE) return false

    const index = await readIndex(dir)
    const latest = index[0]
    if (latest) {
      if (latest.sourceMtimeMs === stat.mtimeMs && latest.size === stat.size) return false
      if (!force && Date.now() - latest.savedAt < MIN_SNAPSHOT_INTERVAL_MS) return false
    }

    await fs.mkdir(dir, { recursive: true })
    const savedAt = Date.now()
    // 扩展名必须能通过 VERSION_ID_PATTERN，否则该版本会“可列出但不可恢复”
    const rawExt = path.extname(normalized).toLowerCase()
    const id = `${savedAt}${/^\.[a-z0-9]+$/.test(rawExt) ? rawExt : ''}`
    await fs.copyFile(normalized, path.join(dir, id))
    index.unshift({ id, savedAt, size: stat.size, sourceMtimeMs: stat.mtimeMs })
    const pruned = index.splice(MAX_VERSIONS)
    await writeIndex(dir, index)
    for (const entry of pruned) {
      try {
        await fs.rm(path.join(dir, entry.id))
      } catch {
        // 清理失败不影响主流程
      }
    }
    return true
  } catch {
    return false
  }
}

/** 为文件当前内容记录一个版本快照。永不抛错，可 fire-and-forget。 */
export function snapshotFile(filePath: string, options: { force?: boolean } = {}): Promise<boolean> {
  const normalized = normalizePath(filePath)
  const dir = historyDirFor(normalized)
  return serialize(dir, () => snapshotLocked(normalized, dir, options.force === true))
}

/**
 * 先快照旧内容，再写入新内容——两步在同一串行链内完成，
 * 避免并发的打开快照/恢复操作读到写了一半的文件。写盘失败会抛错。
 */
export function writeFileWithSnapshot(filePath: string, data: Buffer): Promise<void> {
  const normalized = normalizePath(filePath)
  const dir = historyDirFor(normalized)
  return serialize(dir, async () => {
    await snapshotLocked(normalized, dir, false)
    await fs.writeFile(normalized, data)
  })
}

/** 文件重命名后把历史目录迁移到新路径对应的键 */
export function moveFileHistory(oldPath: string, newPath: string): Promise<void> {
  const oldDir = historyDirFor(normalizePath(oldPath))
  const newDir = historyDirFor(normalizePath(newPath))
  if (oldDir === newDir) return Promise.resolve()
  return serialize(oldDir, async () => {
    try {
      await fs.rename(oldDir, newDir)
    } catch {
      // 无历史目录或目标已占用：忽略
    }
  })
}

/** 删除文件后清除其历史快照，避免已删文件在本地留下副本 */
export function deleteFileHistory(filePath: string): Promise<void> {
  const dir = historyDirFor(normalizePath(filePath))
  return serialize(dir, async () => {
    try {
      await fs.rm(dir, { recursive: true, force: true })
    } catch {
      // 清理失败不影响删除主流程
    }
  })
}

export function listFileHistory(filePath: string): Promise<FileVersion[]> {
  const dir = historyDirFor(normalizePath(filePath))
  return serialize(dir, async () => {
    const index = await readIndex(dir)
    const versions: FileVersion[] = []
    for (const { id, savedAt, size } of index) {
      try {
        await fs.access(path.join(dir, id))
        versions.push({ id, savedAt, size })
      } catch {
        // 快照文件被外部删除，跳过
      }
    }
    return versions
  })
}

export function restoreFileVersion(
  filePath: string,
  versionId: string,
): Promise<{ success: boolean; errorCode?: 'not-found' | 'failed' }> {
  const normalized = normalizePath(filePath)
  const dir = historyDirFor(normalized)
  return serialize(dir, async () => {
    // versionId 来自渲染进程，严格校验防止路径穿越
    if (!VERSION_ID_PATTERN.test(versionId)) return { success: false, errorCode: 'failed' as const }

    let data: Buffer
    try {
      data = await fs.readFile(path.join(dir, versionId))
    } catch {
      return { success: false, errorCode: 'not-found' as const }
    }

    // 恢复前把当前内容也留一个版本，避免误操作丢内容
    await snapshotLocked(normalized, dir, true)

    try {
      await fs.writeFile(normalized, data)
      return { success: true }
    } catch {
      return { success: false, errorCode: 'failed' as const }
    }
  })
}

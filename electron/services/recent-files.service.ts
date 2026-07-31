import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

export interface RecentFile {
  path: string
  name: string
  openedAt: number
}

const MAX_RECENT = 20

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'recent-files.json')
}

export async function getRecentFiles(): Promise<RecentFile[]> {
  try {
    const data = await fs.readFile(getStorePath(), 'utf-8')
    return JSON.parse(data) as RecentFile[]
  } catch {
    return []
  }
}

export async function addRecentFile(filePath: string): Promise<RecentFile[]> {
  const name = path.basename(filePath)
  let recent = await getRecentFiles()
  recent = recent.filter((f) => f.path !== filePath)
  recent.unshift({ path: filePath, name, openedAt: Date.now() })
  recent = recent.slice(0, MAX_RECENT)
  await fs.writeFile(getStorePath(), JSON.stringify(recent, null, 2))
  return recent
}

export async function removeRecentFile(filePath: string): Promise<RecentFile[]> {
  const recent = (await getRecentFiles()).filter((f) => f.path !== filePath)
  await fs.writeFile(getStorePath(), JSON.stringify(recent, null, 2))
  return recent
}

/** 文件重命名后同步打开记录里的路径与显示名 */
export async function renameRecentFile(oldPath: string, newPath: string): Promise<RecentFile[]> {
  const recent = await getRecentFiles()
  for (const entry of recent) {
    if (entry.path === oldPath) {
      entry.path = newPath
      entry.name = path.basename(newPath)
    }
  }
  await fs.writeFile(getStorePath(), JSON.stringify(recent, null, 2))
  return recent
}
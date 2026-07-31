import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { clipboard, shell } from 'electron'
import { normalizePath } from './file.service'

const execFileAsync = promisify(execFile)

export interface FileStatInfo {
  exists: boolean
  size: number
  modifiedAt: number
  createdAt: number
  extension: string
}

export type FileOpErrorCode = 'not-found' | 'name-exists' | 'invalid-name' | 'failed'

export interface RenameFileResult {
  success: boolean
  newPath?: string
  errorCode?: FileOpErrorCode
}

export async function statFile(filePath: string): Promise<FileStatInfo> {
  const extension = path.extname(filePath).toLowerCase()
  try {
    const stat = await fs.stat(normalizePath(filePath))
    return {
      exists: stat.isFile(),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      createdAt: stat.birthtimeMs || stat.mtimeMs,
      extension,
    }
  } catch {
    return { exists: false, size: 0, modifiedAt: 0, createdAt: 0, extension }
  }
}

// Windows 文件名非法字符；其余平台跟随最严格集合，保证跨平台可移动
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/
// Windows 保留设备名（含带扩展名形式，如 NUL.txt）
const RESERVED_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i

export async function renameFile(filePath: string, newName: string): Promise<RenameFileResult> {
  const trimmed = newName.trim()
  if (
    !trimmed
    || trimmed === '.'
    || trimmed === '..'
    || INVALID_NAME_CHARS.test(trimmed)
    || RESERVED_DEVICE_NAMES.test(trimmed)
    // Windows 会静默丢弃结尾的点号，导致实际文件名与打开记录不一致
    || trimmed.endsWith('.')
  ) {
    return { success: false, errorCode: 'invalid-name' }
  }

  const normalized = normalizePath(filePath)
  const target = path.join(path.dirname(normalized), trimmed)
  if (target === normalized) return { success: true, newPath: normalized }

  try {
    await fs.access(normalized)
  } catch {
    return { success: false, errorCode: 'not-found' }
  }

  // Windows 大小写不敏感：同一文件仅改大小写时跳过“同名已存在”检查
  const isCaseOnlyRename = target.toLowerCase() === normalized.toLowerCase()
  if (!isCaseOnlyRename) {
    try {
      await fs.access(target)
      return { success: false, errorCode: 'name-exists' }
    } catch {
      // 目标不存在，可以重命名
    }
  }

  try {
    await fs.rename(normalized, target)
    return { success: true, newPath: target }
  } catch {
    return { success: false, errorCode: 'failed' }
  }
}

export async function deleteFileToTrash(filePath: string): Promise<{ success: boolean; errorCode?: FileOpErrorCode }> {
  const normalized = normalizePath(filePath)
  let stat
  try {
    stat = await fs.stat(normalized)
  } catch {
    // 文件已不存在：视为删除成功，让调用方清理打开记录
    return { success: true }
  }
  // 该功能只删除文件；不给渲染进程整树删除目录的能力
  if (!stat.isFile()) return { success: false, errorCode: 'failed' }
  try {
    await shell.trashItem(normalized)
    return { success: true }
  } catch {
    return { success: false, errorCode: 'failed' }
  }
}

export function showInFolder(filePath: string): void {
  shell.showItemInFolder(normalizePath(filePath))
}

/**
 * “分享”：把文件本体放入系统剪贴板（Windows/macOS），
 * 用户可直接粘贴到聊天窗口/资源管理器发送；
 * 不支持的平台退化为复制文件路径文本。
 */
export async function copyFileToClipboard(filePath: string): Promise<{ success: boolean; method: 'file' | 'path' }> {
  const normalized = normalizePath(filePath)

  if (process.platform === 'win32') {
    try {
      // 路径经环境变量传入，避免命令行注入与引号转义问题
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -LiteralPath $env:WPS_SHARE_FILE'],
        { env: { ...process.env, WPS_SHARE_FILE: normalized }, windowsHide: true },
      )
      return { success: true, method: 'file' }
    } catch {
      // 回退为复制路径
    }
  } else if (process.platform === 'darwin') {
    try {
      await execFileAsync(
        'osascript',
        ['-e', 'set the clipboard to POSIX file (system attribute "WPS_SHARE_FILE")'],
        { env: { ...process.env, WPS_SHARE_FILE: normalized } },
      )
      return { success: true, method: 'file' }
    } catch {
      // 回退为复制路径
    }
  }

  clipboard.writeText(normalized)
  return { success: true, method: 'path' }
}

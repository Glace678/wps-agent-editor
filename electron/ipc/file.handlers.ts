import { dialog, BrowserWindow } from 'electron'
import { IPC } from './channels'
import { handleTrustedIpc } from './trusted-ipc'
import { t } from '../i18n/translate'
import { CODE_FILE_EXTENSIONS, CODE_FILE_FILTER_GROUPS } from '../../src/lib/code-languages'
import { listDirectory, searchFiles, getHomeDir, normalizePath } from '../services/file.service'
import {
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  renameRecentFile,
} from '../services/recent-files.service'
import {
  statFile,
  renameFile,
  deleteFileToTrash,
  showInFolder,
  copyFilesToClipboard,
} from '../services/file-ops.service'
import {
  snapshotFile,
  listFileHistory,
  restoreFileVersion,
  moveFileHistory,
  deleteFileHistory,
} from '../services/file-history.service'
import {
  allowOpenedDocumentInBridge,
  revokeOpenedDocumentInBridge,
} from '../services/offline-office.service'

const OFFICE_FILE_EXTENSIONS = Object.freeze([
  'docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'pdf', 'odt', 'ods',
])
const PRESENTATION_FILE_EXTENSIONS = Object.freeze(['pptx', 'ppt'])
const TEXT_FILE_EXTENSIONS = Object.freeze(['txt', 'md', 'markdown', 'json', 'log'])

function uniqueExtensions(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())]
}

function normalizeClipboardPaths(filePaths: string | string[]): string[] {
  const values = Array.isArray(filePaths) ? filePaths : [filePaths]
  return [...new Set(
    values
      .map((filePath) => normalizePath(filePath))
      .filter((filePath) => filePath.length > 0),
  )]
}

export function registerFileHandlers(): void {
  handleTrustedIpc(IPC.FILE_LIST, async (_e, dirPath: string) => {
    return listDirectory(normalizePath(dirPath))
  })

  handleTrustedIpc(IPC.FILE_OPEN, async (_e, filePath: string) => {
    const normalized = normalizePath(filePath)
    await allowOpenedDocumentInBridge(normalized)
    const recent = await addRecentFile(normalized)
    // 打开时自动记录版本快照（供“历史版本”），不阻塞打开流程
    void snapshotFile(normalized)
    return { path: normalized, recent }
  })

  handleTrustedIpc(IPC.FILE_STAT, async (_e, filePath: string) => {
    return statFile(filePath)
  })

  handleTrustedIpc(IPC.FILE_RENAME, async (_e, filePath: string, newName: string) => {
    const result = await renameFile(filePath, newName)
    if (result.success && result.newPath) {
      await revokeOpenedDocumentInBridge(filePath)
      await allowOpenedDocumentInBridge(result.newPath)
      const recent = await renameRecentFile(normalizePath(filePath), result.newPath)
      // 历史快照按路径哈希存放，跟随重命名迁移，否则版本记录会失联
      await moveFileHistory(filePath, result.newPath)
      return { ...result, recent }
    }
    return result
  })

  handleTrustedIpc(IPC.FILE_DELETE, async (_e, filePath: string) => {
    const result = await deleteFileToTrash(filePath)
    if (!result.success) return result
    await revokeOpenedDocumentInBridge(filePath)
    const recent = await removeRecentFile(normalizePath(filePath))
    // 文件已删除：同时清除本地历史快照，避免留下内容副本
    await deleteFileHistory(filePath)
    return { ...result, recent }
  })

  handleTrustedIpc(IPC.FILE_SHOW_IN_FOLDER, async (_e, filePath: string) => {
    const stat = await statFile(filePath)
    if (!stat.exists) return { success: false, errorCode: 'not-found' }
    showInFolder(filePath)
    return { success: true }
  })

  handleTrustedIpc(IPC.FILE_REMOVE_RECENT, async (_e, filePath: string) => {
    return removeRecentFile(normalizePath(filePath))
  })

  handleTrustedIpc(IPC.FILE_COPY_TO_CLIPBOARD, async (_e, filePaths: string | string[]) => {
    const normalizedPaths = normalizeClipboardPaths(filePaths)
    if (normalizedPaths.length === 0) return { success: false, errorCode: 'failed' }

    const stats = await Promise.all(normalizedPaths.map((filePath) => statFile(filePath)))
    if (stats.some((stat) => !stat.exists)) return { success: false, errorCode: 'not-found' }

    return copyFilesToClipboard(normalizedPaths)
  })

  handleTrustedIpc(IPC.FILE_HISTORY_LIST, async (_e, filePath: string) => {
    return listFileHistory(filePath)
  })

  handleTrustedIpc(IPC.FILE_HISTORY_RESTORE, async (_e, filePath: string, versionId: string) => {
    return restoreFileVersion(filePath, versionId)
  })

  handleTrustedIpc(IPC.FILE_SEARCH, async (_e, rootPath: string, query: string) => {
    return searchFiles(normalizePath(rootPath), query)
  })

  handleTrustedIpc(IPC.FILE_GET_RECENT, async () => {
    return getRecentFiles()
  })

  handleTrustedIpc(IPC.FILE_GET_HOME, async () => {
    return getHomeDir()
  })

  handleTrustedIpc(IPC.FILE_SELECT_FOLDER, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizePath(result.filePaths[0])
  })

  handleTrustedIpc(IPC.FILE_SELECT_FILE, async (
    event,
    kind: 'all' | 'text' | 'presentation' = 'all',
  ) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const officeFilter = {
      name: t('fileHandler.officeDocuments'),
      extensions: [...OFFICE_FILE_EXTENSIONS],
    }
    const textFilter = { name: t('fileHandler.text'), extensions: [...TEXT_FILE_EXTENSIONS] }
    const codeFilter = { name: t('fileHandler.codeDocuments'), extensions: [...CODE_FILE_EXTENSIONS] }
    const presentationFilter = {
      name: t('fileHandler.officeDocuments'),
      extensions: [...PRESENTATION_FILE_EXTENSIONS],
    }
    const supportedFilter = {
      name: t('fileHandler.supportedFiles'),
      extensions: uniqueExtensions(OFFICE_FILE_EXTENSIONS, TEXT_FILE_EXTENSIONS, CODE_FILE_EXTENSIONS),
    }
    const languageFilters = [
      { name: t('fileHandler.cCppFiles'), extensions: [...CODE_FILE_FILTER_GROUPS.cCpp] },
      { name: t('fileHandler.pythonFiles'), extensions: [...CODE_FILE_FILTER_GROUPS.python] },
      {
        name: t('fileHandler.javascriptTypescriptFiles'),
        extensions: [...CODE_FILE_FILTER_GROUPS.javascriptTypescript],
      },
      { name: t('fileHandler.javaJvmFiles'), extensions: [...CODE_FILE_FILTER_GROUPS.javaJvm] },
    ]
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: kind === 'text'
        ? [textFilter, { name: t('fileHandler.allFiles'), extensions: ['*'] }]
        : kind === 'presentation'
          ? [presentationFilter, { name: t('fileHandler.allFiles'), extensions: ['*'] }]
          : [
            supportedFilter,
            ...languageFilters,
            codeFilter,
            officeFilter,
            textFilter,
            { name: t('fileHandler.allFiles'), extensions: ['*'] },
          ],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizePath(result.filePaths[0])
  })

  handleTrustedIpc(IPC.FILE_SELECT_ATTACHMENTS, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('fileHandler.allFiles'), extensions: ['*'] }],
    }
    // Electron delegates this dialog to the native Windows, macOS, or Linux file picker.
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return [...new Set(result.filePaths.map((filePath) => normalizePath(filePath)))]
  })

  handleTrustedIpc(IPC.FILE_SELECT_SAVE_FILE, async (_e, defaultName?: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [
        { name: t('fileHandler.txtDocuments'), extensions: ['txt'] },
        { name: t('fileHandler.markdownDocuments'), extensions: ['md', 'markdown'] },
        { name: t('fileHandler.jsonDocuments'), extensions: ['json'] },
        { name: t('fileHandler.logFiles'), extensions: ['log'] },
        { name: t('fileHandler.allFiles'), extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) return null
    return normalizePath(result.filePath)
  })
}

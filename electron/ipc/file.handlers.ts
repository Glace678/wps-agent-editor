import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC } from './channels'
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
  copyFileToClipboard,
} from '../services/file-ops.service'
import {
  snapshotFile,
  listFileHistory,
  restoreFileVersion,
  moveFileHistory,
  deleteFileHistory,
} from '../services/file-history.service'

const OFFICE_FILE_EXTENSIONS = Object.freeze([
  'docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt', 'pdf', 'odt', 'ods',
])
const TEXT_FILE_EXTENSIONS = Object.freeze(['txt', 'md', 'markdown', 'json', 'log'])

function uniqueExtensions(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())]
}

export function registerFileHandlers(): void {
  ipcMain.handle(IPC.FILE_LIST, async (_e, dirPath: string) => {
    return listDirectory(normalizePath(dirPath))
  })

  ipcMain.handle(IPC.FILE_OPEN, async (_e, filePath: string) => {
    const normalized = normalizePath(filePath)
    const recent = await addRecentFile(normalized)
    // 打开时自动记录版本快照（供“历史版本”），不阻塞打开流程
    void snapshotFile(normalized)
    return { path: normalized, recent }
  })

  ipcMain.handle(IPC.FILE_STAT, async (_e, filePath: string) => {
    return statFile(filePath)
  })

  ipcMain.handle(IPC.FILE_RENAME, async (_e, filePath: string, newName: string) => {
    const result = await renameFile(filePath, newName)
    if (result.success && result.newPath) {
      const recent = await renameRecentFile(normalizePath(filePath), result.newPath)
      // 历史快照按路径哈希存放，跟随重命名迁移，否则版本记录会失联
      await moveFileHistory(filePath, result.newPath)
      return { ...result, recent }
    }
    return result
  })

  ipcMain.handle(IPC.FILE_DELETE, async (_e, filePath: string) => {
    const result = await deleteFileToTrash(filePath)
    if (!result.success) return result
    const recent = await removeRecentFile(normalizePath(filePath))
    // 文件已删除：同时清除本地历史快照，避免留下内容副本
    await deleteFileHistory(filePath)
    return { ...result, recent }
  })

  ipcMain.handle(IPC.FILE_SHOW_IN_FOLDER, async (_e, filePath: string) => {
    const stat = await statFile(filePath)
    if (!stat.exists) return { success: false, errorCode: 'not-found' }
    showInFolder(filePath)
    return { success: true }
  })

  ipcMain.handle(IPC.FILE_REMOVE_RECENT, async (_e, filePath: string) => {
    return removeRecentFile(normalizePath(filePath))
  })

  ipcMain.handle(IPC.FILE_COPY_TO_CLIPBOARD, async (_e, filePath: string) => {
    const stat = await statFile(filePath)
    if (!stat.exists) return { success: false, errorCode: 'not-found' }
    return copyFileToClipboard(filePath)
  })

  ipcMain.handle(IPC.FILE_HISTORY_LIST, async (_e, filePath: string) => {
    return listFileHistory(filePath)
  })

  ipcMain.handle(IPC.FILE_HISTORY_RESTORE, async (_e, filePath: string, versionId: string) => {
    return restoreFileVersion(filePath, versionId)
  })

  ipcMain.handle(IPC.FILE_SEARCH, async (_e, rootPath: string, query: string) => {
    return searchFiles(normalizePath(rootPath), query)
  })

  ipcMain.handle(IPC.FILE_GET_RECENT, async () => {
    return getRecentFiles()
  })

  ipcMain.handle(IPC.FILE_GET_HOME, async () => {
    return getHomeDir()
  })

  ipcMain.handle(IPC.FILE_SELECT_FOLDER, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizePath(result.filePaths[0])
  })

  ipcMain.handle(IPC.FILE_SELECT_FILE, async (_event, kind: 'all' | 'text' = 'all') => {
    const win = BrowserWindow.getFocusedWindow()
    const officeFilter = {
      name: t('fileHandler.officeDocuments'),
      extensions: [...OFFICE_FILE_EXTENSIONS],
    }
    const textFilter = { name: t('fileHandler.text'), extensions: [...TEXT_FILE_EXTENSIONS] }
    const codeFilter = { name: t('fileHandler.codeDocuments'), extensions: [...CODE_FILE_EXTENSIONS] }
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
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: kind === 'text'
        ? [textFilter, { name: t('fileHandler.allFiles'), extensions: ['*'] }]
        : [
            supportedFilter,
            ...languageFilters,
            codeFilter,
            officeFilter,
            textFilter,
            { name: t('fileHandler.allFiles'), extensions: ['*'] },
          ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizePath(result.filePaths[0])
  })

  ipcMain.handle(IPC.FILE_SELECT_SAVE_FILE, async (_e, defaultName?: string) => {
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

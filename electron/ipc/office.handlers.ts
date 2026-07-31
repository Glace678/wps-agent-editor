import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from './channels'
import * as offlineOffice from '../services/offline-office.service'
import * as docServer from '../services/document-server.service'

export function registerOfficeHandlers(): void {
  ipcMain.handle(IPC.OFFICE_GET_STATUS, async () => offlineOffice.getOfflineStatus())

  ipcMain.handle(IPC.OFFICE_DOWNLOAD, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const installerPath = await docServer.downloadOfficeInstaller((percent, message) => {
      win?.webContents.send('office:download-progress', { percent, message })
    })
    return { success: true, path: installerPath }
  })

  ipcMain.handle(IPC.OFFICE_INSTALL, async () => {
    await docServer.launchOfficeInstaller()
    return { success: true }
  })

  ipcMain.handle(IPC.OFFICE_START, async () => {
    const started = await docServer.tryStartDocumentServer()
    const state = await offlineOffice.getOfflineStatus()
    return { started, state }
  })

  ipcMain.handle(IPC.OFFICE_OPEN_FOLDER, async () => {
    await docServer.openOfficeDataFolder()
    return { success: true }
  })
}
import { app, Menu, BrowserWindow, dialog, shell } from 'electron'
import type { BaseWindow, MenuItemConstructorOptions } from 'electron'
import { t } from '../i18n/translate'
import type { AppMenuAction } from '../../src/types/app-menu'

function asBrowserWindow(window: BaseWindow | undefined): BrowserWindow | null {
  return window instanceof BrowserWindow ? window : null
}

export function executeAppMenuAction(action: AppMenuAction, window: BrowserWindow | null): void {
  switch (action) {
    case 'open-file': window?.webContents.send('menu:open-file'); return
    case 'open-folder': window?.webContents.send('menu:open-folder'); return
    case 'save': window?.webContents.send('menu:save'); return
    case 'print': window?.webContents.send('menu:print'); return
    case 'quit': app.quit(); return
    case 'undo': window?.webContents.undo(); return
    case 'redo': window?.webContents.redo(); return
    case 'cut': window?.webContents.cut(); return
    case 'copy': window?.webContents.copy(); return
    case 'paste': window?.webContents.paste(); return
    case 'select-all': window?.webContents.selectAll(); return
    case 'reload': window?.reload(); return
    case 'force-reload': window?.webContents.reloadIgnoringCache(); return
    case 'toggle-dev-tools': window?.webContents.toggleDevTools(); return
    case 'reset-zoom': window?.webContents.setZoomLevel(0); return
    case 'zoom-in':
      if (window) window.webContents.setZoomLevel(window.webContents.getZoomLevel() + 0.5)
      return
    case 'zoom-out':
      if (window) window.webContents.setZoomLevel(window.webContents.getZoomLevel() - 0.5)
      return
    case 'toggle-fullscreen':
      if (window) window.setFullScreen(!window.isFullScreen())
      return
    case 'new-agent': window?.webContents.send('menu:new-agent'); return
    case 'run-multi-agent': window?.webContents.send('menu:run-multi-agent'); return
    case 'open-onlyoffice-docs': void shell.openExternal('https://api.onlyoffice.com/'); return
    case 'show-about':
      void dialog.showMessageBox({
        type: 'info',
        title: t('menu.aboutTitle'),
        message: t('menu.aboutMessage'),
        detail: t('menu.aboutDetail'),
      })
      return
  }
}

export function createAppMenu(getMainWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { 
              label: t('menu.about'),
              role: 'about' as const 
            },
            { type: 'separator' as const },
            { 
              label: t('menu.services'),
              role: 'services' as const 
            },
            { type: 'separator' as const },
            { 
              label: t('menu.hide'),
              role: 'hide' as const 
            },
            { 
              label: t('menu.hideOthers'),
              role: 'hideOthers' as const 
            },
            { 
              label: t('menu.unhide'),
              role: 'unhide' as const 
            },
            { type: 'separator' as const },
            { 
              label: t('menu.quit'),
              role: 'quit' as const 
            },
          ],
        }]
      : []),
    {
      label: t('menu.file'),
      submenu: [
        {
          label: t('menu.openFile'),
          // Office-common: Ctrl+O (shared catalog file.open)
          accelerator: 'CmdOrCtrl+O',
          click: () => getMainWindow()?.webContents.send('menu:open-file'),
        },
        {
          label: t('menu.openFolder'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => getMainWindow()?.webContents.send('menu:open-folder'),
        },
        {
          // Office-common: Ctrl+S
          label: t('menu.save'),
          accelerator: 'CmdOrCtrl+S',
          click: () => getMainWindow()?.webContents.send('menu:save'),
        },
        {
          // Office-common: Ctrl+P
          label: t('menu.print'),
          accelerator: 'CmdOrCtrl+P',
          click: () => getMainWindow()?.webContents.send('menu:print'),
        },
        { type: 'separator' },
        isMac ? {
          label: t('menu.close'),
          accelerator: 'CmdOrCtrl+W',
          click: (_, window) => window?.close(),
        } : {
          label: t('menu.quit'),
          accelerator: 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        {
          label: t('menu.undo'),
          accelerator: 'CmdOrCtrl+Z',
          role: 'undo',
        },
        {
          label: t('menu.redo'),
          accelerator: 'CmdOrCtrl+Y',
          role: 'redo',
        },
        { type: 'separator' },
        {
          label: t('menu.cut'),
          accelerator: 'CmdOrCtrl+X',
          role: 'cut',
        },
        {
          label: t('menu.copy'),
          accelerator: 'CmdOrCtrl+C',
          role: 'copy',
        },
        {
          label: t('menu.paste'),
          accelerator: 'CmdOrCtrl+V',
          role: 'paste',
        },
        {
          label: t('menu.selectAll'),
          accelerator: 'CmdOrCtrl+A',
          role: 'selectAll',
        },
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        {
          label: t('menu.reload'),
          accelerator: 'CmdOrCtrl+R',
          click: (_, window) => asBrowserWindow(window)?.reload(),
        },
        {
          label: t('menu.forceReload'),
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (_, window) => asBrowserWindow(window)?.webContents.reloadIgnoringCache(),
        },
        {
          // F12 reserved for Office Save As in-app; use Ctrl+Shift+I for DevTools
          label: t('menu.toggleDevTools'),
          accelerator: 'CmdOrCtrl+Shift+I',
          click: (_, window) => asBrowserWindow(window)?.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        {
          label: t('menu.resetZoom'),
          accelerator: 'CmdOrCtrl+0',
          click: (_, window) => asBrowserWindow(window)?.webContents.setZoomLevel(0),
        },
        {
          label: t('menu.zoomIn'),
          accelerator: 'CmdOrCtrl+Plus',
          click: (_, window) => {
            const browserWindow = asBrowserWindow(window)
            const currentZoom = browserWindow?.webContents.getZoomLevel() || 0
            browserWindow?.webContents.setZoomLevel(currentZoom + 0.5)
          },
        },
        {
          label: t('menu.zoomOut'),
          accelerator: 'CmdOrCtrl+-',
          click: (_, window) => {
            const browserWindow = asBrowserWindow(window)
            const currentZoom = browserWindow?.webContents.getZoomLevel() || 0
            browserWindow?.webContents.setZoomLevel(currentZoom - 0.5)
          },
        },
        { type: 'separator' },
        {
          label: t('menu.toggleFullscreen'),
          accelerator: 'F11',
          click: (_, window) => window?.setFullScreen(!window?.isFullScreen()),
        },
      ],
    },
    {
      label: t('menu.agent'),
      submenu: [
        {
          label: t('menu.newAgent'),
          click: () => getMainWindow()?.webContents.send('menu:new-agent'),
        },
        {
          label: t('menu.runMultiAgent'),
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => getMainWindow()?.webContents.send('menu:run-multi-agent'),
        },
      ],
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.onlyOfficeDocs'),
          click: () => shell.openExternal('https://api.onlyoffice.com/'),
        },
        {
          label: t('menu.aboutTitle'),
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: t('menu.aboutTitle'),
              message: t('menu.aboutMessage'),
              detail: t('menu.aboutDetail'),
            })
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
  if (!isMac) {
    for (const window of BrowserWindow.getAllWindows()) {
      window.setMenuBarVisibility(false)
    }
  }
}

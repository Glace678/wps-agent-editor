export const APP_MENU_ACTIONS = [
  'open-file',
  'open-folder',
  'save',
  'print',
  'quit',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'select-all',
  'reload',
  'force-reload',
  'toggle-dev-tools',
  'reset-zoom',
  'zoom-in',
  'zoom-out',
  'toggle-fullscreen',
  'new-agent',
  'run-multi-agent',
  'open-onlyoffice-docs',
  'show-about',
] as const

export type AppMenuAction = (typeof APP_MENU_ACTIONS)[number]

export function isAppMenuAction(value: unknown): value is AppMenuAction {
  return typeof value === 'string'
    && (APP_MENU_ACTIONS as readonly string[]).includes(value)
}

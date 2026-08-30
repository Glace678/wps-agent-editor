export { AppError, unavailableError } from './app-error'
export { base64ToBytes, toUint8Array } from './binary'
export { DESKTOP_COMMANDS } from './commands'
export { desktopApi } from './desktop-api'
export {
  captureFileGrants,
  forgetFileGrant,
  getFileGrantId,
  registerFileGrant,
} from './grants'
export {
  configureTauriBindings,
  desktopTransport,
  detectDesktopRuntime,
  isTauriAvailable,
} from './transport'
export type * from '@/types/desktop-api'

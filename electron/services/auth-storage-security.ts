export type LinuxSafeStorageBackend =
  | 'basic_text'
  | 'gnome_libsecret'
  | 'kwallet'
  | 'kwallet5'
  | 'kwallet6'
  | 'unknown'

/**
 * Electron's Linux `basic_text` backend is obfuscation, not secret storage.
 * Treat it (and an unknown pre-ready backend) as session-only.
 */
export function isStrongSafeStorageBackend(
  platform: NodeJS.Platform,
  encryptionAvailable: boolean,
  linuxBackend?: LinuxSafeStorageBackend,
): boolean {
  if (!encryptionAvailable) return false
  if (platform !== 'linux') return true
  return linuxBackend !== undefined
    && linuxBackend !== 'basic_text'
    && linuxBackend !== 'unknown'
}

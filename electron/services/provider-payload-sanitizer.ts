import path from 'node:path'

const LOCAL_PATH_METADATA_KEYS = new Set([
  'cwd', 'directory', 'documentid', 'file', 'filename', 'filepath', 'folder',
  'inputpath', 'outputpath', 'path', 'paths', 'root', 'sourcepath', 'targetpath',
  'workspaceroot',
])

const WINDOWS_ABSOLUTE_PATH = /(?:\\\\\?\\)?[A-Za-z]:[\\/][^'"<>|\r\n,;)\]}]*/g
const WINDOWS_UNC_PATH = /(?:\\\\\?\\UNC\\|\\\\)[^'"<>|\r\n,;)\]}]+/gi
const FILE_URL = /file:\/\/\/?[^'"<>|\r\n,;)\]}]+/gi
const COMMON_POSIX_PATH = /(^|[\s(=:\[{])\/(?:Applications|Library|System|Users|Volumes|app|code|data|etc|home|media|mnt|opt|private|root|run|srv|tmp|usr|var|workspace|workspaces)(?:\/[^'"<>|\r\n,;)\]}]*)?/g
const GENERIC_POSIX_PATH = /(^|[\s(=:\[{])(\/(?:[^/\s'"<>|,;)\]}]+\/)+[^/\s'"<>|,;)\]}]+)/g

function isLocalPathMetadataKey(key: string): boolean {
  const normalized = key.toLocaleLowerCase().replace(/[-_\s]/g, '')
  return LOCAL_PATH_METADATA_KEYS.has(normalized)
    || normalized.endsWith('filepath')
    || normalized.endsWith('directory')
}

function redactEmbeddedLocalPaths(value: string): string {
  return value
    .replace(FILE_URL, '<local-path>')
    .replace(WINDOWS_UNC_PATH, '<local-path>')
    .replace(WINDOWS_ABSOLUTE_PATH, '<local-path>')
    .replace(COMMON_POSIX_PATH, (_match, prefix: string) => `${prefix}<local-path>`)
    .replace(GENERIC_POSIX_PATH, (_match, prefix: string) => `${prefix}<local-path>`)
}

function localPathLabel(value: string): string {
  const basename = value.includes('\\') ? path.win32.basename(value) : path.posix.basename(value)
  return basename ? `<local-file:${basename}>` : '<local-path>'
}

/** Removes local filesystem identity before tool data is returned to a provider. */
export function sanitizeProviderPayload(
  value: unknown,
  key = '',
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') {
    if (isLocalPathMetadataKey(key)
      && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value) || /^file:\/\//i.test(value))) {
      return localPathLabel(value)
    }
    if (path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) return localPathLabel(value)
    return redactEmbeddedLocalPaths(value)
  }
  if (value === null || typeof value !== 'object') return value
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '<binary-data>'
  if (seen.has(value)) return '<circular-reference>'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeProviderPayload(item, key, seen))
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    sanitizeProviderPayload(entryValue, entryKey, seen),
  ]))
}

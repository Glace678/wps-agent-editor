import type { GrantedPath } from '@/types/desktop-api'

const grantsByPath = new Map<string, string>()

function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\')
}

function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return isWindowsPath(path) ? normalized.toLowerCase() : normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function registerFileGrant(grant: GrantedPath): void {
  if (!grant.path || !grant.grantId) return
  grantsByPath.set(pathKey(grant.path), grant.grantId)
}

export function getFileGrantId(path: string): string | undefined {
  return grantsByPath.get(pathKey(path))
}

export function forgetFileGrant(path: string): void {
  grantsByPath.delete(pathKey(path))
}

export function captureFileGrants(value: unknown, depth = 0): void {
  if (depth > 8 || value === null || value === undefined) return
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return
  if (Array.isArray(value)) {
    for (const item of value) captureFileGrants(item, depth + 1)
    return
  }
  if (!isRecord(value)) return

  const path = typeof value.path === 'string' ? value.path : undefined
  const grantId = typeof value.grantId === 'string'
    ? value.grantId
    : typeof value.grant_id === 'string'
      ? value.grant_id
      : undefined
  if (path && grantId) registerFileGrant({ path, grantId })

  for (const nested of Object.values(value)) captureFileGrants(nested, depth + 1)
}

import type { GrantedPath } from '@/types/desktop-api'

const grantsByPath = new Map<string, string>()

function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\')
}

function pathKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return isWindowsPath(path) ? normalized.toLowerCase() : normalized
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

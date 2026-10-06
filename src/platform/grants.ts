import type { GrantedPath } from '@/types/desktop-api'
import { pathKey } from '@/lib/path'

const grantsByPath = new Map<string, string>()

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

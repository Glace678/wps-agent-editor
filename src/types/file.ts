export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedAt: number
  extension: string
}

export interface RecentFile {
  path: string
  name: string
  openedAt: number
}

export interface FileStatInfo {
  exists: boolean
  size: number
  modifiedAt: number
  createdAt: number
  extension: string
}

export interface FileVersion {
  id: string
  savedAt: number
  size: number
}
import { create } from 'zustand'
import type { FileSessionState } from '@/types/desktop-api'

const MAX_RECENT_DIRECTORIES = 10
const MAX_OPEN_FILES = 100

function pathKey(path: string): string {
  const isWindowsPath = /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\')
  const normalized = path.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return isWindowsPath ? normalized.toLowerCase() : normalized
}

function uniquePaths(paths: string[], limit: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    if (!path) continue
    const key = pathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(path)
    if (result.length >= limit) break
  }
  return result
}

function samePaths(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((path, index) => pathKey(path) === pathKey(right[index] ?? ''))
}

interface FileSessionStore extends FileSessionState {
  hydrated: boolean
  hydrate: (session: FileSessionState) => void
  setMainDirectory: (directory: string | null) => void
  visitDirectory: (directory: string) => void
  setDocuments: (openFiles: string[], activeFile: string | null) => void
}

const emptySession: FileSessionState = {
  mainDirectory: null,
  currentDirectory: null,
  recentDirectories: [],
  openFiles: [],
  activeFile: null,
}

export function selectFileSession(state: FileSessionStore): FileSessionState {
  return {
    mainDirectory: state.mainDirectory,
    currentDirectory: state.currentDirectory,
    recentDirectories: state.recentDirectories,
    openFiles: state.openFiles,
    activeFile: state.activeFile,
  }
}

export const useFileSessionStore = create<FileSessionStore>((set) => ({
  ...emptySession,
  hydrated: false,

  hydrate: (session) => set({
    ...session,
    recentDirectories: uniquePaths(session.recentDirectories, MAX_RECENT_DIRECTORIES),
    openFiles: uniquePaths(session.openFiles, MAX_OPEN_FILES),
    hydrated: true,
  }),

  setMainDirectory: (directory) => set((state) => (
    state.mainDirectory === directory ? state : { mainDirectory: directory }
  )),

  visitDirectory: (directory) => set((state) => {
    const recentDirectories = uniquePaths(
      [directory, ...state.recentDirectories],
      MAX_RECENT_DIRECTORIES,
    )
    if (
      pathKey(state.currentDirectory ?? '') === pathKey(directory)
      && samePaths(state.recentDirectories, recentDirectories)
    ) return state
    return { currentDirectory: directory, recentDirectories }
  }),

  setDocuments: (files, requestedActiveFile) => set((state) => {
    const openFiles = uniquePaths(files, MAX_OPEN_FILES)
    const requestedKey = requestedActiveFile ? pathKey(requestedActiveFile) : null
    const activeFile = requestedKey
      ? openFiles.find((path) => pathKey(path) === requestedKey) ?? null
      : null
    if (
      samePaths(state.openFiles, openFiles)
      && pathKey(state.activeFile ?? '') === pathKey(activeFile ?? '')
    ) return state
    return { openFiles, activeFile }
  }),
}))

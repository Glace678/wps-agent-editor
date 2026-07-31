import { create } from 'zustand'
import type { FileEntry, RecentFile } from '@/types/file'

interface FileState {
  currentDir: string
  entries: FileEntry[]
  recentFiles: RecentFile[]
  searchResults: FileEntry[]
  searchQuery: string
  isSearching: boolean
  loading: boolean

  setCurrentDir: (dir: string) => void
  setEntries: (entries: FileEntry[]) => void
  setRecentFiles: (files: RecentFile[]) => void
  setSearchResults: (results: FileEntry[]) => void
  setSearchQuery: (query: string) => void
  setIsSearching: (v: boolean) => void
  setLoading: (v: boolean) => void
}

export const useFileStore = create<FileState>((set) => ({
  currentDir: '',
  entries: [],
  recentFiles: [],
  searchResults: [],
  searchQuery: '',
  isSearching: false,
  loading: false,

  setCurrentDir: (dir) => set({ currentDir: dir }),
  setEntries: (entries) => set({ entries }),
  setRecentFiles: (files) => set({ recentFiles: files }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsSearching: (v) => set({ isSearching: v }),
  setLoading: (v) => set({ loading: v }),
}))
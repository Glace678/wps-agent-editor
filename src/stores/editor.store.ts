import { create } from 'zustand'
import { baseName } from '@/lib/path'

interface EditorState {
  currentFile: string | null
  fileName: string | null
  editorReady: boolean
  isDirty: boolean

  setCurrentFile: (path: string | null, name?: string | null) => void
  setEditorReady: (v: boolean) => void
  setIsDirty: (v: boolean) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  currentFile: null,
  fileName: null,
  editorReady: false,
  isDirty: false,

  // wps_09 C-3: reuse the shared baseName (handles trailing separators and
  // mixed slash styles consistently with the rest of the frontend).
  setCurrentFile: (path, name) =>
    set({ currentFile: path, fileName: name ?? (path ? baseName(path) || null : null) }),
  setEditorReady: (v) => set({ editorReady: v }),
  setIsDirty: (v) => set({ isDirty: v }),
}))

import { create } from 'zustand'

interface EditorState {
  currentFile: string | null
  fileName: string | null
  documentServerUrl: string | null
  editorReady: boolean
  isDirty: boolean

  setCurrentFile: (path: string | null, name?: string | null) => void
  setDocumentServerUrl: (url: string | null) => void
  setEditorReady: (v: boolean) => void
  setIsDirty: (v: boolean) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  currentFile: null,
  fileName: null,
  documentServerUrl: null,
  editorReady: false,
  isDirty: false,

  setCurrentFile: (path, name) =>
    set({ currentFile: path, fileName: name ?? (path ? path.split(/[/\\]/).pop() ?? null : null) }),
  setDocumentServerUrl: (url) => set({ documentServerUrl: url }),
  setEditorReady: (v) => set({ editorReady: v }),
  setIsDirty: (v) => set({ isDirty: v }),
}))

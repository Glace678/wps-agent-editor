import { useEffect, useRef, useState, useCallback } from 'react'
import { FileText } from 'lucide-react'
import { useEditorStore } from '@/stores/editor.store'
import { useTranslation } from '@/lib/i18n/runtime'
import { OfflineSetupWizard } from './OfflineSetupWizard'

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (id: string, config: unknown) => { destroyEditor: () => void }
    }
  }
}

interface OnlyOfficeEditorProps {
  onReady?: () => void
  onRegisterSave?: (fn: (() => Promise<void>) | null) => void
}

type OnlyOfficeError =
  | { kind: 'api' }
  | { kind: 'editor' }
  | { kind: 'raw' }

const ONLYOFFICE_API_LOAD_FAILED = 'ONLYOFFICE_API_LOAD_FAILED'

export function OnlyOfficeEditor({ onReady, onRegisterSave }: OnlyOfficeEditorProps = {}) {
  const { language, t } = useTranslation()
  const { currentFile, setDocumentServerUrl, setEditorReady } = useEditorStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null)
  const [error, setError] = useState<OnlyOfficeError | null>(null)
  const [loading, setLoading] = useState(false)
  const [officeReady, setOfficeReady] = useState<boolean | null>(null)

  const checkOffice = useCallback(async () => {
    const status = await window.api.office.getStatus()
    setOfficeReady(status.offlineReady)
    return status.offlineReady
  }, [])

  useEffect(() => {
    checkOffice()
  }, [checkOffice])

  useEffect(() => {
    if (!onRegisterSave) return
    onRegisterSave(async () => {
      await window.api.onlyoffice.forceSave()
    })
    return () => onRegisterSave(null)
  }, [onRegisterSave])

  useEffect(() => {
    if (!currentFile || !officeReady) {
      setEditorReady(false)
      return
    }

    let cancelled = false

    async function initEditor() {
      setLoading(true)
      setError(null)
      setEditorReady(false)

      try {
        const { config, documentServerUrl: serverUrl } = await window.api.onlyoffice.getConfig(currentFile!)
        if (cancelled) return

        setDocumentServerUrl(serverUrl)

        const scriptId = 'onlyoffice-api-script'
        let script = document.getElementById(scriptId) as HTMLScriptElement | null

        if (!script || script.src !== `${serverUrl}/web-apps/apps/api/documents/api.js`) {
          if (script) script.remove()
          script = document.createElement('script')
          script.id = scriptId
          script.src = `${serverUrl}/web-apps/apps/api/documents/api.js`
          document.head.appendChild(script)
          await new Promise<void>((resolve, reject) => {
            script!.onload = () => resolve()
            script!.onerror = () => reject(new Error(ONLYOFFICE_API_LOAD_FAILED))
          })
        }

        if (cancelled) return

        if (editorRef.current) {
          try { editorRef.current.destroyEditor() } catch { /* ignore */ }
          editorRef.current = null
        }

        if (containerRef.current) {
          containerRef.current.innerHTML = '<div id="onlyoffice-editor" style="width:100%;height:100%"></div>'
        }

        if (window.DocsAPI) {
          editorRef.current = new window.DocsAPI.DocEditor('onlyoffice-editor', {
            ...config,
            events: {
              onDocumentReady: () => {
                if (cancelled) return
                setEditorReady(true)
                onReady?.()
              },
              onError: (event: { data: string }) => {
                if (!cancelled) {
                  console.error('[OnlyOfficeEditor] editor error:', event.data)
                  setError({ kind: 'editor' })
                }
              },
            },
          })
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[OnlyOfficeEditor] initialization failed:', err)
          if (msg === 'OFFICE_NOT_READY') {
            setOfficeReady(false)
          } else if (msg === ONLYOFFICE_API_LOAD_FAILED) {
            setError({ kind: 'api' })
          } else {
            setError({ kind: 'raw' })
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    initEditor()

    return () => {
      cancelled = true
      if (editorRef.current) {
        try { editorRef.current.destroyEditor() } catch { /* ignore */ }
        editorRef.current = null
      }
    }
  }, [currentFile, language, officeReady, onReady, setDocumentServerUrl, setEditorReady])

  if (officeReady === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('onlyOffice.detectingEngine')}
      </div>
    )
  }

  if (!officeReady) {
    return <OfflineSetupWizard onReady={() => setOfficeReady(true)} />
  }

  if (!currentFile) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <FileText className="h-16 w-16 opacity-20" />
        <div className="text-center">
          <p className="text-lg font-medium">{t('onlyOffice.selectFileStart')}</p>
          <p className="mt-1 text-sm">{t('onlyOffice.formatSupport')}</p>
          <p className="mt-2 text-xs text-green-600">{t('onlyOffice.engineReady')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    const errorMessage = error.kind === 'api'
      ? t('onlyOffice.cannotLoadApi')
      : null

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="font-medium text-destructive">{t('onlyOffice.openFailed')}</p>
        {errorMessage && (
          <p className="max-w-md text-sm text-muted-foreground">{errorMessage}</p>
        )}
        <button
          className="text-sm text-primary hover:underline"
          onClick={() => { setError(null); setOfficeReady(false) }}
        >
          {t('onlyOffice.recheckEngine')}
        </button>
      </div>
    )
  }

  return (
    <div className="document-zoom-target onlyoffice-container relative flex-1 overflow-hidden">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{t('onlyOffice.loadingEditor')}</p>
          </div>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}

import { useEffect, useState, useCallback } from 'react'
import { Download, HardDrive, Play, FolderOpen, WifiOff, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/runtime'

interface OfficeStatus {
  status: string
  offlineReady: boolean
  message: string
  installPath: string | null
  bridgeUrl: string
}

interface OfflineSetupWizardProps {
  onReady: () => void
}

type ProgressMessageKey =
  | 'offlineSetup.preparingDownload'
  | 'offlineSetup.downloading'
  | 'offlineSetup.downloadComplete'
  | 'offlineSetup.downloadFailed'
  | 'offlineSetup.pleaseCompleteInstall'

export function OfflineSetupWizard({ onReady }: OfflineSetupWizardProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<OfficeStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<{
    percent: number
    messageKey: ProgressMessageKey | null
  }>({ percent: 0, messageKey: null })
  const [starting, setStarting] = useState(false)

  const refresh = useCallback(async () => {
    const s = await window.api.office.getStatus()
    setStatus(s)
    if (s.offlineReady) onReady()
  }, [onReady])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    window.api.on('office:download-progress', (data) => {
      const d = data as { percent: number; message: string }
      setProgress({
        percent: d.percent,
        messageKey: d.percent >= 100
          ? 'offlineSetup.downloadComplete'
          : 'offlineSetup.downloading',
      })
    })
  }, [])

  const handleDownload = async () => {
    setDownloading(true)
    setProgress({ percent: 0, messageKey: 'offlineSetup.preparingDownload' })
    try {
      await window.api.office.download()
      setProgress({ percent: 100, messageKey: 'offlineSetup.downloadComplete' })
    } catch (err) {
      console.error('[OfflineSetupWizard] engine download failed:', err)
      setProgress({
        percent: 0,
        messageKey: 'offlineSetup.downloadFailed',
      })
    } finally {
      setDownloading(false)
    }
  }

  const handleInstall = async () => {
    await window.api.office.install()
    setProgress({ percent: 0, messageKey: 'offlineSetup.pleaseCompleteInstall' })
  }

  const handleStart = async () => {
    setStarting(true)
    try {
      const result = await window.api.office.start()
      if (result.started) onReady()
      else await refresh()
    } finally {
      setStarting(false)
    }
  }

  if (!status) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (status.offlineReady) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-green-600">
        <CheckCircle2 className="h-12 w-12" />
        <p className="font-medium">{t('offlineSetup.engineReady')}</p>
        <p className="text-sm text-muted-foreground">{t('offlineSetup.offlineEdit')}</p>
      </div>
    )
  }

  const statusMessage = status.status === 'running'
    ? t('documentServer.engineRunning')
    : status.status === 'stopped'
      ? t('documentServer.installedPleaseStart')
      : status.status === 'downloading'
        ? t('offlineSetup.downloading')
        : status.status === 'installing'
          ? t('offlineSetup.pleaseCompleteInstall')
          : t('documentServer.needInstall')
  const progressMessage = progress.messageKey
    ? t(progress.messageKey)
    : ''

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex items-center gap-3">
        <WifiOff className="h-10 w-10 text-primary" />
        <div>
          <h2 className="text-xl font-semibold">{t('offlineSetup.installEngine')}</h2>
          <p className="text-sm text-muted-foreground">{t('offlineSetup.installDescription')}</p>
        </div>
      </div>

      <div className="w-full max-w-md rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-start gap-3">
          <HardDrive className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">{t('offlineSetup.offlineCapability')}</p>
            <ul className="mt-1 text-muted-foreground space-y-1 list-disc pl-4">
              <li>{t('offlineSetup.formatSupport')}</li>
              <li>{t('offlineSetup.fileLocal')}</li>
              <li>{t('offlineSetup.agentLocal')}</li>
            </ul>
          </div>
        </div>

        <div className="text-xs text-muted-foreground rounded bg-muted p-3">
          {t('offlineSetup.status', { status: statusMessage })}
          {status.installPath && (
            <p className="mt-1">
              {t('offlineSetup.installPath', { path: status.installPath })}
            </p>
          )}
        </div>

        {downloading && (
          <div className="space-y-2">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{progressMessage}</p>
          </div>
        )}

        {!downloading && progressMessage && (
          <p className="text-xs text-muted-foreground">{progressMessage}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleDownload} disabled={downloading} className="gap-2">
            <Download className="h-4 w-4" />
            {downloading ? t('offlineSetup.downloading') : t('offlineSetup.step1Download')}
          </Button>
          <Button variant="outline" onClick={handleInstall} className="gap-2">
            <FolderOpen className="h-4 w-4" />
            {t('offlineSetup.step2Install')}
          </Button>
          <Button variant="outline" onClick={handleStart} disabled={starting} className="gap-2">
            <Play className="h-4 w-4" />
            {starting ? t('offlineSetup.detecting') : t('offlineSetup.step3Detect')}
          </Button>
        </div>

        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => window.api.office.openFolder()}>
          {t('offlineSetup.openLocalData')}
        </Button>
      </div>
    </div>
  )
}

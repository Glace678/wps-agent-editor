import { useEffect, useState } from 'react'
import { Key, Plus, Trash2, RefreshCw } from 'lucide-react'
import type { ProviderDefinition, CustomProviderConfig } from '@/types/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/lib/i18n/runtime'

interface ProviderSettingsProps {
  onClose: () => void
}

export function ProviderSettings({ onClose }: ProviderSettingsProps) {
  const { language, t } = useTranslation()
  const [providers, setProviders] = useState<ProviderDefinition[]>([])
  const [authStatus, setAuthStatus] = useState<Record<string, { configured: boolean }>>({})
  const [selectedId, setSelectedId] = useState<string>('deepseek')
  const [apiKey, setApiKey] = useState('')
  const [search, setSearch] = useState('')
  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customForm, setCustomForm] = useState<Partial<CustomProviderConfig>>({
    name: '',
    baseURL: 'https://api.example.com/v1',
    defaultModel: 'gpt-4o-mini',
    protocol: 'openai-compatible',
  })

  const load = async () => {
    const [list, auth] = await Promise.all([
      window.api.provider.list(),
      window.api.auth.getAll(),
    ])
    setProviders(list)
    setAuthStatus(auth)
  }

  useEffect(() => { void load() }, [language])

  const filtered = providers.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.id.includes(search),
  )

  const selected = providers.find((p) => p.id === selectedId)

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    await window.api.auth.set(selectedId, apiKey.trim())
    setApiKey('')
    await load()
  }

  const handleSaveCustom = async () => {
    const provider: CustomProviderConfig = {
      id: `custom-${crypto.randomUUID()}`,
      name: customForm.name || t('providerSettings.customProvider'),
      baseURL: customForm.baseURL || '',
      defaultModel: customForm.defaultModel || 'gpt-4o-mini',
      protocol: customForm.protocol || 'openai-compatible',
      createdAt: Date.now(),
    }
    await window.api.customProvider.save(provider)
    setShowCustomForm(false)
    await load()
    setSelectedId(provider.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-card shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('providerSettings.title')}
      >
        <div className="flex items-center justify-between border-b p-4">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            <h2 className="font-semibold">{t('providerSettings.title')}</h2>
          </div>
           <div className="flex gap-2">
             <TooltipProvider delayDuration={450}>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button
                     variant="ghost"
                     size="icon"
                     onClick={() => window.api.provider.list(true).then(setProviders)}
                     aria-label={t('providerSettings.refresh')}
                   >
                     <RefreshCw className="h-4 w-4" />
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent side="bottom" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                   {t('providerSettings.refresh')}
                 </TooltipContent>
               </Tooltip>
             </TooltipProvider>
             <Button variant="outline" size="sm" onClick={onClose}>{t('providerSettings.close')}</Button>
           </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-56 flex-col border-r">
            <div className="p-2">
              <Input
                placeholder={t('providerSettings.search')}
                aria-label={t('providerSettings.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <ScrollArea className="flex-1">
               {filtered.map((p) => (
                 <button
                   key={p.id}
                   className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-accent ${
                     selectedId === p.id ? 'bg-accent' : ''
                   }`}
                   onClick={() => { setSelectedId(p.id); setApiKey('') }}
                 >
                   <span className="truncate">{p.name}</span>
                   {authStatus[p.id]?.configured && (
                     <TooltipProvider delayDuration={450}>
                       <Tooltip>
                         <TooltipTrigger asChild>
                           <span
                             className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500"
                             aria-label={t('providerSettings.configured')}
                           />
                         </TooltipTrigger>
                         <TooltipContent side="right" className="whitespace-nowrap rounded-[2px] border-0 bg-[#666] px-1.5 py-1.5 text-center text-[12px] leading-normal text-white shadow-none">
                           {t('providerSettings.configured')}
                         </TooltipContent>
                       </Tooltip>
                     </TooltipProvider>
                   )}
                 </button>
               ))}
            </ScrollArea>
            <div className="border-t p-2">
              <Button variant="outline" size="sm" className="w-full gap-1 text-xs" onClick={() => setShowCustomForm(true)}>
                <Plus className="h-3 w-3" /> {t('providerSettings.addCustom')}
              </Button>
            </div>
          </div>

          <div className="flex flex-1 flex-col p-4">
            {showCustomForm ? (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t('providerSettings.newCompatibleProvider')}</h3>
                <Input placeholder={t('providerSettings.name')} value={customForm.name} onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })} />
                <Input placeholder={t('agentConfig.baseUrl')} value={customForm.baseURL} onChange={(e) => setCustomForm({ ...customForm, baseURL: e.target.value })} />
                <Input placeholder={t('providerSettings.defaultModel')} value={customForm.defaultModel} onChange={(e) => setCustomForm({ ...customForm, defaultModel: e.target.value })} />
                <div className="flex gap-2">
                  <Button onClick={handleSaveCustom}>{t('providerSettings.create')}</Button>
                  <Button variant="outline" onClick={() => setShowCustomForm(false)}>{t('providerSettings.cancel')}</Button>
                </div>
              </div>
            ) : selected ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium">{selected.name}</h3>
                  <p className="text-xs text-muted-foreground">ID: {selected.id} · {selected.protocol}</p>
                  {selected.api && <p className="text-xs text-muted-foreground">{selected.api}</p>}
                </div>
                <Separator />
                {!selected.isLocal && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium">{t('providerSettings.apiKeyStorage')}</label>
                    <Input
                      type="password"
                      placeholder={authStatus[selectedId]?.configured
                        ? t('providerSettings.configuredKeyPlaceholder')
                        : t('providerSettings.enterApiKey')}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveKey}>{t('providerSettings.saveKey')}</Button>
                      {authStatus[selectedId]?.configured && (
                        <Button size="sm" variant="outline" onClick={async () => {
                          await window.api.auth.remove(selectedId)
                          await load()
                        }}>
                          <Trash2 className="mr-1 h-3 w-3" /> {t('providerSettings.delete')}
                        </Button>
                      )}
                    </div>
                    {selected.env.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t('providerSettings.environmentVariables', {
                          variables: selected.env.join(', '),
                        })}
                      </p>
                    )}
                  </div>
                )}
                {selected.isLocal && (
                  <p className="text-sm text-muted-foreground">{t('providerSettings.localNoApiKey')}</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

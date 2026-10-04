import { Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { WaitingText } from '@/components/ui/animated-ellipsis'
import type {
  AuthStatus,
  ProviderDefinition,
} from '@/types/provider'
import { ProviderLogo } from '../ProviderLogo'

export function ProviderDetailPanel({
  selected,
  authStatus,
  selectedId,
  providerLink,
  baseURL,
  baseURLError,
  baseURLSaved,
  apiKey,
  apiKeyError,
  isSavingKey,
  hasCustomBaseURL,
  isResettingBaseURL,
  labels,
  onBaseURLChange,
  onSaveBaseURL,
  onResetBaseURL,
  onApiKeyChange,
  onSaveKey,
  onDeleteKey,
  onOpenLink,
}: {
  selected: ProviderDefinition
  authStatus: Record<string, AuthStatus>
  selectedId: string
  providerLink: string
  baseURL: string
  baseURLError: string
  baseURLSaved: boolean
  apiKey: string
  apiKeyError: string
  isSavingKey: boolean
  hasCustomBaseURL: boolean
  isResettingBaseURL: boolean
  labels: {
    apiBaseUrl: string
    apiBaseUrlPlaceholder: string
    saveBaseUrl: string
    resetBaseUrl: string
    baseUrlSaved: string
    apiKeyStorage: string
    configuredKeyPlaceholder: string
    enterApiKey: string
    saveKey: string
    delete: string
    environmentVariables: string
    localNoApiKey: string
    apiDocumentation: string
  }
  onBaseURLChange: (value: string) => void
  onSaveBaseURL: () => void
  onResetBaseURL: () => void
  onApiKeyChange: (value: string) => void
  onSaveKey: () => void
  onDeleteKey: () => void
  onOpenLink: (url: string) => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2.5">
          <ProviderLogo
            providerId={selected.id}
            providerName={selected.name}
            className="h-9 w-9 rounded-md"
          />
          <div className="min-w-0">
            <h3 className="truncate font-medium">{selected.name}</h3>
            <p className="truncate text-xs text-muted-foreground">ID: {selected.id} | {selected.protocol}</p>
          </div>
        </div>
        {providerLink && (
          <a
            data-testid="provider-documentation"
            href={providerLink}
            onClick={(event) => {
              event.preventDefault()
              onOpenLink(providerLink)
            }}
            className="mt-2 inline-flex max-w-full cursor-pointer items-start gap-1.5 text-xs text-primary hover:underline"
            title={labels.apiDocumentation}
          >
            <svg
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              style={{ backgroundColor: 'transparent' }}
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M3 4H13V7.8H6.8V17.2H17.2V11.2H21V21H3V4Z" fill="currentColor" />
              <path d="M12.8 4H21V12.2L18.6 9.8L11.1 17.3L8.7 14.9L16.2 7.4L12.8 4Z" fill="currentColor" />
            </svg>
            <span className="break-all">{providerLink}</span>
          </a>
        )}
      </div>
      <Separator />
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="provider-base-url">
          {labels.apiBaseUrl}
        </label>
        <Input
          id="provider-base-url"
          data-testid="provider-base-url"
          type="url"
          className="h-11 w-full text-sm"
          placeholder={labels.apiBaseUrlPlaceholder}
          value={baseURL}
          aria-invalid={Boolean(baseURLError)}
          onChange={(event) => onBaseURLChange(event.target.value)}
        />
        {baseURLError && <p className="text-xs text-destructive">{baseURLError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="provider-save-base-url" size="sm" onClick={onSaveBaseURL} disabled={!baseURL.trim()}>
            <svg
              data-testid="provider-save-base-url-icon"
              className="mr-1 h-[18px] w-[18px] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3 2H15.5L21 7.5V22H3V2ZM7 3.75V9.5H16V3.75H7ZM7 14.5V20.25H17V14.5H7Z"
                fill="currentColor"
                fillRule="evenodd"
                clipRule="evenodd"
              />
              <path d="M10 3.75V9.5M13 3.75V9.5" stroke="currentColor" strokeWidth="1.35" />
            </svg>
            {labels.saveBaseUrl}
          </Button>
          <Button
            size="sm"
            data-testid="provider-reset-base-url"
            variant="outline"
            onClick={onResetBaseURL}
            disabled={!hasCustomBaseURL || isResettingBaseURL}
          >
            <svg
              data-testid="provider-reset-base-url-icon"
              className="mr-1 h-[18px] w-[18px] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M7.75 19.36A8.5 8.5 0 1 0 3.5 12"
                fill="none"
                style={{ fill: 'none' }}
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                d="M0.8 9L3.5 12L6.7 9.1"
                fill="none"
                style={{ fill: 'none' }}
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {labels.resetBaseUrl}
          </Button>
          {baseURLSaved && (
            <span data-testid="provider-base-url-saved" className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <Check className="h-3.5 w-3.5" />
              {labels.baseUrlSaved}
            </span>
          )}
        </div>
      </div>
      <Separator />
      {!selected.isLocal ? (
        <div className="space-y-2">
          <label className="text-xs font-medium">{labels.apiKeyStorage}</label>
          <Input
            data-testid="provider-api-key"
            type="password"
            placeholder={authStatus[selectedId]?.configured
              ? labels.configuredKeyPlaceholder
              : labels.enterApiKey}
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              data-testid="provider-save-key"
              onClick={onSaveKey}
              disabled={isSavingKey}
            >
              {isSavingKey ? <WaitingText text={labels.saveKey} /> : labels.saveKey}
            </Button>
            {authStatus[selectedId]?.configured && (
              <Button
                size="sm"
                variant="outline"
                data-testid="provider-delete-key"
                onClick={onDeleteKey}
              >
                <Trash2 className="mr-1 h-3 w-3" /> {labels.delete}
              </Button>
            )}
          </div>
          {apiKeyError && <p data-testid="provider-save-key-error" className="text-xs text-destructive">{apiKeyError}</p>}
          {selected.env.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {labels.environmentVariables}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{labels.localNoApiKey}</p>
      )}
    </div>
  )
}

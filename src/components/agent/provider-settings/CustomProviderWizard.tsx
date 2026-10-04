import {
  Check,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WaitingText } from '@/components/ui/animated-ellipsis'
import type {
  CustomProviderConfig,
  ProviderModel,
} from '@/types/provider'

export function CustomProviderWizard({
  title,
  labels,
  form,
  apiKey,
  detectedModels,
  testError,
  isTesting,
  isModelMenuOpen,
  isCreating,
  onFormChange,
  onApiKeyChange,
  onTest,
  onModelMenuOpenChange,
  onDefaultModelChange,
  onCreate,
  onCancel,
}: {
  title: string
  labels: {
    name: string
    baseUrl: string
    apiKey: string
    testConnection: string
    testingConnection: string
    modelsDetected: string
    defaultModel: string
    create: string
    cancel: string
  }
  form: Partial<CustomProviderConfig>
  apiKey: string
  detectedModels: ProviderModel[]
  testError: string
  isTesting: boolean
  isModelMenuOpen: boolean
  isCreating: boolean
  onFormChange: (next: Partial<CustomProviderConfig>) => void
  onApiKeyChange: (value: string) => void
  onTest: () => void
  onModelMenuOpenChange: (open: boolean) => void
  onDefaultModelChange: (id: string) => void
  onCreate: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <Input
        placeholder={labels.name}
        value={form.name ?? ''}
        onChange={(event) => onFormChange({ name: event.target.value })}
      />
      <Input
        data-testid="custom-provider-base-url"
        placeholder={labels.baseUrl}
        value={form.baseURL ?? ''}
        onChange={(event) => onFormChange({ baseURL: event.target.value })}
      />
      <Input
        data-testid="custom-provider-api-key"
        type="password"
        autoComplete="off"
        placeholder={labels.apiKey}
        value={apiKey}
        onChange={(event) => onApiKeyChange(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="custom-provider-test-connection"
          type="button"
          variant="outline"
          size="sm"
          onClick={onTest}
          disabled={!form.baseURL?.trim() || !apiKey.trim() || isTesting}
        >
          {isTesting
            ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          {isTesting ? <WaitingText text={labels.testingConnection} /> : labels.testConnection}
        </Button>
        {detectedModels.length > 0 && (
          <span data-testid="custom-provider-models-detected" className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <Check className="h-3.5 w-3.5" />
            {labels.modelsDetected}
          </span>
        )}
      </div>
      {testError && <p data-testid="custom-provider-test-error" className="text-xs text-destructive">{testError}</p>}
      {detectedModels.length > 0 ? (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{labels.defaultModel}</label>
          <DropdownMenu.Root open={isModelMenuOpen} onOpenChange={onModelMenuOpenChange}>
            <DropdownMenu.Trigger asChild>
              <Button
                data-testid="custom-provider-model-picker"
                type="button"
                variant="outline"
                className="w-full justify-between font-normal"
              >
                <span className="truncate">{form.defaultModel}</span>
                <ChevronDown className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                data-testid="custom-provider-model-menu"
                align="start"
                sideOffset={4}
                className="z-[60] max-h-60 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {detectedModels.map((model) => (
                  <DropdownMenu.Item
                    key={model.id}
                    data-testid="custom-provider-model-option"
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus:bg-accent"
                    onSelect={() => onDefaultModelChange(model.id)}
                  >
                    <span className="min-w-0 truncate" title={model.name}>{model.name}</span>
                    {form.defaultModel === model.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      ) : (
        <Input
          data-testid="custom-provider-default-model"
          placeholder={labels.defaultModel}
          value={form.defaultModel ?? ''}
          onChange={(event) => onFormChange({ defaultModel: event.target.value })}
        />
      )}
      {!isModelMenuOpen && (
        <div className="flex gap-2">
          <Button
            data-testid="custom-provider-create"
            onClick={onCreate}
            disabled={!form.baseURL?.trim() || !form.defaultModel?.trim() || isCreating}
          >
            {isCreating ? <WaitingText text={labels.testingConnection} /> : labels.create}
          </Button>
          <Button variant="outline" onClick={onCancel}>{labels.cancel}</Button>
        </div>
      )}
    </div>
  )
}

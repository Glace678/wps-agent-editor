import type { CustomProviderConfig } from '@/types/provider'

export function createCustomProviderForm(): Partial<CustomProviderConfig> {
  return {
    name: '',
    baseURL: 'https://api.example.com/v1',
    defaultModel: 'gpt-4o-mini',
    protocol: 'openai-compatible',
  }
}

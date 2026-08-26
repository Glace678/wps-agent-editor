import type { AuthStatus, ProviderDefinition } from '@/types/provider'

const ENGLISH_PROVIDER_COLLATOR = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
  usage: 'sort',
})

const PROVIDER_END_OF_LETTER_SECTIONS: Readonly<Record<string, string>> = {
  alibaba: 'T',
}

function getEnglishSortName(provider: ProviderDefinition): string {
  return provider.sortName ?? provider.name
}

function getEnglishSortSection(name: string): string {
  return name.match(/[a-z]|\d+/i)?.[0].toUpperCase() ?? name
}

function compareProviderNames(left: ProviderDefinition, right: ProviderDefinition): number {
  const leftEndSection = PROVIDER_END_OF_LETTER_SECTIONS[left.id]
  const rightEndSection = PROVIDER_END_OF_LETTER_SECTIONS[right.id]
  const leftName = getEnglishSortName(left)
  const rightName = getEnglishSortName(right)

  if (!leftEndSection && !rightEndSection) {
    return ENGLISH_PROVIDER_COLLATOR.compare(leftName, rightName)
  }
  if (leftEndSection && rightEndSection) {
    return ENGLISH_PROVIDER_COLLATOR.compare(leftEndSection, rightEndSection)
      || ENGLISH_PROVIDER_COLLATOR.compare(leftName, rightName)
  }
  if (leftEndSection) {
    return ENGLISH_PROVIDER_COLLATOR.compare(
      leftEndSection,
      getEnglishSortSection(rightName),
    ) || 1
  }
  return -(ENGLISH_PROVIDER_COLLATOR.compare(
    rightEndSection,
    getEnglishSortSection(leftName),
  ) || 1)
}

export function orderProvidersForSettings(
  providers: readonly ProviderDefinition[],
  authStatus: Readonly<Record<string, AuthStatus>>,
): ProviderDefinition[] {
  return [...providers].sort((left, right) => {
    const leftConfigured = authStatus[left.id]?.configured === true
    const rightConfigured = authStatus[right.id]?.configured === true

    if (leftConfigured !== rightConfigured) return leftConfigured ? -1 : 1

    const nameComparison = compareProviderNames(left, right)
    if (nameComparison !== 0) return nameComparison

    return ENGLISH_PROVIDER_COLLATOR.compare(left.id, right.id)
  })
}

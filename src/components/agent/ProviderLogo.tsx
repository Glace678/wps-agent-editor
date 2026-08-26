import { getProviderLogoAsset, getProviderLogoPresentationColor } from '@/lib/provider-logos'

export interface ProviderLogoProps {
  providerId: string
  providerName?: string
  className?: string
  title?: string
  decorative?: boolean
}

function providerInitials(providerName: string): string {
  const words = providerName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[1][0]}`.toUpperCase()
}

export function ProviderLogo({
  providerId,
  providerName = providerId,
  className = 'h-5 w-5',
  title,
  decorative = false,
}: ProviderLogoProps) {
  const asset = getProviderLogoAsset(providerId)
  const presentationColor = getProviderLogoPresentationColor(providerId)
  const label = title || providerName

  const wrapperProps = {
    'aria-hidden': decorative || undefined,
    'aria-label': decorative ? undefined : label,
    className: `inline-flex shrink-0 items-center justify-center overflow-hidden ${presentationColor ? 'p-px' : ''} ${className}`,
    role: decorative ? undefined : 'img',
    style: presentationColor ? { backgroundColor: presentationColor } : undefined,
    title,
  }

  if (asset?.kind === 'image') {
    return (
      <span {...wrapperProps}>
        <img
          alt=""
          aria-hidden="true"
          className="block h-full w-full object-contain"
          src={asset.url}
        />
      </span>
    )
  }

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className={`inline-flex shrink-0 items-center justify-center rounded-md bg-muted text-[9px] font-semibold text-muted-foreground ${className}`}
      role={decorative ? undefined : 'img'}
      title={title}
    >
      {providerInitials(providerName)}
    </span>
  )
}

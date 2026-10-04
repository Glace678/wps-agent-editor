export function ProviderEnableSwitch({
  checked,
  label,
  onChange,
  providerId,
}: {
  checked: boolean
  label: string
  onChange: () => void
  providerId: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-state={checked ? 'checked' : 'unchecked'}
      data-testid={`provider-enable-${providerId}`}
      className={`inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/45 focus-visible:ring-offset-1 ${
        checked ? 'bg-[#22c55e]' : 'bg-[#c7c7c7] dark:bg-[#525252]'
      }`}
      onClick={(event) => {
        event.stopPropagation()
        onChange()
      }}
    >
      <span
        data-provider-switch-thumb=""
        className={`block h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
          checked ? 'translate-x-3' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

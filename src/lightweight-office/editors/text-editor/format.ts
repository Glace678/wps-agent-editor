export type SpellCheckFormat = 'txt' | 'markdown' | 'subtitles' | 'lrc' | 'lic'

export function fontStretchValue(stretch: number): string {
  return [
    'normal',
    'ultra-condensed',
    'extra-condensed',
    'condensed',
    'semi-condensed',
    'normal',
    'semi-expanded',
    'expanded',
    'extra-expanded',
    'ultra-expanded',
  ][stretch] || 'normal'
}

export function spellCheckFormatForName(name: string): SpellCheckFormat | null {
  const extension = name.toLowerCase().match(/\.([^.]+)$/)?.[1]
  if (!extension) return 'txt'
  if (extension === 'txt') return 'txt'
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  if (extension === 'srt' || extension === 'ass') return 'subtitles'
  if (extension === 'lrc') return 'lrc'
  if (extension === 'lic') return 'lic'
  return null
}

export function expandPrintTemplate(template: string, fileName: string): string {
  const now = new Date()
  return template
    .replaceAll('&f', fileName)
    .replaceAll('&d', now.toLocaleDateString())
    .replaceAll('&t', now.toLocaleTimeString())
    .replaceAll('&p', '1')
    .replaceAll('&&', '&')
}

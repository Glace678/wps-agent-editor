export function expandPrintTemplate(template: string, fileName: string): string {
  const now = new Date()
  const replacements: Record<string, string> = {
    f: fileName,
    d: now.toLocaleDateString(),
    t: now.toLocaleTimeString(),
    p: '1',
    '&': '&',
  }
  // Single-pass expansion: scan the template once with a replacer callback so an
  // inserted fileName that itself contains '&' tokens (e.g. "&d", "&&") is not
  // re-interpreted by later replacements, and "$&" in the name is literal.
  return template.replace(/&(&|[fdpt])/g, (match, key: string) => replacements[key] ?? match)
}

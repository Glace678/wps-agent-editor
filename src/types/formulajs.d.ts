declare module '@formulajs/formulajs' {
  const formulaJs: Record<string, unknown>
  export default formulaJs
}

declare module '@fortune-sheet/formula-parser' {
  export class Parser {
    parse(formula: string, options?: Record<string, unknown>): { error: string | null; result: unknown }
    setFunction(name: string, callback: (parameters: unknown[]) => unknown): this
    on(event: string, callback: (...args: any[]) => void): this
  }
}

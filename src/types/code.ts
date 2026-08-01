export interface CodeRunResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  command: string
  durationMs: number
  errorCode?: 'unsupported' | 'runtime-missing' | 'timeout' | 'failed'
}

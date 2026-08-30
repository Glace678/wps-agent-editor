export interface CodeRunResult {
  success: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  command: string
  durationMs: number
  errorCode?: 'unsupported' | 'runtime-missing' | 'timeout' | 'failed'
}

export interface DebugBreakpoint {
  file: string
  line: number
}

export interface DebugFrame {
  index: number
  name: string
  file: string
  line: number
  column: number
}

export interface DebugVariable {
  name: string
  value: string
}

export type DebugStatus = 'idle' | 'starting' | 'running' | 'paused' | 'error'

export type DebugCommand =
  | 'continue'
  | 'step-over'
  | 'step-into'
  | 'step-out'

export type DebugEvent =
  | { event: 'started'; kind: 'node' | 'python' }
  | { event: 'paused'; reason: string; frames: DebugFrame[]; variables: DebugVariable[] }
  | { event: 'resumed' }
  | { event: 'output'; kind: 'stdout' | 'stderr'; text: string }
  | { event: 'breakpoint-verified'; file: string; line: number }
  | { event: 'eval-result'; id: string; result?: string; error?: string }
  | { event: 'error'; message: string }
  | { event: 'exit'; code: number | null }

export type RoutedDebugEvent = DebugEvent & {
  sessionId: string
  windowLabel: string
}

export interface DebugStartResult {
  ok: boolean
  kind?: 'node' | 'python'
  error?: 'unsupported' | 'failed' | string
  sessionId?: string
}

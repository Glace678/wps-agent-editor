import type { AppErrorCode, AppErrorData } from '@/types/desktop-api'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSerializedError(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

export class AppError extends Error implements AppErrorData {
  readonly code: AppErrorCode
  readonly messageKey?: string
  readonly details?: unknown
  readonly retryable?: boolean
  readonly command?: string
  override readonly cause?: unknown

  constructor(data: AppErrorData, cause?: unknown) {
    super(data.message)
    this.name = 'AppError'
    this.code = data.code
    this.messageKey = data.messageKey
    this.details = data.details
    this.retryable = data.retryable
    this.command = data.command
    this.cause = cause
  }

  static from(error: unknown, command?: string): AppError {
    if (error instanceof AppError) {
      if (!command || error.command) return error
      return new AppError({
        code: error.code,
        messageKey: error.messageKey,
        message: error.message,
        details: error.details,
        retryable: error.retryable,
        command,
      }, error.cause)
    }

    const parsed = typeof error === 'string' ? parseSerializedError(error) : error
    if (isRecord(parsed)) {
      const code = typeof parsed.code === 'string' ? parsed.code : 'invoke-failed'
      const message = typeof parsed.message === 'string'
        ? parsed.message
        : `Desktop command${command ? ` ${command}` : ''} failed`
      return new AppError({
        code,
        messageKey: typeof parsed.messageKey === 'string' ? parsed.messageKey : undefined,
        message,
        details: parsed.details,
        retryable: typeof parsed.retryable === 'boolean' ? parsed.retryable : undefined,
        command,
      }, error)
    }

    if (error instanceof Error) {
      return new AppError({ code: 'invoke-failed', message: error.message, command }, error)
    }

    return new AppError({
      code: 'invoke-failed',
      message: typeof parsed === 'string' ? parsed : 'Desktop command failed',
      command,
    }, error)
  }

  toJSON(): AppErrorData {
    return {
      code: this.code,
      messageKey: this.messageKey,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      command: this.command,
    }
  }
}

export function unavailableError(capability: string): AppError {
  return new AppError({
    code: 'desktop-api-unavailable',
    message: `${capability} is unavailable outside a supported desktop runtime`,
  })
}

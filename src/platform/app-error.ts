import { t } from '@/lib/i18n/translate'
import type { TranslationKey } from '@/lib/i18n/types'
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
      // Backend codes belong to the generated union (codes::ALL); the value
      // crosses IPC untyped so it is asserted at the boundary. Unknown strings
      // (e.g. a newer backend shipping a code this build does not know) are
      // still preserved on the object rather than mislabeled.
      const code = (typeof parsed.code === 'string' && parsed.code)
        ? parsed.code as AppErrorCode
        : 'invoke-failed'
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

  /// User-facing message in the active language: resolves the backend
  /// messageKey through the i18n registry and falls back to the raw Rust
  /// message when no localized entry exists (wps_03 D2).
  localizedMessage(): string {
    if (this.messageKey) {
      const translated = t(this.messageKey as TranslationKey)
      if (translated !== this.messageKey) return translated
    }
    return this.message
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

/// Resolve any thrown value to a localized, user-readable message. UI catch
/// blocks should use this instead of `error.message` so backend messageKeys
/// reach the user (wps_03 D2).
export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.localizedMessage()
  if (error instanceof Error) {
    // Non-AppError Error may still be a serialized backend error structurally.
    return AppError.from(error).localizedMessage()
  }
  return AppError.from(error).localizedMessage()
}

export function unavailableError(capability: string): AppError {
  return new AppError({
    code: 'desktop-api-unavailable',
    message: `${capability} is unavailable outside a supported desktop runtime`,
  })
}

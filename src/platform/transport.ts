import { Channel as TauriChannel, invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'
import type {
  DesktopChannel,
  DesktopRuntime,
  DesktopTransport,
  InvokeBody,
  InvokeOptions,
} from '@/types/desktop-api'
import { AppError, unavailableError } from './app-error'

interface TauriEvent<T> {
  event: string
  id: number
  payload: T
}

interface TauriBindings {
  invoke: <T>(command: string, args?: InvokeBody, options?: InvokeOptions) => Promise<T>
  listen?: <T>(event: string, handler: (event: TauriEvent<T>) => void) => Promise<() => void>
  channel?: new <T>(handler?: (message: T) => void) => DesktopChannel<T>
}

interface DesktopGlobal {
  __TAURI_INTERNALS__?: object
}

let configuredBindings: TauriBindings | undefined

function desktopGlobal(): DesktopGlobal | undefined {
  return typeof window === 'undefined' ? undefined : window as unknown as DesktopGlobal
}

function bindings(): TauriBindings | undefined {
  if (configuredBindings) return configuredBindings
  if (!desktopGlobal()?.__TAURI_INTERNALS__) return undefined
  return {
    invoke: <T>(command: string, args?: InvokeBody, options?: InvokeOptions) =>
      tauriInvoke<T>(
        command,
        args,
        options ? { headers: options.headers ?? {} } : undefined,
      ),
    listen: <T>(event: string, handler: (message: TauriEvent<T>) => void) =>
      tauriListen<T>(event, handler),
    channel: TauriChannel as unknown as TauriBindings['channel'],
  }
}

export function configureTauriBindings(value: TauriBindings | undefined): void {
  configuredBindings = value
}

export function isTauriAvailable(): boolean {
  return Boolean(bindings())
}

export function detectDesktopRuntime(): DesktopRuntime {
  return isTauriAvailable() ? 'tauri' : 'web'
}

function createChannel<T>(handler?: (message: T) => void): DesktopChannel<T> {
  const Channel = bindings()?.channel
  if (!Channel) throw unavailableError('Tauri channel transport')
  return new Channel(handler)
}

async function invoke<T>(command: string, args?: InvokeBody, options?: InvokeOptions): Promise<T> {
  const current = bindings()
  if (!current) throw unavailableError(`Desktop command ${command}`)
  try {
    return await current.invoke<T>(command, args, options)
  } catch (error) {
    throw AppError.from(error, command)
  }
}

async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const current = bindings()
  if (!current?.listen) throw unavailableError(`Desktop event ${event}`)
  return current.listen<T>(event, (message) => handler(message.payload))
}

export const desktopTransport: DesktopTransport = {
  get runtime() {
    return detectDesktopRuntime()
  },
  invoke,
  listen,
  channel: createChannel,
}

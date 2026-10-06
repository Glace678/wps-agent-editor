// D2: canonical e2e mock payloads typed against the ts-rs generated
// interfaces (src/types/generated), plus runtime structural validators run
// over what the mocks actually returned (recorded per invoke as
// __WAE_MOCK_RESPONSES__). When the Rust structs evolve, either the factory
// types (compile time) or the afterEach validators fail, instead of the mock
// silently exercising a fictional protocol.
import type { FileSessionSnapshot } from '../../../src/types/generated/FileSessionSnapshot'
import type { FileStatInfo } from '../../../src/types/generated/FileStatInfo'
import type { GrantedPath } from '../../../src/types/generated/GrantedPath'
import type { OpenedFile } from '../../../src/types/generated/OpenedFile'

export interface MockResponse {
  command: string
  result: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// —— Canonical factories (compile-time anchor on the generated types) ——

export function grantedPath(path: string, grantId: string): GrantedPath {
  return { path, grantId }
}

export function sessionSnapshot(
  overrides: Partial<FileSessionSnapshot> = {},
): FileSessionSnapshot {
  return {
    mainDirectory: null,
    currentDirectory: null,
    recentDirectories: [],
    openFiles: [],
    activeFile: null,
    ...overrides,
  }
}

export function statInfo(overrides: Partial<FileStatInfo> = {}): FileStatInfo {
  return {
    exists: true,
    size: 0,
    modifiedAt: 1_788_825_600_000,
    createdAt: 1_788_825_600_000,
    extension: '',
    ...overrides,
  }
}

export function openedFileInfo(overrides: Partial<OpenedFile> = {}): OpenedFile {
  return {
    path: '/mock/file.txt',
    grantId: 'file-grant',
    recent: [],
    ...overrides,
  }
}

// —— Runtime validators (structural mirrors of the generated interfaces) ——

function grantedPathErrors(value: unknown, label: string): string | null {
  if (!isRecord(value)) return `${label}: expected object, got ${typeof value}`
  if (typeof value.path !== 'string') return `${label}.path: expected string`
  if (typeof value.grantId !== 'string') return `${label}.grantId: expected string`
  return null
}

function sessionSnapshotErrors(value: unknown): string | null {
  if (!isRecord(value)) return `files_session_load: expected object, got ${typeof value}`
  if (value.mainDirectory !== null) {
    const error = grantedPathErrors(value.mainDirectory, 'files_session_load.mainDirectory')
    if (error) return error
  }
  if (value.currentDirectory !== null) {
    const error = grantedPathErrors(value.currentDirectory, 'files_session_load.currentDirectory')
    if (error) return error
  }
  if (!Array.isArray(value.recentDirectories)) {
    return 'files_session_load.recentDirectories: expected array'
  }
  for (const [index, entry] of value.recentDirectories.entries()) {
    const error = grantedPathErrors(entry, `files_session_load.recentDirectories[${index}]`)
    if (error) return error
  }
  if (!Array.isArray(value.openFiles)) {
    return 'files_session_load.openFiles: expected array'
  }
  for (const [index, entry] of value.openFiles.entries()) {
    const error = grantedPathErrors(entry, `files_session_load.openFiles[${index}]`)
    if (error) return error
  }
  if (value.activeFile !== null && typeof value.activeFile !== 'string') {
    return 'files_session_load.activeFile: expected string | null'
  }
  return null
}

function statInfoErrors(value: unknown): string | null {
  if (!isRecord(value)) return `files_stat: expected object, got ${typeof value}`
  if (typeof value.exists !== 'boolean') return 'files_stat.exists: expected boolean'
  if (typeof value.size !== 'number') return 'files_stat.size: expected number'
  if (typeof value.modifiedAt !== 'number') return 'files_stat.modifiedAt: expected number'
  if (typeof value.createdAt !== 'number') return 'files_stat.createdAt: expected number'
  if (typeof value.extension !== 'string') return 'files_stat.extension: expected string'
  return null
}

function openedFileErrors(value: unknown): string | null {
  if (!isRecord(value)) return `files_open: expected object, got ${typeof value}`
  if (typeof value.path !== 'string') return 'files_open.path: expected string'
  if (typeof value.grantId !== 'string') return 'files_open.grantId: expected string'
  if (!Array.isArray(value.recent)) return 'files_open.recent: expected array'
  for (const [index, entry] of value.recent.entries()) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.grantId !== 'string'
      || typeof entry.name !== 'string' || typeof entry.openedAt !== 'number') {
      return `files_open.recent[${index}]: expected RecentFile {path, grantId, name, openedAt}`
    }
  }
  return null
}

const VALIDATORS: Record<string, (value: unknown) => string | null> = {
  files_get_home: (value) => grantedPathErrors(value, 'files_get_home'),
  files_session_load: sessionSnapshotErrors,
  files_stat: statInfoErrors,
  files_open: openedFileErrors,
}

export function validateMockResponses(responses: MockResponse[]): string[] {
  const errors: string[] = []
  for (const { command, result } of responses) {
    const validator = VALIDATORS[command]
    if (validator) {
      const error = validator(result)
      if (error) errors.push(error)
    }
  }
  return errors
}

/**
 * Fails if the validators do not accept their own canonical factories or
 * reject clearly invalid shapes — keeps the structural validators aligned
 * with the generated-type factories. Called from the e2e afterEach.
 */
export function selfValidateMockPayloads(): void {
  const accepted: MockResponse[] = [
    { command: 'files_get_home', result: grantedPath('/mock/home', 'home-grant') },
    { command: 'files_session_load', result: sessionSnapshot() },
    { command: 'files_stat', result: statInfo() },
    { command: 'files_open', result: openedFileInfo() },
  ]
  const acceptErrors = validateMockResponses(accepted)
  if (acceptErrors.length > 0) {
    throw new Error(`mock payload validators rejected canonical factories: ${acceptErrors.join('; ')}`)
  }
  const rejected = validateMockResponses([
    { command: 'files_session_load', result: { ...sessionSnapshot(), openFiles: [{ path: 'x' }] } },
    { command: 'files_stat', result: statInfo() && { exists: 'yes' } },
  ])
  if (rejected.length !== 2) {
    throw new Error(`mock payload validators failed to flag 2 invalid fixtures (got ${rejected.length})`)
  }
}

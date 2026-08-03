import { execFile } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(process.env.GIT_SYNC_REPOSITORY ?? process.cwd())
const debounceMs = 1_000
const gitCandidates = process.platform === 'win32'
  ? [
      process.env.GIT_EXECUTABLE,
      'C:\\Program Files\\Git\\cmd\\git.exe',
      path.join(process.env.LOCALAPPDATA ?? '', 'GitHubDesktop', 'app-3.5.4', 'resources', 'app', 'git', 'cmd', 'git.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'GitHubDesktop', 'app-3.5.2', 'resources', 'app', 'git', 'cmd', 'git.exe'),
      'git.exe',
    ]
  : [process.env.GIT_EXECUTABLE, 'git']

const gitPath = gitCandidates.find((candidate) => candidate && (!candidate.includes('\\') || existsSync(candidate)))

if (!gitPath) {
  throw new Error('Git was not found. Install Git or set GIT_EXECUTABLE before starting the sync watcher.')
}

async function git(args, options = {}) {
  return execFileAsync(gitPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  })
}

async function gitOutput(args) {
  const { stdout } = await git(args)
  return stdout.trim()
}

async function hasStagedChanges() {
  try {
    await git(['diff', '--cached', '--quiet'])
    return false
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) return true
    throw error
  }
}

function timestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

let syncing = false
let syncQueued = false
let timer = null

async function pushWithRetry(args, attempts = 3, delayMs = 3_000) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await git(['push', ...args])
      return
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      const detail = error && typeof error === 'object' && 'stderr' in error ? error.stderr : error
      console.log(`[git-sync] Push attempt ${attempt}/${attempts} failed, retrying in ${delayMs}ms: ${detail}`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

async function syncSnapshot() {
  if (syncing) {
    syncQueued = true
    return
  }

  syncing = true
  try {
    // Network fixes for flaky HTTPS connections to GitHub (HTTP/2 is often reset by the GFW).
    await git(['config', 'http.version', 'HTTP/1.1'])
    await git(['config', 'http.postBuffer', '524288000'])

    await git(['add', '--all'])
    const hasChanges = await hasStagedChanges()
    if (hasChanges) {
      const branch = await gitOutput(['branch', '--show-current'])
      await git(['commit', '-m', `chore(sync): automatic snapshot ${timestamp()}`])
      console.log(`[git-sync] Committed a snapshot on ${branch}.`)
    }

    const remote = await gitOutput(['remote', 'get-url', 'origin']).catch(() => '')
    if (!remote) {
      console.log('[git-sync] No GitHub remote is configured yet. The snapshot is saved locally and will be pushed after origin is added.')
      return
    }

    // Push even when nothing new was committed: a previous run may have failed
    // to push (e.g. transient network reset) and must not be silently skipped.
    await pushWithRetry(['origin', 'HEAD'])
    await pushWithRetry(['origin', 'HEAD:main'])
    console.log('[git-sync] Pushed the snapshot to GitHub.')
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error ? error.stderr : error
    console.error('[git-sync] Synchronization failed:', detail)
  } finally {
    syncing = false
    if (syncQueued) {
      syncQueued = false
      scheduleSync()
    }
  }
}

function scheduleSync() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void syncSnapshot()
  }, debounceMs)
}

async function main() {
  const topLevel = await gitOutput(['rev-parse', '--show-toplevel'])
  if (path.resolve(topLevel) !== repoRoot) {
    throw new Error(`Run this command from the repository root: ${topLevel}`)
  }

  if (process.argv.includes('--once')) {
    await syncSnapshot()
    return
  }

  console.log(`[git-sync] Watching ${repoRoot}`)
  console.log('[git-sync] Each detected code save is committed after one second of inactivity and pushed when origin is configured.')
  watch(repoRoot, { recursive: true }, (_eventType, filename) => {
    if (!filename || filename === '.git' || filename.startsWith(`.git${path.sep}`)) return
    scheduleSync()
  })
}

await main()
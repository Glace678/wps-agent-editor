// Release guard: the updater public key injected from the protected GitHub
// secret (TAURI_UPDATER_PUBLIC_KEY) must be the exact same Minisign key as the
// one checked into src-tauri/tauri.conf.json. Without this assertion a
// rotated/mistyped secret produces signed releases whose updater trusts a key
// that the repository-side smoke fixtures never validated.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const configPath = resolve(root, 'src-tauri/tauri.conf.json')
const MINISIGN_RE = /^untrusted comment: minisign public key [0-9A-F]+\r?\nRWQ[^\r\n]+\r?\n?$/i

function decodeMinisign(encoded, label) {
  const compact = encoded.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error(`${label} is not canonical base64`)
  }
  const text = Buffer.from(encoded, 'base64').toString('utf8')
  if (!MINISIGN_RE.test(text)) {
    throw new Error(`${label} is not a valid Minisign public key`)
  }
  return Buffer.from(compact, 'base64')
}

export async function assertUpdaterKeyConsistency(secretPublicKey) {
  const value = String(secretPublicKey ?? '').trim()
  if (!value) throw new Error('TAURI_UPDATER_PUBLIC_KEY is required for updater key consistency verification')
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const repositoryKey = config.plugins?.updater?.pubkey
  if (!repositoryKey) throw new Error('tauri.conf.json has no plugins.updater.pubkey to compare against')

  const secretDecoded = decodeMinisign(value, 'TAURI_UPDATER_PUBLIC_KEY')
  const repositoryDecoded = decodeMinisign(repositoryKey, 'tauri.conf.json updater pubkey')
  if (!secretDecoded.equals(repositoryDecoded)) {
    throw new Error(
      'Updater public key drift: the TAURI_UPDATER_PUBLIC_KEY secret does not match ' +
        'the key checked into src-tauri/tauri.conf.json. Rotate the secret or update ' +
        'the repository copy so signed releases and smoke fixtures use one key.',
    )
  }
}

// Runs when invoked directly; check-bundle-inputs.mjs imports the function to
// apply the same guard whenever the secret is present in its environment.
if (resolve(process.argv[1] || '') === resolve(import.meta.filename)) {
  await assertUpdaterKeyConsistency(process.env.TAURI_UPDATER_PUBLIC_KEY)
  console.log('Updater public key matches the repository copy')
}

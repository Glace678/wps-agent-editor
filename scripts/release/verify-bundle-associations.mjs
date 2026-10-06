import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const configPath = resolve(scriptDirectory, '..', '..', 'src-tauri', 'tauri.conf.json')

function fail(message) {
  throw new Error(message)
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) fail(`Unexpected argument: ${argument}`)
    const name = argument.slice(2)
    if (!['platform', 'root', 'report', 'hooks'].includes(name)) fail(`Unknown option: ${argument}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`${argument} requires a value`)
    options[name] = value
    index += 1
  }
  if (!['macos', 'linux', 'windows'].includes(options.platform)) {
    fail('--platform must be macos, linux, or windows')
  }
  if (options.platform === 'windows') {
    // Windows verification cross-checks the NSIS hardening hooks against the
    // ProgID names declared in tauri.conf.json; there is no extracted bundle.
    if (!options.hooks) fail('--hooks must point at the NSIS installer hooks file for windows')
  } else if (!options.root) {
    fail('--root is required')
  }
  return options
}

function expectedAssociations(config) {
  const associations = config.bundle?.fileAssociations
  if (!Array.isArray(associations) || associations.length === 0) {
    fail('Tauri config declares no file associations')
  }

  const extensions = new Set()
  const mimeTypes = new Set()
  const windowsDescriptions = new Map()
  for (const association of associations) {
    if (association.role !== 'Editor') {
      fail(`File association ${association.name ?? '<unnamed>'} is not declared with the Editor role`)
    }
    if (!Array.isArray(association.ext) || association.ext.length === 0) {
      fail(`File association ${association.name ?? '<unnamed>'} has no extensions`)
    }
    if (typeof association.mimeType !== 'string' || !association.mimeType.includes('/')) {
      fail(`File association ${association.name ?? '<unnamed>'} has no valid MIME type`)
    }
    if (windowsDescriptions.has(association.name)) {
      if (windowsDescriptions.get(association.name) !== association.description) {
        fail(`Windows ProgID ${association.name} has conflicting descriptions`)
      }
    } else {
      windowsDescriptions.set(association.name, association.description)
    }
    mimeTypes.add(association.mimeType)
    for (const rawExtension of association.ext) {
      const extension = String(rawExtension).toLowerCase().replace(/^\./, '')
      if (!extension || extensions.has(extension)) {
        fail(`Duplicate or empty file association extension: ${rawExtension}`)
      }
      extensions.add(extension)
    }
  }
  // Windows ProgIDs are the unique `name` fields; the NSIS POSTINSTALL hook must
  // harden exactly this set.
  const progIds = new Set(associations.map((association) => association.name))
  return { associations, extensions, mimeTypes, progIds }
}

async function verifyWindowsHooks(hooksPath, expected) {
  const source = await readFile(resolve(hooksPath), 'utf8')

  // Every hardened open command must use SHCTX and a quoted executable path.
  const commandLines = source
    .split(/\r?\n/)
    .filter((line) => line.includes('WriteRegStr'))
  if (commandLines.length === 0) fail('NSIS hooks file contains no WriteRegStr open-command hardening')
  for (const line of commandLines) {
    if (!line.includes('SHCTX')) fail(`NSIS hook does not register in the install context (SHCTX): ${line.trim()}`)
    if (!line.includes('office-agentic.exe')) fail(`NSIS hook does not target office-agentic.exe: ${line.trim()}`)
  }

  const hooked = new Set()
  const hookEntry = /WAE_WRITE_SAFE_OPEN_COMMAND\s+"([^"]+)"/g
  let match
  while ((match = hookEntry.exec(source)) !== null) hooked.add(match[1])

  const missing = [...expected.progIds].filter((name) => !hooked.has(name))
  const extra = [...hooked].filter((name) => !expected.progIds.has(name))
  if (missing.length || extra.length) {
    fail(
      `NSIS hook ProgID coverage must match tauri.conf.json one-to-one; ` +
        `missing hardening: [${missing.join(', ')}], hooks for unknown ProgIDs: [${extra.join(', ')}]`,
    )
  }

  return {
    metadataFile: resolve(hooksPath),
    expectedExtensionCount: expected.extensions.size,
    verifiedExtensionCount: null,
    expectedMimeTypeCount: expected.mimeTypes.size,
    verifiedMimeTypeCount: null,
  }
}

function readPlistAsJson(infoPath) {
  const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', infoPath], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) fail(`Unable to run plutil: ${result.error.message}`)
  if (result.status !== 0) {
    fail(`plutil could not read ${infoPath}: ${(result.stderr || result.stdout).trim()}`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    fail(`plutil returned invalid JSON for ${infoPath}: ${error.message}`)
  }
}

async function verifyMacos(root, expected) {
  const infoPath = resolve(root, 'Contents', 'Info.plist')
  const plist = readPlistAsJson(infoPath)
  const documentTypes = plist.CFBundleDocumentTypes
  if (!Array.isArray(documentTypes) || documentTypes.length === 0) {
    fail('Info.plist contains no CFBundleDocumentTypes')
  }

  const missing = []
  const wrongRole = []
  const missingContentTypes = []
  for (const association of expected.associations) {
    const configuredExtensions = association.ext.map((extension) =>
      String(extension).toLowerCase().replace(/^\./, ''),
    )
    const documentType = documentTypes.find((candidate) => {
      if (candidate.CFBundleTypeName !== association.name) return false
      const extensions = new Set(
        (candidate.CFBundleTypeExtensions ?? []).map((extension) =>
          String(extension).toLowerCase().replace(/^\./, ''),
        ),
      )
      return configuredExtensions.every((extension) => extensions.has(extension))
    })
    if (!documentType) {
      missing.push(...configuredExtensions)
      continue
    }
    if (documentType.CFBundleTypeRole !== association.role) {
      wrongRole.push(`${configuredExtensions.join('/')} (${documentType.CFBundleTypeRole})`)
    }
    const actualContentTypes = new Set(documentType.LSItemContentTypes ?? [])
    for (const contentType of association.contentTypes ?? []) {
      if (!actualContentTypes.has(contentType)) {
        missingContentTypes.push(`${configuredExtensions.join('/')}: ${contentType}`)
      }
    }
  }
  if (missing.length > 0) fail(`Info.plist is missing file extensions: ${missing.join(', ')}`)
  if (wrongRole.length > 0) fail(`Info.plist has non-Editor file associations: ${wrongRole.join(', ')}`)
  if (missingContentTypes.length > 0) {
    fail(`Info.plist is missing declared content types: ${missingContentTypes.join(', ')}`)
  }

  return {
    metadataFile: infoPath,
    expectedExtensionCount: expected.extensions.size,
    verifiedExtensionCount: expected.extensions.size,
    expectedMimeTypeCount: expected.mimeTypes.size,
    verifiedMimeTypeCount: null,
  }
}

async function desktopFileCandidates(root) {
  const directories = [
    root,
    resolve(root, 'usr', 'share', 'applications'),
    resolve(root, 'share', 'applications'),
  ]
  const candidates = []
  for (const directory of directories) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.desktop')) {
        candidates.push(resolve(directory, entry.name))
      }
    }
  }
  return [...new Set(candidates)]
}

function desktopValue(source, key) {
  const prefix = `${key}=`
  const line = source.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix))
  return line?.slice(prefix.length)
}

async function verifyLinux(root, expected) {
  const candidates = await desktopFileCandidates(root)
  if (candidates.length === 0) fail(`No .desktop file was found under ${root}`)

  const parsed = await Promise.all(
    candidates.map(async (path) => ({ path, source: await readFile(path, 'utf8') })),
  )
  const selected =
    parsed.find(({ source }) => desktopValue(source, 'Name') === 'Office Agentic') ??
    (parsed.length === 1 ? parsed[0] : undefined)
  if (!selected) {
    fail(`Could not identify the Office Agentic .desktop file among: ${candidates.join(', ')}`)
  }

  const mimeValue = desktopValue(selected.source, 'MimeType')
  if (!mimeValue) fail(`${selected.path} contains no MimeType entry`)
  const actualMimeTypes = new Set(mimeValue.split(';').map((value) => value.trim()).filter(Boolean))
  const missing = [...expected.mimeTypes].filter((mimeType) => !actualMimeTypes.has(mimeType))
  if (missing.length > 0) fail(`${selected.path} is missing MIME types: ${missing.join(', ')}`)

  const execValue = desktopValue(selected.source, 'Exec')
  if (!execValue || !/%[fFuU]/u.test(execValue)) {
    fail(`${selected.path} Exec entry cannot receive a file or URL argument`)
  }

  return {
    metadataFile: selected.path,
    expectedExtensionCount: expected.extensions.size,
    verifiedExtensionCount: null,
    expectedMimeTypeCount: expected.mimeTypes.size,
    verifiedMimeTypeCount: expected.mimeTypes.size,
  }
}

const options = parseArguments(process.argv.slice(2))
const config = JSON.parse(await readFile(configPath, 'utf8'))
const expected = expectedAssociations(config)
const verification = options.platform === 'windows'
  ? await verifyWindowsHooks(options.hooks, expected)
  : options.platform === 'macos'
    ? await verifyMacos(resolve(options.root), expected)
    : await verifyLinux(resolve(options.root), expected)

const report = {
  schemaVersion: 1,
  platform: options.platform,
  associationEntryCount: expected.associations.length,
  associationsVerified: true,
  ...verification,
}
if (options.report) {
  const reportPath = resolve(options.report)
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
const extensionSummary = verification.verifiedExtensionCount === null
  ? `${verification.expectedExtensionCount} configured`
  : `${verification.verifiedExtensionCount}/${verification.expectedExtensionCount}`
const mimeSummary = verification.verifiedMimeTypeCount === null
  ? `${verification.expectedMimeTypeCount} configured`
  : `${verification.verifiedMimeTypeCount}/${verification.expectedMimeTypeCount}`
console.log(
  `${options.platform} bundle associations verified: ` +
    `${extensionSummary} extensions, ${mimeSummary} MIME types`,
)

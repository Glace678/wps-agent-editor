import { resolve } from 'node:path'

const PLATFORM_SPECS = {
  'windows-x86': {
    platformKey: 'windows-i686',
    primarySuffix: '-setup.exe',
    updaterSuffix: '-setup.exe',
  },
  'windows-x86_64': {
    platformKey: 'windows-x86_64',
    primarySuffix: '-setup.exe',
    updaterSuffix: '-setup.exe',
  },
  'windows-aarch64': {
    platformKey: 'windows-aarch64',
    primarySuffix: '-setup.exe',
    updaterSuffix: '-setup.exe',
  },
  'macos-x86_64': {
    platformKey: 'darwin-x86_64',
    primarySuffix: '.dmg',
    updaterSuffix: '.app.tar.gz',
  },
  'macos-aarch64': {
    platformKey: 'darwin-aarch64',
    primarySuffix: '.dmg',
    updaterSuffix: '.app.tar.gz',
  },
  'linux-x86_64': {
    platformKey: 'linux-x86_64',
    primarySuffix: '.AppImage',
    updaterSuffix: '.AppImage',
  },
  'linux-aarch64': {
    platformKey: 'linux-aarch64',
    primarySuffix: '.AppImage',
    updaterSuffix: '.AppImage',
  },
}

export function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}`)
    const separator = token.indexOf('=')
    if (separator !== -1) {
      result[token.slice(2, separator)] = token.slice(separator + 1)
      continue
    }
    const key = token.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      result[key] = true
    } else {
      result[key] = value
      index += 1
    }
  }
  return result
}

export function requireSemverTag(tag, label = 'tag') {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag || '')
  if (!match) throw new Error(`${label} must be a SemVer tag such as v2.0.1; received ${JSON.stringify(tag)}`)
  return {
    tag,
    version: tag.slice(1),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  }
}

export function compareVersions(left, right) {
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1
  }
  if (left.prerelease === right.prerelease) return 0
  if (!left.prerelease) return 1
  if (!right.prerelease) return -1
  const leftParts = left.prerelease.split('.')
  const rightParts = right.prerelease.split('.')
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] === undefined) return -1
    if (rightParts[index] === undefined) return 1
    if (leftParts[index] === rightParts[index]) continue
    const leftNumeric = /^\d+$/.test(leftParts[index])
    const rightNumeric = /^\d+$/.test(rightParts[index])
    if (leftNumeric && rightNumeric) return Number(leftParts[index]) < Number(rightParts[index]) ? -1 : 1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftParts[index] < rightParts[index] ? -1 : 1
  }
  return 0
}

export function releaseArtifactSpec(tag, platform, arch, directory = '.') {
  const { version } = requireSemverTag(tag)
  const key = `${platform}-${arch}`
  const spec = PLATFORM_SPECS[key]
  if (!spec) {
    throw new Error(`Unsupported release target ${key}; expected one of ${Object.keys(PLATFORM_SPECS).join(', ')}`)
  }
  const baseName = `${platform}-${arch}`
  const primaryName = `${baseName}${spec.primarySuffix}`
  const updaterName = `${baseName}${spec.updaterSuffix}`
  const signatureName = `${updaterName}.sig`
  const invalidInstallName = `updater-invalid-install-${baseName}.bin`
  const invalidInstallSignatureName = `${invalidInstallName}.sig`
  const root = resolve(directory)
  return {
    tag,
    version,
    platform,
    arch,
    ...spec,
    directory: root,
    primaryName,
    updaterName,
    signatureName,
    invalidInstallName,
    invalidInstallSignatureName,
    primaryPath: resolve(root, primaryName),
    updaterPath: resolve(root, updaterName),
    signaturePath: resolve(root, signatureName),
    invalidInstallPath: resolve(root, invalidInstallName),
    invalidInstallSignaturePath: resolve(root, invalidInstallSignatureName),
    checksumsPath: resolve(root, 'SHA256SUMS'),
    latestPath: resolve(root, 'latest.json'),
    tamperedLatestPath: resolve(root, 'latest-tampered.json'),
    invalidInstallLatestPath: resolve(root, 'latest-invalid-install.json'),
  }
}

export const supportedReleaseTargets = Object.freeze(Object.keys(PLATFORM_SPECS))

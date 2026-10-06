import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  releaseArtifactSpec,
  supportedReleaseTargets,
} from './release-smoke-lib.mjs'

const root = resolve(import.meta.dirname, '../..')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'wae-release-contract-'))

function runScript(script, args, environment = {}, expectFailure = false, baseDirectory = 'scripts/release') {
  const result = spawnSync(process.execPath, [join(root, baseDirectory, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  })
  if (expectFailure) {
    assert.notEqual(result.status, 0, `${script} unexpectedly succeeded`)
  } else {
    assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

function testSignature() {
  const packet = Buffer.alloc(74)
  packet[0] = 0x45
  packet[1] = 0x44
  const signatureBox = [
    'untrusted comment: signature from minisign secret key',
    packet.toString('base64'),
    'trusted comment: timestamp:0',
    Buffer.alloc(64).toString('base64'),
  ].join('\n')
  return Buffer.from(`${signatureBox}\n`, 'utf8').toString('base64')
}

async function createReleaseFixture(name) {
  const directory = join(temporaryRoot, name)
  await mkdir(directory, { recursive: true })
  const version = '2.0.0'
  const tag = `v${version}`
  for (const target of supportedReleaseTargets) {
    const separator = target.indexOf('-')
    const platform = target.slice(0, separator)
    const arch = target.slice(separator + 1)
    const spec = releaseArtifactSpec(tag, platform, arch, directory)
    await writeFile(spec.primaryPath, `primary ${target}\n`)
    await writeFile(spec.updaterPath, `updater ${target}\n`)
    await writeFile(spec.signaturePath, testSignature())
    await writeFile(spec.invalidInstallPath, `invalid ${target}\n`)
    await writeFile(spec.invalidInstallSignaturePath, testSignature())
    await writeFile(join(directory, `release-part-${platform}-${arch}.json`), `${JSON.stringify({
      version,
      platform,
      arch,
      updaterKey: spec.platformKey,
      primary: spec.primaryName,
      updater: spec.updaterName,
      signature: spec.signatureName,
      invalidInstall: spec.invalidInstallName,
      invalidInstallSignature: spec.invalidInstallSignatureName,
    })}\n`)
  }
  await writeFile(join(directory, 'sbom-npm.cdx.json'), '{"bomFormat":"CycloneDX"}\n')
  await writeFile(join(directory, 'sbom-rust.cdx.json'), '{"bomFormat":"CycloneDX"}\n')
  await writeFile(join(directory, `Office-Agentic-${tag}-source.zip`), Buffer.from('504b0304', 'hex'))
  return directory
}

async function createUnsignedFixture(name, tag) {
  const directory = join(temporaryRoot, name)
  await mkdir(directory, { recursive: true })
  for (const target of supportedReleaseTargets) {
    const separator = target.indexOf('-')
    const platform = target.slice(0, separator)
    const arch = target.slice(separator + 1)
    const spec = releaseArtifactSpec(tag, platform, arch, directory)
    await writeFile(spec.primaryPath, `unsigned primary ${target}\n`)
  }
  await writeFile(join(directory, 'sbom-npm.cdx.json'), '{"bomFormat":"CycloneDX"}\n')
  await writeFile(join(directory, 'sbom-rust.cdx.json'), '{"bomFormat":"CycloneDX"}\n')
  await writeFile(join(directory, `Office-Agentic-${tag}-source.zip`), Buffer.from('504b0304', 'hex'))
  return directory
}

try {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  runScript('../check-version.mjs', [], {
    GITHUB_REF_NAME: 'main',
    GITHUB_REF_TYPE: 'branch',
  })
  runScript('../check-version.mjs', [], {
    GITHUB_REF_NAME: `v${packageJson.version}`,
    GITHUB_REF_TYPE: 'tag',
  })

  const unsigned = await createUnsignedFixture('unsigned', `v${packageJson.version}`)
  runScript('finalize-unsigned-prerelease.mjs', [unsigned], {
    GITHUB_REF_NAME: `v${packageJson.version}`,
  })
  assert.match(await readFile(join(unsigned, 'SHA256SUMS'), 'utf8'), /linux-aarch64\.AppImage/)
  await assert.rejects(readFile(join(unsigned, 'latest.json')), /ENOENT/)

  const valid = await createReleaseFixture('valid')
  const validFixtures = join(temporaryRoot, 'valid-fixtures')
  runScript('finalize-release.mjs', [valid, '--fixtures-dir', validFixtures], {
    GITHUB_REPOSITORY: 'owner/repository',
    GITHUB_REF_NAME: 'v2.0.0',
  })
  const latest = JSON.parse(await readFile(join(valid, 'latest.json'), 'utf8'))
  assert.equal(Object.keys(latest.platforms).length, 6)
  assert.match(await readFile(join(valid, 'SHA256SUMS'), 'utf8'), /sbom-rust\.cdx\.json/)

  // Release fixtures were separated out and neither shipped publicly nor were
  // covered by the public checksums.
  await assert.rejects(readFile(join(valid, 'latest-tampered.json'), 'utf8'), /ENOENT/)
  await assert.rejects(readFile(join(valid, 'latest-invalid-install.json'), 'utf8'), /ENOENT/)
  const fixtureNames = await readdir(validFixtures)
  assert.equal(fixtureNames.length, 14)
  assert.ok(fixtureNames.includes('latest-tampered.json'))
  assert.ok(fixtureNames.includes('latest-invalid-install.json'))
  const publicChecksums = await readFile(join(valid, 'SHA256SUMS'), 'utf8')
  assert.match(publicChecksums, /latest\.json/)
  assert.doesNotMatch(publicChecksums, /tampered|invalid-install/)
  // Exact 19-file public set.
  const publicNames = await readdir(valid)
  assert.equal(publicNames.length, 19)

  const mismatched = await createReleaseFixture('mismatched')
  const mismatchedManifest = join(mismatched, 'release-part-windows-x86_64.json')
  const manifest = JSON.parse(await readFile(mismatchedManifest, 'utf8'))
  manifest.updater = 'windows-aarch64-setup.exe'
  await writeFile(mismatchedManifest, `${JSON.stringify(manifest)}\n`)
  const mismatchResult = runScript('finalize-release.mjs', [
    mismatched,
    '--fixtures-dir', join(temporaryRoot, 'mismatched-fixtures'),
  ], {
    GITHUB_REPOSITORY: 'owner/repository',
    GITHUB_REF_NAME: 'v2.0.0',
  }, true)
  assert.match(mismatchResult.stderr, /field updater must be/)

  // finalize fails when fixtures are not directed elsewhere.
  const noFixtures = await createReleaseFixture('no-fixtures')
  const noFixtureResult = runScript('finalize-release.mjs', [noFixtures], {
    GITHUB_REPOSITORY: 'owner/repository',
    GITHUB_REF_NAME: 'v2.0.0',
  }, true)
  assert.match(noFixtureResult.stderr, /--fixtures-dir/)

  const debugFixture = join(temporaryRoot, 'debug-symbols')
  await mkdir(join(debugFixture, 'app.dSYM', 'Contents', 'Resources', 'DWARF'), { recursive: true })
  await writeFile(join(debugFixture, 'windows-x86_64-setup.exe'), 'package')
  await writeFile(join(debugFixture, 'app.dSYM', 'Contents', 'Resources', 'DWARF', 'app'), 'debug')
  const debugResult = runScript('check-artifacts.mjs', [debugFixture], {}, true)
  assert.match(debugResult.stderr, /Forbidden packaged content/)

  const oversized = join(temporaryRoot, 'oversized')
  await mkdir(oversized)
  const oversizedPath = join(oversized, 'windows-x86_64-setup.exe')
  const oversizedFile = await open(oversizedPath, 'w')
  await oversizedFile.truncate(100 * 1024 * 1024 + 1)
  await oversizedFile.close()
  const sizeResult = runScript('check-artifacts.mjs', [oversized], {
    MAX_PRIMARY_ARTIFACT_BYTES: String(1024 * 1024 * 1024),
  }, true)
  assert.match(sizeResult.stderr, /limit is 100\.00 MiB/)

  // Updater public-key consistency guard.
  const tauriConfig = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
  runScript('check-updater-key-consistency.mjs', [], {
    TAURI_UPDATER_PUBLIC_KEY: tauriConfig.plugins.updater.pubkey,
  })
  const missingSecret = runScript('check-updater-key-consistency.mjs', [], {}, true)
  assert.match(missingSecret.stderr, /TAURI_UPDATER_PUBLIC_KEY is required/)
  // A structurally valid but different Minisign key must be flagged as drift.
  const keyLines = Buffer.from(tauriConfig.plugins.updater.pubkey, 'base64').toString('utf8').split('\n')
  keyLines[1] = keyLines[1].slice(0, -1) + (keyLines[1].endsWith('A') ? 'B' : 'A')
  const otherKey = Buffer.from(keyLines.join('\n'), 'utf8').toString('base64')
  const drift = runScript('check-updater-key-consistency.mjs', [], {
    TAURI_UPDATER_PUBLIC_KEY: otherKey,
  }, true)
  assert.match(drift.stderr, /Updater public key drift/)

  // Windows installer hook one-to-one ProgID coverage.
  runScript('verify-bundle-associations.mjs', [
    '--platform', 'windows',
    '--hooks', join(root, 'src-tauri/windows/installer-hooks.nsh'),
  ])
  const badHooks = join(temporaryRoot, 'bad-installer-hooks.nsh')
  const hooksSource = await readFile(join(root, 'src-tauri/windows/installer-hooks.nsh'), 'utf8')
  await writeFile(badHooks, hooksSource.replace('Office Agentic Source', 'Office Agentic Bogus'))
  const badHooksResult = runScript('verify-bundle-associations.mjs', [
    '--platform', 'windows',
    '--hooks', badHooks,
  ], {}, true)
  assert.match(badHooksResult.stderr, /one-to-one/)

  // Audit gate runs with the expiring-exception machinery.
  runScript('check-npm-audit.mjs', ['--mode', 'full'], {}, false, 'scripts')
  runScript('check-npm-audit.mjs', ['--mode', 'production'], {}, false, 'scripts')

  assert.deepEqual(tauriConfig.bundle.icon, [
    'icons/32x32.png',
    'icons/64x64.png',
    'icons/128x128.png',
    'icons/128x128@2x.png',
    'icons/icon.png',
    'icons/icon.icns',
    'icons/icon.ico',
  ])
  const linuxDesktopRelativePath = tauriConfig.bundle.linux?.deb?.desktopTemplate
  assert.equal(linuxDesktopRelativePath, 'linux/office-agentic.desktop')
  const linuxDesktop = await readFile(join(root, 'src-tauri', linuxDesktopRelativePath), 'utf8')
  assert.match(linuxDesktop, /^Exec=\{\{exec\}\} %F$/m)
  assert.match(linuxDesktop, /^StartupWMClass=\{\{exec\}\}$/m)
  assert.match(linuxDesktop, /^Icon=\{\{icon\}\}$/m)
  assert.match(linuxDesktop, /^MimeType=\{\{mime_type\}\}$/m)
  const linuxConfig = join(temporaryRoot, 'linux-release.json')
  runScript('tauri-release-config.mjs', [linuxConfig], {
    GITHUB_REPOSITORY: 'owner/repository',
    WAE_BUILD_TARGET: 'x86_64-unknown-linux-gnu',
    WAE_UPDATER_PUBLIC_KEY: tauriConfig.plugins.updater.pubkey,
  })
  assert.equal(JSON.parse(await readFile(linuxConfig, 'utf8')).bundle.createUpdaterArtifacts, true)

  const windowsConfig = join(temporaryRoot, 'windows-release.json')
  const missingCertificate = runScript('tauri-release-config.mjs', [windowsConfig], {
    GITHUB_REPOSITORY: 'owner/repository',
    WAE_BUILD_TARGET: 'x86_64-pc-windows-msvc',
    WAE_UPDATER_PUBLIC_KEY: tauriConfig.plugins.updater.pubkey,
    WAE_WINDOWS_CERTIFICATE_THUMBPRINT: '',
  }, true)
  assert.match(missingCertificate.stderr, /CERTIFICATE_THUMBPRINT/)
  runScript('tauri-release-config.mjs', [windowsConfig], {
    GITHUB_REPOSITORY: 'owner/repository',
    WAE_BUILD_TARGET: 'x86_64-pc-windows-msvc',
    WAE_UPDATER_PUBLIC_KEY: tauriConfig.plugins.updater.pubkey,
    WAE_WINDOWS_CERTIFICATE_THUMBPRINT: 'A'.repeat(40),
  })
  assert.equal(JSON.parse(await readFile(windowsConfig, 'utf8')).bundle.windows.certificateThumbprint, 'A'.repeat(40))

  const updaterSmoke = await readFile(join(root, 'scripts/release/updater-smoke.mjs'), 'utf8')
  const updaterHook = await readFile(join(root, 'scripts/release/run-updater-smoke.mjs'), 'utf8')
  const ciWorkflow = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8')
  const signedWorkflow = await readFile(join(root, '.github/workflows/release.yml'), 'utf8')
  const stagingWorkflow = await readFile(join(root, '.github/workflows/staging-smoke.yml'), 'utf8')
  const unsignedWorkflow = await readFile(join(root, '.github/workflows/unsigned-prerelease.yml'), 'utf8')
  const unsignedConfig = await readFile(join(root, 'scripts/release/tauri-unsigned-config.mjs'), 'utf8')
  const releaseConfig = await readFile(join(root, 'scripts/release/tauri-release-config.mjs'), 'utf8')
  const healthGuardian = await readFile(join(root, 'src-tauri/src/update_health.rs'), 'utf8')
  assert.match(updaterSmoke, /runHook\(rollbackReportPath, true\)/)
  assert.match(updaterSmoke, /healthRollbackVerified: true/)
  assert.match(updaterHook, /--wae-updater-health-failure/)
  assert.match(updaterHook, /healthRollbackExternalObservationVerified/)
  assert.match(updaterHook, /spctl.*--assess/)
  assert.match(updaterHook, /stapler.*validate/)
  const macosInstallSmoke = await readFile(join(root, 'scripts/release/macos-install-smoke.sh'), 'utf8')
  assert.match(macosInstallSmoke, /for attempt in 1 2 3/)
  assert.match(macosInstallSmoke, /printf 'Y\\n' \| hdiutil attach/)
  assert.match(macosInstallSmoke, /hdiutil attach[^\n]+-noverify/)
  assert.match(macosInstallSmoke, /Unable to mount the DMG after 3 attempts/)
  assert.match(macosInstallSmoke, /expected_macho_arch=.*arm64.*x86_64/)
  assert.match(macosInstallSmoke, /updater_architectures.*expected_macho_arch/)
  assert.match(stagingWorkflow, /startup health rollback/)
  assert.match(healthGuardian, /--wae-update-health-guardian/)
  assert.match(healthGuardian, /startup-health-failed/)
  for (const publicContract of [ciWorkflow, signedWorkflow, stagingWorkflow, unsignedWorkflow]) {
    assert.doesNotMatch(publicContract, /\bi686\b|\barch:\s*x86(?:\s*[,}])/)
  }
  assert.match(signedWorkflow, /!v\*\.\*\.\*-\*/)
  assert.match(signedWorkflow, /git fetch --force --no-tags origin "refs\/tags\/\$\{GITHUB_REF_NAME\}:refs\/tags\/\$\{GITHUB_REF_NAME\}"/)
  assert.match(signedWorkflow, /TAG_COMMIT="\$\(git rev-parse "refs\/tags\/\$GITHUB_REF_NAME\^\{\}"\)"/)
  assert.match(signedWorkflow, /NODE_OPTIONS:\s+--max-old-space-size=4096/)
  assert.match(unsignedWorkflow, /v\*\.\*\.\*-rc\.\*/)
  assert.match(unsignedWorkflow, /Unsigned Preview/)
  assert.match(unsignedWorkflow, /NODE_OPTIONS:\s+--max-old-space-size=4096/)
  assert.match(unsignedWorkflow, /git fetch --force --no-tags origin "refs\/tags\/\$\{GITHUB_REF_NAME\}:refs\/tags\/\$\{GITHUB_REF_NAME\}"/)
  assert.match(unsignedWorkflow, /TAG_COMMIT="\$\(git rev-parse "refs\/tags\/\$GITHUB_REF_NAME\^\{\}"\)"/)
  assert.doesNotMatch(unsignedWorkflow, /TAURI_SIGNING_PRIVATE_KEY|WINDOWS_CERTIFICATE|APPLE_CERTIFICATE|latest\.json/)
  assert.match(unsignedConfig, /createUpdaterArtifacts:\s*false/)
  assert.match(unsignedConfig, /endpoints:\s*\[\]/)

  // --- wps_08 build & release hardening ---
  assert.strictEqual(tauriConfig.bundle.createUpdaterArtifacts, false)
  assert.deepEqual(tauriConfig.bundle.targets, ['nsis', 'dmg', 'appimage'])
  assert.match(signedWorkflow, /check-updater-key-consistency\.mjs/)
  assert.match(signedWorkflow, /security delete-keychain build\.keychain/)
  assert.match(signedWorkflow, /name:\s*release-fixtures/)
  assert.match(signedWorkflow, /fail_on_unmatched_files:\s*true/)
  assert.match(signedWorkflow, /finalize-release\.mjs artifacts --fixtures-dir release-fixtures/)
  assert.match(signedWorkflow, /certificate\.p12/)
  assert.match(stagingWorkflow, /name:\s*stable-channel/)
  assert.match(stagingWorkflow, /--public-only/)
  assert.match(stagingWorkflow, /release-fixtures/)
  assert.match(stagingWorkflow, /refusing to promote again/)
  const nightlyAudit = await readFile(join(root, '.github/workflows/nightly-audit.yml'), 'utf8')
  assert.match(nightlyAudit, /check-npm-audit\.mjs --mode full/)
  assert.match(nightlyAudit, /check-npm-audit\.mjs --mode production/)
  const securityDoc = await readFile(join(root, 'SECURITY.md'), 'utf8')
  assert.match(securityDoc, /Components fetched at install time/)
  assert.match(securityDoc, /downloadBootstrapper/)
  assert.match(releaseConfig, /https:\/\/timestamp\.sectigo\.com/)

  console.log('Release contract tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

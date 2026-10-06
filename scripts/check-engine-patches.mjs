// Verifies that the vendored engine patches (patch-package, postinstall) are
// present in both the repository (committed patch artifacts) and the installed
// node_modules. Running this explicitly in CI closes the --ignore-scripts hole:
// `npm ci --ignore-scripts` skips postinstall, leaving node_modules on pristine
// engines while all source-level tests still pass (wps_07 A1/A3).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const failures = []
function check(condition, message) {
  if (!condition) failures.push(message)
}

function readText(target) {
  return readFileSync(target, 'utf8')
}
function installedVersion(packageDir) {
  const manifest = JSON.parse(readText(path.join(root, 'node_modules', packageDir, 'package.json')))
  return manifest.version
}

// 1. Committed patch artifacts exist.
const committedPatches = [
  'patches/@aiden0z+pptx-renderer+1.2.4.patch',
  'patches/superdoc+1.44.0.patch',
]
for (const patchFile of committedPatches) {
  check(existsSync(path.join(root, patchFile)), `missing committed engine patch: ${patchFile}`)
}

// 2. Installed versions match the versions the patches were generated against.
check(
  installedVersion(path.join('@aiden0z', 'pptx-renderer')) === '1.2.4',
  '@aiden0z/pptx-renderer version drifted from 1.2.4; regenerate its patch with patch-package',
)
check(
  installedVersion('superdoc') === '1.44.0',
  'superdoc version drifted from 1.44.0; regenerate its patch with patch-package',
)

// 3. Patched markers are present in installed artifacts. If node_modules is
//    pristine here, postinstall was skipped or patch application failed.
const pptxDist = path.join(root, 'node_modules', '@aiden0z', 'pptx-renderer', 'dist')
for (const file of [
  'aiden0z-pptx-renderer.es.js',
  'aiden0z-pptx-renderer.browser.es.js',
  'aiden0z-pptx-renderer.cjs',
]) {
  const target = path.join(pptxDist, file)
  check(
    existsSync(target) && readText(target).includes('masterPhLevel'),
    `pptx-renderer patch marker 'masterPhLevel' missing from dist/${file}`
      + " — was postinstall skipped (e.g. 'npm ci --ignore-scripts')?",
  )
}

const chunksDir = path.join(root, 'node_modules', 'superdoc', 'dist', 'chunks')
const layoutChunks = existsSync(chunksDir)
  ? readdirSync(chunksDir).filter((name) => /^src-.*\.(?:es\.js|cjs)$/.test(name)).sort()
  : []
check(
  layoutChunks.length === 2,
  `expected one ESM and one CJS superdoc layout chunk, found ${layoutChunks.length}`,
)
for (const chunk of layoutChunks) {
  check(
    readText(path.join(chunksDir, chunk)).includes('#isSemanticFlowMode'),
    `superdoc zoom patch marker '#isSemanticFlowMode' missing from ${chunk}`
      + " — was postinstall skipped (e.g. 'npm ci --ignore-scripts')?",
  )
}

if (failures.length > 0) {
  console.error('Engine patch verification failed:')
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  process.exit(1)
}

console.log('engine patches verified: committed artifacts, versions, and installed markers all match')

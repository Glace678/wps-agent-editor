import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const recentFilesSource = fs.readFileSync(
  path.join(root, 'src/components/file-manager/RecentFiles.tsx'),
  'utf8',
)

test('recent-file rows do not render a hover details card', () => {
  assert.doesNotMatch(recentFilesSource, /data-recent-file-hover-details/)
  assert.doesNotMatch(recentFilesSource, /<FileHoverCard/)
  assert.doesNotMatch(recentFilesSource, /title=\{file\.name\}/)
})

test('all nine locale files translate the file-name label', () => {
  const localeDir = path.join(root, 'src/lib/i18n/locales')
  const localeFiles = fs.readdirSync(localeDir).filter((name) => name.endsWith('.ts'))

  assert.equal(localeFiles.length, 9)
  for (const localeFile of localeFiles) {
    const source = fs.readFileSync(path.join(localeDir, localeFile), 'utf8')
    assert.match(source, /\n\s*infoName:\s*'[^']+',/, `${localeFile} is missing recentFiles.infoName`)
  }
})

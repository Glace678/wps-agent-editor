import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  canonicalRendererDocument,
  createRendererContentSecurityPolicy,
  createTrustedRendererArgument,
  externalHttpUrl,
  isTrustedRendererDocument,
  loopbackHttpUrl,
  readTrustedRendererArgument,
} from '../electron/security/renderer-boundary'

const devRenderer = 'http://127.0.0.1:5173/'
const fileRenderer = 'file:///C:/Program%20Files/WPS/resources/renderer/index.html'

assert.equal(canonicalRendererDocument(`${devRenderer}?openFile=test.docx#editor`), devRenderer)
assert.equal(canonicalRendererDocument('http://localhost:5173/'), 'http://localhost:5173/')
assert.equal(canonicalRendererDocument('http://[::1]:5173/'), 'http://[::1]:5173/')
assert.equal(canonicalRendererDocument(fileRenderer), fileRenderer)
assert.equal(canonicalRendererDocument('https://example.com/app'), null)
assert.equal(canonicalRendererDocument('http://localhost.example.com/app'), null)
assert.equal(canonicalRendererDocument('file://remote-host/share/index.html'), null)
assert.equal(canonicalRendererDocument('javascript:alert(1)'), null)

assert.equal(isTrustedRendererDocument(`${devRenderer}?openFile=a.docx`, devRenderer), true)
assert.equal(isTrustedRendererDocument('http://127.0.0.1:5173/settings', devRenderer), false)
assert.equal(isTrustedRendererDocument('http://localhost:5173/', devRenderer), false)
assert.equal(isTrustedRendererDocument('https://example.com/', devRenderer), false)

const rendererArgument = createTrustedRendererArgument(`${fileRenderer}?openFile=test.docx`)
assert.equal(readTrustedRendererArgument(['electron', rendererArgument]), fileRenderer)
assert.equal(readTrustedRendererArgument(['electron', '--wps-trusted-renderer-url=invalid']), null)
assert.throws(() => createTrustedRendererArgument('https://example.com/app'))

assert.equal(externalHttpUrl('https://example.com/docs'), 'https://example.com/docs')
assert.equal(externalHttpUrl('http://example.com/'), 'http://example.com/')
assert.equal(externalHttpUrl('https://user:password@example.com/'), null)
assert.equal(externalHttpUrl('file:///C:/secret.txt'), null)
assert.equal(externalHttpUrl('javascript:alert(1)'), null)
assert.equal(externalHttpUrl('data:text/html,test'), null)

assert.equal(loopbackHttpUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/')
assert.equal(loopbackHttpUrl('https://localhost:8443/office'), 'https://localhost:8443/office')
assert.equal(loopbackHttpUrl('http://example.com:8080/'), null)
assert.equal(loopbackHttpUrl('file:///C:/office/index.html'), null)

const productionCsp = createRendererContentSecurityPolicy(false)
assert.match(productionCsp, /script-src 'self';/)
assert.match(productionCsp, /connect-src 'self';/)
assert.match(productionCsp, /frame-src 'none'/)
assert.doesNotMatch(productionCsp, /script-src[^;]*'unsafe-inline'/)
const developmentCsp = createRendererContentSecurityPolicy(true)
assert.match(developmentCsp, /script-src[^;]*'unsafe-inline'/)
assert.match(developmentCsp, /ws:\/\/127\.0\.0\.1:\*/)

const electronRoot = path.resolve('electron')
const stack = [electronRoot]
const rawHandlerFiles: string[] = []
while (stack.length > 0) {
  const directory = stack.pop()!
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      stack.push(entryPath)
    } else if (
      entry.name.endsWith('.ts')
      && !entryPath.endsWith(path.join('ipc', 'trusted-ipc.ts'))
      && /ipcMain\.(?:handle|handleOnce|on|once)\s*\(/.test(fs.readFileSync(entryPath, 'utf8'))
    ) {
      rawHandlerFiles.push(path.relative(process.cwd(), entryPath))
    }
  }
}
assert.deepEqual(rawHandlerFiles, [], `unprotected IPC handlers: ${rawHandlerFiles.join(', ')}`)

const preloadSource = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
assert.match(preloadSource, /process\.isMainFrame/)
assert.match(preloadSource, /isTrustedRendererDocument\(globalThis\.location\.href/)

const mainSource = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
assert.match(mainSource, /webSecurity:\s*true/)
assert.match(mainSource, /sandbox:\s*true/)
assert.match(mainSource, /app\.isPackaged[\s\S]*process\.env\.ELECTRON_RENDERER_URL/)
assert.doesNotMatch(mainSource, /webSecurity:\s*false|sandbox:\s*false/)

console.log('Electron renderer boundary tests passed')

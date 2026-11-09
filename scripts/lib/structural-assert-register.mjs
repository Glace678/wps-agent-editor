// Registers the structural-test assertion counter loader. Invoked through
// `node --import` by scripts/run-structural-tests.mjs (wps_07 B5).
import { register } from 'node:module'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

register(new URL('./structural-assert-loader.mjs', import.meta.url))

// tsx loads .ts files as CommonJS when the nearest package.json has no
// `"type": "module"`. CJS `require('node:assert/strict')` bypasses ESM loader
// hooks entirely, so the ESM wrapper above never sees those assertions.
// Install a CJS-side patch that wraps Module._load for assert specifiers so
// .ts structural tests are counted the same way .mjs tests are.
// Anchor createRequire to the repo root (this file lives in scripts/lib/).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(pathToFileURL(path.join(root, 'package.json')).href)
const Module = require('node:module')

const origLoad = Module._load
const realAssert = origLoad.call(Module, 'node:assert', null, false)
const realStrict = origLoad.call(Module, 'node:assert/strict', null, false)

let cjsAssertionCount = 0

function wrapAssertionCall(fn, methodName) {
  return function wrapped(...args) {
    cjsAssertionCount++
    return fn.apply(this, args)
  }
}

function wrapNamespace(real) {
  const wrapped = function assertFn(value, message) {
    cjsAssertionCount++
    return real(value, message)
  }
  for (const key of Object.keys(real)) {
    const value = real[key]
    if (typeof value === 'function') {
      wrapped[key] = wrapAssertionCall(value, key)
    }
  }
  return wrapped
}

const wrappedDefault = wrapNamespace(realAssert)
const wrappedStrict = wrapNamespace(realStrict)
// node:assert's default export exposes a `.strict` view; mirror it.
wrappedDefault.strict = wrappedStrict
wrappedStrict.strict = wrappedStrict

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'node:assert' || request === 'assert' || request === 'assert/') {
    return wrappedDefault
  }
  if (request === 'node:assert/strict' || request === 'assert/strict') {
    return wrappedStrict
  }
  return origLoad.call(this, request, parent, isMain)
}

process.on('exit', () => {
  if (cjsAssertionCount > 0) {
    console.log(`STRUCTURAL_OK: ${cjsAssertionCount} assertions`)
  }
})

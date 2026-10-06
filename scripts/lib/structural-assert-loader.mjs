// Module loader that replaces node:assert / node:assert/strict with counting
// wrappers. On process exit each structural script prints
// `STRUCTURAL_OK: N assertions`; the runner fails any script whose N is 0 or
// missing, closing the "exit 0 without a single executed assertion" hole
// (wps_07 B5).
const VIRTUAL_ASSERT = 'structural-virtual:assert'
const VIRTUAL_ASSERT_STRICT = 'structural-virtual:assert/strict'

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'node:assert' || specifier === 'assert') {
    return { url: VIRTUAL_ASSERT, shortCircuit: true }
  }
  if (specifier === 'node:assert/strict' || specifier === 'assert/strict') {
    return { url: VIRTUAL_ASSERT_STRICT, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url === VIRTUAL_ASSERT || url === VIRTUAL_ASSERT_STRICT) {
    return { format: 'module', shortCircuit: true, source: buildSource(url) }
  }
  return nextLoad(url, context)
}

function buildSource(url) {
  const strict = url === VIRTUAL_ASSERT_STRICT
  // require() bypasses ESM loader hooks, so the builtin is reachable without
  // re-entering this loader. Base createRequire on a real file in the working
  // directory (the runner always sets cwd to the project root).
  return `
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(pathToFileURL(process.cwd() + '/package.json'))
const realDefault = require(${strict ? "'node:assert/strict'" : "'node:assert'"})
const realStrict = require('node:assert/strict')

let assertionCount = 0
function count(value, message) {
  assertionCount += 1
  return realDefault(value, message)
}
function wrapMethod(fn) {
  return function wrappedMethod(...args) {
    assertionCount += 1
    return Reflect.apply(fn, this, args)
  }
}
for (const key of Reflect.ownKeys(realDefault)) {
  if (key === 'length' || key === 'name' || key === 'prototype') continue
  const descriptor = Reflect.getOwnPropertyDescriptor(realDefault, key)
  if (descriptor && typeof descriptor.value === 'function') {
    Reflect.defineProperty(count, key, { ...descriptor, value: wrapMethod(descriptor.value) })
  } else if (descriptor) {
    Reflect.defineProperty(count, key, descriptor)
  }
}
// node:assert exposes the strict API at assert.strict.
count.strict = countStrict
count.ok = count

let strictCount
function countStrict(value, message) {
  assertionCount += 1
  return realStrict(value, message)
}
for (const key of Reflect.ownKeys(realStrict)) {
  if (key === 'length' || key === 'name' || key === 'prototype') continue
  const descriptor = Reflect.getOwnPropertyDescriptor(realStrict, key)
  if (descriptor && typeof descriptor.value === 'function') {
    Reflect.defineProperty(countStrict, key, { ...descriptor, value: wrapMethod(descriptor.value) })
  } else if (descriptor) {
    Reflect.defineProperty(countStrict, key, descriptor)
  }
}
countStrict.strict = countStrict
countStrict.ok = countStrict
strictCount = countStrict

process.on('exit', () => {
  if (assertionCount > 0) {
    console.log('STRUCTURAL_OK: ' + assertionCount + ' assertions')
  }
})

${strict ? 'export default strictCount' : 'export default count'}
`
}

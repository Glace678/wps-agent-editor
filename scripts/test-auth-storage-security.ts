import assert from 'node:assert/strict'
import { isStrongSafeStorageBackend } from '../electron/services/auth-storage-security'

assert.equal(isStrongSafeStorageBackend('win32', true), true)
assert.equal(isStrongSafeStorageBackend('darwin', true), true)
assert.equal(isStrongSafeStorageBackend('linux', true, 'gnome_libsecret'), true)
assert.equal(isStrongSafeStorageBackend('linux', true, 'kwallet6'), true)
assert.equal(isStrongSafeStorageBackend('linux', true, 'basic_text'), false)
assert.equal(isStrongSafeStorageBackend('linux', true, 'unknown'), false)
assert.equal(isStrongSafeStorageBackend('linux', false, 'gnome_libsecret'), false)
assert.equal(isStrongSafeStorageBackend('win32', false), false)

console.log('PASS authentication secrets persist only with a strong OS storage backend')

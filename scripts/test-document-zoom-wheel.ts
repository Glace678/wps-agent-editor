import assert from 'node:assert/strict'
import {
  consumeWheelZoomSteps,
  normalizeWheelZoomDelta,
} from '../src/components/layout/modules/document-zoom-wheel'

assert.equal(normalizeWheelZoomDelta(-100, 0), -1)
assert.equal(normalizeWheelZoomDelta(100, 0), 1)
assert.equal(normalizeWheelZoomDelta(-3, 1), -1)
assert.equal(normalizeWheelZoomDelta(1, 2), 1)

const trackpadDelta = Array.from({ length: 10 }, () =>
  normalizeWheelZoomDelta(-10, 0),
).reduce((sum, delta) => sum + delta, 0)
assert.deepEqual(consumeWheelZoomSteps(trackpadDelta), { steps: -1, remainder: 0 })

const burst = consumeWheelZoomSteps(5.25)
assert.equal(burst.steps, 5)
assert.ok(Math.abs(burst.remainder - 0.25) < 1e-9)

const reverseBurst = consumeWheelZoomSteps(-3.4)
assert.equal(reverseBurst.steps, -3)
assert.ok(Math.abs(reverseBurst.remainder + 0.4) < 1e-9)

console.log('document zoom wheel normalization: ok')

const PIXEL_DELTA_PER_STEP = 100
const STANDARD_WHEEL_DELTA = 40
const STEP_EPSILON = 1e-6

/**
 * Convert browser/device-specific wheel deltas into logical 10% zoom steps.
 * A mouse-wheel notch is one step, while high-resolution trackpad deltas are
 * accumulated until they amount to a full step.
 */
export function normalizeWheelZoomDelta(
  deltaY: number,
  deltaMode: number,
): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0

  if (deltaMode === 1 || deltaMode === 2) {
    return Math.sign(deltaY)
  }

  if (Math.abs(deltaY) >= STANDARD_WHEEL_DELTA) {
    return Math.sign(deltaY)
  }

  return deltaY / PIXEL_DELTA_PER_STEP
}

export function consumeWheelZoomSteps(accumulatedDelta: number): {
  steps: number
  remainder: number
} {
  const steps = accumulatedDelta > 0
    ? Math.floor(accumulatedDelta + STEP_EPSILON)
    : Math.ceil(accumulatedDelta - STEP_EPSILON)
  const remainder = accumulatedDelta - steps
  return { steps, remainder: Math.abs(remainder) < STEP_EPSILON ? 0 : remainder }
}

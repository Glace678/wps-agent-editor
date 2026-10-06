// C5: e2e timeouts are environment-overridable so CI can give slow machines
// more room without editing test sources.
//   WAE_E2E_TEST_TIMEOUT_MS  — whole-test wall clock (test.setTimeout)
//   WAE_E2E_STEP_TIMEOUT_MS  — single worker operation inside page.evaluate
const envNumber = (name: string): number => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** Per-test wall clock; CI override only ever widens the local default. */
export function e2eTestTimeout(defaultMs: number): number {
  const override = envNumber('WAE_E2E_TEST_TIMEOUT_MS')
  return override > 0 ? Math.max(defaultMs, override) : defaultMs
}

/** Per-operation step timeout forwarded into page.evaluate calls. */
export function e2eStepTimeout(defaultMs = 20_000): number {
  const override = envNumber('WAE_E2E_STEP_TIMEOUT_MS')
  return override > 0 ? override : defaultMs
}

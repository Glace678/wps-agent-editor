// Registers the structural-test assertion counter loader. Invoked through
// `node --import` by scripts/run-structural-tests.mjs (wps_07 B5).
import { register } from 'node:module'

register(new URL('./structural-assert-loader.mjs', import.meta.url))

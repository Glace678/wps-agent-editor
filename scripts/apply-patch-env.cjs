const { spawnSync } = require('node:child_process')

const result = spawnSync(process.argv[2], ['--codex-run-as-apply-patch', process.env.CODEX_PATCH], {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)

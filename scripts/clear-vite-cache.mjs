// Vite 依赖预打包缓存里是打补丁前的 superdoc；补丁改写 node_modules 后
// lockfile 哈希不变，dev server 重启也不会重新预打包（页面继续跑旧引擎）。
// 清掉缓存，下次 dev 启动强制重新预打包。生产 build 每次从 node_modules
// 重新打包，不受影响。
//
// 引擎补丁本身由 patch-package 在 postinstall 时从 patches/ 应用
// （git-style diff，无法应用即失败），本脚本只负责缓存失效。
import { existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const cacheDir of [
  path.join(root, 'node_modules', '.vite'),
  path.join(root, 'node_modules', '.vite-temp'),
]) {
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true })
    console.log(`cleared stale Vite dependency cache: ${path.relative(root, cacheDir)}`)
  }
}

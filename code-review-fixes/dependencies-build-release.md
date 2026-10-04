# dependencies/build/release 修复对账

来源 finding：`review-dependencies-build-release.md`（静态审查报告第 1324–1450 行），共 8 项。
执行日期：2026-10-04。Shell 统一 PowerShell 5.1；未做任何 git commit/push/tag。

## 汇总

- 共 8 项。
- **已修复 7 项**：F1、F2、F3、F4、F6、F7、F8。
- **保留现状（不适用/残留）1 项**：F5（glib，上游无可用升级路径，条件性、仅 Linux GTK 构建编译）。

| # | finding | 严重度/状态 | 处理状态 |
|---|---------|-------------|----------|
| F1 | 发布工作流可变 Action 标签 | conditional/High | 已修复（39 处全部固定为 commit SHA） |
| F2 | npm audit 排除 devDependencies | confirmed/Medium | 已修复（新增完整审计步骤） |
| F3 | lopdf 0.34.0 栈溢出 DoS（RUSTSEC-2026-0187） | conditional/Medium | 已修复（lopdf 0.34.0 → 0.42.0） |
| F4 | rustls 0.23.43 TLS1.3 边界（RUSTSEC-2026-0285） | conditional/Medium | 已修复（rustls 0.23.43 → 0.23.45） |
| F5 | glib 0.18.5 VariantStrIter UB（RUSTSEC-2024-0429） | conditional/Low | 保留现状（上游无 gtk-rs 0.20 集成路径） |
| F6 | prepare-esbuild-sidecar 下载不校验摘要 | conditional/Medium | 已修复（lock SHA-512 校验 + 安全解包） |
| F7 | Windows 文件关联硬编码 exe 名 | conditional/Low | 已修复（改为 office-agentic.exe） |
| F8 | 合约测试期待不存在的 desktop 路径 | confirmed/Medium | 已修复（断言/读取路径改小写，测试通过） |

## 逐项

### F1 — 第三方 Action 固定到 commit SHA
- 处理状态：已修复。
- 关键改动：四个 workflow 中全部 39 处 `uses:` 由 `@vN/@stable` 替换为官方仓库联网核验的 40 位 commit SHA（保持主版本同线）。
  - `.github/workflows/ci.yml`（7 处）：checkout x2、setup-node x2、rust-toolchain x2、upload-artifact x1
  - `.github/workflows/release.yml`（12 处）：checkout x3、setup-node x2、rust-toolchain x2、upload-artifact x2、download-artifact x1、attest-build-provenance x1、action-gh-release x1
  - `.github/workflows/unsigned-prerelease.yml`（12 处）：同上 12 处
  - `.github/workflows/staging-smoke.yml`（8 处）：checkout x3、setup-node x3、upload-artifact x2
- 核验方式：`git ls-remote <repo>.git <ref>` 直接读取官方仓库 ref 指向的 commit（checkout v4 另经 `https://api.github.com/repos/actions/checkout/git/ref/tags/v4` 交叉确认为 `type=commit`）。
- SHA 对照表（原 ref → 固定 SHA）：

  | Action | 原 ref | 固定 commit SHA |
  |---|---|---|
  | actions/checkout | v4 | `11d5960a326750d5838078e36cf38b85af677262` |
  | actions/setup-node | v4 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
  | dtolnay/rust-toolchain | stable | `89b12181fb390509a0842a86cc55eeb8eb928c1d` |
  | actions/upload-artifact | v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
  | actions/download-artifact | v4 | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |
  | actions/attest-build-provenance | v3 | `43d14bc2b83dec42d39ecae14e916627a18bb661` |
  | softprops/action-gh-release | v2 | `3bb12739c298aeb8a4eeaf626c5b8d85266b0e65` |

  注：四个 workflow 中未出现 `tauri-apps/tauri-action`（构建直接用 `npx tauri build`），也无可复用 workflow（reusable workflow）引用；以上为实际出现的全部第三方 Action。
- 验证：`Grep '\@v\d|\@stable|\@latest|\@main|\@master' .github/workflows` → **0 命中**；`Grep 'uses:'` → 39 处全部为 40 位 SHA。`node scripts/release/test-release-contract.mjs` → `Release contract tests passed`。

### F2 — npm audit 覆盖 devDependencies
- 处理状态：已修复。
- 关键改动：`.github/workflows/ci.yml:35-38`。原单行 `npm audit --omit=dev --audit-level=high` 拆为两步：
  - `ci.yml:36` `npm audit --audit-level=high`（production + development 完整审计，high 门禁）
  - `ci.yml:38` `npm audit --omit=dev --audit-level=high`（保留生产依赖单独审计）
- 验证：改动后 `node scripts/release/test-release-contract.mjs` 通过（合约测试读取 ci.yml 未受影响）。

### F3 — lopdf >=0.42.0（RUSTSEC-2026-0187）
- 处理状态：已修复。
- 调研：crates.io 查询显示 pdf-extract 0.12.0/0.12.1 依赖 `lopdf ^0.42`；0.10.0 仍为 `^0.38`，0.9.0 为 `^0.36`——只有 0.12.x 线能拉到受修复的 lopdf。
- 关键改动：
  - `src-tauri/Cargo.toml:31`：`pdf-extract = "=0.8.2"` → `pdf-extract = "=0.12.1"`
  - `src-tauri/Cargo.lock`：`pdf-extract 0.8.2 → 0.12.1`、`lopdf 0.34.0 → 0.42.0`（新增 nom 8、aes、cbc、cff-parser 0.2 等传递依赖）
- 验证：`cargo update -p pdf-extract --precise 0.12.1` → 成功；`cargo check --manifest-path src-tauri/Cargo.toml` → `Finished dev profile ... exit 0`（pdf-extract 0.12.1 API 与现有 src 代码兼容，未触发编译错误）；`Cargo.lock` 确认 `lopdf = 0.42.0`。

### F4 — rustls >=0.23.45（RUSTSEC-2026-0285）
- 处理状态：已修复。
- 关键改动：`src-tauri/Cargo.lock`：`rustls 0.23.43 → 0.23.45`（reqwest 0.12.28 rustls-tls 同线兼容，无需改 Cargo.toml）。
- 验证：`cargo update -p rustls` → `Updating rustls v0.23.43 -> v0.23.45`；`cargo check` → exit 0（重编译 rustls 0.23.45、tokio-rustls、hyper-rustls、reqwest 后 Finished）；`cargo tree -p rustls` / Cargo.lock 确认 `rustls = 0.23.45`。

### F5 — glib >=0.20.0（RUSTSEC-2024-0429）
- 处理状态：**保留现状（不升级）**，理由如下。
- 现状：`Cargo.lock` 中 `glib = 0.18.5`、`glib-sys = 0.18.1`、`gtk = 0.18.2`、`gdk = 0.18.2`、`gtk-sys = 0.18.2`，链为 `tauri 2.11.5 → wry 0.55.1 → gtk ^0.18 → glib 0.18.x`（tao 0.35.3）。
- 调研结论：crates.io 显示 wry 即便最新版 **0.57.0** 仍依赖 `gtk ^0.18`、`gdkx11 ^0.18`、`webkit2gtk =2.0.2`；没有任何已发布的 wry 版本使用 gtk-rs 0.20 / glib 0.20。glib 0.20 属于 gtk-rs 0.20 发布线，要落到本项目必须先有一个使用该线的 wry，再由 tauri 接纳——上游目前不存在。强行在 Cargo.toml 引入 glib 0.20 会与 wry 锁定的 `gtk ^0.18 / glib ^0.18` 冲突，导致依赖求解失败或破坏构建。
- 可达性边界：`gtk/glib/webkit2gtk` 链仅在 Linux GTK 目标编译；Windows/macOS 不编译该链（`cargo tree -p glib` 在本机 Windows 返回 “nothing to print”）。公告触发还需业务代码实际调用 `VariantStrIter` 的 next/next_back/last/nth——业务源码已排除，故为 conditional。
- 处置：按报告“无法在不破坏项目前提下完成则保留并说明”保留 `glib 0.18.5`。后续待上游 wry 升级到 gtk-rs 0.20 线后随 tauri 整体升级。

### F6 — prepare-esbuild-sidecar 跨平台下载校验摘要
- 处理状态：已修复。
- 关键改动：`scripts/prepare-esbuild-sidecar.mjs`
  - 新增 `loadLockEntry(name)`：从 `package-lock.json` 的 `packages["node_modules/@esbuild/<pkg>"]` 读取 `integrity`（须为 `sha512-` 前缀），读不到则拒绝下载。
  - 新增 `safeExtractTar(bytes, destDir)`：内置 gzip+tar 解析，逐成员拒绝绝对路径、含 `..` 的路径、逃逸根目录的路径，拒绝硬链接(type=1)/符号链接(type=2)成员，仅写普通文件；不再盲目调用外部 `tar`。
  - `downloadPackage()`：`npm pack` 后先用 `crypto.sha512` 计算 tarball 摘要并与 lock 的 integrity 严格比对，不一致即抛错；解包后经 `realpath` 校验二进制落在隔离临时目录内，且为普通文件，再复制。
  - 优先路径不变：`node_modules/@esbuild/<pkg>` 已由 `npm ci` 按 lock 安装时直接使用（不触发下载），仅当缺失才走上述已校验下载路径。
- 验证：`node --check scripts/prepare-esbuild-sidecar.mjs` → 语法通过；host 目标（win32-x64 已安装）走快速路径 `Reusing prepared esbuild 0.25.12`；外来目标 `--target x86_64-unknown-linux-gnu` 触发 `npm pack`，npm notice 显示 `integrity: sha512-uqZMTLr/...QZkgw==` 与 package-lock.json:840 一致，安全解包产出 10,358,936 字节二进制，`Prepared esbuild 0.25.12 ... (execution deferred)`。产物位于 gitignore 的 `src-tauri/binaries/`。

### F7 — Windows 文件关联 exe 名
- 处理状态：已修复。
- 关键改动：`src-tauri/windows/installer-hooks.nsh:2` 六个 ProgID 的 open command 由 `$INSTDIR\wps-agent-editor.exe` 改为 `$INSTDIR\office-agentic.exe`。
- 依据：Cargo 包名 `office-agentic`（Cargo.toml:2），无 `[[bin]]` 覆盖，tauri.conf.json 未设 `mainBinaryName`，故主二进制为 `office-agentic.exe`。

### F8 — 合约测试 desktop 路径大小写
- 处理状态：已修复。
- 关键改动：`scripts/release/test-release-contract.mjs:157` 断言由 `'linux/Office-Agentic.desktop'` 改为 `'linux/office-agentic.desktop'`（与 `tauri.conf.json:49` 的 `linux/office-agentic.desktop` 及仓库实际文件 `src-tauri/linux/office-agentic.desktop` 一致）。
- 验证：`node scripts/release/test-release-contract.mjs` → `Release contract tests passed`（exit 0）。

## 依赖升级明细

| 包 | 升级前 | 升级后 | 触发 finding | cargo check 结果 |
|----|--------|--------|--------------|------------------|
| rustls | 0.23.43 | 0.23.45 | RUSTSEC-2026-0285 (F4) | `Finished dev profile` exit 0 |
| pdf-extract | 0.8.2 | 0.12.1 | RUSTSEC-2026-0187 间接 (F3) | `Finished dev profile` exit 0 |
| lopdf | 0.34.0 | 0.42.0 | RUSTSEC-2026-0187 (F3) | 随 pdf-extract 升级一并通过 |
| glib | 0.18.5 | 0.18.5（未升级） | RUSTSEC-2024-0429 (F5) | N/A（上游无 gtk-rs 0.20 路径，保留） |

说明：
- 所有版本命中均沿用报告 conditional 表述：锁定版本落入公告区间不等于已确认可利用；F3/F4 的业务调用链在排除范围内，本次仅完成依赖版本升级与编译回归。
- cargo check 在 Windows 主机完成（glib/gtk 链为 Linux-only，本机不编译该部分）；Linux GTK 构建的最终复验由协调者统一进行。

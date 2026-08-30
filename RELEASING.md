# WPS Agent Editor v2 发布手册

本仓库保留 Electron `v1.0.0` 标签和既有资产。Tauri v2 使用独立的 `v2/` 数据目录，首个稳定版不会从 Electron `v1.0.0` 自动升级，也不会读取、迁移或删除 v1 数据。

公开发布目标固定为六个：

- `windows-x86_64-setup.exe`
- `windows-aarch64-setup.exe`
- `macos-x86_64.dmg`
- `macos-aarch64.dmg`
- `linux-x86_64.AppImage`
- `linux-aarch64.AppImage`

仓库不发布 Windows i686、Zed remote server 或 bwrap 产物。所有主要安装包必须小于 100 MiB。

## 未签名 RC

版本必须在 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中一致，并与注释标签完全匹配。例如 `2.0.0-rc.1` 对应：

```bash
git tag -a v2.0.0-rc.1 -m "WPS Agent Editor v2.0.0-rc.1"
git push origin v2.0.0-rc.1
```

`Unsigned release candidate` 只接受 `v*-rc.*` 标签。它不会读取签名 secrets，不会生成 `latest.json`、updater 包或 Ed25519 签名，也不会进入自动更新渠道。工作流会在六个原生 runner 上构建、安装、验证架构和文件关联、执行核心功能与启动检查并卸载，然后发布公开 prerelease、`SHA256SUMS`、npm/Rust CycloneDX SBOM、AGPL 对应源码 ZIP 和 GitHub 构建证明。

RC 未签名。Windows 可能显示 Microsoft Defender SmartScreen 警告；macOS Gatekeeper 默认会阻止普通启动，测试者必须在系统安全设置中明确批准。不要把 RC 当作稳定版分发。

## 正式签名凭据

在 GitHub 仓库的 **Settings > Secrets and variables > Actions** 中创建以下 repository secrets。值只应在 GitHub 的加密 secret 表单中输入；不要发到聊天、提交到源码、放进 `.env`、保存为 Actions artifact，或在日志中输出。

| Secret | 内容 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater Minisign 私钥的完整内容；只保存在密码管理器和 GitHub Secret 中 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成 updater 私钥时设置的密码 |
| `TAURI_UPDATER_PUBLIC_KEY` | 与上述私钥配对的 Tauri Minisign 公钥完整内容；工作流仍按 secret 注入以统一配置 |
| `WINDOWS_CERTIFICATE` | 包含私钥和 Code Signing EKU 的 `.pfx` 文件的单行 Base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | `.pfx` 导出密码 |
| `APPLE_CERTIFICATE` | Developer ID Application `.p12` 文件的单行 Base64 |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` 导出密码 |
| `APPLE_KEYCHAIN_PASSWORD` | 仅供 CI 临时 keychain 使用的高强度随机密码 |
| `APPLE_SIGNING_IDENTITY` | 完整的 `Developer ID Application: ... (TEAMID)` 签名身份 |
| `APPLE_API_ISSUER` | App Store Connect API Issuer ID |
| `APPLE_API_KEY` | App Store Connect API Key ID，不是私钥内容 |
| `APPLE_API_KEY_CONTENT` | 对应 `AuthKey_<KEY_ID>.p8` 文件的原始完整内容 |

Tauri updater 的公私钥必须作为一对生成并长期备份；丢失私钥会导致已安装版本无法验证后续更新。官方命令示例：

```bash
npm run tauri signer generate -- -w ~/.tauri/wps-agent-editor.key
```

命令会交互式要求密码。不要在 shell 历史中写明文密码，也不要在仓库目录生成私钥。Windows 工作流当前使用可导出的 PFX；如果证书颁发机构要求硬件令牌或云签名服务，必须先把工作流改为该机构支持的签名方式，不能导出或伪造私钥。Apple `.p12` 必须包含 Developer ID Application 证书及其私钥；公证 API 私钥只能下载一次，应另行离线备份。

参考官方文档：

- [Tauri Windows 签名](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri macOS 签名和公证](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/concepts/security/secrets)

## 正式版流程

1. 将上述五处版本提升为 `2.0.0`，运行全部本地门禁并推送 `main`。
2. 等待远端 `CI` 全绿，创建并推送注释标签 `v2.0.0`。
3. `Signed cross-platform release` 只接受没有预发布后缀的 tag。它要求全部 12 个 secrets，构建六个平台的签名安装包、updater 包和签名，并验证 Windows Authenticode、macOS Developer ID、公证与 stapling。
4. 工作流先创建 prerelease。运行 `Signed staging release smoke`，设置 `release_tag=v2.0.0`、`previous_tag` 留空、`promote=true`。
5. 只有六平台安装、下载后校验和签名验收全部成功，独立的最小权限任务才会把 `v2.0.0` 提升为 Latest 稳定版。

`v2.0.0` 之后的稳定版必须把 `previous_tag` 设为上一已发布稳定版，以验证真实 updater 安装、签名篡改拒绝、无效安装保持原版本、启动健康检查和失败回滚。

## 本地门禁

```bash
npm run check:sensitive
node scripts/check-version.mjs
node scripts/release/test-release-contract.mjs
npm audit --omit=dev --audit-level=high
npm run check:i18n
npm run check:providers
npm run test:web-canaries
npm run check:generated
npm run typecheck
npm run build:web
node scripts/release/check-bundle-inputs.mjs
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

不要在本地门禁、RC 或正式工作流中降低 100 MiB 预算、跳过敏感数据扫描、关闭签名验证，或手工上传缺少校验和、SBOM、源码和构建证明的替代资产。

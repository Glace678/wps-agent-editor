# WPS Agent Editor

WPS Agent Editor 2 是基于 Tauri v2、React 和 Rust 的跨平台文档编辑器与多 Agent 工作台。桌面端使用系统 WebView，不再捆绑 Electron、Chromium、Node.js 或 OnlyOffice Document Server。

## 内置能力

- Word：SuperDoc
- Excel：Fortune Sheet
- PDF：PDF.js
- PowerPoint：pptx-renderer；常用 PPTX 编辑由 Rust OOXML 后端完成
- 文本与 Markdown：内置编辑器
- 代码：Monaco；执行和调试使用本机已安装的语言工具链
- Agent：OpenAI、Anthropic、Google、Ollama 和 OpenAI-compatible Provider

旧 `.doc`、`.ppt` 与复杂媒体转换需要系统 WPS、Microsoft Office 或 LibreOffice。JavaScript/TypeScript 运行需要系统 Node.js；其他语言同样使用系统工具链。缺失依赖会返回可识别的 `dependency-missing` 错误，不会在运行时静默下载大型组件。

## 开发

要求：

- Node.js 22+
- Rust stable 与对应编译目标
- [Tauri v2 平台依赖](https://v2.tauri.app/start/prerequisites/)

```bash
npm ci
npm run dev
```

仅运行浏览器界面：

```bash
npm run dev:web
```

验证：

```bash
npm run typecheck
npm run build:web
npm run check:rust
npm run test:rust
```

## 发布目标

正式 Release 构建以下签名产物：

- Windows 10+：x86、x86_64、ARM64 NSIS 安装程序
- macOS：Intel 与 Apple Silicon DMG
- Linux：x86_64 与 ARM64 AppImage

每个主要下载包的 CI 上限为 100 MiB。Tag 必须与 `package.json`、Cargo 和 `tauri.conf.json` 的版本一致；稳定版还要求 Windows Authenticode、macOS Developer ID/公证及 Tauri updater Ed25519 密钥。

Pull Request 会在七个原生目标上生成短期保留的未签名测试包。正式 tag 构建必须通过对应平台的签名、文件关联、核心文档、Agent 流式响应、安装、启动、内容检查和卸载冒烟后才能进入单一 finalize 任务；finalize 统一生成 updater 元数据、拒绝安装夹具、校验和、SBOM、源码归档与构建证明，并先发布为 prerelease。

`Signed staging release smoke` 使用精确 tag 在七个平台验证签名篡改拒绝、无效安装保持原程序、真实升级、重启、启动健康检查、失败回滚和外部版本/哈希。每个目标还会重新安装旧版，注入一次更新后启动失败，并从进程外确认旧载荷已恢复和重启。工作流默认只验收；显式选择 `promote` 且全部矩阵通过时，只有独立的最小权限 job 可以将 prerelease 提升为稳定版。`v2.0.0` 之后必须提供较旧的已发布 tag，不能跳过升级验收。

## v2 数据策略

v2 将配置写入新的 `v2/` 应用数据目录。旧 Electron 配置和用户文档不会被读取、迁移或删除；API key 需要重新录入并只存放在系统凭据库中。更新前会在 `v2/updater-health/` 创建受限备份和原子事务状态；新版本只有在 React 已挂载且完成原生 IPC 往返后才确认健康，否则独立旧版本 guardian 会恢复原安装载荷。

## Codex 对话迁移

Agent 面板首次启动时会扫描当前用户的 `CODEX_HOME`（未设置时使用 `~/.codex`）中的活动与归档 JSONL 会话，并以幂等方式写入 `v2/conversations/`。历史面板中的下载按钮可以随时重新扫描；已同步的文件不会重复导入，后续新增或变化的会话会增量更新。

导入仅保留可续聊的用户、助手和系统消息，同时保留标题、项目路径、原始 Provider/模型和归档状态；开发者指令、内部推理、工具调用输出、Codex 凭据文件和附件原始数据不会被读取或进入对话上下文。用户主动粘贴在正文中的敏感信息会按原文保存，请在共享前自行检查。选择任意历史对话后，可以直接切换到已配置的 OpenAI、Anthropic、Google、Ollama 或 OpenAI-compatible Provider 继续工作。超长历史会在发送时自动压缩为便携上下文窗口，原始记录仍完整保存在本地。

Codex 的 shell/process 会话、审批状态和正在运行的工具不会迁移；外部模型会基于已导入的可见消息和当前应用可用工具继续执行。

## 许可证

本项目以 GNU Affero General Public License v3.0 only 发布。参见 [LICENSE](./LICENSE) 和 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。分发二进制时必须同时提供该版本对应的完整源代码。

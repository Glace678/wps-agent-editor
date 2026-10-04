# Rust 后端修复对账

## 汇总（候选13；已修复13；不适用0；部分/残留0）

- 候选：13（F1–F13）
- 已修复：13
- 不适用：0
- 部分/残留：0

说明：confirmed 项（F1、F2）已修复；conditional 项（F4–F12）按报告建议加固使其触发条件失效；hypothesis 项（F13）按防御性修复落地。未将任何 conditional/hypothesis 表述为已复现漏洞。仅编辑 `src-tauri/src/**`，未触碰 Cargo.toml/Cargo.lock，未新增依赖。

## 逐项

### F1 — 会话保存路径未规范化 conversation ID
- 报告状态 confirmed / 处理状态 已修复
- 关键改动：`src-tauri/src/agents/conversations.rs` `save()` 入口先 `request.id = request.id.trim().to_owned()`，再 `validate_conversation_id`。trim 后的 ID 随后统一用于记录文件写入、摘要 `record_path`、索引与 summary 回写。`get/delete` 在 commands 层本就 trim，现与写入路径解析同一文件。
- 验证：`cargo check` 通过（CARGO_EXIT=0）。

### F2 — 外部 URL opener 未校验退出状态
- 报告状态 confirmed / 处理状态 已修复
- 关键改动：`src-tauri/src/commands/app.rs` `app_open_url` 的非 Windows 分支（macOS `open` / Linux `xdg-open`）在 `status()` 后检查 `!status.success()`，非零退出取 `code().unwrap_or(-1)` 写入 `log::warn!` 并返回稳定错误码 `open-failed`；不再把失败启动器当成功。
- 验证：`cargo check` 通过。

### F3 — updater 健康失败注入被裸 argv 开关触发
- 报告状态 conditional / 处理状态 已修复（加固使触发条件失效）
- 关键改动：
  - `src-tauri/src/updater_smoke.rs` `health_failure_injection_active()` 改为同时要求：argv 含 `HEALTH_FAILURE_FLAG` **且** argv 含 `SMOKE_FLAG` **且** 环境变量 `WAE_UPDATER_SMOKE=1`，三者全真才返回 true。生产 `mark_startup_healthy` 不再独立 honor 裸 argv 开关。
  - `src-tauri/src/update_health.rs` `filtered_relaunch_args()` 新增剔除 `HEALTH_FAILURE_FLAG`，避免 guardian 重启把失败标志传播到生产进程。
- 验证：`cargo check` 通过。

### F4 — 会话复合写（记录+摘要+索引）竞态
- 报告状态 conditional / 处理状态 已修复
- 关键改动：`src-tauri/src/agents/conversations.rs` 新增 `write_gate: Arc<Mutex<()>>`（复用已有 parking_lot 依赖）。`save()`、`delete()`、`import_codex()` 各自在入口持有该锁，覆盖“读已有→写记录→更摘要→写索引”完整复合操作，使 save 与 delete 不再交错。
- 验证：`cargo check` 通过。

### F5 — provider 响应体无界读取
- 报告状态 conditional / 处理状态 已修复
- 关键改动：
  - `src-tauri/src/agents/provider.rs` 将 `MAX_PROVIDER_BODY_BYTES` 提为 `pub(crate)`，新增 `pub(crate) async fn read_bounded_json(response) -> AppResult<Value>`：先查 `Content-Length` 超 2MiB 即拒，再按 chunk 流式累计、累计字节超 2MiB 硬拒绝，最后才 `serde_json::from_slice`。
  - `src-tauri/src/commands/providers.rs` 三条路径（Ollama 发现、custom test、`fetch_models_dev`）均由无界 `.json().await` 改为 `read_bounded_json(response)`。
- 验证：`cargo check` 通过。

### F6 — 附件缓存每会话无界增长
- 报告状态 conditional / 处理状态 已修复
- 关键改动：`src-tauri/src/agents/runtime.rs` `AttachmentSession` 改为 `messages: HashMap<String, CachedAttachment{text, used_at}>` + `session_bytes`；新增 `MAX_ATTACHMENT_CACHE_ENTRIES_PER_SESSION=64`、`MAX_ATTACHMENT_CACHE_SESSION_BYTES=256KiB`。单条目超过会话字节预算则跳过缓存；插入后按 `used_at` LRU 淘汰直到条目数与字节数双预算内；命中时刷新 `used_at`。
- 验证：`cargo check` 通过。

### F7 — 附件缓存签名未含渲染预算
- 报告状态 conditional / 处理状态 已修复
- 关键改动：`src-tauri/src/agents/runtime/attachments.rs` `attachment_signature(owner, message, maximum_chars)` 新增 `maximum_chars` 参数，将 `maximum_chars.to_le_bytes()` 并入 SHA-256；`runtime.rs` 调用处传入 `maximum_chars`。小预算渲染不再被大预算请求复用。
- 验证：`cargo check` 通过。

### F8 — PNG 剪贴板解码峰值内存
- 报告状态 conditional / 处理状态 已修复
- 关键改动：`src-tauri/src/commands/documents.rs` `documents_write_png_clipboard`：保留 25MiB 压缩 / 100MP 既有界限；新增 `MAX_DECODED_PIXEL_BYTES=96MiB` 在分配 `decoded` 前硬校验 `output_buffer_size`；`pixels = width.checked_mul(height)` 做 checked 算术防溢出；用 `std::sync::OnceLock<Semaphore>(2)` 全局信号量对解码做有界并发（permit 持有至 blocking decode 结束）。
- 验证：`cargo check` 通过。

### F9 — documents_read_file metadata/读取 TOCTOU
- 报告状态 conditional / 处理状态 已修复
- 关键改动：`src-tauri/src/commands/documents.rs` `documents_read_file` 改为 `tokio::fs::File::open` 后用同一 handle `take(MAX_READ_FILE_BYTES+1)` 有界 `read_to_end`，按实际读取字节数（而非 metadata.len()）判断是否超 100MiB，消除 metadata 与读之间的窗口。
- 验证：`cargo check` 通过。

### F10 — child grant 无界累积 / 目录遍历无预算
- 报告状态 conditional / 处理状态 已修复
- 关键改动：
  - `src-tauri/src/files/access.rs` `Grant` 新增 `minted_at: Instant`；`grant_child` 在 insert 前按 (owner, 规范化路径, source==Child) 复用已有 grant_id，反复列目录返回稳定 id；`insert` 在创建 Child grant 前调用 `enforce_child_grant_budget`（每 owner `MAX_CHILD_GRANTS_PER_OWNER=2048`，按 minted_at 淘汰最旧）。
  - `src-tauri/src/files/operations.rs` `list_directory` 新增 `MAX_LIST_DIRECTORY_ENTRIES=2000`，达到即停。
- 验证：`cargo check` 通过。

### F11 — 历史快照 metadata 长度即读取长度
- 报告状态 conditional / 处理状态 已修复
- 关键改动：`src-tauri/src/files/history.rs` `snapshot_unlocked` 改为先 `File::open`，用同一 handle `take(MAX_SNAPSHOT_SIZE+1)` 有界读取；按实际读取长度 `actual_len` 复验上限并写入 index 的 `size`（不再用 `metadata.len()`）。
- 验证：`cargo check` 通过。

### F12 — 字体大小校验晚于复制/读取
- 报告状态 conditional / 处理状态 已修复
- 关键改动：`src-tauri/src/documents/fonts.rs` `read_font`：`Source::Binary` 先 `data.as_ref().as_ref()` 取切片、校验 `slice.len() <= MAX_FONT_BYTES` 后再 `to_vec()`；`File/SharedFile` 改为 `File::open` 后 `take(MAX_FONT_BYTES+1)` 有界读取，超限立即返回 `font-too-large`，消除 metadata→read 的 TOCTOU。
- 验证：`cargo check` 通过。

### F13 — Windows 外链打开经 cmd.exe（hypothesis 防御性修复）
- 报告状态 hypothesis / 处理状态 已修复（防御性落地，未声称复现）
- 关键改动：`src-tauri/src/commands/app.rs` 手写 raw FFI：`#[cfg(target_os="windows")] #[link(name="shell32")] extern "system" { fn ShellExecuteW(...) -> isize; }`；UTF-16 宽字符以 0 收尾，operation="open"、URL 作为 lpFile 结构化整体传入（不拼命令行），`show_cmd=SW_SHOWNORMAL`；返回值 `<=32` 视为失败并映射为 `open-failed`。保留 http/https scheme 校验作为纵深防御。macOS/Linux 路径保留并应用 F2 退出码检查。
- 验证：`cargo check` 通过；`cargo clippy --manifest-path src-tauri/Cargo.toml` CLIPPY_EXIT=0，0 警告（初始 `needless_return` 已通过把两个 cfg 块改为仅做副作用、函数末尾统一尾表达式 `Ok(SuccessResult { success: true })` 返回消除，功能不变）。

## 验证命令
- `cd src-tauri; cargo check --message-format short` → `Finished dev profile`，CARGO_EXIT=0，无 error。
- 注：按纪律仅运行一次完整 cargo check（中途因 fonts.rs 一处类型错误修复后复跑）；未编辑 Cargo.toml/Cargo.lock，未新增依赖。

# Rust 域修复明细（documents / commands / files / providers）

- 基线 HEAD：`55b8ccf`。改动全部留在工作树，未 commit/push/tag。
- 作用域：仅 `src-tauri/src/documents/`、`src-tauri/src/commands/`、`src-tauri/src/files/`、`src-tauri/src/providers/`。
- 纪律：未运行 `cargo build/check/clippy/test`（target 与其他分片竞争，总控合并后统一跑）；未改报告；未改上述四个目录之外的文件。
- 行号为当前工作树（略晚于报告基线）实测行号；`confirmed` = 已按报告定位并改；`limitation` = 环境/跨域限制已注明。

---

## 已修复（10 项）

### P0-1 · merge_with_builtins 丢失 `is_local`
- 【报告位置】§1.3 Top10 第 2 条（报告 :33）；§12 一、总体结论表后说明（报告 :2700）；Top8 第 1 条（报告 :2773）。
- 【现状确认】`commands/providers.rs` 原 `merge_with_builtins` 在 `if let Some(bundled)` 分支只回填 `api/npm/doc/env/models`，随后 `providers.insert(provider.id, provider)` 用 remote（`fetch_models_dev` 一律 `is_local:false`）整体覆盖 bundled，ollama 的 `is_local:true` 被冲掉。`ProviderDefinition.is_local: bool` 字段见 `providers/store.rs:77-78`。
- 【关键改动】合并时保留本地标记：`provider.is_local |= bundled.is_local;`。
- 【证据】`commands/providers.rs:469`；回归测试 `merge_keeps_bundled_local_flag_when_remote_has_none`（`commands/providers.rs:491-512`）。
- 【状态】confirmed。

### P0-2 · 非 2xx 错误体无上限读
- 【报告位置】§1.3 Top10 第 4 条（报告 :35）；§12 providers/client.rs 问题 18（报告 :2758）；Top8 第 3 条（报告 :2775）。
- 【现状确认】`providers/client.rs` 原 `if !status.is_success() { let body = response.text().await... }` 一次性读全量错误体；成功 SSE 路径已有 `MAX_EVENT_BYTES=2MiB` 上限（`client.rs:10`）。
- 【关键改动】新增 `MAX_ERROR_BODY_BYTES = 64KiB`；新增 `read_bounded_error_body()` 按 `bytes_stream()` 逐块收集、超限即截断；错误消息追加 ` (truncated)` 注明。成功 SSE 流路径上限逻辑未动。
- 【证据】`providers/client.rs:15`（常量）、`:53-58`（调用）、`:96-115`（helper）。
- 【状态】confirmed。

### P0-3 · RegQueryValueExW 二次读取 TOCTOU 无长度复核
- 【报告位置】§10 §1.4（报告 :2207-2219）；§10 结论“必须做”第 2 条（报告 :2454）。
- 【现状确认】`documents/converter.rs` `registered_app_path` 先探测 `byte_count`，按 `div_ceil(2)` 分配 `Vec<u16>`，第二次 `RegQueryValueExW` 后未复核实际写入长度。
- 【关键改动】分配改为 `div_ceil(2) + 1`（留一个 u16 余量）；读完后断言 `written_bytes <= value.len()*2`，超界直接 `return None`（不 panic、不越界解释）；NUL 搜索范围收紧到实际写入单元 `value[..written_bytes/2]`。
- 【证据】`documents/converter.rs:1297`（+1 分配）、`:1314-1325`（尺寸复核与切片）。
- 【状态】confirmed。

### P0-4 · RegCloseKey 无 RAII + 5 处 unsafe 无 SAFETY + pid 回绕
- 【报告位置】§10 §1.1-1.6（报告 :2149-2241）；§10 结论“必须做”第 1/3/4 条（报告 :2453-2456）。
- 【现状确认】`converter.rs` 5 处生产 unsafe：unix `libc::kill(-(pid as i32),...)`、Windows `RegOpenKeyExW` / `RegQueryValueExW`(探测) / `RegQueryValueExW`(读) / `RegCloseKey`，全部无 `// SAFETY:`；`pid as i32` 无守卫；`RegCloseKey` 裸调用。
- 【关键改动】
  - 新增局部 `struct KeyGuard(Hkey); impl Drop`，`Drop` 内 `unsafe { RegCloseKey(self.0) }`；`RegOpenKeyExW` 成功后立即 `let _guard = KeyGuard(key)`，删除原裸 `unsafe { RegCloseKey(key); }`。
  - 5 处生产 unsafe 逐处补 `// SAFETY:`（数据来源、生命周期、返回值处理）。
  - unix 分支 `let Ok(pgid) = i32::try_from(pid) else { return; }`，随后 `libc::kill(-pgid, SIGKILL)`。
- 【证据】`documents/converter.rs:1132`（try_from）、`:1135-1138`（kill SAFETY）、`:1247-1257`（KeyGuard + Drop SAFETY）、`:1262-1265`（Open SAFETY）、`:1277-1279`（探测 SAFETY）、`:1298-1300`（读取 SAFETY）。
- 【状态】confirmed。

### P1-5 · store.rs keyring 调用未入 spawn_blocking
- 【报告位置】§12 providers/store.rs 问题 21（报告 :2765）；Top8 第 4 条（报告 :2776）；§11 providers/runtime 层（报告 :2514）；§13 keyring 口径。
- 【现状确认】`providers/store.rs` `auth_status()` / `set_api_key()` / `remove_api_key()` 均为同步 `&self` 方法，被异步 Tauri 命令直接调用，keyring FFI（Windows 凭据管理器可能阻塞）跑在 tokio worker 上；另有 `api_key()` 同步方法在 `agents/provider.rs` 三个 async 补全函数（`complete_openai`/`complete_anthropic`/`complete_google`）中被同步调用，即 async 上下文里仍有同步 keyring FFI。
- 【关键改动】
  - `auth_status` / `set_api_key` / `remove_api_key` 改 `pub async fn`，keyring get/set/delete 与失败回滚整体包进 `tokio::task::spawn_blocking`（闭包只 move 自有 `String`，不跨池持有 `&self`）；错误映射沿用 `From<keyring::Error> for AppError`（`credential-store-failed` / `credential-not-found`）；`set_api_key`/`remove_api_key` 在索引落盘失败时按原语义回滚凭据。
  - `api_key` 改 `pub async fn`，keyring get 包 `spawn_blocking`，错误码/缺失 key 行为不变。
  - 命令侧三处调用补 `.await`；`agents/provider.rs` 三处调用改 `store.api_key(&provider.id).await?`（anthropic/google 改为先取 key 再进 builder 链）。
- 【证据】`providers/store.rs:284-297`（auth_status：clone 快照给闭包，外部 `indexed` 保留做比较）、`:327-339`（set 主写 keyring）、`:344-355`（锁内提交 candidate，守卫块内 drop）、`:356-370`（锁外 spawn_blocking 回滚 + await）、`:380-394`（remove 主删 keyring）、`:399-410`（锁内提交）、`:411+`（锁外回滚）、`api_key` async（:427）；命令侧 `commands/providers.rs:155,162,171`；补全侧 `agents/provider.rs:257,363,438`。
- 【状态】confirmed。两轮 cargo check 修复：① 3 处 "borrow of moved value"（闭包前 clone 一份给闭包、外层保留原值）；② 2 处 Send 错误——parking_lot 写锁守卫（非 Send）原持有到回滚 `await`，已把锁作用域收进同步块、await 全部移到守卫外（persist 成功仍在锁内 `*index = candidate` 提交，失败则索引不改、error 带出后回滚）。rustfmt 已过；回滚逻辑与 `credential-store-failed` 错误码不变。

### P1-6 · is_executable_file 覆盖面
- 【报告位置】§1.5 裁定 P1；§19 缺口 1（报告 :3652）；§12 files/mod.rs（报告 :2704）。
- 【现状确认】`files/mod.rs` 原 `is_executable_file` 仅匹配 `.exe`。
- 【关键改动】Windows 分支拦截 `.exe/.msi/.scr/.com/.pif/.cpl`（大小写不敏感）；明确不拦 `.bat/.cmd/.ps1/.vbs`（runner 脚本=产品功能）。Unix 分支检查 `metadata.mode() & 0o111 != 0` 即拒（读取语义，无执行）。错误码保持 `executable-file-blocked`，文案改为中性 “Executable files cannot be opened”。
- 【证据】`files/mod.rs:66`（扩展名白名单）、`:69-78`（Windows fn）、`:80-88`（Unix fn）；测试 `:94-131`（`.MSI` 拒 / `installer.msi.txt` 放行 / runner 脚本放行；`#[cfg(unix)]` 可执行位测试）。
- 【状态】confirmed。
- 【限制】Unix 可执行位测试 `#[cfg(unix)]` 在 Windows 主机不参与编译，本机无法实际跑；须在 macOS/Linux CI 验证。

### P1-7 · grant_child 查找+插入竞态
- 【报告位置】§12 A1（报告 :2627，原 :114-127）；Top8 第 6 条（报告 :2778）。
- 【现状确认】原 `grant_child` 复用检查在 `read()` 锁、`insert` 在另一次 `write()` 锁之间存在竞态。
- 【关键改动】抽出 `insert_unlocked(&mut grants, ...)`；`grant_child` 单次 `write()` 持锁内完成复用查找 + 未命中即 mint；`insert()` 改为只取锁后委托 `insert_unlocked`。
- 【证据】`files/access.rs:116-136`（单次 write 锁内复用查找+mint）、`:326-333`（insert 委托）、`:348-349`（`insert_unlocked`，带 `#[allow(clippy::too_many_arguments)]`）。
- 【状态】confirmed。clippy（`-D warnings`）报 `insert_unlocked` 参数过多，已加 allow 属性并注明“私有 grant 构造 helper，参数一一对应 Grant 字段”，签名/逻辑未动；rustfmt 已过。

### P1-8 · path_key 大小写折叠扩展到 macOS
- 【报告位置】§12 A2（报告 :2628）；Top8 第 8 条（报告 :2780）。
- 【现状确认】`files/mod.rs` `path_key` 仅 `cfg!(windows)` 折叠大小写；macOS APFS 默认大小写不敏感，等价路径会被拒（可用性 bug）。
- 【关键改动】折叠条件改为 `cfg!(windows) || cfg!(target_os = "macos")`。`access.rs` 复用同一 `path_key`（import），无需另改。
- 【证据】`files/mod.rs:108-116`。
- 【状态】confirmed。

### C9 · documents/limits.rs 常量收敛
- 【报告位置】§10 §6 X1（报告 :2439）；§10 结论“强烈建议”第 8 条（报告 :2462）。
- 【现状确认】`word.rs:14-18` 与 `presentation.rs:32-35` 重复定义 `MAX_PART_BYTES=64MiB`/`MAX_EXPANDED_BYTES=256MiB`/`MAX_XML_BYTES=16MiB`；100MiB 输入上限三处异名（converter `MAX_DOCUMENT_BYTES:u64`、word/presentation `MAX_ARCHIVE_BYTES:usize`）。
- 【关键改动】新建 `documents/limits.rs`，统一 `MAX_PART_BYTES`(u64)/`MAX_EXPANDED_BYTES`(u64)/`MAX_XML_BYTES`(usize)/`MAX_DOCUMENT_INPUT_BYTES`(u64)；`mod.rs` `pub mod limits; pub use ...`；converter 直接引用 `MAX_DOCUMENT_INPUT_BYTES`（全量重命名）；word/presentation 保留本地 `MAX_ARCHIVE_BYTES: usize = MAX_DOCUMENT_INPUT_BYTES as usize` 类型别名（值与原名/类型保持，调用点零改动）。
- 【证据】`documents/limits.rs:6,9,12,15`；`documents/mod.rs:1,6-9`；`documents/word.rs:17`；`documents/presentation.rs:35`；`documents/converter.rs:7`（import）及全部引用点。
- 【状态】confirmed。

### C10 · SuccessResult 单一化
- 【报告位置】§12 §1.2 末段（报告 :2651）。
- 【现状确认】`commands/process.rs` 与 `commands/app.rs` 各自定义同名 `SuccessResult`（序列化均为 `{"success":bool}`，wire 形状一致）。
- 【关键改动】收敛到 `commands/mod.rs` 单一 `pub struct SuccessResult { pub success: bool }`（保留 `#[serde(rename_all="camelCase")]`，序列化字段不变）；process/app 删本地定义并 `use super::SuccessResult;`；process.rs 不再使用 `Serialize`，import 收敛为 `use serde::Deserialize;`。
- 【证据】`commands/mod.rs:11-16`；`commands/process.rs:1`（import，本地结构已删）；`commands/app.rs:1`（import，本地结构已删）。
- 【状态】confirmed。

---

## 延期 / 待用户决策（含理由）

| 项 | 理由 |
|---|---|
| converter/presentation/word 目录化拆分（§10 §2/§3.4/§4.3） | 纯结构搬迁，非安全/正确性；本批只做 limits 收敛，拆分留后续批次，避免与其他分片在大文件上冲突。 |
| X4 ZIP 事务重写抽公共、X5 `validate_part_name` 合并、X6 路径/关系解析合并（§10 §6 :2442-2444） | word 与 presentation 两版契约有差异（word 版允许目录名尾 `/`），合并需先明确契约，非零风险机械改动；按指示列入第二批。 |
| B1–B8 命令层约 840 行下沉（§12 表 :2642-2649） | 属于可维护性重构，跨 commands/files/documents/providers 多文件搬迁，与安全修复解耦；按指示延期。 |
| A3 `path-not-found` 错误码、A4 Home grant 默认可写、A5/A7 recent grant 复用/re-mint（§12 :2629-2631） | 均涉及产品策略（错误码前端契约、Home 能力面、recent 刷新频率），需产品决策，非纯机械修复。 |
| X3 `DocumentErrorCode` 枚举（§10 §6 :2441） | 判断为非纯零风险机械项：错误码字符串散落各处且与前端 i18n key 耦合，集中成枚举会触碰大量调用点与序列化契约，留待与前端错误层统一设计；本批延期。 |
| `agents/` 目录其余 §11 问题（provider/runtime 拆分、协议骨架收敛、事件枚举化等） | 本轮仅按用户授权修改 `agents/provider.rs` 三处 `api_key` 调用以闭环 P1-5；agents 域其余重构随第二批处理，本轮不碰。 |
| `documents/fonts.rs:199` 的本地 `path_key` 仍仅 `cfg!(windows)` 折叠 | 该函数是系统字体枚举缓存键，非 grant 匹配；报告未标记，影响仅为 macOS 下可能出现重复条目，故意不改以免改变字体列表行为。 |

---

## 验证与限制声明
- 未运行 cargo build/check/clippy/test（按总控纪律）。所有改动以人工逐处核对为准；类型/借用/错误映射已按现有 API（`AppError::{new,invalid,internal}`、`From<keyring::Error>`、parking_lot 锁）推演。
- Windows 专属 unsafe（converter.rs 注册表 FFI、KeyGuard）在 Linux/macOS 不编译；Unix 专属可执行位测试同理。合并后建议：Windows CI 跑 `registered_app_path` 相关路径与 `cargo check`，macOS/Linux CI 跑 `is_executable_file` 可执行位测试与 `cargo check`。

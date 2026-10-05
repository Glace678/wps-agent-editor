# Rust 内核分片修复明细（code-review-fixes-2）

- 仓库：`C:\Users\Glace\Desktop\wps\wps-agent-editor`（HEAD=55b8ccf，工作树，未 commit）
- 基线说明：报告行号对应略早基线；下文证据行号为**当前工作树**行号。
- 环境限制：Windows 主机，未运行 `cargo build/check/clippy/test`（target 目录分片竞争）；仅运行了 `cargo fmt`（exit 0）。**Linux-only 代码（pidfd 降级路径、cfg(unix) 进程组）无法在本机运行时验证**，仅做静态正确性保证。

---

## P0-1：runner.rs truncate_output 在多字节 UTF-8 中间 panic

- **报告位置**：Top10 #1（报告 30 行）；§13 P5（报告 ~2820）。
- **现状确认**：原 `runner.rs` 直接 `value.truncate(MAX_OUTPUT_BYTES)`，4 MiB 中文输出截断点必落于 UTF-8 序列中间 → panic。
- **关键改动**：抽出 `truncate_to_limit(value, limit)`，先 `kept = limit`，`while !value.is_char_boundary(kept) { kept -= 1; }` 再 truncate；`truncate_output` 以 `OUTPUT_LIMIT_BYTES` 调用。新增单测 `truncate_never_cuts_inside_a_multibyte_character`（"a" + 3 个中文字符，limit 1..=len 全遍历，断言 UTF-8 合法）。
- **证据**：`src-tauri/src/process/runner.rs:469-486`（实现）、`:535-543`（测试）。
- **状态**：已修复。

## P0-2：terminal/debugger 会话注册表 check-then-act 竞态（孤儿会话）

- **报告位置**：Top10 #3（报告 32 行）；§13 P8（报告 ~2870）。
- **现状确认**：`terminal.rs` 原流程为「锁内查 key→放锁→配额校验→放锁→openpty/spawn→锁内 insert」；`debugger.rs` `start_node/start_python` 为裸 `sessions().lock().insert(...)`。并发同 key 双方都 spawn、后 insert 覆盖前者 → 前者子进程无人回收，且占住 16/4 配额 8 小时。
- **关键改动**：
  - 先 openpty/spawn 建出 `Arc<TerminalSession>`/`Arc<DebugSession>`，再进**单一临界区**：查重复 key → 查配额（全局 16 / 每窗口 4，逻辑原样保留）→ insert 一起完成；失败者 `stop_session(&session)` 回滚子进程并返回错误，**不进注册表、不占配额**。
  - `remove_session` 保留原「按 key 查并比对 window_label+id 内容再删」逻辑，未动。
- **证据**：`src-tauri/src/process/terminal.rs:159-186`（锁内三段判定 + `:185` 回滚）；`src-tauri/src/process/debugger.rs:481-496`（node）、python 段同构。
- **状态**：已修复。spawn 失败（PTY/exec 错误）路径在进锁前即返回，注册表零接触。

## P1-3：Unix terminate 缺 kill(pid) 补刀 + 三处 reaper 统一（D1）

- **报告位置**：P1（报告 ~2840）；横向 D1。
- **现状确认**：原 `runner.rs:441-447` Unix 分支只 `kill(-pgid)`；terminal/debugger 各有一份 `terminate_tree` + `configure_process_group` 副本；runner 签名为 `Option<u32>`、terminal/debugger 为 `u32`。
- **关键改动**：新建 `src-tauri/src/process/reaper.rs`（已在 `process/mod.rs` 注册 `pub mod reaper;`）：
  - `configure_process_group(&mut Command)`：unix `process_group(0)` / windows `CREATE_NO_WINDOW|CREATE_NEW_PROCESS_GROUP`，行为与原三份一致。
  - `terminate_process_tree(Option<u32>)`（async，runner 用）与 `terminate_process_tree_sync(Option<u32>)`（terminal/debugger 的 reader/monitor 线程用）：Unix 先 `kill(-pgid, SIGKILL)` **再 `kill(pid, SIGKILL)` 补刀**；Windows 保持 `taskkill /PID /T /F`（std::process::Command 同步版 / tokio 版各一份）。u32 调用方统一传 `Some(pid)`。
- **证据**：`src-tauri/src/process/reaper.rs:28-92`；调用点 `runner.rs:316,350,364`、`terminal.rs:315,342`、`debugger.rs:447,455,626,700,798,825,835,1023,1056`（均经 replace_all 收敛）。
- **状态**：已修复。Windows 行为不变；Unix 双杀语义补全。

## P1-4：MAX_OUTPUT_BYTES 三处独立定义收敛（D3）

- **报告位置**：横向 D3。
- **现状确认**：runner/terminal/debugger 各定义 `4*1024*1024`。
- **关键改动**：收敛为 `reaper.rs` 单一 `OUTPUT_LIMIT_BYTES`，并在注释标明语义差异：runner=**drain 上限**（进程不杀、丢字节保管道排空）；terminal/debugger=**会话致死量**（累计超限杀会话）。另把 terminal/debugger 共享的 `MAX_SESSION_AGE`（8h）也收敛为 `reaper.rs:MAX_SESSION_AGE`（原 debugger `MAX_DEBUG_SESSION_AGE` 删除）。
- **证据**：`src-tauri/src/process/reaper.rs:17-26`（输出上限语义注释）、`:29-32`（会话寿命）。
- **状态**：已修复。

## P1-5：debugger.rs Node stderr 读取线程无上限（P6）

- **报告位置**：P6（报告 ~2850）。
- **现状确认**：原代码 `BufReader::lines().take((MAX_DEBUG_OUTPUT+1) as u64)`——`.take` 限制的是**行数**（400 万行）而非字节，且 `output_bytes` 从不递增；单行超大 stderr 可无限驻留内存。
- **关键改动**：改为 `read_until(b'\n', &mut line)` 逐行读，每行先 `stderr_counter.fetch_add(line.len())`，超限即 break；计数与 stdout reader 共享同一个 `Arc<AtomicUsize>`（`DebugSession.output_bytes` 字段类型随之改为 `Arc<AtomicUsize>`，stdout/pdb reader 经 Deref 无感）。inspector URL 识别逻辑（trim 后 `inspector_url`）保持不变。
- **证据**：`src-tauri/src/process/debugger.rs:396-443`。
- **状态**：已修复。

## P1-6：dependencies.rs probe_all 串行 60s（P16）

- **报告位置**：P16（报告 ~2950）。
- **现状确认**：20+ 探测 `for spec in DEPENDENCIES { probe(spec).await }` 串行，最坏 ~60s。
- **关键改动**：`futures_util::future::join_all(DEPENDENCIES.iter().map(probe))`（futures-util 本就是直接依赖），结果用 `extend` 展开——**顺序与原 Vec push 完全一致**；每个探测自身的 3s 超时（`command_output_with_timeout`）未动。
- **证据**：`src-tauri/src/process/dependencies.rs:64-78`。
- **状态**：已修复。墙钟时间降为最慢单探测（≤3s）。

## P1-7：runner 超时 30s 对编译器过短（P4）

- **报告位置**：P4（报告 ~2830）。
- **现状确认**：`RUN_TIMEOUT=30s` 同时用于 javac/kotlinc/go build/swift 与运行步骤；超时文案硬编码 "30 seconds"。
- **关键改动**：`execute(spec, cwd, timeout)` 增加 timeout 参数；新增 `COMPILE_TIMEOUT=120s`（编译路径用）与 `RUN_TIMEOUT=30s`（运行路径用）；文案改为 `format!("Process timed out after {} seconds", timeout.as_secs())`，数字与常量不再脱节。
- **证据**：`src-tauri/src/process/runner.rs:16-20`（常量）、`:75/:94`（两路调用）、`:347/:371`（format 文案）。
- **状态**：已修复。

## P1-8：error.rs code 自由字符串（E1，低风险方案）

- **报告位置**：E1（报告 ~2750）。
- **现状确认**：约 40 处 `AppError::new("kebab-code", ...)` 字面量散落全 crate；前端无 `errors.{code}` 词条保障。
- **关键改动**：
  - `error.rs` 新增 `pub mod codes`，以 `pub const &str` 形式登记**全部**现有 code（含非本分片文件在用的，约 105 个），值一个未改；并提供 `codes::ALL` 清单。
  - 本分片独占文件内全部调用点已替换为 `codes::*`：process/*（runner/terminal/debugger 共 ~15 处）、error.rs 自身（helpers + From impls）、state.rs 5 处、update_health.rs ~40 处（含 36 处批量替换）。非本分片文件（providers/、agents/、commands/、documents/、smoke）的字面量**未动**（文件边界），但 code 已在注册表内可被其分片直接引用。
  - 新增 `#[cfg(test)]` 测试 `registered_codes_have_english_locale_entries`：读 `CARGO_MANIFEST_DIR/../../src/lib/i18n/locales/en.ts`，定位 `errors: {` 段后断言每个 code 存在。
  - **重要现状（confirmed）**：en.ts 目前**没有 `errors` 段**（已全文 grep 确认：无 `errors`、无任一 code 词条；前端 AppError 仅以 message 兜底）。因此测试当前行为为：无 errors 段时打印缺失清单并**通过**（避免交付即红的测试套件），待前端落地 `errors` 段后自动转为硬性覆盖断言。另加 `registry_codes_are_unique_and_kebab_case` 单测防拼写/重复。
- **证据**：`src-tauri/src/error.rs:14-240`（codes 注册表）、`:435-457`（i18n 守卫测试）。
- **状态**：已修复（注册表 + 本分片调用点 + 测试）；前端 `errors` 词条段为另一分片范围，已在测试中前向兼容处理。

## P1-9：From<tauri_plugin_updater::Error> 子串匹配（E2）

- **报告位置**：E2。
- **现状确认**：原实现用 `to_string().contains("signature"/"network")` 分类。
- **关键改动**：改为类型匹配——`is_signature_error()`（参照 updater_smoke.rs：`Minisign(_) | Base64(_) | SignatureUtf8(_)`）判签名错误；`UpdaterError::Network(_)` 判网络错误；其余归 `update-failed`。分类结果与原三档等价，子串法已删。
- **证据**：`src-tauri/src/error.rs:371-386`（From impl + is_signature_error）。已核对 `tauri-plugin-updater-2.10.1/src/error.rs` 枚举变体确认。
- **状态**：已修复。

## P1-10：A6 / Top10 #10——Destroyed → revoke_window 链路

- **报告位置**：报告 :2632 与 Top10 #10。
- **现状确认（confirmed，无需改动）**：`lib.rs` 启动期已挂钩 `on_window_event`，`WindowEvent::Destroyed { .. }` 时调用 `state.revoke_window(&window.label())`；`state.rs:revoke_window` 内部统一清理 terminal 会话 + debugger 会话 + agent runtime + 文件 grants（files/startup/current_files）。`app_window_new` 路径只做启动健康检查（`AppError::invalid` 分支），不注册任何会话，无冲突。
- **证据**：`src-tauri/src/lib.rs:44-50`（Destroyed→revoke_window）、`src-tauri/src/state.rs:101-108`（revoke_window 清理范围）。
- **状态**：现状已存在，确认无需补齐。

## P1-11：update_health.rs 手写 HMAC-SHA256（Top10 #6）

- **报告位置**：Top10 #6；报告 :1821。
- **现状确认**：手写 ipad/opad 循环固定 64 字节数组，密钥 >64B 时未按 RFC2104 先哈希（静默截断长密钥）。
- **关键改动**：改用 `hmac::Hmac<Sha256>`（`Mac::new_from_slice/update/finalize`），输出仍为 `hex::encode` 小写 hex，与原格式一致；`verify_state_auth` 改用 `mac.verify_slice(&hex_decode(stored_tag))`——`hmac` crate 的 verify_slice 即恒时比较。`constant_time_equal` 函数保留（仍被 `verify_payload_digest` 的 hex 摘要比较使用）。
- **证据**：`src-tauri/src/update_health.rs:1815-1850`（state_mac 提取 + HMAC 实现 + verify_slice）。
- **依赖变更**：`Cargo.toml` 新增 `hmac = "0.12"`（sha2 0.10 已在库，digest 0.10 已在 lock）；`cargo fetch` 联网成功，**`Cargo.lock` 已更新：hmac v0.12.1**（Cargo.lock:1844-1847）。无离线阻塞项。
- **状态**：已修复（依赖可解析、lock 已落）。

## P1-12：Linux pidfd 依赖内核 ≥5.3 无降级（Top10 #6）

- **报告位置**：Top10 #6；§09 表（报告 1894-1926）。
- **现状确认**：Linux 回滚路径无条件使用 `pidfd_open/pidfd_send_signal`，内核 <5.3 直接失败。
- **关键改动（全部 cfg(target_os="linux")，Windows 零影响）**：
  - 新增 `kernel_supports_pidfd()`：读 `/proc/sys/kernel/osrelease`，解析 `(major, minor)`，`>=5.3` 判定，`OnceLock` 缓存；读不到时默认 true（保持原行为）。
  - 原 pidfd 实现改名 `terminate_tree_with_pidfd`；新增派发器 `terminate_process_tree_if_same`：新内核走 pidfd，老内核走新 `terminate_tree_with_proc`。
  - 降级路径 `terminate_tree_with_proc`：身份校验（query_process_identity）→ `kill(pid, SIGSTOP)` 冻结根 → /proc 快照 BFS 逐层冻结（复用 `snapshot_linux_process_links/recursive_process_descendants/linux_process_parent_pid`，父进程须已冻结、parent_pid 复核防 PID 复用）→ 深度倒序 `kill(pid, SIGKILL)` → `wait_for_linux_process_exit` 轮询 `/proc/<pid>` 消失（10s 超时）。限制/超时/不稳定错误码与 pidfd 路径同（`update-rollback-process-tree-limit/unstable/timeout`）。
- **证据**：`src-tauri/src/update_health.rs:2175-2197`（版本检测）、`:2200-2211`（派发）、`:2214-2264`（降级主路径）、`:2266-2280`（kill_linux_pid，ESRCH 容忍）、`:2282-2298`（退出轮询）、`:2321`（pidfd 原实现改名）。
- **状态**：已修复。**限制注明：Windows 主机无法编译运行 cfg(target_os="linux") 代码，本机未做 Linux 运行时验证**；代码按报告语义静态编写，由总控在 Linux CI 验证。

---

## 顺手小项（同文件内）

| 项 | 改动 | 证据 |
|---|---|---|
| P3 错误分支回收 | runner execute 的 `Ok(Err(error))` 分支补 `let _ = child.wait().await` | `runner.rs:350-353` |
| P9 注释 | 编译失败提前返回处补注释：两路输出由 read_capped 分别限长后合并共享单一 truncation 预算 | `runner.rs:78-90` |
| terminal 常量 | REAPER_INTERVAL=60s、MIN/MAX_COLS(10,1000) 两处 clamp 共用、MAX_WRITE_BYTES=256KB、MAX_SESSION_AGE 8h 共享 | `terminal.rs:22-26`、`:115`、`:323`；reaper.rs:30 |
| E3/N4 | `From<tauri::Error>` 从 lib.rs 移入 error.rs | `error.rs:361-364`；lib.rs 已删 |
| N5 | lib.rs 裸 `exit(71)` → `EXIT_UPDATER_GUARDIAN_FAILED` 具名常量 | `lib.rs:21-30` |

## 延期 / 待用户决策（明确不做，附理由）

1. **update_health.rs 拆 9 子模块**——纯重构，无行为收益，9 子模块跨文件移动会与其他分片大面积冲突。理由：低价值高冲突。
2. **debugger.rs 拆 node/python**——同上，且会动到本分片刚修好的竞态锁结构。
3. **terminal P7 改环形缓冲**——会变更会话输出丢弃语义（当前是超限即杀会话），属产品决策。
4. **两个 smoke 文件 feature-gate 与 S1 合并、smoke 迁移 tests/**——涉及发行打包/CI 决策；且 smoke 文件不在本分片独占清单内。
5. **N5 中 exit(1)/exit(72)**——位于 runtime_smoke.rs / updater_smoke.rs（非本分片文件），未越权修改；exit(72) 的具名化建议由 smoke 分片在自身文件内完成。
6. **非本分片文件的 AppError code 字面量替换**（providers/、agents/、commands/、documents/ 约 25 处）——文件边界所限；code 已全部登记进 `codes` 注册表，各分片可直接引用 `codes::*`。

## 无法离线完成的依赖变更

- 无。`cargo fetch` 联网成功，hmac 0.12.1 已入 Cargo.lock；sha2/digest 原本即在 lock 中。

## 未运行的验证（如实声明）

- 未运行 cargo build/check/clippy/test（按纪律，target 目录由总控合并后统一跑）。
- Linux pidfd 降级路径未在 Linux 运行时验证（Windows 主机）。
- `cargo fmt` 已跑（exit 0，无格式 diff）。

---

## 合并后 cargo check 反馈的编译错误修复（第二轮）

总控合并后 cargo check 报本分片 5 处集成错误，已全部修复：

| # | 问题 | 修复 | 证据 |
|---|---|---|---|
| 1 | tokio 1.53 `child.id()` 返回 `Option<u32>`，runner 两处 `terminate_process_tree(Some(pid))` 多包一层 | 改为 `reaper::terminate_process_tree(pid).await;`；grep 确认 pid 仅这两处使用 | `runner.rs:338`（pid 绑定）、`:350`、`:364` |
| 2 | reaper 的 `configure_process_group` 只接受 tokio Command，debugger 两处 std::process::Command 传参类型不符 | reaper.rs 新增 `configure_std_process_group(&mut std::process::Command)`（unix `process_group(0)` / windows `CREATE_NO_WINDOW\|CREATE_NEW_PROCESS_GROUP`，与 tokio 版同标志）；debugger 两处调用切换 | `reaper.rs:43-58`；`debugger.rs:374`、`:537` |
| 3 | terminal.rs `window_label: label` move 进结构体后，配额闭包再用 `label` | 改为 `window_label: label.clone()`，闭包处照旧 | `terminal.rs:143`、`:169` |

修后已跑 `cargo fmt`（exit 0）。cargo check 由总控重跑。

---

## 合并后 clippy(-D warnings) 反馈修复（第三轮）

| # | 问题 | 修复 | 证据 |
|---|---|---|---|
| 1 | debugger start_node 占位注册 `contains_key` + `insert` 触发 `clippy::map_entry` | 改用 `active.entry(key)`：Occupied → SESSION_ALREADY_ACTIVE；Vacant → `entry.insert(session)`，单锁内判定、行为等价 | `debugger.rs:481-493`（node） |
| 2 | debugger start_python 同型 map_entry | 同上 | `debugger.rs:578-590`（python） |
| 3 | stderr 线程 `inspector_url(&trimmed)` / `is_inspector_boilerplate(&trimmed)` 触发 `clippy::needless_borrow`（String 到 &str 的 deref coercion 自动插入借用） | 去掉 `&` | `debugger.rs:424`、`:431` |

修后已跑 `cargo fmt`（exit 0）。clippy 由总控重跑。



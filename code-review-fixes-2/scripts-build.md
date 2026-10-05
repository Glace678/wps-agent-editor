# scripts / 构建 / 配置分片 — 第一批修复记录

**范围（独占）**：`scripts/**`、`tests/**`、`playwright.config.ts`、`vite.config.ts`、`tsconfig*.json`、`package.json`、`package-lock.json`、`.github/**`（只读核对）。未触碰 `src/**` 与 `src-tauri/**`。
**基线**：HEAD=55b8ccf，改动留工作树，未 commit。
**验证纪律**：未运行 playwright / vite build / cargo。

---

## 完成项（7/7）

### 1. tsconfig.node.json 改造（include scripts、paths、删 outDir）

- **报告位置**：§15 §2.2「真实缺口：scripts/*.ts 不在任何 typecheck 范围内」(报告 3137 行)、§2.1.3「outDir:"out" 死配置」(3132 行)、§2.3 汇总表 (3144–3145 行)。
- **现状确认**：`tsconfig.node.json` 原 include 仅 `vite.config.ts`/`playwright.config.ts`/`tests/e2e/**/*.ts`（原 15 行），无 `baseUrl`/`paths`，含死配置 `"outDir": "out"`（原 12 行）。
- **关键改动**：
  - `include` 增加 `scripts/**/*.ts`（19+ 个 scripts/*.ts 及 `release/` 下 TS 全部进入 typecheck）；
  - 新增 `"baseUrl": "."` + `"paths": { "@/*": ["src/*"] }`（与 tsconfig.web.json 同形，保险别名）；
  - 删除 `"outDir": "out"`（所有调用均 `--noEmit`，声明永不生效）。
- **证据**：`tsconfig.node.json:14-16`（baseUrl/paths）、`tsconfig.node.json:21-26`（include 含 `scripts/**/*.ts` 与 `src/lib/i18n/**/*`）。
- **状态**：✅ 完成。

### 2. 删除 tsconfig.i18n.json，并入 node config

- **报告位置**：§15 §2.1.1「tsconfig.i18n.json 整体可删」(报告 3130 行)、§5 优先级表 #4 (3239 行)。
- **现状确认**：`tsconfig.i18n.json` 仅 extends node config 做三件事：`noEmit:true`、加 `paths`、换 include（`src/lib/i18n/**/*` + `scripts/check-i18n.ts`）。全仓引用点 grep 结果：`package.json:32`（check:i18n）、`code-review-fixes/quality-scripts.md:22`（历史运行记录，不改）、`SOURCE-INDEX.txt:719`（库存清单）。`.github/**`、`*.cmd`、`scripts/**` 无引用。
- **关键改动**：
  - 删除 `tsconfig.i18n.json`（已 `Remove-Item`，Test-Path=False）；
  - `package.json:32` check:i18n 改为 `tsc --noEmit -p tsconfig.node.json && tsx scripts/check-i18n.ts`（noEmit 由命令行承担，node config 补 paths 与 include i18n）；
  - `SOURCE-INDEX.txt` 删除 `tsconfig.i18n.json | 232` 库存行；
  - check-i18n.ts 用 `node:fs`（原报告已判断其本就属 node config），无需额外 DOM 配置。
- **证据**：`package.json:32`；`SOURCE-INDEX.txt`（719 行条目已删）；`tsconfig.node.json:26`（`src/lib/i18n/**/*`）。
- **局部验证**：`npm run check:i18n` → exit 0，输出 `i18n check passed: 9 locales, 761 keys per locale.`（与旧链输出一致，见下方验证记录）。
- **状态**：✅ 完成。

### 3. typecheck scripts/**：修复暴露的存量类型错误（3 处，最小修复）

- **报告位置**：§15 §2.2 (报告 3137 行)「可能暴露存量类型小错」。
- **首次运行** `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json` → exit 2，恰好 3 个错误，全部在 scripts/ 内：
  1. `scripts/test-multi-tables.ts(8,3) TS6133: 'buildHtmlTable' is declared but never read` → 从 import 中删除死导入（`test-multi-tables.ts:7-9`，行为不变）。
  2. `scripts/test-word-toolbar-i18n.ts(2,23) TS7016: Could not find a declaration file for module 'jsdom'` → jsdom 仅为间接依赖、仓库无 `@types/jsdom`（已核实 node_modules/@types/jsdom 不存在）。新增 ambient 声明 `scripts/types/jsdom.d.ts`（`declare module 'jsdom'`，注释说明用途与后续替换方式），不新增任何依赖/不改 lock。
  3. `scripts/test-word-toolbar-i18n.ts(59,85) TS2739: 构造的 fontFace 缺 SystemFontFace 必填字段 fontId/faceIndex/embedding/subsetAllowed/outlineEmbeddingAllowed` → 该接口在 `src/lightweight-office/utils/system-fonts.ts:5-17` 已扩展。最小修复：工厂函数补齐 5 个字段（fontId=familyName、faceIndex=0、embedding='unknown'、两个布尔 true），不改动任何断言值与行为。
- **证据**：`scripts/types/jsdom.d.ts:1-6`；`scripts/test-word-toolbar-i18n.ts:59-71`；`scripts/test-multi-tables.ts:2-9`。
- **复验**：修复后 `tsc --noEmit -p tsconfig.node.json` → **exit 0**（scripts/** 全绿）。
- **状态**：✅ 完成。

### 4. 移除 @radix-ui/react-dialog

- **报告位置**：§15 §3.1「唯一可删的依赖」(报告 3163 行)、§5 优先级 #2 (3237 行)。
- **现状确认**：删前再次全仓 grep `@radix-ui/react-dialog`：src/tests/scripts **零 import**，仅 package.json、lock 与历史文档（REFACTOR-AUD.md/PLAN）提及。
- **关键改动**：`package.json` dependencies 删除 `"@radix-ui/react-dialog": "^1.1.6"`；运行 `npm install --package-lock-only`（exit 0；postinstall 幂等 SKIP，未触发重装）。
- **package-lock.json 实际 diff 摘要**（`git diff --stat`：package-lock 114 行删除、package.json 3 行改动）：
  - 删除的 node_modules 条目**仅** `node_modules/@radix-ui/react-dialog`（1.1.23 整块，含其 dependency/peerDependencies 清单）；
  - 无任何其他包的 version/resolved/integrity 变动（逐一核对：version/resolved/integrity 的删除行全部属于 react-dialog 自身）；
  - 唯一新增行是 lock 根与 `packages[""]` 的 `"name": "wps-agent-editor" → "office-agentic"`（2 行）——npm 将 lock 的 name 字段对齐 package.json 既有值（HEAD 的 package.json 本就是 office-agentic），属存量不一致的归一化，非依赖变动；
  - 另有约 20 处嵌套 `libc: ["glibc"/"musl"]` 元数据数组被 npm 重序列化时规整删除——对应包条目均保留、版本未变，纯元数据格式归一化。
- **状态**：✅ 完成。

### 5. 硬编码 chunk 哈希改 glob/pattern + 数量断言

- **报告位置**：§15 §4.3「test-word-zoom-seamless.ts:164-165 已硬编码 src-CcBJnYZd.es.js」(报告 3219 行)、§5 优先级 #3 (3238 行)。
- **现状确认**：实测 `node_modules/superdoc/dist/chunks/` 下 `src-*.es.js`=1 个、`src-*.cjs`=1 个、`SuperConverter-*.es.js`=1 个。仓库已有现成 idiom（`patch-superdoc-word-layout.mjs:17-29`：readdirSync + `/^src-.*\.(?:es\.js|cjs)$/` + `length !== 2` 硬失败），本次全部按该 idiom 改造。
- **关键改动**（grep 复核：scripts/ 下 `CcBJnYZd|VzGe|SsIUcBUk|BvRRLlhT` 现 **0 命中**）：
  - `scripts/test-word-zoom-seamless.ts:166-177`：两个硬编码路径改为 `chunksDir` + readdir pattern 解析；保留「依赖未安装时跳过」语义（`if (exists(chunksDir))` 才进断言），并对解析到的 ESM/CJS 数量做 `assert.equal(..., 2)` 断言；
  - `scripts/patch-superdoc-font-size.mjs:50-56,76`：layoutChunks pattern 解析 + 数量断言，apply 循环 concrete 文件名；
  - `scripts/patch-superdoc-image-resize.mjs`：同上模式；
  - `scripts/patch-superdoc-table-borders.mjs:48-60,75,147-148,158`：layoutChunks（2 个 apply 点）+ converterChunks（SuperConverter-*）；ESM/CJS 替换集不同的那对用 `layoutEsm/layoutCjs` 分流（`:54-55,147-148`）；
  - `scripts/test-superdoc-image-resize.mjs`：loop 改为 pattern 解析结果；
  - `scripts/test-superdoc-table-borders.mjs`：`resolveOne(pattern)` 辅助（恰好 1 个匹配否则 throw），converterEsm 与 loop 均走它。
  - pptx-renderer 的 `aiden0z-pptx-renderer.es.js` 为稳定产物名（无哈希），未改。
- **局部验证**：3 个 patch 脚本各 `node scripts/*.mjs` → exit 0（日志打印 concrete 文件名、全部 SKIP 幂等命中）；`node scripts/test-superdoc-image-resize.mjs` → exit 0「SuperDoc image-resize regression checks passed」；`node scripts/test-superdoc-table-borders.mjs` → exit 0「SuperDoc inserted-table border regression checks passed」；`tsx --tsconfig tsconfig.web.json scripts/test-word-zoom-seamless.ts` → exit 0「PASS Word seamless zoom ...」。
- **状态**：✅ 完成。

### 6. test:web-canaries 编排化

- **报告位置**：§15 §4.2.2「19 段 && 串联单行 1300+ 字符」(报告 3212 行)、§5 优先级 #6 (3241 行)。
- **现状确认**：package.json 原第 65 行为 21 段 `&&` 串联（任务书称 19 段，实测 21 段；以逐字保留为准）。
- **关键改动**：
  - 新建 `scripts/run-web-canaries.mjs`（参照 `run-structural-tests.mjs` 模式：export 步骤表 + 主入口守卫）；`WEB_CANARY_STEPS` 21 条与原链逐字一致、顺序一致；fail-fast（同 `&&` 语义），每步打印 `[n/21] <cmd>`，失败时打印步数 + 原退出码并 `process.exit(status)`；
  - `package.json:65` 改为 `"test:web-canaries": "node scripts/run-web-canaries.mjs"`（1300+ 字符单行 → 1 行）。
- **证据**：`scripts/run-web-canaries.mjs:14-36`（步骤表）、`:38-53`（执行循环）；`package.json:65`。
- **局部验证**：`node --check scripts/run-web-canaries.mjs` → exit 0；import 导出实测 `steps=21`、first=`node scripts/test-office-shortcuts-structural.mjs`、last=`npm run test:terminal-e2e`。**未全量跑**（末三步是 playwright e2e，按纪律不跑）。
- **状态**：✅ 完成。

### 7. stripComments 抽取共享 util

- **报告位置**：§15 §1.4.2「stripComments 两处逐字重复」(报告 3118 行)。
- **现状确认**：`generate-command-contract.mjs:12-16` 与 `check-test-scripts-wired.mjs:40-44` 两份函数体逐字相同（仅函数名 stripComments/stripJsComments），正则 `/\/\*[\s\S]*?\*\//g` 与 `/(^|[^:])\/\/[^\n]*/g, '$1'` 一字不差。
- **关键改动**：新建 `scripts/lib/comment-utils.mjs`（`export function stripComments`，正则原样复制，注释保留 `[^:]` guard 的动机）；两处改为 import（`check-test-scripts-wired.mjs` 用 `stripComments as stripJsComments` 别名，调用点零改动）。
- **证据**：`scripts/lib/comment-utils.mjs:9-12`；`generate-command-contract.mjs:3`（import）；`check-test-scripts-wired.mjs:7`（import）。
- **局部验证**：`node scripts/generate-command-contract.mjs` → exit 0「Desktop command contract passed (80 commands)」；`node scripts/check-test-scripts-wired.mjs` → exit 0「All scripts/test-* files are wired into a runner」。
- **状态**：✅ 完成。

---

## 追加：e2e mock 对齐真实契约（documents_set_current_file → {success:true}）

- **触发**：总控跑 e2e 时 5 个用例失败，根因为 mock 失真（非产品代码）。
- **现状确认**：`tests/e2e/pdf-worker.spec.ts:107`（改前）原为 `if (command === 'files_session_save' || command === 'documents_set_current_file') return null`。真实后端契约：`files_session_save` 返回 `AppResult<()>`（Tauri 序列化为 null，mock 的 null 正确）；`documents_set_current_file` 返回 `Ok(json!({ "success": true }))`（`src-tauri/src/commands/documents.rs:316`；同仓 `tests/e2e/color-pickers.spec.ts:98` 的 mock 即正确返回 `{success:true}`）。新加的 `documents.setCurrentFile` 形状校验（要求 `{success:boolean}`）因此在 e2e 中抛 "documents.setCurrentFile returned invalid data"，连带 5 个用例失败。
- **关键改动**：仅拆该行，未动 spec 其余断言：
  - `tests/e2e/pdf-worker.spec.ts:107`：`if (command === 'files_session_save') return null`
  - `tests/e2e/pdf-worker.spec.ts:108`：`if (command === 'documents_set_current_file') return { success: true }`
- **证据**：`tests/e2e/pdf-worker.spec.ts:107-108`；对照 `src-tauri/src/commands/documents.rs:316`、`tests/e2e/color-pickers.spec.ts:98`。
- **状态**：✅ 完成，e2e 由总控重跑。
- **二轮追加**：总控重跑后 5→3 失败，根因相同。`pdf-worker.spec.ts` 除共享 fixture 外另有 3 个测试内联 mock 尾部误返 null（原 :135/:468/:593 块）。已用 replace_all 统一补两行，现 `documents_set_current_file → {success:true}` 全文件共 4 处：`tests/e2e/pdf-worker.spec.ts:108`（共享 fixture）、`:153`（test ~:129）、`:482`（test ~:462）、`:609`（test ~:587）；`files_session_save → null` 对应 4 处紧邻上一行。

---

## 局部验证记录（命令 / 真实输出 / 退出码）

| 命令 | 结果 |
|---|---|
| `tsc --noEmit -p tsconfig.node.json`（修复 3 个 scripts 错误后首次全绿） | exit **0** |
| `npm run check:i18n` | exit **0**，`i18n check passed: 9 locales, 761 keys per locale.`（9 个 locale 键数全部=761） |
| `npm install --package-lock-only` | exit **0**（postinstall 幂等 SKIP） |
| patch/font-size、patch/image-resize、patch/table-borders 各 node 直跑 | exit **0** ×3 |
| `node scripts/test-superdoc-image-resize.mjs` | exit **0**，「SuperDoc image-resize regression checks passed」 |
| `node scripts/test-superdoc-table-borders.mjs` | exit **0**，「SuperDoc inserted-table border regression checks passed」 |
| `tsx --tsconfig tsconfig.web.json scripts/test-word-zoom-seamless.ts` | exit **0**，「PASS Word seamless zoom and anti-jitter / anti-blackscreen assertions passed」 |
| `node scripts/generate-command-contract.mjs` | exit **0**，「Desktop command contract passed (80 commands)」 |
| `node scripts/check-test-scripts-wired.mjs` | exit **0**，「All scripts/test-* files are wired into a runner」 |
| `node --check scripts/run-web-canaries.mjs` + import 计数 | exit **0**，steps=21 |

**遗留 transient 失败（与本分片改动无关，记录备查）**：`tsc --noEmit -p tsconfig.node.json` 现复现 6 个错误，全部位于 `src/platform/desktop.ts`（5 处）与 `src/platform/transport.ts:41`（1 处）——系并行分片正在改写 `src/types/desktop-api.ts`（今日 13:04 落盘，FileStatInfo/FileVersion 导出被移）所致；这些 src 文件是经 `scripts/test-desktop-channel-contract.ts` 的 import 图才进入 node 项目的。本分片改动前同命令 exit 0、改动后 scripts/ 内零错误。待 src 分片收敛后由总控复跑全量 typecheck。

---

## 延期 / 明确不做（及理由）

| 事项 | 理由 |
|---|---|
| postinstall 补丁链 redesign（5 个改写 node_modules 的脚本架构） | 供应链架构决策，任务书明确延期 |
| 桌面桥 mock 工厂与巨型 spec 拆分 | 报告第二批内容 |
| 删 store-github-credential.ps1 | 任务书明确不做 |
| tsconfig.base.json 公共抽取（10 行重复） | 低收益；本片区已按任务要求完成 node config 改造，base 抽取留给后续决策（报告 §2.1.2 称"见仁见智"） |
| smoke 文件 feature-gate | 另一分片文档已列，不在本片区 |
| test:e2e 改用 playwright bin | 报告仅疑问、无缺陷，保持现状（任务书明确） |
| `npm install` 后物理 node_modules 中残留的 @radix-ui/react-dialog 目录 | `--package-lock-only` 按指示只同步 lock；树修剪留待总控 `npm ci` |

---

## 本分片改动文件清单（工作树，未 commit）

- 删：`tsconfig.i18n.json`
- 改：`tsconfig.node.json`、`package.json`、`package-lock.json`、`SOURCE-INDEX.txt`
- 改：`tests/e2e/pdf-worker.spec.ts`（追加：mock 契约对齐）
- 改：`scripts/test-multi-tables.ts`、`scripts/test-word-toolbar-i18n.ts`、`scripts/test-word-zoom-seamless.ts`、`scripts/patch-superdoc-font-size.mjs`、`scripts/patch-superdoc-image-resize.mjs`、`scripts/patch-superdoc-table-borders.mjs`、`scripts/test-superdoc-image-resize.mjs`、`scripts/test-superdoc-table-borders.mjs`、`scripts/generate-command-contract.mjs`、`scripts/check-test-scripts-wired.mjs`
- 新：`scripts/run-web-canaries.mjs`、`scripts/lib/comment-utils.mjs`、`scripts/types/jsdom.d.ts`

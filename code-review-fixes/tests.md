# tests 修复对账

## 汇总

- 报告分区：tests/docs/assets，共 **22 项**（20 项测试断言 + 1 项 DOCX fixture 条件性问题 + 1 项 SECURITY.md 私密报告渠道）。
- **已修复：22**
- **不适用：0**
- **残留：0**。先前记录的 4 个「基准自带失败」（见末尾小节）已按当前应用既定行为修正断言，全量重跑通过。

运行方式：`node node_modules/@playwright/test/cli.js test <spec> --workers=1`（webServer 自动起 `npm run dev:web`）。本机 Chromium 已安装，全部实际运行。

## 逐项

### collaboration.spec.ts（2 项）

| 报告状态 | 处理状态 | 关键改动 | 验证→结果 |
|---|---|---|---|
| 缓存读数聚合断言空泛（多 provider/turn 求和、加权比例、异常样本） | 已修复 | `tests/e2e/collaboration.spec.ts`：mock 加 `pauseAfter` 门控；两个 measured agent-complete（director 4600/300/4900、peer 5400/600/6000）+ 一个 measured:false 异常样本；断言 badge=91.7%（=10000/10900 加权，异常样本排除，非样本均值 91.9%） | 实跑 4 passed |
| 流式分片拼接未断言顺序/增量/最终严格相等 | 已修复 | 同文件：两分片 "Planning the split "+"of work."（带门控）；先断言 speech 增量显示 "Planning the split"，释放后严格等于 "Planning the split of work."，同 operationId 合并为 1 个气泡 | 实跑 4 passed |

### color-pickers.spec.ts（4 项）

| 报告状态 | 处理状态 | 关键改动 | 验证→结果 |
|---|---|---|---|
| 颜色实际应用断言缺失 | 已修复 | 整文件重写：真实编辑器用例点 #F00F00 后重开自定义色轮种子化 hex=#F00F00；点 canvas 中心→#F0F0F0；点 (116,74)→#F06060；确认后重开种子化为 #F06060（证明颜色传播到编辑器状态） | 实跑 3 passed |
| 固定 sleep 改为等待可观察条件 | 已修复 | 全部 `waitForTimeout` 替换为页内 `waitFor`/`expect.poll` 轮询 | 实跑 3 passed |
| mock 未 fail-closed、未记录调用 | 已修复 | `MODELED_COMMANDS` allowlist + 未建模命令返回 `{success:false,error}`；记录 `__WAE_INVOKED_COMMANDS__`；断言 files_session_load+documents_prepare_word 被调、无 unhandled | 实跑 3 passed |
| 色轮语义/几何断言缺失 | 已修复 | 色轮点击绑定到精确颜色（中心=#F0F0F0、(116,74)=#F06060）；用 `page.mouse.click` 原始坐标（事件绑定在 `.excel-color-wheel-wrap` 而非 canvas，避免 Playwright 命中拦截） | 实跑 3 passed |

### pdf-worker.spec.ts（3 项）

| 报告状态 | 处理状态 | 关键改动 | 验证→结果 |
|---|---|---|---|
| 保存后红线未用 pixelsAfter 断言 | 已修复 | `tests/e2e/pdf-worker.spec.ts`：redRulePixels 改读保存后渲染 `afterPixmap`，offset 用 `afterPixmap.getStride()` | 实跑该 spec 7 passed（含本用例） |
| Ctrl+S 未从保存字节重建验证注释持久化 | 已修复 | Ctrl+S 用例从 `__WAE_SAVED_PDF__` 字节重建 MuPDF 文档，断言 reopenedTexts/rawContents 含 'Persisted PDF annotation' | 实跑 7 passed |
| undo/redo 仅断言热区计数 | 已修复 | undo 后点击恢复正文热区，断言草稿编辑器预填 'Hello Body Text'（非仅计数），Tab 无改动提交=丢弃草稿，redo 后热区=0 | 实跑 7 passed |

注：修复过程中发现并补回一处误删的测试结尾 `})`（esbuild 报 EOF）。mupdf `annotation.getColor()` 返回 0–1 浮点且文本色未必映射描边色，已放弃脆弱颜色断言。

### terminal.spec.ts（4 项）

| 报告状态 | 处理状态 | 关键改动 | 验证→结果 |
|---|---|---|---|
| kill 精确次数/幂等未覆盖 | 已修复 | `tests/e2e/terminal.spec.ts`：断言 kills.filter(id) 精确=2（close 时 1 次 + start 解析后补偿 1 次）、Set size=1、starts=1 | 实跑 2 passed |
| ANSI 红色预期值空泛 | 已修复 | 31m 红色断言精确 = `rgb(204, 0, 0)`（xterm 默认 #cc0000）；0m 复位文本 = `rgb(212,212,212)` | 实跑 2 passed |
| 跨 session 路由未断言目标收到+其余排他 | 已修复 | 正确路由事件 FOURTH-ONLY 到达 fourth；陷阱事件 WRONG-SESSION（投递给 first 回调但 sessionId=fourth）被按 sessionId 过滤，fourth/first/second/third 均不含；second/third 排他不含任一文本 | 实跑 2 passed |
| 折叠重开未断言完整会话集合与状态 | 已修复 | 重开后断言 tab-1 running=ids[0]、tab-3 exited=ids[2]、tab-4 running=ids[3]、tab-2 count=0、身份与状态齐全 | 实跑 2 passed |

### web-canary.spec.ts（3 项）

| 报告状态 | 处理状态 | 关键改动 | 验证→结果 |
|---|---|---|---|
| 文本保存未断言路径/内容载荷/结果 | 已修复 | `tests/e2e/web-canary.spec.ts`：mock 建模 `documents_save_text` 记录 args；断言 path='/mock/notes.txt'、text='changed through Tauri'、encoding 非空 | 单独实跑该用例 passed |
| Excel 颜色/边框未断言实际应用 | 已修复 | fill #336699 后断言 `.excel-circular-color-picker` 的 `data-selected-color`='#336699'（值已提交进选择器状态，非仅输入框回显） | 单独实跑 passed |
| 样式项按位置索引 `.nth(4)` | 已修复 | 改为按线样式语义 `.fortune-border-style-picker-menu:has(svg path[stroke-dasharray="5,5"])`（Dashed）选样；点击后断言样式预览 path 的 stroke-dasharray='5,5'（已提交） | 单独实跑 passed |

### word-zoom-seamless.spec.ts（3 项）

| 报告状态 | 处理状态 | 关键改动 | 验证→结果 |
|---|---|---|---|
| 覆盖层仅断言全程总数>3 | 已修复 | `tests/e2e/word-zoom-seamless.spec.ts`：对两次 rebuild（模式切换）事件分别校验其时间窗内有 cover 帧；结束后 cover 撤收>300ms | 实跑 1 passed |
| 锚点场景未滚到非零位置 | 已修复 | 书挡模式下将 `.super-editor-container.contained` 滚到底；断言 before.scrollTop>0（确已下滚）且 book→vertical 切换后 after.scrollTop>0（未被重置回顶）。注：该缩放档书挡内容仅 860px、视口 758px，最多滚 102px，不足以把 page 0 完全移出视口，故以 scrollTop 为锚点量度 | 实跑 1 passed |
| 仅断言首 spread 前两页 | 已修复 | 遍历全部 spread：断言共 4 个、每 spread=[2i,2i+1]、摊平索引严格=[0,1,2,3,4,5,6,7] 无重复无缺漏 | 实跑 1 passed |

### support/minimal-docx.ts（2 项）

| 报告状态 | 处理状态 | 关键改动 | 验证→结果 |
|---|---|---|---|
| 调用方未补总页数/末页索引断言 | 已修复 | 总页数=8、末页索引=7 的断言并入 word-zoom 全 spread 配对（摊平=[0..7]、spread 数=4），见上 | 随 word-zoom 实跑 1 passed |
| 条件性：styles.xml 缺主文档关系 | 已修复 | `tests/e2e/support/minimal-docx.ts`：新增 `word/_rels/document.xml.rels`（rId1 → styles.xml，Type=officeDocument/2006/relationships/styles），补齐 [Content_Types].xml 已声明的 styles part 主文档关系 | 随 word-zoom 实跑 1 passed |

### SECURITY.md（1 项）

| 报告状态 | 处理状态 | 关键改动 | 验证→结果 |
|---|---|---|---|
| 私密报告漏洞政策无可操作入口 | 已修复 | `git remote -v` = https://Glace678@github.com/Glace678/wps-agent-editor.git，owner=Glace678/repo=wps-agent-editor；SECURITY.md 新增「Reporting a vulnerability」章节，给出入口 https://github.com/Glace678/wps-agent-editor/security/advisories/new 及操作步骤；未编造邮箱 | 人工核对文件 |

## 基准自带失败修复（全量验证定位）

以下 4 个用例在 pristine base（HEAD=8e95435，`git stash` 后复跑）即失败，与本次 22 项安全修复无关；根因均为品牌改名提交 **e846378** 及 PDF 原生光标定位改造时漏改测试断言。证据：`src/renderer/index.html:6 = <title>Office Agentic</title>`；`src/lib/i18n/runtime.ts:13 = APP_LANGUAGE_STORAGE_KEY='officeagentic-agent-language'`。均已改为验证当前既定行为，未弱化、未空泛。

| # | 位置 | 根因证据 | 改动 | 验证 |
|---|---|---|---|---|
| 1 | web-canary.spec.ts:132 | 品牌改名后标题="Office Agentic"，测试仍断言旧标题 | `toHaveTitle('WPS Agent Editor')` → `toHaveTitle('Office Agentic')` | web-canary 8 passed |
| 2 | web-canary.spec.ts:424 | i18n 键已改 `officeagentic-agent-language`，init 仍写陈旧键 `wps-agent-language`，致 zh-CN 未生效、alert 渲染英文 | addInitScript 键 → `'officeagentic-agent-language'`（字面量）。修复后 458 行 `toContainText('保存')` 真正通过：zh-CN 冲突文案 `与"{commands}"冲突`，file.save 经 getLocalizedShortcutCommandLabel 本地化即"保存" | web-canary 8 passed |
| 3 | pdf-worker.spec.ts:763（test 732） | 正文点击从"首次全选整段"改为"点击位置放原生光标（折叠选区）"：onClick 传 clientX → startBodyParagraphEdit → enterTextAnnotationEdit(id, clickX!=null, clickX) 走 placeCaretAtX | `expect.poll(selectedText).toBe('Hello Body Text')` → poll `getSelection()` 的 `isCollapsed===true && editor.contains(anchorNode)`。后续 clickCharacter(4)（其内部已 poll 折叠+光标 offset=4）、Shift+ArrowRight、拖拽选择不变 | pdf-worker 9 passed |
| 4 | pdf-worker.spec.ts:858（test 827 multiline） | 同上；首次点击 {x:20} 靠近行首 | `expect.poll(getSelection().toString()).toBe(originalText)` → 折叠+contains 断言（不 pin 精确 offset）。859 后"第二次点击定位光标"流程不变 | pdf-worker 9 passed |

**同根因额外暴露的两处**（实跑时在同一 test 内后续步骤再次命中陈旧"点击后整选"假设，一并修正，模式同上）：

- pdf-worker.spec.ts:805（test 732，保存重进编辑后）：`expect.poll(selectedText).toBe('Hella Word Text')` → 折叠+contains（内容已由 801 行 `toHaveText('Hella Word Text')` 断言）。
- pdf-worker.spec.ts:981（test 827 multiline，保存重进编辑后结尾）：`expect.poll(getSelection().toString()).toBe(replacement)` → 折叠+contains（保存内容已由 961 `saved.record` / earlier innerText 断言）。

## 验证汇总

- `npm run typecheck`：通过（tsconfig.web.json + tsconfig.node.json；未回退 color-pickers.spec.ts:180 的 boolean|null 修复）。
- web-canary.spec.ts 全量：**8 passed**。
- pdf-worker.spec.ts 全量：**9 passed**。
- 其余 spec（collaboration 4 / color-pickers 3 / terminal 2 / word-zoom 1）此前已实跑通过。

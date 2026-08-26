# lightweight-office（轻量离线文档模块）

独立文件夹，可随时卸载或替换，不影响主应用其他功能。

## 包含

| 文件类型 | 引擎 | 体积 |
|---------|------|------|
| .docx | SuperDoc | ~60MB |
| .doc | 内置 OLE/CFB 兼容层 → SuperDoc（纯 JS，不调用本机 Word/WPS） | 很小 |
| .xlsx/.csv | Fortune Sheet | ~8MB |
| .pdf | pdf.js | ~36MB |

## 试用说明

- 默认已启用（`config.ts` + `electron/lightweight-office/config.ts`）
- 打开 `.docx` / `.doc` / `.xlsx` / `.pdf` / `.txt` 即可编辑或预览
- 旧版 `.doc` 由应用内兼容层解析正文；保存为同名 `.docx`
- `Ctrl+S` 保存 Word / Excel / 文本
- Agent 通过主窗口内 `document-bridge` 操作文档，无需 OnlyOffice 隐藏窗口

## 卸载方法

1. 设置 `src/lightweight-office/config.ts` 与 `electron/lightweight-office/config.ts` 中 `LIGHTWEIGHT_OFFICE_ENABLED = false`
2. `App.tsx` 移除 `useAgentBridge()` 相关代码
3. 删除本文件夹 `src/lightweight-office/`
4. 删除 `electron/lightweight-office/`
5. `npm uninstall superdoc @superdoc-dev/react @fortune-sheet/react @fortune-sheet/core pdfjs-dist xlsx mammoth`

## Agent 文档操作

通过 `agent/document-bridge.ts` 暴露 API，无需 OnlyOffice 服务端。
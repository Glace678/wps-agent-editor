# Lightweight Office renderer

该目录包含按需加载的 Web 文档界面。桌面权限、二进制读写、格式转换和进程调用均由 `src-tauri/` 提供，渲染层不直接访问文件系统或 Shell。

| 类型 | Web 编辑/预览引擎 | 旧格式处理 |
| --- | --- | --- |
| DOCX | SuperDoc | DOC/ODT 由可选的 WPS、Microsoft Office 或 LibreOffice 转为 DOCX |
| XLSX/CSV | Fortune Sheet | XLS/ODS 由可选系统 Office 转为 XLSX |
| PPTX | pptx-renderer | PPT/ODP 由可选系统 Office 转为 PPTX |
| PDF | PDF.js | 只读预览 |
| 文本/代码 | Monaco 与轻量文本编辑器 | 无外部运行时 |

编辑器入口必须继续使用动态 `import()`，避免把全部文档引擎放进首屏 chunk。文件数据通过 `desktopApi.documents` 以原始 `Uint8Array` 或版本化 WAE1 envelope 传递，不得改回 Base64 或 JSON 字节数组。

Agent 文档操作由 `agent/document-bridge.ts` 连接当前可见编辑器；不存在隐藏编辑窗口或本地文档服务器。

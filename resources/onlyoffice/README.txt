WPS Agent Editor - 离线 Office 引擎

本应用使用 OnlyOffice Document Server 作为本地文档引擎。
安装包由应用首次启动时自动下载到用户数据目录，无需 Docker。

Windows: onlyoffice-documentserver.exe
macOS:   onlyoffice-documentserver.pkg
Linux:   onlyoffice-documentserver.x86_64.rpm

安装后 Document Server 运行在 http://127.0.0.1:8080
文档 Bridge 内嵌在应用中 http://127.0.0.1:13001

完全离线可用（Agent LLM 功能除外需联网）。
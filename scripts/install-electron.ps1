# 快速安装 Electron 二进制（国内网络推荐）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$electronDir = Join-Path $root "node_modules\electron"
$distDir = Join-Path $electronDir "dist"
$zipPath = Join-Path $electronDir "electron.zip"
$version = (Get-Content (Join-Path $electronDir "package.json") | ConvertFrom-Json).version

New-Item -ItemType Directory -Force -Path $distDir | Out-Null

$url = "https://cdn.npmmirror.com/binaries/electron/v$version/electron-v$version-win32-x64.zip"
Write-Host "Downloading Electron $version ..."
Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

Write-Host "Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $distDir -Force
Remove-Item $zipPath -Force

"electron.exe" | Set-Content (Join-Path $electronDir "path.txt") -NoNewline
$version | Set-Content (Join-Path $distDir "version") -NoNewline
Write-Host "Done: $(Join-Path $distDir 'electron.exe')"
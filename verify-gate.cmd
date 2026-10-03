@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set FAIL=0

call npm run typecheck
if errorlevel 1 set FAIL=1

call npm run check:i18n
if errorlevel 1 set FAIL=1

call npm run check:providers
if errorlevel 1 set FAIL=1

cargo test --manifest-path src-tauri/Cargo.toml -q
if errorlevel 1 set FAIL=1

call npm run build
if errorlevel 1 set FAIL=1

if %FAIL%==0 (
  echo VERIFY_GATE_OK
  exit /b 0
)
echo VERIFY_GATE_FAILED
exit /b 1

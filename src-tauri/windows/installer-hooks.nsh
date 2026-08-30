!macro WAE_WRITE_SAFE_OPEN_COMMAND PROG_ID
  WriteRegStr SHCTX "Software\Classes\${PROG_ID}\shell\open\command" "" '$\"$INSTDIR\wps-agent-editor.exe$\" $\"%1$\"'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "WPS Agent Editor Document"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "WPS Agent Editor Workbook"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "WPS Agent Editor Presentation"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "WPS Agent Editor PDF"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "WPS Agent Editor Text"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "WPS Agent Editor Source"
!macroend

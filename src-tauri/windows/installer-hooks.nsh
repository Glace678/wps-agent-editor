!macro WAE_WRITE_SAFE_OPEN_COMMAND PROG_ID
  WriteRegStr SHCTX "Software\Classes\${PROG_ID}\shell\open\command" "" '$\"$INSTDIR\office-agentic.exe$\" $\"%1$\"'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; ProgIDs must match the `name` fields of bundle.fileAssociations in
  ; tauri.conf.json exactly. scripts/release/verify-bundle-associations.mjs
  ; (--platform windows) asserts one-to-one coverage so a new association name
  ; cannot land here without a matching hardened open command.
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "Office Agentic Document"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "Office Agentic Workbook"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "Office Agentic Presentation"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "Office Agentic PDF Viewer and Editor"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "Office Agentic Text"
  !insertmacro WAE_WRITE_SAFE_OPEN_COMMAND "Office Agentic Source"
!macroend

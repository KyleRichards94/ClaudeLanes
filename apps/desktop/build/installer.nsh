; Custom NSIS hooks for the Agent Lanes installer (ticket AL-007), included through nsis.include in
; electron-builder.yml.
;
; electron-builder's installer copies itself to %LOCALAPPDATA%\<package>-updater\installer.exe so that
; electron-updater can download differential updates later, and its uninstaller never removes that
; copy. Agent Lanes has no auto-updater, so the copy is a few hundred MB of dead weight that would
; outlive an uninstall. Remove it after installing, and again when uninstalling.
;
; Only the known installer file is deleted, and its folder is removed only if it is then empty, so a
; surprise in the electron-builder define can never delete anything else.

!ifdef APP_INSTALLER_STORE_FILE
  !searchparse /noerrors "${APP_INSTALLER_STORE_FILE}" "" AGENT_LANES_UPDATER_DIR "\"
!endif

!macro agentLanesRemoveInstallerCopy
  !ifdef APP_INSTALLER_STORE_FILE
    ; The copy always goes to the current user's local app data, even for an all-users install.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    !ifdef AGENT_LANES_UPDATER_DIR
      RMDir "$LOCALAPPDATA\${AGENT_LANES_UPDATER_DIR}"
    !endif
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  !endif
!macroend

!macro customInstall
  !insertmacro agentLanesRemoveInstallerCopy
!macroend

!macro customUnInstall
  !insertmacro agentLanesRemoveInstallerCopy
!macroend

; ============================================================================
;  UnioTechIT custom NSIS installer hooks
;
;  Lock-screen capture + PIN unlock require a process running as SYSTEM inside
;  the active user session (only SYSTEM can reach the Winlogon secure desktop).
;  We create a SYSTEM scheduled task here, at install time (the installer is the
;  one elevated step — the app itself runs un-elevated / asInvoker afterwards).
;
;    input-helper.exe --service      -> SYSTEM launcher (spawned by this task)
;      \_ spawns input-helper.exe --lockworker as SYSTEM into the active session
;
;  Normal mouse/keyboard input is handled entirely by the un-elevated
;  user-session helper and never touches this task, so control can't break.
;
;  electron-builder auto-includes build/installer.nsh and invokes these macros.
; ============================================================================

!macro customInstall
  ; Path to the asarUnpack'd native helper inside the per-machine install dir.
  StrCpy $0 "$INSTDIR\resources\app.asar.unpacked\input-helper.exe"

  ; Remove any previous task (ignore errors on fresh installs).
  nsExec::Exec 'schtasks /delete /tn "RemoteITLockService" /f'

  ; Create the SYSTEM task in ONE robust step via Register-ScheduledTask, with ALL the
  ; correct settings baked in from the start — SYSTEM/HighestAvailable, at-logon trigger,
  ; and crucially battery conditions OFF + no run-time limit + run-on-demand. (The old
  ; two-step schtasks-create-then-modify was fragile and, on some machines/laptops, left
  ; the default "only on AC power" restriction so the task never ran — which is exactly
  ; why lock-screen worked on one PC but not another.)
  ; Backtick-delimited NSIS string so inner ' and " pass verbatim; $0 (exe path) is expanded
  ; by NSIS; no PowerShell $variables are used so NSIS won't mis-expand them.
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Register-ScheduledTask -TaskName 'RemoteITLockService' -Force -Action (New-ScheduledTaskAction -Execute '$0' -Argument '--service') -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Principal (New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest) -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel)"`

  ; Enable software SAS generation so Ctrl+Alt+Del can be simulated on the lock screen.
  nsExec::Exec 'reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v SoftwareSASGeneration /t REG_DWORD /d 3 /f'

  ; Start it now so lock-screen works immediately without waiting for the next logon.
  nsExec::Exec 'schtasks /run /tn "RemoteITLockService"'
!macroend

!macro customUnInstall
  ; Remove the task and stop any running helper processes.
  nsExec::Exec 'schtasks /delete /tn "RemoteITLockService" /f'
  nsExec::Exec 'taskkill /f /im input-helper.exe'
!macroend

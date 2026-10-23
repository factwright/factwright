; Factwright's install window. electron-builder's one-click installer shows a small banner while
; it installs (the SpiderBanner plugin's dialog). This redraws that banner in Factwright's look: a
; header in the app icon's blue with the mark, then "Installing Factwright…" and a thin progress
; bar in the app's blue. Updates install silently, so it's seen once on each computer.
;
; The header pictures, one for each screen scaling, are drawn by scripts/installer-art.ts --win,
; which `pnpm dist:win` runs first.

!include LogicLib.nsh
!include WinMessages.nsh

; Drawn at the screen's own scaling, so it's sharp at 150% and 200% as well as 100%.
ManifestDPIAware true

; electron-builder's check that the app isn't running needs these, and leaves them out once
; there's a customCheckAppRunning, so they come in here.
!include "getProcessInfo.nsh"
Var pid

; Runs as the banner opens, then checks the app isn't running, as electron-builder does.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${Silent}
      Call factwrightInstallWindow
    ${EndIf}
  !endif
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend

!ifndef BUILD_UNINSTALLER
  ; The window's inside, in points at 100% scaling. The header is INSTALL_HEADER's size in
  ; @factwright/ui/brand, which draws it.
  !define FACTWRIGHT_WIDTH 440
  !define FACTWRIGHT_HEIGHT 236
  !define FACTWRIGHT_HEADER 148
  !define FACTWRIGHT_MARGIN 28

  ; A size in points, as pixels at the screen's scaling: dots per inch over 96.
  !macro FACTWRIGHT_PIXELS OUT POINTS
    IntOp ${OUT} ${POINTS} * $R1
    IntOp ${OUT} ${OUT} / 96
  !macroend

  Function factwrightInstallWindow
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    Push $R4
    Push $R5
    Push $R6
    Push $R7
    Push $R8
    Push $R9
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4

    ; The banner: the second dialog inside the installer's window, as electron-builder finds it.
    FindWindow $R0 "#32770" "" $HWNDPARENT
    FindWindow $R0 "#32770" "" $HWNDPARENT $R0
    ${If} $R0 != 0
      System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .R1'
      ${If} $R1 < 96
        StrCpy $R1 96
      ${EndIf}

      ; The banner paints around its controls, not over them, so its header stays whole.
      System::Call 'user32::GetWindowLongW(p R0, i -16) i .R8'
      IntOp $R8 $R8 | 0x02000000
      System::Call 'user32::SetWindowLongW(p R0, i -16, i R8)'

      ; The window, made to fit the new inside around the middle it had, its frame as it was.
      System::Call '*(i, i, i, i) p .R9'
      System::Call 'user32::GetWindowRect(p $HWNDPARENT, p R9)'
      System::Call '*$R9(i .R2, i .R3, i .R4, i .R5)'
      System::Call 'user32::GetClientRect(p $HWNDPARENT, p R9)'
      System::Call '*$R9(i, i, i .R6, i .R7)'
      System::Free $R9
      IntOp $R4 $R4 - $R2
      IntOp $R5 $R5 - $R3
      IntOp $R6 $R4 - $R6
      IntOp $R7 $R5 - $R7
      !insertmacro FACTWRIGHT_PIXELS $0 ${FACTWRIGHT_WIDTH}
      !insertmacro FACTWRIGHT_PIXELS $1 ${FACTWRIGHT_HEIGHT}
      IntOp $R6 $R6 + $0
      IntOp $R7 $R7 + $1
      IntOp $R8 $R4 - $R6
      IntOp $R8 $R8 / 2
      IntOp $R2 $R2 + $R8
      IntOp $R8 $R5 - $R7
      IntOp $R8 $R8 / 2
      IntOp $R3 $R3 + $R8
      System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i R2, i R3, i R6, i R7, i 0x14)'
      System::Call 'user32::SetWindowPos(p R0, p 0, i 0, i 0, i r0, i r1, i 0x14)'

      ; The banner's own icon and its two lines of detail aren't part of it.
      GetDlgItem $R4 $R0 1025
      ShowWindow $R4 ${SW_HIDE}
      GetDlgItem $R4 $R0 1002
      ShowWindow $R4 ${SW_HIDE}
      GetDlgItem $R4 $R0 1003
      ShowWindow $R4 ${SW_HIDE}

      ; The line under the header, in Segoe UI Semibold.
      GetDlgItem $R4 $R0 1000
      SendMessage $R4 ${WM_SETTEXT} 0 "STR:Installing Factwright${U+2026}"
      CreateFont $R5 "Segoe UI" 11 600
      SendMessage $R4 ${WM_SETFONT} $R5 1
      !insertmacro FACTWRIGHT_PIXELS $2 ${FACTWRIGHT_MARGIN}
      !insertmacro FACTWRIGHT_PIXELS $3 168
      IntOp $4 $2 * 2
      IntOp $4 $0 - $4
      !insertmacro FACTWRIGHT_PIXELS $R6 24
      System::Call 'user32::SetWindowPos(p R4, p 0, i r2, i r3, i r4, i R6, i 0x14)'

      ; The progress bar, flat, in the app's blue on its border color. Without the system's
      ; theme it takes colors (PBM_SETBARCOLOR, PBM_SETBKCOLOR, as 0x00BBGGRR), and it loses the
      ; sunken edge Windows gives it then (WS_EX_STATICEDGE, WS_EX_CLIENTEDGE).
      GetDlgItem $R4 $R0 1001
      System::Call 'uxtheme::SetWindowTheme(p R4, w " ", w " ")'
      SendMessage $R4 0x409 0 0x00D04B2F
      SendMessage $R4 0x2001 0 0x00D8E1E4
      System::Call 'user32::GetWindowLongW(p R4, i -20) i .R8'
      IntOp $R8 $R8 & 0xFFFDFDFF
      System::Call 'user32::SetWindowLongW(p R4, i -20, i R8)'
      !insertmacro FACTWRIGHT_PIXELS $3 204
      !insertmacro FACTWRIGHT_PIXELS $R6 6
      ; SWP_FRAMECHANGED, so the edge goes.
      System::Call 'user32::SetWindowPos(p R4, p 0, i r2, i r3, i r4, i R6, i 0x34)'

      ; The header: the smallest picture drawn at least this big, fitted exactly.
      ${If} $R1 <= 96
        File "/oname=$PLUGINSDIR\factwright-header.bmp" "${BUILD_RESOURCES_DIR}\install-header-100.bmp"
      ${ElseIf} $R1 <= 120
        File "/oname=$PLUGINSDIR\factwright-header.bmp" "${BUILD_RESOURCES_DIR}\install-header-125.bmp"
      ${ElseIf} $R1 <= 144
        File "/oname=$PLUGINSDIR\factwright-header.bmp" "${BUILD_RESOURCES_DIR}\install-header-150.bmp"
      ${ElseIf} $R1 <= 168
        File "/oname=$PLUGINSDIR\factwright-header.bmp" "${BUILD_RESOURCES_DIR}\install-header-175.bmp"
      ${ElseIf} $R1 <= 192
        File "/oname=$PLUGINSDIR\factwright-header.bmp" "${BUILD_RESOURCES_DIR}\install-header-200.bmp"
      ${ElseIf} $R1 <= 240
        File "/oname=$PLUGINSDIR\factwright-header.bmp" "${BUILD_RESOURCES_DIR}\install-header-250.bmp"
      ${Else}
        File "/oname=$PLUGINSDIR\factwright-header.bmp" "${BUILD_RESOURCES_DIR}\install-header-300.bmp"
      ${EndIf}
      !insertmacro FACTWRIGHT_PIXELS $2 ${FACTWRIGHT_HEADER}
      ; A static control showing a bitmap: WS_CHILD, WS_VISIBLE and SS_BITMAP.
      System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5000000E, i 0, i 0, i r0, i r2, p R0, p 0, p 0, p 0) p .R2'
      ; Loaded from the file (LR_LOADFROMFILE) at exactly the header's size.
      System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\factwright-header.bmp", i 0, i r0, i r2, i 0x10) p .R3'
      ; STM_SETIMAGE, with an IMAGE_BITMAP.
      SendMessage $R2 0x172 0 $R3

      ; All of it drawn again, at once: RDW_INVALIDATE, RDW_ERASE, RDW_ALLCHILDREN, RDW_UPDATENOW.
      System::Call 'user32::RedrawWindow(p R0, p 0, p 0, i 0x185)'
    ${EndIf}

    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
    Pop $R9
    Pop $R8
    Pop $R7
    Pop $R6
    Pop $R5
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
  FunctionEnd
!endif

; The browser extension saves to the app on this computer through its helper, factwright-save.exe,
; which the app registers with each browser it finds as it starts: a key for each under HKCU,
; naming a manifest the app writes in its data folder, and a record of what it registered
; (src/main/extension/register.ts). Uninstalling takes it all away, so no browser is left starting
; a helper that's gone, and a reinstall registers again. An update runs the old version's
; uninstaller first, with --updated, and the new version keeps the registration, so then it stays.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.factwright.save"
    DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.factwright.save"
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.factwright.save"
    DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.factwright.save"
    DeleteRegKey HKCU "Software\Vivaldi\NativeMessagingHosts\com.factwright.save"
    DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.factwright.save"
    ; The app installs for this user alone, so $APPDATA is this user's, where Electron keeps the
    ; app's data folder. The job hunt in it stays, as deleteAppDataOnUninstall says.
    Delete "$APPDATA\Factwright\save-helper\chrome.json"
    Delete "$APPDATA\Factwright\save-helper\firefox.json"
    ; A manifest half written when the app stopped, if there's one.
    Delete "$APPDATA\Factwright\save-helper\.*.tmp"
    RMDir "$APPDATA\Factwright\save-helper"
    Delete "$APPDATA\Factwright\save-helper.json"
  ${EndIf}
!macroend

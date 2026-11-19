Var PreviewGuard

!macro PreviewAbort code message
  DetailPrint "${message}"
  MessageBox MB_OK|MB_ICONSTOP "${message}" /SD IDOK
  SetErrorLevel ${code}
  Quit
!macroend

; The open handle reserves the name until this process exits. An application
; launch and every installer/uninstaller entry point compete for the same name.
!macro PreviewAcquireGuard
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\org.shandong-study.knowpaper-preview.lifecycle")p.r0 ?e'
  Pop $1
  ${If} $0 == 0
  ${OrIf} $1 == 183
    !insertmacro PreviewAbort 10 "$(PreviewBusy)"
  ${EndIf}
  StrCpy $PreviewGuard $0
!macroend

!macro PreviewReleaseGuard
  System::Call 'kernel32::CloseHandle(p $PreviewGuard)'
!macroend

!macro PreviewCheckDirectory
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR")i.r0 ?e'
  Pop $1
  ${If} $0 == -1
    ${If} $1 != 2
    ${AndIf} $1 != 3
      !insertmacro PreviewAbort 12 "$(PreviewInvalidDirectory)"
    ${EndIf}
  ${Else}
    ; Must be a directory (0x10) without the reparse-point flag (0x400).
    IntOp $0 $0 & 0x410
    ${If} $0 != 16
      !insertmacro PreviewAbort 12 "$(PreviewInvalidDirectory)"
    ${EndIf}
  ${EndIf}
!macroend

!macro PreviewStrings
  LangString PreviewBusy ${LANG_SIMPCHINESE} "知卷或另一个安装程序正在运行。请保存资料并正常退出，再重试。"
  LangString PreviewBusy ${LANG_ENGLISH} "KnowPaper or another installer is running. Save your work, exit normally, and try again."
  LangString PreviewDowngrade ${LANG_SIMPCHINESE} "检测到较新或无法识别的知卷版本。请使用相同或更新的安装包。"
  LangString PreviewDowngrade ${LANG_ENGLISH} "A newer or unrecognized KnowPaper version is installed. Use the same or a newer installer."
  LangString PreviewInvalidDirectory ${LANG_SIMPCHINESE} "安装目录无法访问或不是预期的本地目录。"
  LangString PreviewInvalidDirectory ${LANG_ENGLISH} "The dedicated installation directory is inaccessible or invalid."
  LangString PreviewFileFailure ${LANG_SIMPCHINESE} "无法更新程序文件。请检查磁盘空间、权限和文件占用后重试。"
  LangString PreviewFileFailure ${LANG_ENGLISH} "Could not update program files. Check available space, permissions, and file locks before retrying."
  LangString PreviewShortcutFailure ${LANG_SIMPCHINESE} "无法创建开始菜单快捷方式。请检查权限后重试。"
  LangString PreviewShortcutFailure ${LANG_ENGLISH} "Could not create the Start menu shortcut. Check permissions and try again."
  LangString KeepPreviewData ${LANG_SIMPCHINESE} "卸载将移除知卷程序和快捷方式。学习资料、资源库和备份将保留。"
  LangString KeepPreviewData ${LANG_ENGLISH} "Uninstalling removes KnowPaper and its shortcuts. Your study data, libraries, and backups are kept."

!macroend

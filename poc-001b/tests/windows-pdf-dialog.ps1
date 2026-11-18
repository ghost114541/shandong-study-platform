
param(
    [Parameter(Mandatory)][int]$AppProcess,
    [Parameter(Mandatory)][string]$Title,
    [Parameter(Mandatory)][string]$Filename
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PdfTestWindows {
    delegate bool Visit(IntPtr hwnd, IntPtr arg);
    [DllImport("user32.dll")] static extern bool EnumWindows(Visit visit, IntPtr arg);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Visit visit, IntPtr arg);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr w, string l);
    public static bool SetFilename(IntPtr window, string filename) {
        bool written = false;
        EnumChildWindows(window, (wnd, arg) => {
            var name = new StringBuilder(100);
            GetClassName(wnd, name, name.Capacity);
            if (name.ToString() != "Edit" || !IsWindowVisible(wnd)) return true;
            written = SendMessage(wnd, 0x000c, IntPtr.Zero, filename) != IntPtr.Zero;
            return !written;
        }, IntPtr.Zero);
        return written;
    }
    public static bool Confirm(IntPtr window) {
        bool clicked = false;
        EnumChildWindows(window, (wnd, arg) => {
            var name = new StringBuilder(100);
            GetClassName(wnd, name, name.Capacity);
            if (name.ToString() != "Button" || GetDlgCtrlID(wnd) != 1 || !IsWindowVisible(wnd)) return true;
            clicked = PostMessage(wnd, 0x00f5, IntPtr.Zero, IntPtr.Zero);
            return !clicked;
        }, IntPtr.Zero);
        return clicked;
    }
    public static IntPtr Find(uint process, string title) {
        var found = IntPtr.Zero;
        EnumWindows((wnd, arg) => {
            uint pid; GetWindowThreadProcessId(wnd, out pid);
            if (pid != process) return true;
            var name = new StringBuilder(512);
            if (GetWindowText(wnd, name, name.Capacity) > 0) {
                if (name.ToString() == title) { found = wnd; return false; }
                if (title == "") Console.WriteLine(name.ToString());
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    $handle = [PdfTestWindows]::Find([uint32]$AppProcess, $Title)
    if ($handle -ne [IntPtr]::Zero -and [PdfTestWindows]::SetFilename($handle, $Filename)) {
        if ([PdfTestWindows]::Confirm($handle)) {
            Write-Output "Selected file through native Win32 controls in $Title"
            exit 0
        }
    }
    Start-Sleep -Milliseconds 150
} while ([DateTime]::UtcNow -lt $deadline)
[void][PdfTestWindows]::Find([uint32]$AppProcess, '')
throw "Native dialog '$Title' or its file controls did not become available for process $AppProcess"

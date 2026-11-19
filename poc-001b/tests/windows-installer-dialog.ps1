param(
    [Parameter(Mandatory)][ValidateSet('Install','Uninstall','Blocked')][string]$Mode,
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$Label,
    [int]$ExistingProcess
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SetupTestWindow {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32")] public static extern bool SetProcessDPIAware();
    [DllImport("user32")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
    [DllImport("user32")] public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
}
'@
[void][SetupTestWindow]::SetProcessDPIAware()

function Get-Button([IntPtr]$Window, [int]$Id) {
    $button = [SetupTestWindow]::GetDlgItem($Window, $Id)
    if ($button -ne [IntPtr]::Zero -and [SetupTestWindow]::IsWindowVisible($button) -and [SetupTestWindow]::IsWindowEnabled($button)) {
        return $button
    }
    return [IntPtr]::Zero
}

function Save-Window([IntPtr]$Window, [string]$Suffix) {
    $bounds = New-Object SetupTestWindow+Rect
    if (-not [SetupTestWindow]::GetWindowRect($Window, [ref]$bounds)) { throw 'Cannot read setup window size' }
    $bitmap = [Drawing.Bitmap]::new($bounds.Right - $bounds.Left, $bounds.Bottom - $bounds.Top)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $dc = $graphics.GetHdc()
        try { $captured = [SetupTestWindow]::PrintWindow($Window, $dc, 2) }
        finally { $graphics.ReleaseHdc($dc) }
        if (-not $captured) { throw 'Failed to capture setup window' }
        $bitmap.Save((Join-Path $Output "$Label-$Suffix.png"), [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

# Keep the copied uninstaller in process so that its exit code is observable.
$argsForSetup = @{}
if ($Mode -eq 'Uninstall') {
    $argsForSetup.ArgumentList = "_?=$env:LOCALAPPDATA\KnowPaper Preview"
}
$setup = if ($ExistingProcess) { Get-Process -Id $ExistingProcess } else {
    Start-Process -FilePath $Executable -PassThru @argsForSetup
}
if ($setup.Path -ne $Executable) { throw "Unexpected executable for setup process" }
$timer = [Diagnostics.Stopwatch]::StartNew()
$steps = 0
while (-not $setup.HasExited -and $timer.Elapsed.TotalSeconds -lt 80) {
    $setup.Refresh()
    $window = $setup.MainWindowHandle
    if ($window -ne [IntPtr]::Zero) {
        $buttonId = 1
        $button = Get-Button $window $buttonId
        if ($Mode -eq 'Blocked' -and $button -eq [IntPtr]::Zero) {
            $buttonId = 2
            $button = Get-Button $window $buttonId
        }
        if ($button -ne [IntPtr]::Zero) {
            $steps++
            Save-Window $window ('page-' + $steps)
            if ($Mode -eq 'Install') {
                $inner = [SetupTestWindow]::GetDlgItem($window, 1018)
                $run = Get-Button $inner 1203
                if ($run -ne [IntPtr]::Zero) {
                    [void][SetupTestWindow]::PostMessage($run, 0xF1, [IntPtr]::Zero, [IntPtr]::Zero)
                }
            }
            [void][SetupTestWindow]::PostMessage($window, 0x111, [IntPtr]$buttonId, $button)
            Start-Sleep -Milliseconds 800
        }
    }
    Start-Sleep -Milliseconds 100
}
if (-not $setup.HasExited) { throw "Setup window timed out after $steps button clicks (PID $($setup.Id))" }
[ordered]@{ exitCode = $setup.ExitCode; seconds = $timer.Elapsed.TotalSeconds; pages = $steps } | ConvertTo-Json -Compress

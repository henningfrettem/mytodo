# Creates a desktop shortcut that opens the app in its own chromeless window.
#
# Chrome's "Create shortcut" / "Install page as app" menu item is disabled for
# file:// pages in current versions, so the only route is the --app= flag on a
# normal Windows shortcut. That still works.
#
# Run from anywhere:   powershell -ExecutionPolicy Bypass -File make-shortcut.ps1

$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$index  = Join-Path $appDir "index.html"
$icon   = Join-Path $appDir "todo.ico"

if (-not (Test-Path $index)) { throw "index.html not found next to this script." }

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) { throw "Chrome not found. Edit this script to point at your browser." }

$fileUrl = "file:///" + ($index -replace '\\', '/')
$lnkPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "Todo.lnk"

$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = $chrome
# Deliberately no --user-data-dir. The app window has to share the ordinary
# Chrome profile: a separate one would mean separate localStorage, and so a
# fresh setup screen and a lost session every launch.
$lnk.Arguments        = "--app=`"$fileUrl`""
$lnk.WorkingDirectory = $appDir
$lnk.Description      = "Todo"
if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
$lnk.Save()

Write-Host "Created $lnkPath"
Write-Host "  -> $chrome --app=`"$fileUrl`""
Write-Host ""
Write-Host "Right-click the shortcut and 'Pin to taskbar' if you want it there too."

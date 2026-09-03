# Sets up MixerM8 on the booth machine:
#   - installs MixerM8.exe to %LOCALAPPDATA%\MixerM8
#   - starts it automatically at login, minimized
#   - puts a "Booth Guide" shortcut on the desktop that opens the page
#
# Run on the media computer, from the folder holding MixerM8.exe:
#     powershell -ExecutionPolicy Bypass -File install_startup.ps1
#
# To undo, run with -Uninstall.

param(
    [string]$ConsoleIp = "",
    [int]$Port = 8080,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$installDir = Join-Path $env:LOCALAPPDATA "MixerM8"
$target     = Join-Path $installDir "MixerM8.exe"
$startup    = [Environment]::GetFolderPath("Startup")
$desktop    = [Environment]::GetFolderPath("Desktop")
$startLink  = Join-Path $startup "MixerM8 Bridge.lnk"
$deskLink   = Join-Path $desktop "Booth Guide.lnk"

if ($Uninstall) {
    foreach ($p in @($startLink, $deskLink)) {
        if (Test-Path $p) { Remove-Item $p -Force; Write-Host "Removed $p" }
    }
    if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force; Write-Host "Removed $installDir" }
    Write-Host "MixerM8 removed. Your saved console address is in %APPDATA%\MixerM8." -ForegroundColor Green
    return
}

$source = Join-Path $PSScriptRoot "MixerM8.exe"
if (-not (Test-Path $source)) { $source = Join-Path (Get-Location) "MixerM8.exe" }
if (-not (Test-Path $source)) {
    throw "MixerM8.exe not found. Put this script next to the exe and run it again."
}

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item $source $target -Force
Write-Host "Installed to $target" -ForegroundColor Green

$shell = New-Object -ComObject WScript.Shell

# Start at login, minimized so it does not cover the lyrics software.
$lnk = $shell.CreateShortcut($startLink)
$lnk.TargetPath       = $target
$lnk.Arguments        = if ($ConsoleIp) { "$ConsoleIp --port $Port" } else { "--port $Port" }
$lnk.WorkingDirectory = $installDir
$lnk.WindowStyle      = 7          # minimized
$lnk.Description      = "MixerM8 booth bridge (read-only)"
$lnk.Save()
Write-Host "Will start automatically at login." -ForegroundColor Green

# Desktop shortcut so anyone can pull the guide up on this machine too.
$lnk2 = $shell.CreateShortcut($deskLink)
$lnk2.TargetPath  = "http://127.0.0.1:$Port"
$lnk2.Description = "Open the booth guide"
$lnk2.Save()

Write-Host ""
Write-Host "Done. Starting it now..." -ForegroundColor Cyan
Start-Process -FilePath $target -ArgumentList (
    if ($ConsoleIp) { "$ConsoleIp","--port","$Port" } else { "--port","$Port" }
) -WindowStyle Minimized

Write-Host ""
Write-Host "On the tablet, open:  http://$($env:COMPUTERNAME):$Port" -ForegroundColor Yellow
Write-Host "(or the IP address the MixerM8 window prints)"

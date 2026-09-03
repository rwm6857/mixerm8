# Builds MixerM8.exe. Run from the repository root:
#     powershell -ExecutionPolicy Bypass -File packaging\build_exe.ps1

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host "Installing build dependencies..." -ForegroundColor Cyan
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -e ".[build]"

Write-Host "Building..." -ForegroundColor Cyan
python -m PyInstaller packaging\mixerm8.spec --noconfirm --clean

$exe = Join-Path (Get-Location) "dist\MixerM8.exe"
if (Test-Path $exe) {
    $mb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
    Write-Host ""
    Write-Host "Built $exe ($mb MB)" -ForegroundColor Green
    Write-Host "Next: copy it to the booth machine and run packaging\install_startup.ps1"
} else {
    throw "Build finished but dist\MixerM8.exe is missing."
}

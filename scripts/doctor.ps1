$ErrorActionPreference = "Stop"

function Write-Check {
  param(
    [string]$Name,
    [bool]$Ok,
    [string]$Detail
  )
  $status = if ($Ok) { "OK " } else { "NG " }
  Write-Output ("[{0}] {1}: {2}" -f $status, $Name, $Detail)
}

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$cargoExe = Join-Path $cargoBin "cargo.exe"
$rustcExe = Join-Path $cargoBin "rustc.exe"

$nodeOk = $false
$npmOk = $false
$cargoOk = Test-Path $cargoExe
$rustcOk = Test-Path $rustcExe

try {
  node --version | Out-Null
  $nodeOk = $true
} catch {}

try {
  npm --version | Out-Null
  $npmOk = $true
} catch {}

$pathHasCargo = $env:Path -split ";" | Where-Object { $_ -eq $cargoBin }
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$userPathHasCargo = $false
if ($userPath) {
  $userPathHasCargo = ($userPath -split ";" | Where-Object { $_ -eq $cargoBin }).Count -gt 0
}
$vsPath = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC"
$vsOk = Test-Path $vsPath
$sdkPathA = "C:\Program Files (x86)\Windows Kits\10\Lib"
$sdkPathB = "C:\Program Files\Windows Kits\10\Lib"
$sdkOk = (Test-Path $sdkPathA) -or (Test-Path $sdkPathB)

$nodeDetail = if ($nodeOk) { node --version } else { "not found" }
$npmDetail = if ($npmOk) { npm --version } else { "not found" }
$cargoDetail = if ($cargoOk) { $cargoExe } else { "not found under ~/.cargo/bin" }
$rustcDetail = if ($rustcOk) { $rustcExe } else { "not found under ~/.cargo/bin" }
$pathReady = ($pathHasCargo.Count -gt 0) -or $userPathHasCargo
$pathDetail = if ($pathHasCargo.Count -gt 0) {
  "present in current shell"
} elseif ($userPathHasCargo) {
  "present in user PATH (restart terminal to apply)"
} else {
  "missing in both current shell and user PATH"
}
$vsDetail = if ($vsOk) { $vsPath } else { "Visual Studio C++ tools not found" }
$sdkDetail = if ($sdkOk) { "Windows Kits detected" } else { "kernel32.lib source is missing" }

Write-Check -Name "Node.js" -Ok $nodeOk -Detail $nodeDetail
Write-Check -Name "npm" -Ok $npmOk -Detail $npmDetail
Write-Check -Name "cargo.exe" -Ok $cargoOk -Detail $cargoDetail
Write-Check -Name "rustc.exe" -Ok $rustcOk -Detail $rustcDetail
Write-Check -Name "PATH includes ~/.cargo/bin" -Ok $pathReady -Detail $pathDetail
Write-Check -Name "MSVC toolchain" -Ok $vsOk -Detail $vsDetail
Write-Check -Name "Windows SDK" -Ok $sdkOk -Detail $sdkDetail

if (-not $sdkOk) {
  Write-Output ""
  Write-Output "Action required:"
  Write-Output "1) Open Visual Studio Installer"
  Write-Output "2) Modify 'Visual Studio 2022 Community'"
  Write-Output "3) Add workload: Desktop development with C++"
  Write-Output "4) Ensure component: Windows 11 SDK (10.0.22621+)"
}

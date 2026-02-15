$ErrorActionPreference = "Stop"

$cargoExe = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
if (-not (Test-Path $cargoExe)) {
  throw "cargo.exe not found at $cargoExe"
}

$vsDevCmd = "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"
if (-not (Test-Path $vsDevCmd)) {
  throw "VsDevCmd.bat not found. Install Visual Studio 2022 Community with C++ tools."
}

$workspace = Resolve-Path (Join-Path $PSScriptRoot "..")
$srcTauri = Join-Path $workspace "src-tauri"
if (-not (Test-Path $srcTauri)) {
  throw "src-tauri directory not found at $srcTauri"
}

Push-Location $srcTauri
try {
  $cmd = "call `"$vsDevCmd`" -arch=amd64 -host_arch=amd64 && `"$cargoExe`" check"
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) {
    throw "cargo check failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

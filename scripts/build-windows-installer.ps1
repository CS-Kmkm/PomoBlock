$ErrorActionPreference = "Stop"

param(
  [string]$Bundles = "nsis,msi",
  [switch]$Debug
)

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$cargoExe = Join-Path $cargoBin "cargo.exe"
$cargoTauriExe = Join-Path $cargoBin "cargo-tauri.exe"

if (-not (Test-Path $cargoExe)) {
  throw "cargo.exe not found at $cargoExe"
}
if (-not (Test-Path $cargoTauriExe)) {
  throw "cargo-tauri.exe not found at $cargoTauriExe. Run: cargo install tauri-cli --version '^2'"
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

$profileFlag = if ($Debug) { "--debug" } else { "--release" }

Push-Location $srcTauri
try {
  $cmd = "call `"$vsDevCmd`" -arch=amd64 -host_arch=amd64 && `"$cargoExe`" tauri build $profileFlag --bundles $Bundles"
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) {
    throw "cargo tauri build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Output "Build completed."
Write-Output "Bundles: $Bundles"
Write-Output "Artifacts: src-tauri/target/release/bundle/"

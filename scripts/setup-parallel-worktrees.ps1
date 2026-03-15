param(
  [string]$MainRepoPath = "C:\Users\Koshi\PomoBlock",
  [string]$WorktreeBasePath = "",
  [string]$BaseBranch = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($WorktreeBasePath)) {
  $parent = Split-Path -Parent $MainRepoPath
  $repoName = Split-Path -Leaf $MainRepoPath
  $WorktreeBasePath = Join-Path $parent ("{0}.worktrees" -f $repoName)
}

$workItems = @(
  [pscustomobject]@{
    Id = "A"; Folder = "tsr-a-safety"; Branch = "codex/tsr-a-safety"; Phase = "PHASE-1";
    Tasks = "TSR-001, TSR-002, TSR-003";
    Allowed = "src-ui/now.ts; src-ui/commands.ts; src-ui/tauri-contracts.ts; src-ui/utils/*; tests/*";
    Forbidden = "src-ui/app-runtime.ts";
    StartAfter = "-"
  },
  [pscustomobject]@{
    Id = "B"; Folder = "tsr-b-mock-split"; Branch = "codex/tsr-b-mock-split"; Phase = "PHASE-1";
    Tasks = "TSR-004 (app-runtime/mock split)";
    Allowed = "src-ui/app-runtime.ts; src-ui/mock/*";
    Forbidden = "src-ui/runtime/* (except import wiring if unavoidable)";
    StartAfter = "-"
  },
  [pscustomobject]@{
    Id = "C"; Folder = "tsr-c-runtime-foundation"; Branch = "codex/tsr-c-runtime-foundation"; Phase = "PHASE-1";
    Tasks = "TSR-005/006 foundation only (new runtime modules only)";
    Allowed = "src-ui/runtime/* (new files); docs";
    Forbidden = "src-ui/app-runtime.ts";
    StartAfter = "-"
  },
  [pscustomobject]@{
    Id = "D"; Folder = "tsr-d-storage"; Branch = "codex/tsr-d-storage"; Phase = "PHASE-1";
    Tasks = "TSR-008, TSR-009";
    Allowed = "src/infrastructure/localStorageRepository.ts; doc/v2/core/*; doc/v2/log/*";
    Forbidden = "src-ui/app-runtime.ts";
    StartAfter = "-"
  },
  [pscustomobject]@{
    Id = "E"; Folder = "tsr-e-runtime-integration"; Branch = "codex/tsr-e-runtime-integration"; Phase = "PHASE-2";
    Tasks = "TSR-005/006 integration + TSR-007 + TSR-010";
    Allowed = "src-ui/app-runtime.ts; src-ui/runtime/*; tests/*; doc/v2/core/*; doc/v2/log/*";
    Forbidden = "-";
    StartAfter = "B merged + C merged + latest main"
  }
)

if (-not (Test-Path $MainRepoPath)) {
  throw "Main repo path not found: $MainRepoPath"
}

$gitDirCheck = & git -C $MainRepoPath rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0 -or $gitDirCheck -ne "true") {
  throw "Not a git repository: $MainRepoPath"
}

if ([string]::IsNullOrWhiteSpace($BaseBranch)) {
  $currentBranch = (& git -C $MainRepoPath branch --show-current).Trim()
  if ([string]::IsNullOrWhiteSpace($currentBranch)) {
    $BaseBranch = "main"
    Write-Warning "Could not detect current branch (detached HEAD?). Fallback to '$BaseBranch'."
  } else {
    $BaseBranch = $currentBranch
  }
}

New-Item -ItemType Directory -Path $WorktreeBasePath -Force | Out-Null

Write-Host "[1/3] Fetching latest refs..."
& git -C $MainRepoPath fetch origin
if ($LASTEXITCODE -ne 0) {
  throw "git fetch failed"
}

Write-Host "[2/3] Creating worktrees..."
foreach ($item in $workItems) {
  $targetPath = Join-Path $WorktreeBasePath $item.Folder
  if (Test-Path $targetPath) {
    Write-Warning "Skip (already exists): $targetPath"
    continue
  }

  & git -C $MainRepoPath show-ref --verify --quiet ("refs/heads/{0}" -f $item.Branch)
  if ($LASTEXITCODE -eq 0) {
    Write-Host ("- add existing branch {0} -> {1}" -f $item.Branch, $targetPath)
    & git -C $MainRepoPath worktree add $targetPath $item.Branch
  } else {
    Write-Host ("- create branch {0} from {1} -> {2}" -f $item.Branch, $BaseBranch, $targetPath)
    & git -C $MainRepoPath worktree add -b $item.Branch $targetPath $BaseBranch
  }

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create worktree: $($item.Branch)"
  }
}

Write-Host "[3/3] Writing assignment doc..."
$assignmentPath = Join-Path $WorktreeBasePath "TSR_AGENT_ASSIGNMENTS.md"

$lines = @()
$lines += "# TSR Parallel Agent Assignments (Conflict-Safe)"
$lines += ""
$lines += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$lines += "MainRepo: $MainRepoPath"
$lines += "BaseBranch: $BaseBranch"
$lines += ""
$lines += "## Rule"
$lines += "- PHASE-1 (A/B/C/D) を並列実行"
$lines += "- PHASE-2 (E) は B/C マージ後に開始"
$lines += "- Allowed/Forbidden を厳守 (同一ファイルの同時編集禁止)"
$lines += ""
$lines += "| Agent | Phase | Worktree | Branch | Tasks | Allowed | Forbidden | StartAfter |"
$lines += "| --- | --- | --- | --- | --- | --- | --- | --- |"
foreach ($item in $workItems) {
  $path = Join-Path $WorktreeBasePath $item.Folder
  $lines += "| $($item.Id) | $($item.Phase) | $path | $($item.Branch) | $($item.Tasks) | $($item.Allowed) | $($item.Forbidden) | $($item.StartAfter) |"
}
$lines += ""
$lines += "## Start Commands"
foreach ($item in $workItems) {
  $path = Join-Path $WorktreeBasePath $item.Folder
  $lines += ""
  $lines += "### Agent $($item.Id)"
  $lines += '```powershell'
  $lines += "cd `"$path`""
  $lines += "git status --short"
  $lines += '```'
}
$lines += ""
$lines += "## Merge Order"
$lines += "1. A"
$lines += "2. D"
$lines += "3. B"
$lines += "4. C"
$lines += "5. E"

Set-Content -Path $assignmentPath -Value ($lines -join "`r`n") -Encoding UTF8

Write-Host "Done."
Write-Host "Worktree base: $WorktreeBasePath"
Write-Host "Assignment file: $assignmentPath"



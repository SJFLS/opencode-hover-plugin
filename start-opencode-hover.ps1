# Windows launcher: start the official OpenCode desktop app with a CDP debug port,
# then attach the hover message-preview add-on.
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File "$HOME\.local\share\opencode\hover-plugin\start-opencode-hover.ps1"
# Stop: close this window / Ctrl+C (stops the add-on only, not OpenCode).
# Equivalent of the macOS start-opencode-hover.command.

$ErrorActionPreference = "Stop"

$Port   = if ($env:OPENCODE_HOVER_PORT) { [int]$env:OPENCODE_HOVER_PORT } else { 9222 }
$VerUrl = "http://127.0.0.1:$Port/json/version"
$Dir    = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---- find bun ----
$Bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $Bun) {
  foreach ($p in @("$env:USERPROFILE\.bun\bin\bun.exe", "$HOME\.bun\bin\bun.exe")) {
    if (Test-Path $p) { $Bun = $p; break }
  }
}
if (-not $Bun) { Write-Host "bun not found. Install it: powershell -c ""irm bun.sh/install.ps1 | iex"""; exit 1 }

# ---- find OpenCode.exe (override with env OPENCODE_EXE) ----
$App = $env:OPENCODE_EXE
if (-not $App -or -not (Test-Path $App)) {
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\opencode-desktop\OpenCode.exe",
    "$env:LOCALAPPDATA\Programs\opencode\OpenCode.exe",
    "$env:LOCALAPPDATA\opencode-desktop\OpenCode.exe",
    "$env:USERPROFILE\scoop\apps\opencode-desktop\current\OpenCode.exe",
    "$env:ProgramFiles\OpenCode\OpenCode.exe"
  )
  $App = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $App) {
  # fallback: search common roots recursively for OpenCode.exe
  $App = Get-ChildItem -Path @("$env:LOCALAPPDATA", "$env:USERPROFILE\scoop\apps") -Filter "OpenCode.exe" -Recurse -ErrorAction SilentlyContinue |
         Select-Object -First 1 -ExpandProperty FullName
}
if (-not $App) { Write-Host "OpenCode.exe not found. Set env OPENCODE_EXE to its full path."; exit 1 }

function Test-Port {
  try { Invoke-WebRequest -Uri $VerUrl -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

# Stop any existing helper (keep a single instance). Match bun processes whose
# command line contains hover-helper.js.
Get-CimInstance Win32_Process -Filter "Name='bun.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "hover-helper\.js" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "Stopped old helper." }

# 1) running but no debug port -> quit, then relaunch with the port
$running = Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue
if ($running) {
  if (Test-Port) {
    Write-Host "OpenCode already running with debug port; attaching add-on."
  } else {
    Write-Host "OpenCode running without debug port; restarting..."
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    for ($i=0; $i -lt 20; $i++) { if (-not (Get-Process -Name "OpenCode" -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 500 }
  }
}

# 2) not running -> launch with the debug port
if (-not (Test-Port)) {
  Write-Host "Starting OpenCode with debug port $Port ..."
  Start-Process -FilePath $App -ArgumentList "--remote-debugging-port=$Port"
}

# 3) wait for the port (first launch can be slow, up to ~90s)
$ready = $false
for ($i=0; $i -lt 180; $i++) { if (Test-Port) { $ready = $true; break }; Start-Sleep -Milliseconds 500 }
if (-not $ready) { Write-Host "Debug port not ready. This build may disable remote debugging; cannot inject."; exit 1 }

Write-Host "Ready. Attaching hover add-on. Keep this window open; close it or Ctrl+C to stop."
& $Bun "$Dir\hover-helper.js"

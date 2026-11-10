$ErrorActionPreference = 'Stop'
$appPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataPath = [System.IO.Path]::GetFullPath((Join-Path $appPath '../../项目'))
$appPort = if ($env:STORYBOARD_PORT) { [int]$env:STORYBOARD_PORT } else { 4318 }
$appUrl = "http://127.0.0.1:$appPort"
try { $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2 } catch { exit 0 }
if ($health.app -ne 'director-reader' -or $health.root -ne $dataPath) { throw 'This port belongs to another application.' }
Invoke-RestMethod -Uri "$appUrl/api/shutdown" -Method Post -Headers @{ 'X-Storyboard-Client' = 'local-launcher' } -TimeoutSec 3 | Out-Null

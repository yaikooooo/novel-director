param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$appPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataPath = [System.IO.Path]::GetFullPath((Join-Path $appPath '../../项目'))
$appPort = if ($env:STORYBOARD_PORT) { [int]$env:STORYBOARD_PORT } else { 4318 }
$appUrl = "http://127.0.0.1:$appPort"
$health = $null
try { $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2 } catch {}
if ($health -and ($health.app -ne 'director-reader' -or $health.root -ne $dataPath)) {
    throw "Port $appPort belongs to another application or project."
}
if (-not $health) {
    $nodeCommand = Get-Command node.exe -ErrorAction Stop
    $serverPath = Join-Path $appPath 'server.mjs'
    $process = Start-Process -FilePath $nodeCommand.Source -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $appPath -WindowStyle Hidden -PassThru
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try { $health = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 1; break } catch { Start-Sleep -Milliseconds 200 }
        if ($process.HasExited) { throw 'Unable to start the director reader.' }
    }
}
if (-not $health -or $health.app -ne 'director-reader' -or $health.root -ne $dataPath) { throw 'The director reader is unavailable.' }
if (-not $NoBrowser) { Start-Process "$appUrl/example" }

# WinPerf installer - Windows performance watcher
# Built by Muse, 2026-10-04
# Installs: %LOCALAPPDATA%\WinPerf\winperf.ps1 (+ winperf.cmd shim) and a Scheduled Task "WinPerf" (every 5 min)
$ErrorActionPreference = "Stop"
$Dir = "$env:LOCALAPPDATA\WinPerf"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# ---------- the winperf tool ----------
$inner = @'
param([string]$Mode = "--status")
$Dir = "$env:LOCALAPPDATA\WinPerf"
$Log = Join-Path $Dir "winperf.log"
$AlertTs = Join-Path $Dir ".last_alert"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

function Get-Snapshot {
  $cpu = 0
  try { $cpu = [math]::Round((Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop).CounterSamples[0].CookedValue) } catch { }
  $os = Get-CimInstance Win32_OperatingSystem
  $mem = [math]::Round($os.FreePhysicalMemory / $os.TotalVisibleMemorySize * 100)
  $disk = [math]::Round((Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'").FreeSpace / 1GB)
  $tops = @()
  try {
    $tops = (Get-Counter '\Process(*)\% Processor Time' -ErrorAction Stop).CounterSamples |
      Where-Object { $_.InstanceName -notmatch '^(idle|_total)$' } |
      Sort-Object CookedValue -Descending | Select-Object -First 5
  } catch { }
  return @{ Cpu = $cpu; Mem = $mem; Disk = $disk; Tops = $tops }
}

function Get-Recommendation($s) {
  $top = ($s.Tops | Select-Object -First 1).InstanceName
  if ([string]::IsNullOrEmpty($top)) { $top = "an app" }
  if ($s.Cpu -ge 85) { return "Close '$top' (the top CPU hog), or restart your PC." }
  if ($s.Mem -lt 15) { return "Memory is tight - close apps you are not using." }
  if ($s.Disk -lt 15) { return "Disk is low - run Disk Cleanup (cleanmgr)." }
  return "All healthy - nothing to do."
}

function Show-Toast($title, $message) {
  try {
    $safe = $message -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;'
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $xml = "<toast><visual><binding template=`"ToastGeneric`"><text>$title</text><text>$safe</text></binding></visual></toast>"
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    $t = [Windows.UI.Notifications.ToastNotification]::new($doc)
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("WinPerf").Show($t)
  } catch { }
}

function Do-Status {
  $s = Get-Snapshot
  Write-Host "CPU: $($s.Cpu)%"
  Write-Host "Memory free: $($s.Mem)%"
  Write-Host "Disk free (C:): $($s.Disk) GB"
  Write-Host "Top CPU processes:"
  $s.Tops | ForEach-Object { Write-Host ("  {0,-28} {1}%" -f $_.InstanceName, [math]::Round($_.CookedValue)) }
  Write-Host "Recommendation: $(Get-Recommendation $s)"
}

function Do-Sample {
  $s = Get-Snapshot
  $topStr = ($s.Tops | ForEach-Object { "$($_.InstanceName)($([math]::Round($_.CookedValue))%)" }) -join ' '
  $entry = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | cpu=$($s.Cpu)% | memfree=$($s.Mem)% | disk=$($s.Disk)G | top: $topStr"
  Add-Content -Path $Log -Value $entry -Encoding UTF8
  $n = (Get-Content $Log -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
  if ($n -gt 2000) { Get-Content $Log -Tail 2000 | Set-Content $Log -Encoding UTF8 }
  $now = [int][double]::Parse((Get-Date -UFormat %s))
  $last = 0
  if (Test-Path $AlertTs) { $last = [int](Get-Content $AlertTs -ErrorAction SilentlyContinue) }
  if (($now - $last) -gt 1800) {
    $rec = Get-Recommendation $s
    $msg = ""
    if ($s.Cpu -ge 85) { $msg = "CPU at $($s.Cpu)%. $rec" }
    elseif ($s.Disk -lt 15) { $msg = "Disk low ($($s.Disk)GB free). $rec" }
    if ($msg -ne "") { Show-Toast "WinPerf Alert" $msg; Set-Content -Path $AlertTs -Value "$now" }
  }
}

function Do-Uninstall {
  schtasks /delete /tn "WinPerf" /f 2>$null | Out-Null
  Write-Host "WinPerf background watcher removed. The 'winperf' command still works for manual checks."
}

switch ($Mode) {
  "--status" { Do-Status }
  "--sample" { Do-Sample }
  "--log" { if (Test-Path $Log) { Get-Content $Log -Tail 30 } else { Write-Host "No samples yet - the watcher runs every 5 minutes." } }
  "--uninstall" { Do-Uninstall }
  default { Write-Host "Usage: winperf --status | --log | --uninstall" }
}
'@
Set-Content -Path (Join-Path $Dir "winperf.ps1") -Value $inner -Encoding UTF8

# ---------- winperf.cmd shim (so `winperf` works in cmd and Run) ----------
$shim = @'
@echo off
powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\WinPerf\winperf.ps1" %*
'@
Set-Content -Path (Join-Path $Dir "winperf.cmd") -Value $shim -Encoding ASCII

# ---------- background watcher: Scheduled Task every 5 minutes ----------
$taskCmd = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Dir\winperf.ps1`" --sample"
schtasks /create /tn "WinPerf" /tr "$taskCmd" /sc minute /mo 5 /f | Out-Null

# ---------- PATH so `winperf` works anywhere ----------
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$Dir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$Dir", "User")
}
$env:Path = "$env:Path;$Dir"

Write-Host "---- WinPerf installed ----"
& (Join-Path $Dir "winperf.ps1") --status
Write-Host ""
Write-Host "Watcher: every 5 min via Scheduled Task 'WinPerf' (log: %LOCALAPPDATA%\WinPerf\winperf.log)"
Write-Host "Alerts: Windows notification if CPU >= 85% or disk < 15 GB free (max 1 per 30 min)"
Write-Host "Commands: winperf --status | winperf --log | winperf --uninstall"

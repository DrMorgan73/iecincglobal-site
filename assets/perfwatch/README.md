# PerfWatch

An always-on performance watcher for your computer. Samples CPU, memory and disk every 5 minutes in the background and pops a notification with a plain-English recommendation the moment something spikes.

Two editions, one for each OS:

- **MacPerf** (macOS) — `macperf --status`
- **WinPerf** (Windows) — `winperf --status`

## Install

**Mac** — in Terminal:

```
curl -sL -o /tmp/macperf-install.sh https://iecincglobal.com/assets/perfwatch/mac/install.sh && bash /tmp/macperf-install.sh
```

**Windows** — in PowerShell (right-click, Run as your normal user):

```
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\install.ps1"
```

(download `install.ps1` first from the Assets page, or run the one-liner above after saving it to Downloads)

## What it does

- `--status` — instant snapshot: CPU, memory, disk free, top 5 CPU processes, plus an immediate recommendation.
- `--log` — recent 5-minute samples.
- `--uninstall` — removes the background watcher.
- Background watcher (Mac: launchd `com.mohammed.macperf`; Windows: Scheduled Task `WinPerf`, every 5 min): notifies you if CPU hits 85%+ or disk drops under 15 GB free — at most one alert per 30 minutes, each with a recommendation (e.g. quit the hogging app, restart, or clean the disk).

## Notes

- No data leaves your computer — logs stay local (`~/Library/Logs/macperf.log` on Mac, `%LOCALAPPDATA%\WinPerf\winperf.log` on Windows).
- Pilot stage: built October 2026, in active use and refinement.

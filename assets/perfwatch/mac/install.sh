#!/bin/bash
# MacPerf installer — performance watcher for MacBook Pro
# Built by Muse for DrMorgan, 2026-10-04
# Installs: ~/.local/bin/macperf  +  launchd job com.mohammed.macperf (samples every 5 min)
set -e

BIN_DIR="$HOME/.local/bin"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LOGS_DIR="$HOME/Library/Logs"
PLIST="$AGENTS_DIR/com.mohammed.macperf.plist"

mkdir -p "$BIN_DIR" "$AGENTS_DIR" "$LOGS_DIR"

# ---------- the macperf tool ----------
cat > "$BIN_DIR/macperf" <<'MACPERF_EOF'
#!/bin/bash
# macperf — watch Mac performance. Commands: --status, --sample, --log, --uninstall
set -u
LOG="$HOME/Library/Logs/macperf.log"
ALERT_TS="$HOME/Library/Logs/.macperf_last_alert"
PLIST="$HOME/Library/LaunchAgents/com.mohammed.macperf.plist"

cpu_snapshot() {  # prints "user sys" percentages
  top -l 1 -n 0 2>/dev/null | awk '/CPU usage/ {u=$3; s=$5; gsub(/%|,/, "", u); gsub(/%|,/, "", s); printf "%.1f %.1f", u, s}'
}
mem_free_pct() {
  memory_pressure 2>/dev/null | awk -F': ' '/free percentage/ {gsub(/%/, "", $2); print $2}'
}
disk_free_gb() {
  df -g / 2>/dev/null | tail -1 | awk '{print $4}'
}
top_procs() {
  ps -arcwwwxo "comm %cpu" 2>/dev/null | head -6 | tail -5 | awk '{printf "%s(%s%%) ", $1, $2}'
}

do_status() {
  read -r u s <<< "$(cpu_snapshot)"
  total=$(awk "BEGIN{printf \"%.0f\", $u + $s}")
  mem=$(mem_free_pct); [ -z "$mem" ] && mem="?"
  disk=$(disk_free_gb)
  echo "CPU: ${total}% (user ${u}%, sys ${s}%)"
  echo "Memory free: ${mem}%"
  echo "Disk free: ${disk} GB"
  echo "Top CPU processes:"
  ps -arcwwwxo "%cpu comm" 2>/dev/null | head -6 | tail -5 | awk '{printf "  %-28s %s%%\n", $2, $1}'
  echo "Recommendation: $(recommend "$total" "$mem" "$disk")"
}

# immediate recommendation based on the snapshot
recommend() {
  local total="$1" mem="$2" disk="$3"
  local topname
  topname=$(ps -arcwwwxo "comm" 2>/dev/null | sed -n '2p')
  if [ "$total" -ge 85 ]; then
    echo "Quit '${topname}' (the top CPU hog), or restart your Mac."
  elif [ "$mem" != "?" ] && [ "$mem" -lt 15 ]; then
    echo "Memory is tight — close apps you are not using."
  elif [ -n "$disk" ] && [ "$disk" -lt 15 ]; then
    echo "Disk is low — run: macclean --clean-all"
  else
    echo "All healthy — nothing to do."
  fi
}

do_sample() {
  read -r u s <<< "$(cpu_snapshot)"
  total=$(awk "BEGIN{printf \"%.0f\", $u + $s}")
  mem=$(mem_free_pct); [ -z "$mem" ] && mem="?"
  disk=$(disk_free_gb)
  top1=$(top_procs)
  echo "$(date '+%F %T') | cpu=${total}% | memfree=${mem}% | disk=${disk}G | top: ${top1}" >> "$LOG"
  tail -2000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
  # alerts with immediate recommendation, max once per 30 minutes
  now=$(date +%s); last=0; [ -f "$ALERT_TS" ] && last=$(cat "$ALERT_TS" 2>/dev/null || echo 0)
  if [ $((now - last)) -gt 1800 ]; then
    rec=""
    if [ "$total" -ge 85 ]; then
      rec=$(recommend "$total" "$mem" "$disk")
      msg="CPU at ${total}%. $rec"
    elif [ -n "$disk" ] && [ "$disk" -lt 15 ]; then
      rec=$(recommend "$total" "$mem" "$disk")
      msg="Disk low (${disk}GB free). $rec"
    fi
    if [ -n "$msg" ]; then
      osascript -e "display notification \"$msg\" with title \"MacPerf Alert\"" 2>/dev/null || true
      echo "$now" > "$ALERT_TS"
    fi
  fi
}

do_log() {
  if [ -f "$LOG" ]; then tail -30 "$LOG"; else echo "No samples yet — the watcher runs every 5 minutes."; fi
}

do_uninstall() {
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "MacPerf background watcher removed. The 'macperf' command still works for manual checks."
}

case "${1:---status}" in
  --status) do_status ;;
  --sample) do_sample ;;
  --log) do_log ;;
  --uninstall) do_uninstall ;;
  *) echo "Usage: macperf --status | --log | --uninstall" ;;
esac
MACPERF_EOF
chmod +x "$BIN_DIR/macperf"

# ---------- the background watcher (every 5 min) ----------
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mohammed.macperf</string>
  <key>ProgramArguments</key>
  <array>
    <string>${HOME}/.local/bin/macperf</string>
    <string>--sample</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/macperf.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/macperf.err.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

# ---------- PATH ----------
if ! grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
fi
export PATH="$HOME/.local/bin:$PATH"

echo "---- MacPerf installed ----"
macperf --status
echo ""
echo "Watcher: every 5 min via com.mohammed.macperf (log: ~/Library/Logs/macperf.log)"
echo "Alerts: macOS notification if CPU >= 85% or disk < 15 GB free (max 1 per 30 min)"
echo "Commands: macperf --status | macperf --log | macperf --uninstall"

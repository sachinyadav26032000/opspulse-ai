#!/bin/bash
# Failures print at column 0 ("FAIL  msg"); passes print " ok   msg".
# A leading-space pattern matches NOTHING and reports every suite clean.
cd "$(dirname "$0")"
tot=0; bad=0
for f in *.mjs; do
  out=$(node "$f" 2>&1); rc=$?
  n=$(printf '%s\n' "$out" | grep -c '^FAIL')
  ok=$(printf '%s\n' "$out" | grep -c '^ ok')
  tot=$((tot+ok+n))
  if [ "$n" != "0" ] || [ "$rc" != "0" ]; then
    bad=$((bad+1)); printf '%-20s FAILS=%s exit=%s\n' "$f" "$n" "$rc"
    printf '%s\n' "$out" | grep '^FAIL' | sed 's/^/    /'
  else
    printf '%-20s ok (%s)\n' "$f" "$ok"
  fi
done
echo "─────────────────────────────"
echo "$tot assertions across $(ls *.mjs | wc -l | tr -d ' ') suites · $bad suite(s) failing"
[ "$bad" = "0" ]

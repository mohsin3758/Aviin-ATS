#!/bin/bash
# Zero-token violation check.
# Run manually (e.g. via /zerocheck or before committing):
#   bash scripts/zerotoken-check.sh
# Scans changed .py/.ts files for forbidden external-LLM calls.
VIOLATIONS=0
for f in $(git diff --name-only 2>/dev/null | grep -E '\.py$|\.ts$'); do
  [ -f "$f" ] || continue
  if grep -qiE 'openai|anthropic\.completions|gpt-4|gpt-3\.5|gemini' "$f" 2>/dev/null; then
    echo "[ZERO-TOKEN VIOLATION] External LLM API in $f"
    VIOLATIONS=$((VIOLATIONS+1))
  fi
done
[ $VIOLATIONS -gt 0 ] && echo "Fix violations before committing." && exit 1
exit 0

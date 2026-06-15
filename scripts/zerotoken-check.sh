#!/bin/bash
# ============================================================
# Zero-token cascade audit for AIrecruit (FinStack Staffing OS)
#
# Confirms NO paid/external AI API is referenced anywhere in the
# product (code, config, env, compose files). Allowed AI services
# are ONLY: local Ollama (Qwen2.5), local BGE-small embeddings,
# local Tesseract/OpenCV OCR, local pgvector. Everything else below
# is forbidden in application code/config.
#
# Usage:
#   bash scripts/zerotoken-check.sh          # full-repo audit (use
#                                             # at the end of every phase)
#   bash scripts/zerotoken-check.sh --diff   # changed files only
#                                             # (quick pre-commit check)
# ============================================================
set -uo pipefail

MODE="full"
[ "${1:-}" = "--diff" ] && MODE="diff"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# Forbidden: any paid/external LLM, embedding, or inference API.
# NOTE: \bgemini\b (not bare `gemini`) — bare substring matching also
# flags "Capgemini" (a real Indian IT employer name used in seed data),
# which has nothing to do with the Google Gemini API.
PATTERN='openai|anthropic[^[:space:]]*api|api\.anthropic|gpt-3|gpt-4|gpt-5|\bgemini\b|generativelanguage\.googleapis|vertexai|aiplatform\.googleapis|cohere\.ai|api\.cohere|mistral\.ai|api\.mistral|together\.ai|api\.together|replicate\.com|api-inference\.huggingface|groq\.com|api\.groq|perplexity\.ai|bedrock-runtime|azure.*openai|claude-(3|opus|sonnet|haiku)|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|COHERE_API_KEY|MISTRAL_API_KEY|GROQ_API_KEY|TOGETHER_API_KEY|REPLICATE_API_TOKEN|HUGGINGFACE_API'

# File types that matter: app code + config/env/compose. Markdown
# docs (CLAUDE.md, AGENTS.md, this script's own comments, blueprints)
# are excluded — they discuss the rule in prose, which is expected.
EXT_GLOBS=( '*.py' '*.ts' '*.tsx' '*.js' '*.jsx' '*.json' '*.yml' '*.yaml' '*.env' '*.env.*' 'Dockerfile*' )

if [ "$MODE" = "diff" ]; then
  FILES=$(git diff --name-only 2>/dev/null)
else
  FILES=$(git ls-files)
fi

VIOLATIONS=0
for f in $FILES; do
  [ -f "$f" ] || continue
  case "$f" in
    *.md|scripts/zerotoken-check.sh|docs/*) continue ;;
  esac
  match=false
  for g in "${EXT_GLOBS[@]}"; do
    case "$(basename "$f")" in
      $g) match=true; break ;;
    esac
  done
  $match || continue

  if grep -EnoiH "$PATTERN" "$f" 2>/dev/null; then
    VIOLATIONS=$((VIOLATIONS+1))
  fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "[ZERO-TOKEN VIOLATION] $VIOLATIONS reference(s) to a paid/external AI API found above."
  echo "Replace with the local cascade: Ollama (Qwen2.5) / BGE-small embeddings / pgvector / Tesseract+OpenCV."
  exit 1
fi

echo "ZERO-TOKEN CASCADE: CONFIRMED CLEAN (0 external API refs, mode=$MODE, $(echo "$FILES" | wc -w) files checked)"
exit 0

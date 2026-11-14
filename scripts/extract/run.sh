#!/usr/bin/env bash
# AI 訊號抽取：build(--no-ai) 產生 texts_for_ai.json → Codex 抽取 signals.json → 再 build 一次驗證引用
# 用法（專案根目錄）：bash scripts/extract/run.sh [--source official]
set -euo pipefail
cd "$(dirname "$0")/../.."
SOURCE=$(python -c "import json,sys;a=sys.argv[1:];print(a[a.index('--source')+1] if '--source' in a else json.load(open('config/columns.json',encoding='utf-8-sig'))['source'])" "$@")

python scripts/build.py --no-ai "$@"
rm -f output/signals_source.txt
codex exec -m gpt-6.1-sol -c model_reasoning_effort="high" -s workspace-write --skip-git-repo-check -C . -o output/extract_last_message.md - < scripts/extract/prompt.md
echo "$SOURCE" > output/signals_source.txt
python scripts/build.py "$@"
echo "完成（資料源 $SOURCE）：看 output/build_log.md 的「AI 標籤」段落，確認丟掉幾筆、原因是什麼。"

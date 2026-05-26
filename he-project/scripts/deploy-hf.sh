#!/bin/sh
set -e

if [ -z "$HF_TOKEN" ]; then
  echo "Error: HF_TOKEN environment variable is required"
  echo "Get a write token from https://huggingface.co/settings/tokens"
  exit 1
fi

HF_USER="${HF_USER:-Botnest}"
HF_SPACE="${HF_SPACE:-cinebot-player}"
REPO_URL="https://${HF_USER}:${HF_TOKEN}@huggingface.co/spaces/${HF_USER}/${HF_SPACE}"
TMPDIR=$(mktemp -d)

SPACE_URL="https://huggingface.co/api/spaces/${HF_USER}/${HF_SPACE}"
echo "Checking if Space ${HF_USER}/${HF_SPACE} exists..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SPACE_URL" -H "Authorization: Bearer $HF_TOKEN")
if [ "$STATUS" = "404" ]; then
  echo "Space not found. Creating ${HF_USER}/${HF_SPACE}..."
  CREATE_RESP=$(curl -s -w "\n%{http_code}" -X POST "https://huggingface.co/api/repos/create" \
    -H "Authorization: Bearer $HF_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"space\",\"name\":\"${HF_SPACE}\",\"sdk\":\"docker\",\"private\":false}")
  CREATE_CODE=$(echo "$CREATE_RESP" | tail -1)
  if [ "$CREATE_CODE" != "200" ] && [ "$CREATE_CODE" != "201" ]; then
    echo "Error: Failed to create Space (HTTP $CREATE_CODE)"
    echo "$CREATE_RESP" | sed '$d'
    exit 1
  fi
  echo "Space created."
elif [ "$STATUS" != "200" ]; then
  echo "Error: Unexpected status $STATUS checking Space. Check your HF_TOKEN."
  exit 1
else
  echo "Space exists."
fi

echo "Preparing deployment..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"
tar --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='artifacts/mockup-sandbox' -cf - . | (cd "$TMPDIR" && tar xf -)

cp "$PROJECT_DIR/HF_README.md" "$TMPDIR/README.md"

cd "$TMPDIR"
git init -b main
git config user.email "deploy@botnest.dev"
git config user.name "Deploy Bot"
git add -A
git commit -m "Deploy CineBot Player"
git remote add hf "$REPO_URL"
git push hf main --force

echo ""
echo "Pushed to https://huggingface.co/spaces/${HF_USER}/${HF_SPACE}"
echo "App URL: https://${HF_USER}-${HF_SPACE}.hf.space"
echo "Build logs: https://huggingface.co/spaces/${HF_USER}/${HF_SPACE}/logs/build"

rm -rf "$TMPDIR"

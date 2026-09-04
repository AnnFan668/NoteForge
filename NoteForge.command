#!/bin/zsh

set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$PROJECT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js or npm was not found. Please install Node.js first:"
  echo "https://nodejs.org/"
  echo ""
  read "?Press Enter to close..."
  exit 1
fi

node scripts/start-fixed.mjs

echo ""
read "?Server stopped. Press Enter to close..."

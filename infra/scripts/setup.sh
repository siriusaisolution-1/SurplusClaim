#!/usr/bin/env bash
set -euo pipefail

pnpm install
python -m pip install --upgrade pip pip-tools
cd services/scraper && pip-sync

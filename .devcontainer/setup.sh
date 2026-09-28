#!/usr/bin/env bash
# Runs once when the Codespace is created: installs everything and adds test data.
set -euo pipefail
cd "$(dirname "$0")/.."

cd backend
pip install --quiet ".[dev]"
if [ ! -f .env ]; then
  cat > .env <<EOF
PV_ENV=dev
PV_DATABASE_URL=sqlite:///./purevegi.db
PV_JWT_SECRET=$(python -c 'import secrets; print(secrets.token_urlsafe(48))')
PV_DEV_PAYMENTS=true
EOF
fi
python -m app.seed --owner-email owner@purevegi.test --owner-password Test12345

cd ../admin
[ -f .env ] || cp .env.example .env
npm install --no-audit --no-fund

echo "Setup done. Log in to the staff app with owner@purevegi.test / Test12345"

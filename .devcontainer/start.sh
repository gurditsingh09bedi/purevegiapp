#!/usr/bin/env bash
# Starts the API (8000), notification worker, staff app (3000) and customer website (5173).
# Installs anything missing first, so an older Codespace catches up after `git pull`.
cd "$(dirname "$0")/.."

python -c "import fastapi, sqlalchemy, cryptography" 2>/dev/null || (cd backend && pip install --quiet ".[dev]")
[ -f backend/.env ] || bash .devcontainer/setup.sh
# The Pure Vegi leaflet menu replaces the old sample dishes (once; later edits in the staff app are kept).
(cd backend && python -m app.menu_import --if-sample)
# Keys for browser notifications (made once, kept in backend/.env).
if ! grep -q "^PV_VAPID_PUBLIC_KEY=." backend/.env; then
  (cd backend && python -m app.vapid >> .env) && echo "Made browser notification keys"
  pkill -f "uvicorn app.main" 2>/dev/null; sleep 1
fi
for dir in admin web; do
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing $dir (first time, 1-2 minutes)..."
    (cd "$dir" && { [ -f .env ] || cp .env.example .env; } && npm install --no-audit --no-fund --silent)
  fi
done

if ! curl -s localhost:8000/health >/dev/null; then
  (cd backend && nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/api.log 2>&1 &)
fi
# The worker sends notifications; restart it so it always runs the latest code and settings.
pkill -f "app.worker" 2>/dev/null; sleep 1
(cd backend && nohup python -m app.worker > /tmp/worker.log 2>&1 &)
if ! curl -s localhost:3000 >/dev/null; then
  (cd admin && nohup npm run dev -- --host 0.0.0.0 > /tmp/admin.log 2>&1 &)
fi

if ! curl -s localhost:5173 >/dev/null; then
  (cd web && nohup npm run dev -- --host 0.0.0.0 > /tmp/web.log 2>&1 &)
fi

sleep 4
echo ""
echo "Pure Vegi is running:"
echo "  Customer website: open the PORTS tab, port 5173"
echo "  Staff app (kitchen + admin): PORTS tab, port 3000"
echo "  API docs: port 8000, then add /docs to the address"
echo "  Login: owner@purevegi.co.uk / Test12345"
echo "  Logs: tail -f /tmp/api.log /tmp/worker.log /tmp/admin.log /tmp/web.log"

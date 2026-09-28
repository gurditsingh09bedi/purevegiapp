#!/usr/bin/env bash
# Starts the API (8000), notification worker, staff app (3000) and customer website (5173).
# Installs anything missing first, so an older Codespace catches up after `git pull`.
cd "$(dirname "$0")/.."

python -c "import fastapi, sqlalchemy" 2>/dev/null || (cd backend && pip install --quiet ".[dev]")
[ -f backend/.env ] || bash .devcontainer/setup.sh
for dir in admin web; do
  if [ ! -d "$dir/node_modules" ]; then
    echo "Installing $dir (first time, 1-2 minutes)..."
    (cd "$dir" && { [ -f .env ] || cp .env.example .env; } && npm install --no-audit --no-fund --silent)
  fi
done

if ! curl -s localhost:8000/health >/dev/null; then
  (cd backend && nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/api.log 2>&1 &)
fi
if ! pgrep -f "app.worker" >/dev/null; then
  (cd backend && nohup python -m app.worker > /tmp/worker.log 2>&1 &)
fi
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

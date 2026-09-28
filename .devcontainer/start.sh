#!/usr/bin/env bash
# Starts the API (port 8000) and the staff app (port 3000). Logs: /tmp/api.log, /tmp/admin.log
cd "$(dirname "$0")/.."

if ! curl -s localhost:8000/health >/dev/null; then
  (cd backend && nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > /tmp/api.log 2>&1 &)
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
echo "  Logs: tail -f /tmp/api.log /tmp/admin.log /tmp/web.log"

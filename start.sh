#!/bin/bash
# Quantitative Trading Signal Engine - Startup Script
# ====================================================
# Not financial advice. Markets involve risk.

set -e

echo "╔══════════════════════════════════════════════════════╗"
echo "║      Quantitative Trading Signal Engine v1.0         ║"
echo "║      Not financial advice. Markets involve risk.     ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Install Python dependencies ───────────────────────
echo "→ Installing Python dependencies..."
pip install -r "$REPO_ROOT/packages/quant/requirements.txt" -q
pip install -r "$REPO_ROOT/apps/api/requirements.txt" -q
echo "  ✓ Python dependencies installed"

# ─── Start API ──────────────────────────────────────────
echo ""
echo "→ Starting FastAPI backend on port 8000..."
cd "$REPO_ROOT/apps/api"
PYTHONPATH="$REPO_ROOT/packages/quant:$PYTHONPATH" \
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
API_PID=$!
echo "  ✓ API started (PID $API_PID)"

# Wait for API
sleep 3
if curl -s http://localhost:8000/health > /dev/null; then
  echo "  ✓ API health check passed"
else
  echo "  ⚠ API may still be starting..."
fi

# ─── Frontend ───────────────────────────────────────────
echo ""
echo "→ Starting Next.js frontend on port 3000..."
cd "$REPO_ROOT/apps/web"
if [ ! -d "node_modules" ]; then
  echo "  Installing Node.js dependencies..."
  npm install -q
fi
npm run dev &
FRONTEND_PID=$!
echo "  ✓ Frontend started (PID $FRONTEND_PID)"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Services running:                                   ║"
echo "║    Frontend:  http://localhost:3000                  ║"
echo "║    API:       http://localhost:8000                  ║"
echo "║    API Docs:  http://localhost:8000/docs             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Press Ctrl+C to stop all services."

# Cleanup on exit
trap "kill $API_PID $FRONTEND_PID 2>/dev/null" EXIT

wait

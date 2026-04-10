#!/bin/bash
set -e

echo "==> Starting Bionic Brain..."

# Copy env if it doesn't exist
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example — add your ANTHROPIC_API_KEY before using AI features."
fi

# Activate virtualenv if present
if [ -f venv/Scripts/activate ]; then
  source venv/Scripts/activate
elif [ -f venv/bin/activate ]; then
  source venv/bin/activate
fi

# Install backend dependencies
echo "==> Installing backend dependencies..."
cd backend
pip install -r requirements.txt -q
cd ..

# Seed built-in types (idempotent)
echo "==> Seeding built-in types..."
python backend/db/seed.py

# Start backend (background)
echo "==> Starting backend on http://localhost:8000..."
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo $BACKEND_PID > .backend.pid

# Install and start frontend
echo "==> Starting frontend on http://localhost:3000..."
cd frontend
npm install -q
npm run dev &
FRONTEND_PID=$!
echo $FRONTEND_PID > ../.frontend.pid
cd ..

echo ""
echo "==> Bionic Brain is running!"
echo "    App:      http://localhost:3000"
echo "    API:      http://localhost:8000"
echo "    API docs: http://localhost:8000/docs"
echo ""
echo "    Run ./stop.sh to stop everything."

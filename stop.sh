#!/bin/bash
echo "==> Stopping Bionic Brain..."

# Stop frontend
if [ -f .frontend.pid ]; then
  kill $(cat .frontend.pid) 2>/dev/null || true
  rm .frontend.pid
fi

# Stop backend
if [ -f .backend.pid ]; then
  kill $(cat .backend.pid) 2>/dev/null || true
  rm .backend.pid
fi

echo "==> Stopped."

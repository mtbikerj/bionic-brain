@echo off
echo =^> Starting Bionic Brain...

if not exist .env (
  copy .env.example .env
  echo =^> Created .env from .env.example — add your ANTHROPIC_API_KEY before using AI features.
)

echo =^> Activating virtual environment...
if exist venv\Scripts\activate.bat (
  call venv\Scripts\activate.bat
)

echo =^> Installing backend dependencies...
cd backend
pip install -r requirements.txt -q
cd ..

echo =^> Seeding built-in types...
python backend/db/seed.py

echo =^> Starting backend on http://localhost:8000...
start /B uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir backend

echo =^> Starting frontend on http://localhost:3000...
cd frontend
call npm install -q
start /B npm run dev
cd ..

echo.
echo =^> Bionic Brain is running!
echo     App:      http://localhost:3000
echo     API:      http://localhost:8000
echo     API docs: http://localhost:8000/docs
echo.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from backend.routers import nodes, edges, types, search, settings, ai, graph, backup, agents
from backend.db.connection import init_db

app = FastAPI(title="Bionic Brain API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(nodes.router, prefix="/api")
app.include_router(edges.router, prefix="/api")
app.include_router(types.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(graph.router, prefix="/api")
app.include_router(backup.router, prefix="/api")
app.include_router(agents.router, prefix="/api")


@app.on_event("startup")
def startup():
    init_db()


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve built frontend in production (optional)
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

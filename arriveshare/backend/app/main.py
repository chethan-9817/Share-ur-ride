"""
ArriveShare — FastAPI Application Entry Point
==============================================
Shared cab rides for people arriving at airports and railway stations.
Upgraded with WAL migration, background auto-matching worker, and central state machine.

Start the server:
    uvicorn app.main:app --reload --port 8000
"""

import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import engine, Base, SessionLocal, ensure_schema_migrations
from .routes.auth import router as auth_router
from .routes.stations import router as stations_router
from .routes.rides import router as rides_router
from .routes.matches import router as matches_router
from .routes.groups import router as groups_router
from .routes.driver import router as driver_router
from .services.matching import run_background_matching
from .seed import seed_all


async def background_matching_worker():
    """Background task running auto-matching and accept timeout handler every 15-30s."""
    interval = getattr(settings, "BACKGROUND_MATCH_INTERVAL_SECONDS", 20)
    while True:
        try:
            await asyncio.sleep(interval)
            db = SessionLocal()
            try:
                run_background_matching(db)
            finally:
                db.close()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            print(f"[BACKGROUND MATCH WORKER WARNING] {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables, ensure schema migrations, seed data, and launch background worker."""
    Base.metadata.create_all(bind=engine)
    ensure_schema_migrations(engine)

    db = SessionLocal()
    try:
        seed_all(db)
    finally:
        db.close()

    # Launch background auto-matching task
    worker_task = asyncio.create_task(background_matching_worker())

    yield

    # Clean shutdown of worker task
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="ArriveShare",
    description="Shared cab rides for airport & railway station arrivals",
    version="1.1.0",
    lifespan=lifespan,
)

# CORS — allow the React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(auth_router)
app.include_router(stations_router)
app.include_router(rides_router)
app.include_router(matches_router)
app.include_router(groups_router)
app.include_router(driver_router)


@app.get("/")
def root():
    return {
        "app": "ArriveShare",
        "version": "1.1.0",
        "docs": "/docs",
        "description": "Shared cab rides for airport & railway station arrivals",
        "demo_mode": settings.DEMO_MODE,
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "demo_mode": settings.DEMO_MODE,
        "database": "connected",
    }


@app.get("/api/config")
def get_public_config():
    """Expose frontend-relevant runtime configuration."""
    return {
        "demo_mode": settings.DEMO_MODE,
        "accept_window_seconds": settings.ACCEPT_WINDOW_SECONDS,
        "max_detour_pct": settings.MAX_DETOUR_PCT,
        "max_detour_km": settings.MAX_DETOUR_KM,
        "cab_capacity": settings.CAB_CAPACITY,
    }

"""
ArriveShare — FastAPI Application Entry Point
==============================================
Shared cab rides for people arriving at airports and railway stations.

Start the server:
    uvicorn app.main:app --reload --port 8000
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, Base, SessionLocal
from .auth import router as auth_router
from .routes.stations import router as stations_router
from .routes.rides import router as rides_router
from .routes.matches import router as matches_router
from .routes.groups import router as groups_router
from .routes.driver import router as driver_router
from .seed import seed_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables and seed data on startup."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_all(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="ArriveShare",
    description="Shared cab rides for airport & railway station arrivals",
    version="1.0.0",
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
        "version": "1.0.0",
        "docs": "/docs",
        "description": "Shared cab rides for airport & railway station arrivals",
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}

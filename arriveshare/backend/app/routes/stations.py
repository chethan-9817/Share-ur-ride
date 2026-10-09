"""Station endpoints — list and retrieve airports/railway stations."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Station
from ..schemas import StationResponse

router = APIRouter(prefix="/api/stations", tags=["stations"])


@router.get("", response_model=List[StationResponse])
def list_stations(db: Session = Depends(get_db)):
    """List all airports and railway stations."""
    return db.query(Station).all()


@router.get("/{station_id}", response_model=StationResponse)
def get_station(station_id: int, db: Session = Depends(get_db)):
    """Get details of a specific station."""
    station = db.query(Station).filter(Station.id == station_id).first()
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    return station

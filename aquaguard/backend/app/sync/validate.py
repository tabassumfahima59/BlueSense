"""Response validation for source adapters: structure (Pydantic) and plausible ranges per variable.

Invalid or missing values are never stored and never replace a stored value; adapters count them as skipped.
"""
from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

# variable-name prefix -> (min, max) in Open-Meteo default units (°C, %, mm, km/h, m³/m³)
RANGES: list[tuple[str, tuple[float, float]]] = [
    ("temperature", (-30.0, 60.0)),
    ("relative_humidity", (0.0, 100.0)),
    ("precipitation_probability", (0.0, 100.0)),
    ("precipitation", (0.0, 2000.0)),
    ("rain", (0.0, 2000.0)),
    ("wind_speed", (0.0, 400.0)),
    ("et0_fao_evapotranspiration", (0.0, 40.0)),
    ("soil_moisture", (0.0, 1.0)),
]


def in_range(variable: str, value) -> bool:
    if value is None or isinstance(value, bool):
        return False
    try:
        v = float(value)
    except (TypeError, ValueError):
        return False
    if not math.isfinite(v):
        return False
    for prefix, (lo, hi) in RANGES:
        if variable.startswith(prefix):
            return lo <= v <= hi
    return False  # unknown variables are not stored


class TimeBlock(BaseModel):
    """An Open-Meteo hourly/daily block: `time` plus equal-length value arrays."""
    model_config = ConfigDict(extra="allow")
    time: list[str]

    @model_validator(mode="after")
    def _lengths(self) -> TimeBlock:
        n = len(self.time)
        for key, values in (self.model_extra or {}).items():
            if not isinstance(values, list) or len(values) != n:
                raise ValueError(f"array '{key}' does not match the time axis")
        return self

    def series(self) -> dict[str, list]:
        return dict(self.model_extra or {})


class OpenMeteoResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    latitude: float
    longitude: float
    timezone: str
    current: dict | None = None
    current_units: dict[str, str] | None = None
    hourly: TimeBlock | None = None
    hourly_units: dict[str, str] | None = None
    daily: TimeBlock | None = None
    daily_units: dict[str, str] | None = None

    @field_validator("latitude")
    @classmethod
    def _lat(cls, v: float) -> float:
        if not -90 <= v <= 90:
            raise ValueError("latitude out of range")
        return v

    @field_validator("longitude")
    @classmethod
    def _lon(cls, v: float) -> float:
        if not -180 <= v <= 180:
            raise ValueError("longitude out of range")
        return v

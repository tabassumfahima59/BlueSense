"""Shared contract. Field names are camelCase on the wire and must match frontend/lib/types/contract.ts."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Provenance = Literal["observed", "historical", "predicted", "estimated", "simulated"]
# P3: what a value is (master prompt rule 1) and how current its source is (computed when read)
DataKind = Literal["observed", "model_current", "forecast", "reanalysis", "satellite_monthly", "satellite_historical",
                   "statistic", "derived", "prediction", "scenario", "conceptual", "reference"]
DataStatus = Literal["fresh", "stale", "unavailable", "not_configured"]
SpatialLevel = Literal["point", "division", "national", "regional", "grid", "mixed"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Interval(Model):
    low: float
    high: float


class Measure(Model):
    value: float | None
    unit: str
    provenance: Provenance  # legacy label, kept until the UI moves to dataKind (P4/M1)
    isSample: bool = False  # legacy, always False since P2
    sourceId: str | None = None
    asOf: str | None = None
    uncertainty: Interval | None = None
    # P3 measurement-level metadata (D4); filled by the new endpoints
    dataKind: DataKind | None = None
    status: DataStatus | None = None
    observedAt: str | None = None
    retrievedAt: str | None = None
    spatialLevel: SpatialLevel | None = None
    referenceYear: int | None = None
    note: str | None = None


class Region(Model):
    id: str
    name: str
    nameBn: str | None = None
    level: Literal["country", "division", "district"]
    centroid: tuple[float, float]
    parentId: str | None = None


class ScenarioParams(Model):
    """Absent parameters = baseline. Ranges follow the specification's slider ranges."""
    rainfallChangePct: float = Field(0.0, ge=-50, le=50)
    temperatureChangeC: float = Field(0.0, ge=-2, le=4)
    demandChangePct: float = Field(0.0, ge=-30, le=50)
    groundwaterAvailabilityPct: float = Field(0.0, ge=-50, le=20)
    irrigationEfficiency: float | None = Field(None, ge=0.30, le=0.90)
    pipelineLossPct: float | None = Field(None, ge=0, le=50)

    def is_baseline(self) -> bool:
        return (
            self.rainfallChangePct == 0 and self.temperatureChangeC == 0 and self.demandChangePct == 0
            and self.groundwaterAvailabilityPct == 0 and self.irrigationEfficiency is None
            and self.pipelineLossPct is None
        )


class Source(Model):
    id: str
    name: str
    url: str
    license: str
    spatialResolution: str
    temporalResolution: str
    retrievedAt: str
    notes: str


class ApiError(Model):
    detail: str


class SeriesPoint(Model):
    t: str
    v: Measure


class Series(Model):
    id: str
    label: str
    points: list[SeriesPoint]


class StatusResponse(Model):
    status: Literal["ok", "degraded"]
    sampleMode: bool
    dataFreshness: dict[str, str | None]
    llmEnabled: bool
    version: str


class RegionsResponse(Model):
    country: Region
    divisions: list[Region]
    districts: list[Region]


class ParameterRow(Model):
    key: str
    value: str
    unit: str
    source: str
    assumption: bool
    note: str | None = None


class SourcesResponse(Model):
    sources: list[Source]
    parameters: list[ParameterRow]


class RuleTrace(Model):
    """Shows exactly why a classification or alert fired."""
    rule: str
    inputs: dict[str, Measure]


class RiskClass(Model):
    label: str
    level: int = Field(ge=0, le=4)
    provenance: Provenance
    rule: RuleTrace

    @model_validator(mode="after")
    def _label_known(self) -> "RiskClass":
        if not self.label:
            raise ValueError("risk label required")
        return self

"""P3 contract: ``{ data, meta }`` envelope and the data models of the new endpoints.

``meta`` keys follow the master prompt (snake_case). ``source``, ``data_kind`` and ``attribution`` are lists because
one response can combine sources (Deviation D4); ``status`` is the least current status among them. Every numeric
value additionally carries its own metadata in ``Measure`` (camelCase, like the rest of the contract).
"""
from __future__ import annotations

from typing import Generic, Literal, TypeVar

from pydantic import Field

from .common import DataKind, DataStatus, Measure, Model, ScenarioParams, SpatialLevel
from .modules import AlertsResponse, BudgetResponse, ScenarioResponse

T = TypeVar("T")


class Meta(Model):
    source: list[str]
    data_kind: list[DataKind]
    observed_at: str | None = None
    retrieved_at: str | None = None
    unit: str | None = None
    spatial_level: SpatialLevel
    status: DataStatus
    attribution: list[str]
    note: str | None = None


class Envelope(Model, Generic[T]):
    data: T
    meta: Meta


class RegionRef(Model):
    id: str
    name: str
    level: Literal["country", "division"]


# ---------------------------------------------------------------- weather

class WeatherCurrent(Model):
    region: RegionRef
    validTime: str | None
    timezone: str
    values: dict[str, Measure]
    points: int = Field(description="weather points combined (8 for the national estimate)")


class SeriesValues(Model):
    variable: str
    label: str
    unit: str
    t: list[str]
    v: list[float | None]


class WeatherSeries(Model):
    region: RegionRef
    step: Literal["hourly", "daily", "monthly"]
    timezone: str
    start: str | None
    end: str | None
    series: list[SeriesValues]
    normals: list[SeriesValues] = Field(default_factory=list,
                                        description="1991-2020 monthly normals aligned to the series months")


# ---------------------------------------------------------------- water

class StatValue(Model):
    key: str
    label: str
    value: Measure
    previous: Measure | None = None
    change: Measure | None = None


class WaterAvailability(Model):
    region: RegionRef
    nationalOnly: bool
    renewable: list[StatValue]
    storage: Measure | None
    storageTrend: Measure | None


class ScarcityIndicator(Model):
    key: str
    label: str
    value: Measure
    classLabel: str | None = None
    classLevel: int | None = None
    method: str


class WaterScarcity(Model):
    region: RegionRef
    statistics: list[ScarcityIndicator] = Field(description="national statistics (AQUASTAT); never per division")
    weather: list[ScarcityIndicator] = Field(description="weather-derived indicators at the selected level")
    note: str | None = None


class GroundwaterPoint(Model):
    t: str
    v: float


class GridCell(Model):
    id: str
    lat: float
    lon: float
    v: float


class GroundwaterTrends(Model):
    region: RegionRef
    quantity: str
    series: list[GroundwaterPoint]
    latest: Measure | None
    sameMonthLastYear: Measure | None
    change: Measure | None
    trend: Measure | None
    trendMethod: str | None
    cells: list[GridCell] = []
    cellsPeriod: str | None = None
    resolutionNote: str


# ---------------------------------------------------------------- dashboard

class Kpi(Model):
    key: str
    label: str
    value: Measure
    comparison: Measure | None = None
    comparisonLabel: str | None = None
    classLabel: str | None = None
    formula: str
    context: list[Measure] = []
    note: str | None = None


class Insight(Model):
    key: str
    text: str
    dataKind: DataKind
    sources: list[str]
    observedAt: str | None
    status: DataStatus


class DashboardSummary(Model):
    region: RegionRef
    kpis: list[Kpi]
    openAlerts: int
    insights: list[Insight] = Field(default_factory=list)


# ---------------------------------------------------------------- division indicators (map, regional table)

class IndicatorClass(Model):
    label: str
    min: float | None
    max: float | None
    tone: int = Field(ge=-3, le=3, description="-3 driest / most need ... +3 wettest; 0 neutral")


class IndicatorDef(Model):
    key: str
    label: str
    unit: str
    dataKind: DataKind
    sourceId: str
    method: str
    classSource: str | None
    assumption: bool
    classes: list[IndicatorClass]


class DivisionRow(Model):
    id: str
    name: str
    values: dict[str, Measure]
    classes: dict[str, IndicatorClass | None]


class DivisionIndicators(Model):
    indicators: list[IndicatorDef]
    divisions: list[DivisionRow]
    national: DivisionRow
    note: str


# ---------------------------------------------------------------- AQUASTAT history by reference year

class StatSeries(Model):
    code: str
    key: str
    label: str
    unit: str
    points: list[Measure]


class StatHistory(Model):
    series: list[StatSeries]
    note: str


# ---------------------------------------------------------------- predictions

class PredictionPoint(Model):
    horizon: int
    issuedMonth: str
    targetMonth: str
    value: Measure
    normal: Measure
    z: Measure
    drynessClass: str | None


class Predictions(Model):
    region: RegionRef
    category: str
    target: str
    horizon: int
    history: SeriesValues
    forecast: PredictionPoint | None
    allHorizons: list[PredictionPoint]
    model: dict[str, str | int | float | None]
    storage: Literal["database", "artifact"]


# ---------------------------------------------------------------- water budget (national AQUASTAT mode)

class BudgetNode(Model):
    id: str
    label: str
    value: Measure
    kind: Literal["source", "total", "use", "remainder"] = "use"
    code: str | None = None  # AQUASTAT variable code
    indicator: str | None = None  # AQUASTAT indicator name


class BudgetLink(Model):
    source: str
    target: str
    value: Measure


class BudgetHistory(Model):
    """Genuine AQUASTAT reference years of one budget part (imputed values excluded, never interpolated)."""
    id: str
    label: str
    code: str
    unit: str
    points: list[Measure]


class NationalBudget(Model):
    nodes: list[BudgetNode]
    links: list[BudgetLink]
    referenceYears: list[int]
    mixedReferenceYears: bool
    missing: list[str]
    notes: list[str]
    history: list[BudgetHistory]
    comparisonYears: list[int]  # years with at least one genuine budget value


class WaterBudget(Model):
    mode: Literal["national", "derived"]
    region: RegionRef
    national: NationalBudget | None = None
    derived: BudgetResponse | None = None


class WhatIfBody(Model):
    region: str = "bd"
    params: ScenarioParams = Field(default_factory=ScenarioParams)
    basis: Literal["latest", "normal"] = "latest"


class WhatIf(Model):
    region: RegionRef
    result: ScenarioResponse
    basis: Literal["latest", "normal"] = "normal"
    basisPeriod: str | None = None
    method: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------- alerts, search, data, refresh

class StoredAlert(Model):
    id: int
    ruleId: str
    regionId: str
    regionName: str
    severity: Literal["info", "low", "medium", "high", "critical"]
    title: str
    message: str
    indicator: str
    value: Measure
    threshold: Measure
    basis: str | None
    dataKind: DataKind
    isPrediction: bool
    sourceId: str | None
    thresholdSource: str | None
    observedAt: str | None
    createdAt: str
    updatedAt: str | None
    resolvedAt: str | None
    read: bool


class AlertsList(Model):
    alerts: list[StoredAlert]
    counts: dict[str, int]


class AlertsResponseV2(AlertsResponse):
    """Legacy fields (``context``, ``alerts``: computed per request, scenario-aware) are kept for the current UI;
    ``data``/``meta`` carry the stored, rule-engine alerts (P3)."""
    data: AlertsList
    meta: Meta


class ReadRequest(Model):
    clientId: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class ReadResult(Model):
    alertId: int
    read: bool


class SearchItem(Model):
    type: Literal["region", "module", "indicator", "source", "alert"]
    id: str
    label: str
    description: str
    href: str


class SearchResults(Model):
    query: str
    items: list[SearchItem]


class SourceStatus(Model):
    id: str
    name: str
    url: str
    licence: str
    attribution: str
    cadence: str
    cadenceSeconds: int | None
    dataKind: DataKind
    spatialLevel: str
    scheduled: bool
    status: DataStatus
    retrievedAt: str | None
    lastSuccessAt: str | None
    lastAttemptAt: str | None
    lastAttemptStatus: str | None
    lastError: str | None
    latestObservation: str | None
    note: str | None


class LastUpdated(Model):
    sources: list[SourceStatus]
    latestRetrievedAt: str | None
    overallStatus: DataStatus


class RefreshResult(Model):
    result: Literal["up_to_date", "refreshed", "partial", "failed"]
    message: str
    jobs: list[dict]


class SyncResult(Model):
    job: str
    status: str
    runId: int | None
    inserted: int
    updated: int
    skipped: int
    okUnits: int
    errors: list[str]
    reason: str | None

"""Schemas of the Water Explorer spatial intelligence endpoints (/api/explorer/*)."""
from __future__ import annotations

from typing import Literal

from .common import Measure, Model


class ExplorerRegion(Model):
    id: str
    name: str
    level: Literal["national", "division"]


class Evidence(Model):
    label: str
    measure: Measure


class Finding(Model):
    id: str
    topic: str
    text: str
    kind: str
    tone: Literal["good", "neutral", "warn", "bad"]
    evidence: list[Evidence]


class Last12(Model):
    start: str
    end: str
    rain: float
    rainNormal: float
    rainDeparturePct: float | None
    tmean: float
    tmeanNormal: float
    tmeanAnomaly: float


class RiskInfo(Model):
    label: str
    level: int
    stressClass: str
    stressLevel: int
    drynessClass: str | None
    drynessLevel: int
    driver: Literal["stress", "dryness", "both", "none"]
    dryStressRatio: float
    z: float | None
    targetMonth: str | None
    rule: str
    isSample: bool


class ResolutionRow(Model):
    layer: str
    spatial: str
    temporal: str
    status: str


class GraceQuality(Model):
    first: str | None = None
    last: str | None = None
    months: int | None = None
    missingMonths: int | None = None
    longestGap: list[str | int] | None = None
    baseline: str | None = None
    release: str | None = None
    uncertaintyStored: bool | None = None


class DataQuality(Model):
    weatherMonths: int
    weatherIncompleteMonths: int
    weatherFirst: str | None
    weatherLast: str | None
    completeYears: int
    grace: GraceQuality
    sources: dict[str, str]
    resolution: list[ResolutionRow]


class RegionProfile(Model):
    area: Measure
    population: Measure
    districts: int


class RegionIntel(Model):
    region: ExplorerRegion
    profile: RegionProfile
    current: dict[str, Measure]
    last12: Last12 | None
    risk: RiskInfo
    findings: list[Finding]
    summary: str
    suggestions: list[str]
    quality: DataQuality
    limitations: list[str]
    graceAvailable: bool


class OverviewRow(Model):
    id: str
    name: str
    level: Literal["national", "division"]
    area: float | None
    population: float | None
    districts: int
    last12: Last12 | None
    risk: RiskInfo
    drynessZ: float | None
    drynessAt: str | None
    drynessClass: str | None
    tempNow: float | None
    tempNowAt: str | None


class ExplorerOverview(Model):
    rows: list[OverviewRow]
    normal: str
    notes: list[str]


class PeriodStats(Model):
    start: int
    end: int
    yearsExpected: int
    yearsComplete: int
    missingYears: list[int]
    rain: float | None
    tmean: float | None
    pet: float | None
    graceMonths: int
    graceMonthsExpected: int
    grace: float | None


class PeriodChange(Model):
    rain: float | None
    rainPct: float | None
    tmean: float | None
    pet: float | None
    grace: float | None


class PeriodComparison(Model):
    region: ExplorerRegion
    a: PeriodStats
    b: PeriodStats
    change: PeriodChange
    notes: list[str]


class Trend(Model):
    slope: float
    low: float
    high: float
    n: int
    start: int
    end: int
    clear: bool


class MonthRow(Model):
    t: str
    rain: float | None
    rainNormal: float | None
    tmean: float | None
    tmeanNormal: float | None
    pet: float | None
    complete: bool


class YearRow(Model):
    year: int
    complete: bool
    rain: float | None
    tmean: float | None
    pet: float | None


class GraceMonth(Model):
    t: str
    v: float | None


class ExplorerSeries(Model):
    region: ExplorerRegion
    monthly: list[MonthRow]
    annual: list[YearRow]
    rainTrend: Trend | None
    tempTrend: Trend | None
    grace: list[GraceMonth]
    graceTrendCmPerYr: float | None
    graceTrendCi95: list[float] | None
    graceTrendPeriod: str | None

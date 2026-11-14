"""Response/request models per module. TypeScript types are generated from the OpenAPI spec
(frontend/lib/types/api.d.ts via `npm run gen:api`), so the wire contract is defined once, here."""
from __future__ import annotations

from typing import Literal

from pydantic import Field

from .common import DataKind, DataStatus, Measure, Model, Region, RiskClass, ScenarioParams, Series

Sector = Literal["agriculture", "domestic", "industry", "environment"]


class SectorValues(Model):
    agriculture: Measure
    domestic: Measure
    industry: Measure
    environment: Measure


class Context(Model):
    region: Region
    scopeNote: str
    scenario: ScenarioParams
    scenarioActive: bool
    sampleData: bool


# ---------------------------------------------------------------- overview / alerts

class Rainfall30d(Model):
    total: Measure
    normal: Measure
    anomalyPct: Measure
    window: str


class OverviewKpis(Model):
    availability: Measure
    usableAvailability: Measure
    demand: Measure
    dryAvailability: Measure
    dryDemand: Measure
    stressRatio: Measure
    stressClass: str
    dryStressRatio: Measure
    dryStressClass: str
    scarcityRisk: RiskClass
    groundwaterTrend: Measure
    rainfall30d: Rainfall30d | None
    distributionEfficiency: Measure
    unmetDry: Measure


class MonthlyBalancePoint(Model):
    month: int
    supply: Measure
    usableSupply: Measure
    consumptiveDemand: Measure
    environment: Measure
    unmet: Measure


class RegionalRow(Model):
    regionId: str
    name: str
    availability: Measure
    demand: Measure
    stressRatio: Measure
    dryStressRatio: Measure
    risk: str
    riskLevel: int


class ValidationCheck(Model):
    label: str
    model: Measure
    reference: Measure
    note: str


class OverviewResponse(Model):
    context: Context
    kpis: OverviewKpis
    monthly: list[MonthlyBalancePoint]
    sectors: SectorValues
    regional: list[RegionalRow]
    trends: list[Series]
    validation: list[ValidationCheck]


class Alert(Model):
    id: str
    severity: Literal["critical", "warning", "info"]
    title: str
    message: str
    recommendation: str
    rule: str
    inputs: dict[str, Measure]
    module: str


class AlertsResponse(Model):
    context: Context
    alerts: list[Alert]


# ---------------------------------------------------------------- map

class LayerInfo(Model):
    id: str
    label: str
    provenance: str
    sourceIds: list[str]
    description: str


class RegionValues(Model):
    regionId: str
    name: str
    level: str
    divisionId: str
    annualRainfall: Measure
    forecastD: Measure
    forecastZ: Measure
    stressRatio: Measure
    dryStressRatio: Measure
    risk: str
    riskLevel: int
    population: Measure
    area: Measure


class MapLayersResponse(Model):
    context: Context
    divisions: dict
    districts: dict
    values: dict[str, RegionValues]
    layers: list[LayerInfo]
    graceTrend: Measure
    forecastTargetMonth: str | None


# ---------------------------------------------------------------- weather

class WeatherResponse(Model):
    context: Context
    agg: Literal["daily", "monthly"]
    series: list[Series]


# ---------------------------------------------------------------- predictions

class ForecastPoint(Model):
    horizon: int
    issuedMonth: str
    targetMonth: str
    value: Measure
    normal: Measure
    z: Measure
    drynessClass: str | None


class TestPoint(Model):
    t: str
    actual: Measure
    predicted: Measure


class ScarcityResponse(Model):
    context: Context
    horizon: int
    target: str
    history: Series
    test: list[TestPoint]
    forecast: ForecastPoint | None
    allHorizons: list[ForecastPoint]
    risk: RiskClass | None
    summary: str
    model: dict
    limitations: list[str]
    available: bool


class DemandYear(Model):
    year: int
    population: Measure
    agriculture: Measure
    domestic: Measure
    industry: Measure
    total: Measure


class DemandResponse(Model):
    context: Context
    method: str
    years: list[DemandYear]
    limitations: list[str]


class GroundwaterResponse(Model):
    context: Context
    available: bool
    series: Series | None
    deseasonalised: Series | None
    projection: Series | None
    trend: Measure | None
    method: str | None
    note: str
    instructions: str | None


class MetricsResponse(Model):
    evaluated: bool
    metrics: dict | None
    trainedAt: str | None
    dataPeriod: str | None
    split: str | None
    samples: dict | None


class ShapResponse(Model):
    available: bool
    horizon: int
    model: str | None
    globalImportance: list[dict]
    local: dict | None
    localNote: str


# ---------------------------------------------------------------- flow

class FlowRequest(Model):
    pumpFlowM3s: float = Field(0.5, gt=0, le=2.0)
    setpointM: float = Field(45.0, ge=5, le=100)
    leaks: dict[str, float] = Field(default_factory=dict)
    lossPct: float | None = Field(None, ge=0, le=50)
    leakageExponent: float | None = Field(None, ge=0.5, le=1.5)
    optimize: bool = False
    # operating controls (all optional; omitted = the normal operating point)
    pumpOn: bool = True
    pumpCapacityM3s: float | None = Field(None, gt=0, le=3.0)
    sourceLimitM3s: float | None = Field(None, ge=0, le=3.0, description="water available at the source (shortage)")
    allocationPct: dict[str, float] | None = Field(None, description="destination -> % of the junction flow (sum 100)")
    closedPipes: list[str] = Field(default_factory=list, max_length=10)
    demandFactors: dict[str, float] | None = Field(None, description="destination -> demand multiplier (0-3)")


class PipeState(Model):
    id: str
    fromNode: str
    toNode: str
    flow: Measure
    velocity: Measure
    headLoss: Measure
    pressureStart: Measure
    pressureEnd: Measure
    pressureEndKpa: Measure
    leak: Measure
    burstSeverity: float
    kind: Literal["main", "branch"]
    status: Literal["open", "closed", "leaking"]
    lengthM: float
    diameterM: float
    flowDaily: Measure
    leakDaily: Measure


class DestinationState(Model):
    id: str
    delivered: Measure
    deliveredDaily: Measure
    pressure: Measure
    minServicePressure: Measure
    serviceOk: bool
    demandDaily: Measure
    allocatedDaily: Measure
    share: Measure                 # % of the junction flow allocated to this destination
    supply: Measure                # delivered / demand, % (value null when demand is 0)
    status: Literal["served", "under_supplied", "low_pressure", "no_supply", "closed"]


class FlowState(Model):
    pumpFlow: Measure
    setpoint: Measure
    pipes: list[PipeState]
    destinations: list[DestinationState]
    leakTotal: Measure
    deliveredTotal: Measure
    lossPct: Measure
    massBalanceError: Measure
    requestedPumpFlow: Measure
    pumpOn: bool
    pumpCapacity: Measure
    pumpUtilization: Measure
    sourceLimit: Measure | None
    limitingFactor: Literal["pump_off", "valve_closed", "pump_capacity", "source_limit"] | None
    inflowDaily: Measure
    deliveredDaily: Measure
    leakDaily: Measure
    demandDaily: Measure
    supplyBalanceDaily: Measure    # delivered - demand
    accountingResidualDaily: Measure  # inflow - delivered - leakage (storage change not modelled)
    efficiency: Measure            # delivered / inflow, %
    balanceStatus: Literal["balanced", "surplus", "deficit"]
    closedPipes: list[str]


class ScaleItem(Model):
    """A real national magnitude shown beside the conceptual network for scale (never used by it)."""
    key: str
    label: str
    value: Measure


class FlowResponse(Model):
    state: FlowState
    optimized: FlowState | None
    optimizationNote: str | None
    savings: dict[str, Measure] | None
    backgroundLossRate: Measure
    disclaimer: str
    reservoirCapacity: Measure | None = None
    defaultAllocationPct: dict[str, float] = Field(default_factory=dict)
    label: str = "Conceptual illustration"
    realPartsUsed: list[str] = Field(default_factory=list, description="real data used by the network (none today)")
    scaleContext: list[ScaleItem] = Field(default_factory=list)


# ---------------------------------------------------------------- budget

class SankeyNode(Model):
    id: str
    label: str
    kind: Literal["source", "pool", "sector", "loss", "storage"]


class SankeyLink(Model):
    source: str
    target: str
    value: Measure


class SectorRow(Model):
    sector: Sector
    demand: Measure
    allocation: Measure
    delivered: Measure
    unmet: Measure
    share: Measure


class BudgetState(Model):
    nodes: list[SankeyNode]
    links: list[SankeyLink]
    supply: Measure
    surface: Measure
    groundwater: Measure
    losses: Measure
    storageChange: Measure
    unmetTotal: Measure
    sectors: list[SectorRow]
    balanceError: Measure
    balanced: bool


class BudgetResponse(Model):
    context: Context
    period: str
    periodLabel: str
    current: BudgetState
    notes: list[str]


class OptimizeRequest(Model):
    region: str = "bd"
    period: str = "dry"
    scenario: ScenarioParams = Field(default_factory=ScenarioParams)
    mode: Literal["optimized", "shares"] = "optimized"
    shares: dict[str, float] | None = None


class OptimizeResponse(Model):
    context: Context
    period: str
    current: BudgetState
    proposed: BudgetState
    savings: dict[str, Measure]
    method: str


# ---------------------------------------------------------------- scenario

class ScenarioRequest(Model):
    region: str = "bd"
    params: ScenarioParams = Field(default_factory=ScenarioParams)


class Compare(Model):
    key: str
    label: str
    baseline: Measure
    simulated: Measure
    change: Measure


class ScenarioResponse(Model):
    context: Context
    comparisons: list[Compare]
    sectorDemand: list[Compare]
    allocation: list[Compare]
    riskBaseline: RiskClass | None
    riskSimulated: RiskClass | None
    monthlyBaseline: list[MonthlyBalancePoint]
    monthlySimulated: list[MonthlyBalancePoint]
    summary: str


# ---------------------------------------------------------------- irrigation

class IrrigationRequest(Model):
    crop: str
    region: str | None = None
    lat: float | None = Field(None, ge=20.5, le=26.7)
    lon: float | None = Field(None, ge=88.0, le=92.7)
    soil: str = "silty_clay_loam"
    plantingDate: str | None = None
    stage: Literal["initial", "development", "mid-season", "late season"] | None = None
    areaHa: float = Field(1.0, gt=0, le=100000)
    efficiency: float | None = Field(None, ge=0.3, le=0.95)
    temperatureOverrideC: float | None = Field(None, ge=-5, le=5)
    rainfallOverrideMm: float | None = Field(None, ge=0, le=2000)


class AssumptionRow(Model):
    key: str
    value: str
    unit: str
    source: str
    assumption: bool


class WhyItem(Model):
    label: str
    value: str
    source: str
    dataKind: DataKind
    observedAt: str | None = None
    retrievedAt: str | None = None
    age: str | None = None
    status: DataStatus | None = None


class IrrigationResponse(Model):
    crop: str
    cropLabel: str
    location: dict
    weatherMode: str
    weatherRetrievedAt: str | None
    sampleData: bool
    period: str
    stage: str
    daysSincePlanting: int
    inSeason: bool
    et0: Measure
    kc: Measure
    etc: Measure
    rainfall: Measure
    effectiveRainfall: Measure
    riceExtra: Measure
    netRequirementMm: Measure
    grossRequirementMm: Measure
    netRequirementM3: Measure
    grossRequirementM3: Measure
    taw: Measure
    raw: Measure
    trigger: Measure
    startDepletion: Measure
    startBasis: str
    soilMoisture: Measure
    nextIrrigationDate: str | None
    interval: Measure
    perIrrigationGrossMm: Measure
    perIrrigationGrossM3: Measure
    daily: list[dict]
    recommendations: list[str]
    assumptions: list[AssumptionRow]
    note: str
    # M2: why the estimate is what it is (each input with its source and age), conditions and data completeness
    why: list[WhyItem] = Field(default_factory=list)
    context: list[WhyItem] = Field(default_factory=list)
    forecastStatus: DataStatus | None = None
    pointId: str | None = None
    missingDays: list[str] = Field(default_factory=list)
    windowNote: str | None = None



# ---------------------------------------------------------------- copilot

class ChatTurn(Model):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class CopilotMapContext(Model):
    """What the user is looking at in the Water Explorer (validated app context, not instructions)."""
    page: Literal["explorer"]
    kind: Literal["national", "division", "district", "weather_point", "grace_cell", "river", "water"]
    name: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9 .,'&()°/\-–]+$")


class CopilotRequest(Model):
    message: str = Field(min_length=1, max_length=2000)
    region: str = "bd"
    context: CopilotMapContext | None = None
    scenario: ScenarioParams = Field(default_factory=ScenarioParams)
    history: list[ChatTurn] = Field(default_factory=list, max_length=12)
    clientId: str | None = Field(None, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class CopilotReference(Model):
    module: str
    label: str
    measure: Measure | None = None


class CopilotToolCall(Model):
    name: str
    module: str | None = None
    status: Literal["running", "done", "error"]
    input: dict | None = None
    dataKind: list[str] | None = None
    source: list[str] | None = None
    observedAt: str | None = None
    ms: int | None = None


class CopilotResponse(Model):
    answer: str
    mode: Literal["llm", "fallback"]  # "fallback" is no longer produced (M8: no canned answers)
    references: list[CopilotReference]
    intent: str
    tools: list[CopilotToolCall] = Field(default_factory=list)
    unverifiedNumbers: list[float] = Field(default_factory=list)


class CopilotToolInfo(Model):
    name: str
    description: str
    module: str


class CopilotLimits(Model):
    perMinute: int
    perDay: int
    siteModelCallsPerDay: int
    siteModelCallsUsedToday: int
    maxConcurrent: int
    maxModelCallsPerQuestion: int
    resetsAt: str


class CopilotStatus(Model):
    status: Literal["ready", "not_configured"]
    provider: str
    providerLabel: str
    model: str
    reason: str | None
    disclosure: str | None = None   # how the external provider processes questions (shown before use)
    policyUrl: str | None = None
    readOnly: bool = True
    tools: list[CopilotToolInfo]
    rateLimitPerMin: int
    limits: CopilotLimits
    streaming: bool = True

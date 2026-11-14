/**
 * Shared contract types. Generated from the FastAPI OpenAPI spec (lib/types/api.d.ts, `npm run gen:api`),
 * so they match the Pydantic models field for field. Do not hand-edit api.d.ts.
 */
import type { components } from "./api";

type S = components["schemas"];

export type Measure = S["Measure"];
export type Provenance = Measure["provenance"];
export type Region = S["Region"];
export type ScenarioParams = S["ScenarioParams"];
export type Source = S["Source"];
export type Series = S["Series"];
export type RiskClass = S["RiskClass"];
export type Context = S["Context"];

export type StatusResponse = S["StatusResponse"];
export type RegionsResponse = S["RegionsResponse"];
export type SourcesResponse = S["SourcesResponse"];
export type OverviewResponse = S["OverviewResponse"];
// P3: /api/alerts returns the legacy fields plus stored alerts (`data`) and `meta`.
export type AlertsResponse = S["AlertsResponseV2"];
export type StoredAlert = S["StoredAlert"];
export type Meta = S["Meta"];
export type DataKind = NonNullable<Measure["dataKind"]>;
export type DataStatus = NonNullable<Measure["status"]>;
export type Alert = S["Alert"];
export type MapLayersResponse = S["MapLayersResponse"];
export type RegionValues = S["RegionValues"];
export type WeatherResponse = S["WeatherResponse"];
export type ScarcityResponse = S["ScarcityResponse"];
export type DemandResponse = S["DemandResponse"];
export type GroundwaterResponse = S["GroundwaterResponse"];
export type MetricsResponse = S["MetricsResponse"];
export type ShapResponse = S["ShapResponse"];
export type FlowRequest = S["FlowRequest"];
export type FlowResponse = S["FlowResponse"];
export type FlowState = S["FlowState"];
export type BudgetResponse = S["BudgetResponse"];
export type BudgetState = S["BudgetState"];
export type OptimizeRequest = S["OptimizeRequest"];
export type OptimizeResponse = S["OptimizeResponse"];
export type ScenarioRequest = S["ScenarioRequest"];
export type ScenarioResponse = S["ScenarioResponse"];
export type Compare = S["Compare"];
export type MonthlyBalancePoint = S["MonthlyBalancePoint"];
export type IrrigationRequest = S["IrrigationRequest"];
export type IrrigationResponse = S["IrrigationResponse"];
export type CopilotRequest = S["CopilotRequest"];
export type CopilotResponse = S["CopilotResponse"];
export type ChatTurn = S["ChatTurn"];

// P3 envelope endpoints
/** `{ data, meta }` returned by the P3 endpoints (generated as Envelope_<Name>_ in api.d.ts). */
export interface Envelope<T> {
  data: T;
  meta: Meta;
}
export type SearchResults = S["SearchResults"];
export type SearchItem = S["SearchItem"];
export type SourceStatus = S["SourceStatus"];
export type LastUpdated = S["LastUpdated"];
export type RefreshResult = S["RefreshResult"];
export type ReadResult = S["ReadResult"];
// M1 Command Center
export type DashboardSummary = S["DashboardSummary"];
export type Kpi = S["Kpi"];
export type Insight = S["Insight"];
export type DivisionIndicators = S["DivisionIndicators"];
export type IndicatorDef = S["IndicatorDef"];
export type IndicatorClass = S["IndicatorClass"];
export type DivisionRow = S["DivisionRow"];
export type StatHistory = S["StatHistory"];
export type StatSeries = S["StatSeries"];
export type WeatherSeries = S["WeatherSeries"];
export type SeriesValues = S["SeriesValues"];
export type GroundwaterTrends = S["GroundwaterTrends"];
export type WhatIf = S["WhatIf"];
// M4 Water Budget
export type WaterBudget = S["WaterBudget"];
export type NationalBudget = S["NationalBudget"];
export type BudgetNode = S["BudgetNode"];
export type BudgetHistory = S["BudgetHistory"];
// M5 Prediction Lab
export type Predictions = S["Predictions"];
export type PredictionPoint = S["PredictionPoint"];
export type PredictionCategory = S["PredictionCategory"];

/** Scenario with every field explicit; `null` efficiency/loss = use the baseline from config. */
export interface Scenario {
  rainfallChangePct: number;
  temperatureChangeC: number;
  demandChangePct: number;
  agriculturalDemandChangePct: number;
  groundwaterAvailabilityPct: number;
  irrigationEfficiency: number | null;
  pipelineLossPct: number | null;
}

export const BASELINE: Scenario = {
  rainfallChangePct: 0,
  temperatureChangeC: 0,
  demandChangePct: 0,
  agriculturalDemandChangePct: 0,
  groundwaterAvailabilityPct: 0,
  irrigationEfficiency: null,
  pipelineLossPct: null,
};

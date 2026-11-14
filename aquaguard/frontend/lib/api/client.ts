/**
 * Typed API client. The browser talks only to the AquaGuard backend (NEXT_PUBLIC_API_URL). There is no mock or
 * sample mode (decision 5): when the API is unavailable, views show their error state.
 */
import { scenarioQuery } from "../store/scenario";
import type {
  AlertsResponse, BudgetResponse, DashboardSummary, WhatIf, WaterBudget, Predictions, DivisionIndicators, GroundwaterTrends, StatHistory, WeatherSeries, CopilotRequest, CopilotResponse, DemandResponse, Envelope, FlowRequest, FlowResponse,
  GroundwaterResponse, IrrigationRequest, IrrigationResponse, LastUpdated, MapLayersResponse, MetricsResponse,
  OptimizeRequest, OptimizeResponse, OverviewResponse, ReadResult, RefreshResult, RegionsResponse, Scenario,
  ScarcityResponse, ScenarioRequest, ScenarioResponse, SearchResults, ShapResponse, SourceStatus, SourcesResponse,
  StatusResponse, WeatherResponse,
} from "../types/contract";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public retryAfter?: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, init);
  } catch {
    throw new ApiError(0, "Cannot reach the AquaGuard API. Check that the backend is running and reachable.", "network");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const j = await res.json();
      if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      else if (j?.message) detail = String(j.message);
      code = j?.code;
    } catch {
      /* non-JSON error body */
    }
    const ra = Number(res.headers.get("Retry-After"));
    throw new ApiError(res.status, detail, code, Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const q = (region: string, s?: Scenario, extra: Record<string, string | number> = {}) => {
  const p = new URLSearchParams({ region, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
  const sq = s ? scenarioQuery(s) : "";
  return `?${p.toString()}${sq ? `&${sq}` : ""}`;
};

export const api = {
  health: () => request<StatusResponse>("/health"),
  regions: () => request<RegionsResponse>("/regions"),
  sources: () => request<SourcesResponse>("/sources"),
  overview: (region: string, s: Scenario) => request<OverviewResponse>(`/overview${q(region, s)}`),
  alerts: (region: string, s: Scenario, clientId?: string) =>
    request<AlertsResponse>(`/alerts${q(region, s, clientId ? { clientId } : {})}`),
  mapLayers: (region: string, s: Scenario) => request<MapLayersResponse>(`/map/layers${q(region, s)}`),
  weather: (region: string, start: string, agg: "daily" | "monthly") =>
    request<WeatherResponse>(`/weather${q(region, undefined, { start, agg })}`),
  scarcity: (region: string, horizon: number, s: Scenario) =>
    request<ScarcityResponse>(`/predictions/scarcity${q(region, s, { horizon })}`),
  demand: (region: string, s: Scenario) => request<DemandResponse>(`/predictions/demand${q(region, s)}`),
  groundwater: (region: string) => request<GroundwaterResponse>(`/predictions/groundwater${q(region)}`),
  metrics: () => request<MetricsResponse>("/models/metrics"),
  shap: (region: string, horizon: number) => request<ShapResponse>(`/models/shap${q(region, undefined, { horizon })}`),
  flow: (body: FlowRequest) => post<FlowResponse>("/flow/simulate", body),
  budget: (region: string, period: string, s: Scenario) => request<BudgetResponse>(`/budget${q(region, s, { period })}`),
  optimize: (body: OptimizeRequest) => post<OptimizeResponse>("/budget/optimize", body),
  scenario: (body: ScenarioRequest) => post<ScenarioResponse>("/scenario/run", body),
  whatif: (body: ScenarioRequest & { basis: "latest" | "normal" }) => post<Envelope<WhatIf>>("/whatif", body),
  irrigation: (body: IrrigationRequest) => post<IrrigationResponse>("/irrigation/estimate", body),
  copilot: (body: CopilotRequest) => post<CopilotResponse>("/copilot/chat", body),
  // P3 platform endpoints used by the shell
  search: (query: string, limit = 12) =>
    request<Envelope<SearchResults>>(`/search?${new URLSearchParams({ q: query, limit: String(limit) })}`),
  dataSources: () => request<Envelope<SourceStatus[]>>("/data/sources"),
  lastUpdated: () => request<Envelope<LastUpdated>>("/data/last-updated"),
  refresh: () => post<Envelope<RefreshResult>>("/refresh"),
  markRead: (alertId: number, clientId: string) => post<Envelope<ReadResult>>(`/alerts/${alertId}/read`, { clientId }),
  // M1 Command Center
  dashboard: (region: string, targetEfficiency?: number) =>
    request<Envelope<DashboardSummary>>(`/dashboard/summary?${new URLSearchParams({ region, ...(targetEfficiency ? { targetEfficiency: String(targetEfficiency) } : {}) })}`),
  divisions: () => request<Envelope<DivisionIndicators>>("/water/scarcity/divisions"),
  waterHistory: (codes: number[], region = "bd") =>
    request<Envelope<StatHistory>>(`/water/history?${new URLSearchParams({ codes: codes.join(","), region })}`),
  weatherHistory: (region: string, opts: { start?: string; end?: string; step?: "daily" | "monthly"; normals?: boolean } = {}) =>
    request<Envelope<WeatherSeries>>(`/weather/history?${new URLSearchParams({
      region, step: opts.step ?? "monthly",
      ...(opts.start ? { start: opts.start } : {}), ...(opts.end ? { end: opts.end } : {}),
      ...(opts.normals ? { normals: "true" } : {}) })}`),
  groundwaterTrends: (region: string, start?: string) =>
    request<Envelope<GroundwaterTrends>>(`/groundwater/trends?${new URLSearchParams({ region, ...(start ? { start } : {}) })}`),
  geo: (level: "divisions" | "districts") => request<GeoJSON.FeatureCollection>(`/geo/${level}`),
  // M4 Water Budget
  waterBudget: (mode: "national" | "derived", opts: { region?: string; period?: string; scenario?: Scenario } = {}) =>
    request<Envelope<WaterBudget>>(`/water-budget${q(opts.region ?? "bd", opts.scenario, { mode, ...(opts.period ? { period: opts.period } : {}) })}`),
  // M5 Prediction Lab
  predictions: (region: string, horizon: number, category = "water_balance") =>
    request<Envelope<Predictions>>(`/predictions?${new URLSearchParams({ region, horizon: String(horizon), category })}`),
};

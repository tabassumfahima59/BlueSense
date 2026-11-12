/**
 * Typed API client. NEXT_PUBLIC_API_MODE=mock serves /public/mocks/*.json (Phase-0 mocks captured from the
 * sample snapshot, flagged isSample) so components work without a backend; "live" calls FastAPI.
 */
import { scenarioQuery } from "../store/scenario";
import type {
  AlertsResponse, BudgetResponse, CopilotRequest, CopilotResponse, DemandResponse, FlowRequest, FlowResponse,
  GroundwaterResponse, IrrigationRequest, IrrigationResponse, MapLayersResponse, MetricsResponse, OptimizeRequest,
  OptimizeResponse, OverviewResponse, RegionsResponse, Scenario, ScarcityResponse, ScenarioRequest, ScenarioResponse,
  ShapResponse, SourcesResponse, StatusResponse, WeatherResponse,
} from "../types/contract";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001").replace(/\/$/, "");
export const API_MODE = process.env.NEXT_PUBLIC_API_MODE === "mock" ? "mock" : "live";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, mock: string, init?: RequestInit): Promise<T> {
  const url = API_MODE === "mock" ? `/mocks/${mock}.json` : `${API_BASE}/api${path}`;
  let res: Response;
  try {
    res = await fetch(url, API_MODE === "mock" ? undefined : init);
  } catch {
    throw new ApiError(0, "Cannot reach the AquaGuard API. Check that the backend is running and reachable.");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, mock: string, body: unknown) =>
  request<T>(path, mock, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const q = (region: string, s?: Scenario, extra: Record<string, string | number> = {}) => {
  const p = new URLSearchParams({ region, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
  const sq = s ? scenarioQuery(s) : "";
  return `?${p.toString()}${sq ? `&${sq}` : ""}`;
};

export const api = {
  health: () => request<StatusResponse>("/health", "health"),
  regions: () => request<RegionsResponse>("/regions", "regions"),
  sources: () => request<SourcesResponse>("/sources", "sources"),
  overview: (region: string, s: Scenario) => request<OverviewResponse>(`/overview${q(region, s)}`, "overview"),
  alerts: (region: string, s: Scenario) => request<AlertsResponse>(`/alerts${q(region, s)}`, "alerts"),
  mapLayers: (region: string, s: Scenario) => request<MapLayersResponse>(`/map/layers${q(region, s)}`, "map-layers"),
  weather: (region: string, start: string, agg: "daily" | "monthly") =>
    request<WeatherResponse>(`/weather${q(region, undefined, { start, agg })}`, "weather"),
  scarcity: (region: string, horizon: number, s: Scenario) =>
    request<ScarcityResponse>(`/predictions/scarcity${q(region, s, { horizon })}`, "predictions-scarcity"),
  demand: (region: string, s: Scenario) =>
    request<DemandResponse>(`/predictions/demand${q(region, s)}`, "predictions-demand"),
  groundwater: (region: string) =>
    request<GroundwaterResponse>(`/predictions/groundwater${q(region)}`, "predictions-groundwater"),
  metrics: () => request<MetricsResponse>("/models/metrics", "models-metrics"),
  shap: (region: string, horizon: number) =>
    request<ShapResponse>(`/models/shap${q(region, undefined, { horizon })}`, "models-shap"),
  flow: (body: FlowRequest) => post<FlowResponse>("/flow/simulate", "flow-simulate", body),
  budget: (region: string, period: string, s: Scenario) =>
    request<BudgetResponse>(`/budget${q(region, s, { period })}`, "budget"),
  optimize: (body: OptimizeRequest) => post<OptimizeResponse>("/budget/optimize", "budget-optimize", body),
  scenario: (body: ScenarioRequest) => post<ScenarioResponse>("/scenario/run", "scenario-run", body),
  irrigation: (body: IrrigationRequest) => post<IrrigationResponse>("/irrigation/estimate", "irrigation-estimate", body),
  copilot: (body: CopilotRequest) => post<CopilotResponse>("/copilot/chat", "copilot-chat", body),
};

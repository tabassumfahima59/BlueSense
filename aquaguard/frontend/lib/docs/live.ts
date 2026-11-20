/**
 * Live system view for /docs (server only). Every request goes from the Next.js server to the BlueSense API, so the
 * backend's CORS policy does not apply and no key reaches the browser. Each block fails on its own: an unreachable
 * endpoint shows as "unavailable", never as a made-up value. Responses are cached for 60 s.
 */
import type {
  AlertsResponse, CopilotStatus, Envelope, LastUpdated, MetricsResponse, SourceStatus, StatusResponse,
} from "../types/contract";

const API = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001").replace(/\/$/, "");
const TIMEOUT_MS = 8000;

export type Live<T> = { ok: true; data: T; asOf: string } | { ok: false; error: string; asOf: string };

async function getJson<T>(path: string): Promise<Live<T>> {
  const started = new Date().toISOString();
  try {
    const res = await fetch(`${API}/api${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const date = res.headers.get("date");
    const asOf = date && Number.isFinite(Date.parse(date)) ? new Date(Date.parse(date)).toISOString() : started;
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, asOf };
    return { ok: true, data: (await res.json()) as T, asOf };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timed out" : "unreachable", asOf: started };
  }
}

export interface ApiOperation {
  method: string;
  path: string;
  summary: string;
  group: string;
}

interface OpenApiDoc {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
}

const METHODS = ["get", "post", "put", "patch", "delete"];

export function operationsFromOpenApi(doc: OpenApiDoc): ApiOperation[] {
  const ops: ApiOperation[] = [];
  for (const [p, item] of Object.entries(doc.paths ?? {})) {
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const segment = p.replace(/^\/api\//, "").split("/")[0] || "root";
      ops.push({ method: m.toUpperCase(), path: p, summary: op.summary ?? "", group: op.tags?.[0] ?? segment });
    }
  }
  return ops.sort((a, b) => a.group.localeCompare(b.group) || a.path.localeCompare(b.path));
}

export interface LiveData {
  apiBase: string;
  health: Live<StatusResponse>;
  copilot: Live<CopilotStatus>;
  sources: Live<Envelope<SourceStatus[]>>;
  lastUpdated: Live<Envelope<LastUpdated>>;
  metrics: Live<MetricsResponse>;
  alerts: Live<AlertsResponse>;
  api: Live<{ title: string; version: string; operations: ApiOperation[] }>;
}

export async function loadLive(): Promise<LiveData> {
  const [health, copilot, sources, lastUpdated, metrics, alerts, openapi] = await Promise.all([
    getJson<StatusResponse>("/health"),
    getJson<CopilotStatus>("/copilot/status"),
    getJson<Envelope<SourceStatus[]>>("/data/sources"),
    getJson<Envelope<LastUpdated>>("/data/last-updated"),
    getJson<MetricsResponse>("/models/metrics"),
    getJson<AlertsResponse>("/alerts?region=bd&status=open"),
    getJson<OpenApiDoc>("/openapi.json"),
  ]);
  const api: LiveData["api"] = openapi.ok
    ? {
      ok: true,
      asOf: openapi.asOf,
      data: {
        title: openapi.data.info?.title ?? "BlueSense API",
        version: openapi.data.info?.version ?? "",
        operations: operationsFromOpenApi(openapi.data),
      },
    }
    : openapi;
  return { apiBase: API, health, copilot, sources, lastUpdated, metrics, alerts, api };
}

/** Whether a live check passes, or null when the backend could not be asked. */
export function liveCheckPasses(check: string, live: LiveData): boolean | null {
  switch (check) {
    case "health":
      return live.health.ok ? live.health.data.status === "ok" : null;
    case "copilot":
      return live.copilot.ok ? live.copilot.data.status === "ready" : null;
    case "rag":
      return live.copilot.ok ? live.copilot.data.tools.some((t) => t.name === "search_docs") : null;
    case "metrics":
      return live.metrics.ok ? live.metrics.data.evaluated === true : null;
    case "sources":
      return live.sources.ok ? live.sources.data.data.length > 0 : null;
    default:
      return null;
  }
}

interface HorizonMetrics {
  regression?: Record<string, { rmse?: number; mae?: number; r2?: number }>;
  interval?: { testCoverage?: number; nominal?: number };
  classification?: { macroF1?: number };
  selectedModel?: string;
}

/** Test RMSE of the selected model and the baselines for one horizon, from /models/metrics. */
export function horizonSkill(metrics: MetricsResponse, horizon: "1" | "3" | "6") {
  const m = metrics.metrics as { horizons?: Record<string, HorizonMetrics> } | null | undefined;
  const h = m?.horizons?.[horizon];
  if (!h) return null;
  const sel = h.selectedModel ?? "random_forest";
  return {
    model: sel,
    rmse: h.regression?.[sel]?.rmse ?? null,
    climatology: h.regression?.climatology?.rmse ?? null,
    persistence: h.regression?.persistence?.rmse ?? null,
    coverage: h.interval?.testCoverage ?? null,
    macroF1: h.classification?.macroF1 ?? null,
  };
}

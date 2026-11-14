import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * 3D Bangladesh Water Explorer: map views (3D / 2D / WebGL-free SVG), shared selection, layers, regional panel,
 * time series and period comparison, data table vs API, analysis, spatial intelligence and the map assistant.
 */

/** Make the browser report no WebGL, so the page must fall back to the 2D map. */
async function noWebGL(page: Page) {
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (...a: unknown[]) => unknown };
    const orig = proto.getContext;
    proto.getContext = function (this: unknown, type: unknown, ...rest: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return orig.call(this, type, ...rest);
    };
  });
}

async function open(page: Page, path = "/explorer") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Layers" })).toBeVisible();
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test("without WebGL the 2D map is used, says why and keeps the 3D-only layers disabled", async ({ page }) => {
  await noWebGL(page);
  await open(page);
  await expect(page.getByTestId("map-mode")).toContainText("WebGL is not available in this browser");
  await expect(page.getByRole("checkbox", { name: "Surface water (JRC)" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Rivers & canals" })).toBeDisabled();
  await expect(page.getByText("Needs the 3D map (map tiles and WebGL).").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /2D map of Bangladesh/ })).toBeVisible();
  await expect(page.locator("[data-point]")).toHaveCount(8);
});

test("clicking a division opens a panel with backend data and selects the region", async ({ page }) => {
  await noWebGL(page);
  await open(page);
  const reqs = ["/api/weather/current?region=khulna", "/api/predictions?region=khulna", "/api/explorer/intelligence?region=khulna"]
    .map((u) => page.waitForRequest((r) => r.url().includes(u)));
  await page.locator('path[data-region="khulna"]').click();
  await Promise.all(reqs);
  const panel = page.getByTestId("region-panel");
  await expect(panel.getByRole("heading", { name: "Khulna Division" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Current weather" })).toBeVisible();
  await expect(panel.getByText(/for \d{4}-\d{2}/)).toBeVisible();
  await expect(panel.getByRole("region", { name: "Scarcity risk (estimated)" })).toContainText(/Low|Medium|High/);
  await expect(panel).toContainText("no per-division statistic is stored");
  await expect(page).toHaveURL(/region=khulna/);
  await expect(page.locator("#region-select")).toHaveValue("khulna");
  await expect(page.locator("#explorer-division")).toHaveValue("khulna");
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await panel.getByRole("button", { name: "Close region panel" }).click();
  await expect(page.getByTestId("region-panel")).toHaveCount(0);
});

test("GRACE cells load only when switched on and come with their legend", async ({ page }) => {
  await noWebGL(page);
  let cellRequests = 0;
  page.on("request", (r) => { if (r.url().includes("/api/groundwater/trends") && r.url().includes("cells=true")) cellRequests += 1; });
  await open(page);
  await page.waitForTimeout(500);
  expect(cellRequests).toBe(0);
  await page.getByRole("checkbox", { name: "GRACE grid cells (~300 km)" }).check();
  await expect(page.getByText("AquaGuard display bins (not an official classification).")).toBeVisible();
  expect(cellRequests).toBe(1);
  await expect(page.locator("svg[role=img] title", { hasText: /^GRACE cell .*~300 km effective resolution$/ }).first()).toBeAttached();
});

test("a district is a reference boundary: the panel shows no district water values", async ({ page }) => {
  await noWebGL(page);
  await open(page);
  await page.getByRole("radio", { name: "Districts (reference)" }).click();
  await page.locator('path[data-region="dhaka-gazipur"]').click({ force: true });
  const panel = page.getByTestId("region-panel");
  await expect(panel).toContainText("district (reference boundary) · data for Dhaka division");
  await expect(panel).toContainText("No district-level water data exists in AquaGuard");
  await expect(page.locator("#region-select")).toHaveValue("dhaka");
  await tab(page, "Spatial Intelligence").click();
  await expect(page.getByText(/Gazipur is a district \(reference boundary\)/)).toBeVisible();
  await expect(page.getByTestId("intel-summary")).toContainText("Dhaka Division");
});

test("small screens start with the 2D view but can switch to 3D", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const mode = page.getByTestId("map-mode");
  await expect(mode).toContainText(/2D map/);
  test.skip(/WebGL is not available/.test((await mode.textContent()) ?? ""), "this browser has no WebGL");
  await expect(mode).toContainText("chosen for this small screen");
  await expect(page.getByRole("button", { name: "Lite mode on" })).toHaveAttribute("aria-pressed", "true");
  await tab(page, "3D Map").click();
  await expect(mode).toContainText("3D map (MapLibre, WebGL)");
  await page.locator("#explorer-division").selectOption("sylhet");
  const sheet = page.getByTestId("region-panel");
  await expect(sheet.getByRole("heading", { name: "Sylhet Division" })).toBeVisible();
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(iw + 1);
});

test("3D map: click selection, terrain exaggeration, 2D switch keeps the selection", async ({ page }) => {
  await open(page);
  const mode = page.getByTestId("map-mode");
  await expect(mode).not.toHaveText("Checking WebGL…");
  test.skip(!/3D map/.test((await mode.textContent()) ?? ""), "this browser has no WebGL");
  await page.waitForFunction(() => typeof window.__explorerProject === "function");
  await page.waitForTimeout(3000); // style, tiles and terrain
  const map = page.getByTestId("explorer-map");
  // the Dhaka weather point (stored coordinates of the representative point)
  const pt = await page.evaluate(() => window.__explorerProject?.(90.4125, 23.8103) ?? null);
  expect(pt).not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
  await expect(map).toHaveAttribute("data-selection", "weather_point:dhaka");
  await expect(page.getByTestId("region-panel")).toContainText("Representative weather point");
  await expect(page.getByTestId("region-panel")).toContainText("not a weather station");
  // keyboard path: division buttons
  await page.getByRole("button", { name: "Sylhet", exact: true }).click();
  await expect(map).toHaveAttribute("data-selection", "division:sylhet");
  await expect(page.getByTestId("region-panel").getByRole("heading", { name: "Sylhet Division" })).toBeVisible();
  const ex = page.locator("#terrain-exaggeration");
  await ex.fill("10");
  await expect(page.getByText("Terrain vertical exaggeration ×10 (Bangladesh is mostly flat)")).toBeVisible();
  for (const name of ["Rotate left", "Rotate right", "Face north", "Reset view"]) await page.getByRole("button", { name }).click();
  await tab(page, "2D Map").click();
  await expect(mode).toContainText("2D map (MapLibre, flat)");
  await expect(map).toHaveAttribute("data-selection", "division:sylhet");
  await expect(page.locator("#terrain-exaggeration")).toHaveCount(0); // 3D-only control
});

test("time series shows complete years and compares two periods without filling gaps", async ({ page }) => {
  await open(page, "/explorer?region=rajshahi");
  await tab(page, "Time Series").click();
  const view = page.getByTestId("series-view");
  await expect(view).toContainText("Weather series for Rajshahi");
  await expect(view.getByRole("heading", { name: "Annual rainfall" })).toBeVisible();
  await expect(view.getByRole("heading", { name: "GRACE water storage anomaly (national)" })).toBeVisible();
  await expect(view.getByText(/missing months shown as gaps/)).toBeVisible();
  const table = view.getByTestId("period-compare");
  await expect(table).toContainText("1991–2000");
  await view.getByLabel("Period A").fill("1980-1990");
  await expect(view.getByRole("alert")).toContainText("Weather history starts in 1991");
  await expect(view.getByRole("button", { name: "Compare" })).toBeDisabled();
  await view.getByLabel("Period A").fill("2002-2010");
  const req = page.waitForRequest((r) => r.url().includes("/api/explorer/compare") && r.url().includes("a=2002-2010") && r.url().includes("region=rajshahi"));
  await view.getByRole("button", { name: "Compare" }).click();
  await req;
  await expect(table).toContainText("2002–2010");
  await expect(table).toContainText("GRACE mean anomaly (national)");
});

test("the data table shows the API values and selects a division", async ({ page }) => {
  const res = page.waitForResponse((r) => r.url().includes("/api/explorer/overview"));
  await open(page);
  await tab(page, "Data Table").click();
  const body = await (await res).json();
  const sylhet = body.data.rows.find((r: { id: string }) => r.id === "sylhet");
  const table = page.getByTestId("explorer-table");
  const row = table.getByRole("row", { name: /^Sylhet/ });
  await expect(row).toContainText(sylhet.risk.label);
  await expect(row).toContainText(`${Math.round(sylhet.last12.rain).toLocaleString("en-US")} mm`);
  await expect(table.getByRole("row")).toHaveCount(10); // header + Bangladesh + 8 divisions
  await table.getByRole("button", { name: /Rain, 12 mo vs normal/ }).click();
  await expect(table.getByRole("columnheader", { name: /Rain, 12 mo/ })).toHaveAttribute("aria-sort", "descending");
  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#region-select")).toHaveValue("sylhet");
  await page.getByRole("radio", { name: "Districts (reference)" }).last().click();
  await expect(page.getByText(/64 districts\. Reference geography only/)).toBeVisible();
});

test("analysis states patterns with their basis and compares two regions", async ({ page }) => {
  await open(page);
  await tab(page, "Analysis").click();
  const pats = page.getByTestId("patterns");
  await expect(pats.getByText("estimated (engine + ML)").first()).toBeVisible();
  await expect(pats.getByText("observed (reanalysis)").first()).toBeVisible();
  await expect(page.getByText(/they do not establish causes/)).toBeVisible();
  await page.locator("#cmp-a").selectOption("dhaka");
  await page.locator("#cmp-b").selectOption("chattogram");
  const cmp = page.getByTestId("region-compare");
  await expect(cmp.getByRole("columnheader", { name: "Chattogram" })).toBeVisible();
  await expect(cmp.getByRole("row", { name: /Rainfall, last 12 months/ })).toContainText("mm");
});

test("spatial intelligence lists traceable findings, risk method and data quality", async ({ page }) => {
  await open(page, "/explorer?region=sylhet");
  await tab(page, "Spatial Intelligence").click();
  await expect(page.getByTestId("intel-summary")).toContainText("Sylhet Division: estimated scarcity risk");
  const findings = page.getByTestId("findings");
  await expect(findings.locator("li").first()).toBeVisible();
  expect(await findings.locator(":scope > li").count()).toBeGreaterThanOrEqual(5);
  await findings.getByText(/Evidence \(\d\)/).first().click();
  await expect(findings.getByText(/Rainfall, last 12 complete months/)).toBeVisible();
  await expect(page.getByText(/so no surface-water percentage is reported/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Risk analysis" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data quality" })).toBeVisible();
  await expect(page.getByText(/uncertainty not in the stored product/)).toBeVisible();
  await expect(page.getByTestId("suggestions")).toContainText("No measured groundwater levels are available");
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(" | ")}`)).toEqual([]);
});

test("the map assistant says when it is not configured", async ({ page }) => {
  await open(page);
  const assistant = page.getByTestId("map-assistant");
  await expect(assistant.getByText("The Copilot is not configured.")).toBeVisible();
  await expect(assistant.getByLabel("Ask the Copilot")).toBeDisabled();
});

test("a configured map assistant sends the map selection as context", async ({ page }) => {
  await page.route("**/api/copilot/status", (r) => r.fulfill({ json: {
    status: "ready", provider: "gemini", providerLabel: "Google Gemini", model: "gemini-3.6-flash", reason: null, readOnly: true,
    disclosure: "Answers are generated by Google Gemini (free tier).", policyUrl: "https://ai.google.dev/gemini-api/terms",
    rateLimitPerMin: 5, streaming: true, tools: [],
    limits: { perMinute: 5, perDay: 30, siteModelCallsPerDay: 200, siteModelCallsUsedToday: 0, maxConcurrent: 2, maxModelCallsPerQuestion: 4, resetsAt: "midnight" } } }));
  let body: Record<string, unknown> | null = null;
  const events = [
    { type: "tool", status: "done", name: "get_regional_intelligence", module: "Water Explorer", input: { region: "dhaka" }, dataKind: ["reanalysis"] },
    { type: "delta", text: "Dhaka Division: the findings are listed [Water Explorer]." },
    { type: "done", model: "gemini-3.6-flash", provider: "gemini", stopReason: "STOP", unverifiedNumbers: [],
      tools: [{ status: "done", name: "get_regional_intelligence", module: "Water Explorer", input: { region: "dhaka" }, dataKind: ["reanalysis"] }] },
  ];
  await page.route("**/api/copilot/stream", (r) => {
    body = r.request().postDataJSON();
    return r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" },
      body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("") });
  });
  await open(page, "/explorer?region=dhaka");
  const assistant = page.getByTestId("map-assistant");
  await expect(assistant).toContainText("Dhaka Division");
  await assistant.getByRole("button", { name: /What is the current data status of Dhaka Division/ }).click();
  await expect(assistant.getByTestId("copilot-answer").last()).toContainText("[Water Explorer]");
  await expect(assistant.getByRole("link", { name: /Regional analysis · dhaka/ })).toHaveAttribute("href", "/explorer");
  expect(body).toMatchObject({ region: "dhaka", context: { page: "explorer", kind: "division", name: "Dhaka Division" } });
});

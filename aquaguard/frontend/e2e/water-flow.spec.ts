import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * 3D Water Flow (conceptual simulation): labelling, the 3D scene and its interactions, the three synchronised views,
 * controls, scenarios, the water balance, layers, playback, responsive layout and the WebGL fallback.
 * 3D objects are clicked at their projected screen position (window.__flowProject, exposed by the scene).
 */

async function open(page: Page, errors?: string[]) {
  if (errors) {
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
  }
  await page.goto("/water-flow");
  await expect(page.getByRole("heading", { name: "What is real here?" })).toBeVisible();
  await expect(page.getByTestId("kpi-inflow")).toContainText("m³/day");
}

async function open3d(page: Page, errors?: string[]) {
  await open(page, errors);
  await expect(page.locator("canvas[data-flow-canvas]")).toBeVisible();
  await page.waitForFunction(() => typeof window.__flowProject === "function");
  await page.waitForTimeout(500); // first frames
}

async function clickObject(page: Page, kind: "node" | "pipe", id: string) {
  const pt = await page.evaluate(([k, i]) => window.__flowProject?.(k as "node" | "pipe", i) ?? null, [kind, id]);
  expect(pt, `${kind} ${id} is on screen`).not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
}

const scene = (page: Page) => page.getByTestId("flow-scene");

test("labelled as a conceptual simulation, real parts marked, no console errors", async ({ page }) => {
  const errors: string[] = [];
  await open3d(page, errors);
  await expect(page.getByRole("status").filter({ hasText: "Conceptual Simulation — Not Live Infrastructure Measurements" })).toBeVisible();
  await expect(scene(page).getByText("Conceptual simulation")).toBeVisible();
  await expect(page.getByTestId("real-parts")).toHaveText("none");
  await expect(page.getByText("Real national magnitudes (for scale)")).toBeVisible();
  await expect(page.getByRole("button", { name: /Data status: .*Reference year \d{4}/ }).first()).toBeVisible();
  await expect(page.getByText(/For scale: the conceptual network delivers .* m³\/day, about .*% of/)).toBeVisible();
  // every facility and zone is drawn and labelled in 3D
  for (const id of ["reservoir", "treatment", "pump", "junction", "residential", "agricultural", "industrial", "other"]) {
    await expect(page.locator(`[data-flow-label="${id}"]`)).toBeVisible();
  }
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test("play / pause and speed control the animation", async ({ page }) => {
  await open(page);
  await expect(scene(page)).toHaveAttribute("data-running", "true");
  await page.getByRole("button", { name: "Pause animation" }).click();
  await expect(scene(page)).toHaveAttribute("data-running", "false");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(scene(page)).toHaveAttribute("data-running", "true");
  await page.getByLabel("Animation speed").fill("4"); // index 4 = 2x
  await expect(page.getByText("2×")).toBeVisible();
  await expect(scene(page)).toHaveAttribute("data-speed", "2");
});

test("clicking 3D objects selects them, shows details, and deselects", async ({ page }) => {
  await open3d(page);
  await clickObject(page, "node", "pump");
  await expect(scene(page)).toHaveAttribute("data-selection", "node:pump");
  const info = scene(page).getByTestId("flow-info");
  await expect(info.getByRole("heading", { name: "Pump station" })).toBeVisible();
  await expect(info).toContainText("Running");
  await expect(info).toContainText("Utilization");
  await expect(page.getByRole("combobox", { name: "Select an object" })).toHaveValue("node:pump");
  await page.keyboard.press("Escape");
  await expect(scene(page)).toHaveAttribute("data-selection", "");

  await clickObject(page, "pipe", "res");
  await expect(scene(page)).toHaveAttribute("data-selection", "pipe:res");
  await expect(info.getByRole("heading", { name: "Residential branch" })).toBeVisible();
  await expect(info).toContainText("Junction J1 → Residential zone");
  await scene(page).getByRole("button", { name: "Focus on the selected object" }).click();
  for (const name of ["Zoom in", "Zoom out", "Rotate left", "Rotate right", "Reset view"]) {
    await scene(page).getByRole("button", { name }).click();
  }
  await page.waitForTimeout(1500); // camera transition back to the overview
  // a click on empty sky deselects
  const box = (await page.locator("canvas[data-flow-canvas]").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.55, box.y + 8);
  await expect(scene(page)).toHaveAttribute("data-selection", "");
});

test("one selection and one simulation state across 3D, schematic and table", async ({ page }) => {
  await open3d(page);
  await clickObject(page, "pipe", "agr");
  await scene(page).getByTestId("flow-info").getByRole("button", { name: "Close valve" }).click();
  await expect(page.getByRole("checkbox", { name: "Agricultural branch valve open" })).not.toBeChecked();
  await page.getByRole("radio", { name: "Schematic" }).click();
  const sch = page.getByTestId("flow-schematic");
  await expect(sch.getByRole("button", { name: /^Agricultural branch: Valve closed/ })).toHaveAttribute("aria-pressed", "true");
  await expect(sch.getByRole("button", { name: /^Agricultural zone: .*Valve closed/ })).toBeVisible();
  await page.getByRole("radio", { name: "Data table" }).click();
  const table = page.getByTestId("flow-table");
  const row = table.getByRole("row", { name: /Agricultural branch/ });
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(row).toContainText("Valve closed");
  // select from the table, see it everywhere
  await table.getByRole("row", { name: /Industrial zone/ }).click();
  await page.getByRole("radio", { name: "Schematic" }).click();
  await expect(sch.getByRole("button", { name: /^Industrial zone:/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("radio", { name: "3D view" }).click();
  await expect(scene(page)).toHaveAttribute("data-selection", "node:industrial");
  await expect(scene(page).getByTestId("flow-info").getByRole("heading", { name: "Industrial zone" })).toBeVisible();
});

test("controls drive the engine and the water balance identity holds", async ({ page }) => {
  await open(page);
  const req = page.waitForRequest((r) => r.url().includes("/api/flow/simulate") && (r.postData() ?? "").includes('"pumpFlowM3s":0.8'));
  await page.locator("#pump").fill("0.8");
  await req;
  await expect(page.getByTestId("kpi-inflow")).toContainText("69,120 m³/day"); // 0.8 m³/s × 86,400 s
  await expect(page.getByTestId("kpi-pump")).toContainText("100.0 %");
  // pump capacity limits the flow
  await page.locator("#capacity").fill("0.5");
  await expect(page.getByTestId("kpi-inflow")).toContainText("43,200 m³/day");
  await expect(page.getByText("Flow limited by the pump capacity.").first()).toBeVisible();
  // allocation always sums to 100 %
  await page.locator("#alloc-residential").fill("70");
  await expect(page.getByText("Total 100.0 %")).toBeVisible();
  // pump off: nothing flows, deficit
  await page.getByRole("switch", { name: "Pump running" }).uncheck();
  await expect(page.getByTestId("kpi-inflow")).toHaveText(/^Total inflow\s*0 m³\/day/);
  await expect(page.getByTestId("kpi-balance")).toContainText("Deficit");
  await page.getByRole("tab", { name: "Results" }).click();
  const results = page.getByRole("tabpanel");
  await expect(results.getByText("Total inflow (pump)")).toBeVisible();
  await expect(results.getByText("Not modelled (steady state)")).toBeVisible();
  await expect(results.getByTestId("zone-results")).toContainText("No supply");
  await page.getByRole("button", { name: "Reset simulation" }).click();
  await expect(page.getByTestId("kpi-balance")).toContainText("Balanced");
  await expect(page.getByTestId("kpi-inflow")).toContainText("43,200 m³/day");
});

test("scenarios apply presets and compare with normal operation", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Scenarios" }).click();
  const group = page.getByRole("radiogroup", { name: "Scenario" });
  await expect(group.getByRole("radio")).toHaveCount(8);
  await group.getByRole("radio", { name: /Pump failure/ }).click();
  await expect(group.getByRole("radio", { name: /Pump failure/ })).toHaveAttribute("aria-checked", "true");
  const cmp = page.getByTestId("scenario-compare");
  await expect(cmp).toContainText("Why:");
  await expect(cmp).toContainText("no zone receives water");
  await expect(cmp.getByRole("row", { name: /Delivered/ })).toContainText("−");
  await expect(page.getByTestId("kpi-balance")).toContainText("Deficit");
  await group.getByRole("radio", { name: /Pipeline leakage/ }).click();
  await expect(page.getByText(/^Leak \d+\.\d{3} m³\/s$/).first()).toBeVisible();
  await group.getByRole("radio", { name: /Normal operation/ }).click();
  await expect(page.getByTestId("kpi-balance")).toContainText("Balanced");
});

test("layer switches hide labels and leak markers; the page passes axe", async ({ page }) => {
  await open3d(page);
  await expect(page.locator('[data-flow-label="pump"]')).toBeVisible();
  await page.getByRole("button", { name: "Layers" }).click();
  await page.getByRole("checkbox", { name: "Labels" }).uncheck();
  await expect(page.locator('[data-flow-label="pump"]')).toBeHidden();
  await expect(scene(page)).not.toHaveAttribute("data-layers", /labels/);
  await page.getByRole("checkbox", { name: "Labels" }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("checkbox", { name: "Leak on Residential branch" }).check();
  await expect(page.getByText(/^Leak \d+\.\d{3} m³\/s$/)).toBeVisible();
  await page.getByRole("button", { name: "Layers" }).click();
  await page.getByRole("checkbox", { name: "Leak markers" }).uncheck();
  await expect(page.getByText(/^Leak \d+\.\d{3} m³\/s$/)).toBeHidden();
  await page.getByRole("radio", { name: "By pressure" }).click();
  await page.keyboard.press("Escape");
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 160)).join(" | ")}`)).toEqual([]);
});

test("data table sorts and filters", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "Data table" }).click();
  const table = page.getByTestId("flow-table");
  await table.getByRole("button", { name: /Flow \(m³\/day\)/ }).click(); // ascending
  await table.getByRole("button", { name: /Flow \(m³\/day\)/ }).click(); // descending
  await expect(table.getByRole("columnheader", { name: /Flow/ })).toHaveAttribute("aria-sort", "descending");
  const first = await table.locator("tbody tr").first().locator("td").nth(1).innerText();
  expect(Number(first.replace(/,/g, ""))).toBeGreaterThanOrEqual(43_000);
  await table.getByRole("combobox").selectOption("zone");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await table.getByRole("searchbox").fill("pump");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText("No object matches this filter.");
});

test("phone: details open in a bottom sheet and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByRole("button", { name: "Lite mode on" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "Select an object" }).selectOption("node:residential");
  const sheet = page.locator("section[aria-labelledby=flow-info-sheet]");
  await expect(sheet.getByRole("heading", { name: "Residential zone" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close details" }).click();
  await expect(sheet).toHaveCount(0);
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw).toBeLessThanOrEqual(iw + 1);
});

test("without WebGL the schematic is shown instead and every control still works", async ({ page }) => {
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: (...a: unknown[]) => unknown };
    const orig = proto.getContext;
    proto.getContext = function (this: unknown, type: unknown, ...args: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return orig.call(this, type, ...args);
    };
  });
  await open(page);
  await expect(page.getByRole("note").filter({ hasText: "3D view unavailable" })).toBeVisible();
  await expect(page.getByTestId("flow-schematic")).toBeVisible();
  await page.getByTestId("flow-schematic").getByRole("button", { name: /^Pump station:/ }).click();
  await expect(scene(page)).toHaveAttribute("data-selection", "node:pump");
});

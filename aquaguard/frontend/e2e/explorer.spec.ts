import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** Make the browser report no WebGL, so the page must fall back to the 2D map. */
async function noWebGL(page: Page) {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error test-only override
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return (orig as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(this, type, ...rest);
    };
  });
}

async function open(page: Page, path = "/explorer") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Layers" })).toBeVisible();
}

test("without WebGL the 2D map is used, says why and keeps the 3D-only layers disabled", async ({ page }) => {
  await noWebGL(page);
  await open(page);
  await expect(page.getByTestId("map-mode")).toContainText("WebGL is not available in this browser");
  await expect(page.getByRole("button", { name: "Show 3D map" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Surface water (JRC)" })).toBeDisabled();
  await expect(page.getByText("Needs the 3D map (map tiles and WebGL).").first()).toBeVisible();
  await expect(page.getByRole("img", { name: /2D map of Bangladesh/ })).toBeVisible();
  await expect(page.locator("[data-point]")).toHaveCount(8);
});

test("clicking a division opens a panel with backend data and selects the region", async ({ page }) => {
  await noWebGL(page);
  await open(page);
  const reqs = ["/api/weather/current?region=khulna", "/api/predictions?region=khulna"].map((u) => page.waitForRequest((r) => r.url().includes(u)));
  await page.locator('path[data-region="khulna"]').click();
  await Promise.all(reqs);
  const panel = page.getByTestId("region-panel");
  await expect(panel.getByRole("heading", { name: "Khulna" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Current weather" })).toBeVisible();
  await expect(panel.getByText(/for \d{4}-\d{2}/)).toBeVisible();
  await expect(page).toHaveURL(/region=khulna/);
  await expect(page.locator("#region-select")).toHaveValue("khulna");
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
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

test("a district is a reference boundary: the panel shows its division's data", async ({ page }) => {
  await noWebGL(page);
  await open(page);
  await page.getByRole("radio", { name: "Districts (reference)" }).click();
  await page.locator('path[data-region="dhaka-gazipur"]').click({ force: true });
  await expect(page.getByTestId("region-panel")).toContainText("district (reference boundary) · data for Dhaka division");
  await expect(page.locator("#region-select")).toHaveValue("dhaka");
});

test("small screens start with the 2D map but can switch to 3D", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const mode = page.getByTestId("map-mode");
  await expect(mode).toContainText(/2D map/);
  test.skip(/WebGL is not available/.test((await mode.textContent()) ?? ""), "this browser has no WebGL");
  await expect(mode).toContainText("chosen for this small screen");
  await expect(page.getByRole("button", { name: "Show 3D map" })).toBeEnabled();
});

test("desktop with WebGL shows the 3D map; the division buttons are a keyboard path to the panel", async ({ page }) => {
  await open(page);
  const mode = page.getByTestId("map-mode");
  await expect(mode).not.toHaveText("Checking WebGL…");
  test.skip(!/3D map/.test((await mode.textContent()) ?? ""), "this browser has no WebGL");
  await expect(page.getByRole("button", { name: "Show 2D map" })).toBeVisible();
  await page.getByRole("button", { name: "Sylhet", exact: true }).click();
  await expect(page.getByTestId("region-panel").getByRole("heading", { name: "Sylhet" })).toBeVisible();
  await page.getByRole("button", { name: "Show 2D map" }).click();
  await expect(page.getByRole("img", { name: /2D map of Bangladesh/ })).toBeVisible();
});

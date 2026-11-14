import { expect, test } from "@playwright/test";

/** P5 check 9: controls that had no dedicated test yet. Each must visibly do what it says. */

test("header: data-label help and the floating Copilot panel open and close", async ({ page }) => {
  await page.goto("/command-center");
  await expect(page.locator("main h1").first()).toBeVisible();
  await page.getByRole("button", { name: "What the data labels mean" }).click();
  await expect(page.getByText("Open-Meteo weather-model estimate of current conditions (not a station reading)")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Open-Meteo weather-model estimate of current conditions (not a station reading)")).toBeHidden();
  await page.getByRole("button", { name: "Open AquaGuard Copilot" }).first().click();
  const panel = page.getByRole("dialog", { name: "AquaGuard Copilot" });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Ask the Copilot")).toBeVisible();
  await panel.getByRole("button", { name: "Close Copilot" }).click();
  await expect(panel).toBeHidden();
});

test("water budget model tab: period, month, optimizer, custom shares and PNG export", async ({ page }) => {
  await page.goto("/water-budget?view=model");
  await expect(page.getByRole("heading", { name: /Model water budget/ })).toBeVisible();
  await page.getByRole("radio", { name: "Month", exact: true }).click();
  const monthReq = page.waitForRequest((r) => r.url().includes("/api/water-budget") && r.url().includes("mode=derived") && r.url().includes("period=3"));
  await page.getByLabel("Month", { exact: true }).selectOption("3");
  await monthReq;
  await expect(page.getByRole("heading", { name: /Model water budget — March/ })).toBeVisible();
  await page.getByRole("button", { name: "Optimize allocation" }).click();
  await expect(page.getByText("Unmet demand reduced")).toBeVisible();
  const shares = page.waitForResponse((r) => r.url().includes("/api/budget/optimize") && (r.request().postData() ?? "").includes('"mode":"shares"'));
  await page.getByRole("button", { name: "Apply custom shares" }).click();
  expect((await shares).status()).toBe(200);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Sankey as PNG" }).click();
  expect((await download).suggestedFilename()).toMatch(/^aquaguard-sankey-model-3\.png$/);
});

test("water flow: pump slider, optimize with the current / optimized view, lite mode", async ({ page }) => {
  await page.goto("/water-flow");
  await expect(page.getByRole("heading", { name: "What is real here?" })).toBeVisible();
  const req = page.waitForRequest((r) => r.url().includes("/api/flow/simulate") && (r.postData() ?? "").includes('"pumpFlowM3s":0.8'));
  await page.locator("#pump").fill("0.8");
  await req;
  await expect(page.getByText("0.8 m³/s").first()).toBeVisible();
  await page.getByRole("button", { name: "Optimize (pressure management)" }).click();
  const view = page.getByRole("radiogroup", { name: "Network state shown" });
  await expect(view.getByRole("radio", { name: "optimized" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "Before vs after optimization" })).toBeVisible();
  await view.getByRole("radio", { name: "current" }).click();
  await expect(view.getByRole("radio", { name: "current" })).toHaveAttribute("aria-checked", "true");
  const lite = page.getByRole("button", { name: "Lite mode" });
  await expect(lite).toHaveAttribute("aria-pressed", "false");
  await lite.click();
  await expect(page.getByRole("button", { name: "Lite mode on" })).toHaveAttribute("aria-pressed", "true");
});

test("prediction lab: the demand and groundwater sections render and are kept in the URL", async ({ page }) => {
  await page.goto("/prediction-lab?tab=demand");
  await expect(page.getByRole("heading", { name: "Water demand projection by sector" })).toBeVisible();
  await page.getByRole("radio", { name: "Groundwater (GRACE)" }).click();
  await expect(page).toHaveURL(/tab=groundwater/);
  await expect(page.getByRole("heading", { name: /Terrestrial water storage anomaly over Bangladesh|GRACE data not loaded/ })).toBeVisible();
});

test("irrigation: soil, area and planting date are sent with the estimate", async ({ page }) => {
  await page.goto("/irrigation");
  await expect(page.getByRole("heading", { name: "Why this estimate" })).toBeVisible();
  const soil = page.getByRole("combobox", { name: "Soil type" });
  const options = await soil.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  await soil.selectOption(options[options.length - 1]);
  await page.getByRole("spinbutton", { name: "Area (ha)" }).fill("2.5");
  await page.getByRole("radio", { name: "Sowing/transplanting date" }).check();
  await page.locator('input[type="date"][aria-label="Planting date"]').fill("2026-11-20");
  const req = page.waitForRequest((r) => {
    const b = r.postData() ?? "";
    return r.url().includes("/api/irrigation/estimate") && b.includes('"areaHa":2.5') && b.includes('"plantingDate":"2026-11-20"')
      && b.includes(`"soil":"${options[options.length - 1]}"`);
  });
  await page.getByRole("button", { name: "Estimate now" }).click();
  await req;
});

test("explorer 3D controls: lite mode, reset view and layer opacity", async ({ page }) => {
  await page.goto("/explorer");
  const mode = page.getByTestId("map-mode");
  await expect(mode).not.toHaveText("Checking WebGL…");
  test.skip(!/3D map/.test((await mode.textContent()) ?? ""), "this browser has no WebGL");
  const lite = page.getByRole("button", { name: "Lite mode" });
  await lite.click();
  await expect(page.getByRole("button", { name: "Lite mode on" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset view" }).click();
  const opacity = page.getByRole("slider", { name: "Scarcity risk opacity" });
  await opacity.fill("0.4");
  await expect(opacity).toHaveValue("0.4");
});

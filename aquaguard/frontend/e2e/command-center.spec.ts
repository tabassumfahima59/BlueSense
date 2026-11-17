import { expect, type Page, test } from "@playwright/test";

async function open(page: Page, path = "/command-center") {
  await page.goto(path);
  await expect(page.locator("header").getByText("Command Center", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Water availability: show details/ })).toBeVisible();
}

test("region change refetches with the region and updates the KPIs", async ({ page }) => {
  await open(page);
  const req = page.waitForResponse((r) => r.url().includes("/api/dashboard/summary?region=dhaka") && r.ok());
  await page.locator("#region-select").selectOption("dhaka");
  const body = await (await req).json();
  await expect(page.getByRole("button", { name: /Irrigation demand \(weather-based\): show details/ })).toBeVisible();
  await expect(page.getByText(/are national data/)).toHaveCount(0);
  // decision 1: national statistics are never division values
  const byKey = Object.fromEntries(body.data.kpis.map((k: { key: string }) => [k.key, k]));
  expect(byKey.availability.value.spatialLevel).toBe("national");
  expect(byKey.utilization.value.spatialLevel).toBe("national");
  expect(byKey.demand.value.dataKind).toBe("derived");
  expect(byKey.demand.value.spatialLevel).toBe("point");
});

test("KPI drawer shows chart, formula and sources and returns focus", async ({ page }) => {
  await open(page);
  const trigger = page.getByRole("button", { name: "Water availability: show details" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Water availability" });
  await expect(drawer.getByRole("heading", { name: "Formula" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Source and dates" })).toBeVisible();
  await expect(drawer.getByText("fao_aquastat").first()).toBeVisible();
  await expect(drawer.getByRole("figure").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("potential saving follows the efficiency slider", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Potential water saving \(scenario\): show details/ }).click();
  const drawer = page.getByRole("dialog", { name: "Potential water saving (scenario)" });
  const slider = drawer.getByLabel(/Target irrigation efficiency/);
  const before = await drawer.locator("span.text-\\[28px\\]").textContent();
  const req = page.waitForResponse((r) => r.url().includes("targetEfficiency=0.9") && r.ok());
  await slider.fill("0.9");
  await req;
  await expect(drawer.locator("span.text-\\[28px\\]")).not.toHaveText(before!);
});

test("map category filter changes the legend without method helper text", async ({ page }) => {
  await open(page);
  const legend = page.getByRole("list", { name: /^Legend:/ });
  await expect(legend).toContainText("Extremely dry");
  await expect(page.getByText(/SPI classes \(McKee/)).toHaveCount(0);
  await page.getByRole("radio", { name: "Rain vs normal" }).click();
  await expect(legend).toContainText("Large deficient");
  await expect(page.getByText(/India Meteorological Department rainfall departure categories/)).toHaveCount(0);
  await page.getByRole("radio", { name: "Next 7 days" }).click();
  await expect(legend).toContainText("Strong deficit");
  await expect(page.getByText(/assumption, not an official classification/)).toHaveCount(0);
});

test("regional table selects a division", async ({ page }) => {
  await open(page);
  const table = page.getByRole("region", { name: "Regional risk table (scrollable)" });
  await table.getByRole("button", { name: "Sylhet" }).click();
  await expect(page.locator("#region-select")).toHaveValue("sylhet");
  await expect(page).toHaveURL(/region=sylhet/);
});

test("header alerts can be marked read and open the affected region", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("region", { name: "Alerts", exact: true });
  await expect(panel.getByRole("listitem").first()).toBeVisible();
  await panel.getByRole("button", { name: "Mark all read", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Mark all read", exact: true })).toBeDisabled();
  await expect(panel.getByText("Unread.", { exact: true })).toHaveCount(0);
  const regionLink = panel.getByRole("link", { name: /^Open / }).first();
  const target = await regionLink.getAttribute("href");
  await regionLink.click();
  await expect(page).toHaveURL(new URL(target!, page.url()).href);
  await expect(panel).toBeHidden();
});

test("insights and weather trends follow the date filter", async ({ page }) => {
  await open(page);
  const insights = page.getByRole("region", { name: "Key insights" });
  await expect(insights.getByRole("listitem")).not.toHaveCount(0);
  const from = page.locator("#date-from");
  await expect(from).toBeVisible();
  const req = page.waitForRequest((r) => r.url().includes("/api/weather/history") && r.url().includes("start=2020-01"));
  await from.fill("2020-01");
  await req;
  await expect(page.getByText(/to .* · use the date filter/).first()).toContainText("Jan 2020");
});

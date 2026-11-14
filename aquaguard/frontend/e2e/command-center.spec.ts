import { expect, type Page, test } from "@playwright/test";

async function open(page: Page, path = "/command-center") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Command Center", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /Water availability: show details/ })).toBeVisible();
}

test("region change refetches with the region and updates the KPIs", async ({ page }) => {
  await open(page);
  const req = page.waitForResponse((r) => r.url().includes("/api/dashboard/summary?region=dhaka") && r.ok());
  await page.locator("#region-select").selectOption("dhaka");
  const body = await (await req).json();
  await expect(page.getByRole("button", { name: /Irrigation demand \(weather-based\): show details/ })).toBeVisible();
  await expect(page.getByText(/are national data/)).toBeVisible();
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

test("map category filter changes the legend and its source", async ({ page }) => {
  await open(page);
  await expect(page.getByText(/SPI classes \(McKee/)).toBeVisible();
  await page.getByRole("radio", { name: "Rain vs normal" }).click();
  await expect(page.getByText(/India Meteorological Department rainfall departure categories/)).toBeVisible();
  await page.getByRole("radio", { name: "Next 7 days" }).click();
  await expect(page.getByText(/assumption, not an official classification/).first()).toBeVisible();
});

test("regional table selects a division", async ({ page }) => {
  await open(page);
  const table = page.getByRole("region", { name: "Regional risk table (scrollable)" });
  await table.getByRole("button", { name: "Sylhet" }).click();
  await expect(page.locator("#region-select")).toHaveValue("sylhet");
  await expect(page).toHaveURL(/region=sylhet/);
});

test("alerts filter, detail dialog and mark read", async ({ page }) => {
  await open(page);
  const list = page.getByRole("list", { name: "Alerts" });
  await expect(list.getByRole("listitem").first()).toBeVisible();
  await page.getByRole("radio", { name: "High+" }).click();
  const pills = list.locator("li span.rounded-full").filter({ hasText: /^(High|Critical|Medium|Low|Info)$/ });
  for (const t of await pills.allTextContents()) expect(["High", "Critical"]).toContain(t);
  await page.getByRole("radio", { name: "All" }).click();
  await list.getByRole("button", { name: "Details" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Threshold source")).toBeVisible();
  await page.keyboard.press("Escape");
  const unread = await list.getByText("Unread").count();
  if (unread) {
    await list.getByRole("button", { name: "Mark read" }).first().click();
    await expect(list.getByText("Unread")).toHaveCount(unread - 1);
  }
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

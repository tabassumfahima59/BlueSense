import { expect, test } from "@playwright/test";

test("Settings and Header region changes sync both ways immediately and persist", async ({ page }) => {
  await page.goto("/settings");
  await page.locator("#default-region").selectOption("dhaka");
  await expect(page.locator("#region-select")).toHaveValue("dhaka");
  await expect(page).toHaveURL(/region=dhaka/);
  await page.locator("#region-select").selectOption("sylhet");
  await expect(page.locator("#default-region")).toHaveValue("sylhet");
  await page.reload();
  await expect(page.locator("#region-select")).toHaveValue("sylhet");
  await expect(page.locator("#default-region")).toHaveValue("sylhet");
  await page.goto("/settings");
  await expect(page.locator("#region-select")).toHaveValue("sylhet");
});

test("regional modules request the shared region and brand navigation opens Command Center", async ({ page }) => {
  await page.goto("/settings");
  await page.locator("#default-region").selectOption("dhaka");
  const prediction = page.waitForResponse((r) => r.url().includes("/api/predictions?") && r.url().includes("region=dhaka"));
  await page.getByRole("link", { name: "AI Prediction Lab", exact: true }).click();
  expect((await prediction).ok()).toBe(true);
  await expect(page.getByRole("figure", { name: /Climatic water balance for Dhaka/ })).toBeVisible();
  await page.getByRole("link", { name: "3D Water Explorer", exact: true }).click();
  await expect(page.locator("#region-select")).toHaveValue("dhaka");
  await page.getByRole("tab", { name: "Spatial Intelligence", exact: true }).click();
  await expect(page.getByTestId("intel-summary")).toContainText("Dhaka");
  for (const title of ["Suggested next investigation", "AI insights", "Limitations"]) {
    await expect(page.getByTestId("intel-view").getByRole("heading", { name: title, exact: true })).toHaveCount(0);
  }
  const summary = page.waitForResponse((r) => r.url().includes("/api/dashboard/summary?region=dhaka"));
  await page.getByRole("link", { name: "BlueSense home", exact: true }).click();
  expect((await summary).ok()).toBe(true);
  await expect(page).toHaveURL(/command-center\?region=dhaka/);
});

test("cross-tab unit changes update Sankey values without resetting controls or source calculations", async ({ page, context }) => {
  const budgetResponse = page.waitForResponse((r) => r.url().includes("/api/water-budget?") && r.url().includes("mode=derived"));
  await page.goto("/water-budget");
  expect((await budgetResponse).ok()).toBe(true);
  await page.getByRole("radio", { name: "Month", exact: true }).click();
  await page.getByLabel("Month", { exact: true }).selectOption("3");
  await expect(page.getByRole("heading", { name: /Model water budget.*March/ })).toBeVisible();
  const shares = page.getByRole("group", { name: /Custom shares of allocable supply/ });
  await shares.getByRole("slider", { name: /^Agriculture/ }).fill("50");
  const diagram = page.getByRole("region", { name: /Model water budget.*March/, exact: false });
  await diagram.getByRole("button", { name: "View as table", exact: true }).click();
  const firstValue = diagram.getByRole("table").locator("tbody tr").first().locator("td").nth(1);
  const native = Number((await firstValue.innerText()).replaceAll(",", ""));
  const settings = await context.newPage();
  await settings.goto("/settings");
  await settings.locator('input[name="volume"][value="km3"]').check();
  await expect(diagram.getByRole("columnheader", { name: "km³", exact: true })).toBeVisible();
  const converted = Number((await firstValue.innerText()).replaceAll(",", ""));
  expect(Math.abs(converted * 1000 - native) / native).toBeLessThan(0.02);
  await expect(page.getByLabel("Month", { exact: true })).toHaveValue("3");
  await expect(shares.getByRole("slider", { name: /^Agriculture/ })).toHaveValue("50");
  await settings.locator("#default-region").selectOption("rangpur");
  await expect(page.locator("#region-select")).toHaveValue("rangpur");
  await settings.close();
});

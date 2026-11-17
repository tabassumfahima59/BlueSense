import { expect, type Page, test } from "@playwright/test";

async function open(page: Page, path = "/what-if") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Scenario summary" })).toBeVisible();
}

test("a lever runs the national model, labels the result and keeps the state in the URL", async ({ page }) => {
  await open(page);
  const req = page.waitForRequest((r) => r.url().endsWith("/api/whatif") && (r.postData() ?? "").includes('"agriculturalDemandChangePct":20'));
  await page.getByRole("button", { name: "More irrigation: agriculture +20%" }).click();
  await req;
  await expect(page.getByText(/agricultural consumption \+20%/).first()).toBeVisible();
  await expect(page).toHaveURL(/agri=20/);
  await expect(page.getByRole("button", { name: /Data status: Fresh, Scenario/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator("#lever-agriculturalDemandChangePct")).toHaveValue("20");
});

test("reset restores the baseline", async ({ page }) => {
  await open(page, "/what-if?rain=-20");
  await expect(page.locator("#lever-rainfallChangePct")).toHaveValue("-20");
  await page.getByRole("button", { name: "Reset to baseline" }).click();
  await expect(page.getByText("Baseline — no levers changed")).toBeVisible();
  await expect(page).not.toHaveURL(/rain=/);
});

test("the baseline can be the latest 12 months or the 1991-2020 normal", async ({ page }) => {
  await open(page);
  await expect(page.getByText(/Weather: \d{4}-\d{2} to \d{4}-\d{2}/)).toBeVisible();
  const req = page.waitForRequest((r) => r.url().endsWith("/api/whatif") && (r.postData() ?? "").includes('"basis":"normal"'));
  await page.getByRole("radio", { name: "1991–2020 normal" }).click();
  await req;
  await expect(page.getByText("Weather: 1991-2020 normal year")).toBeVisible();
  await expect(page).toHaveURL(/basis=normal/);
});

test("a division selection keeps the national model", async ({ page }) => {
  await open(page, "/what-if?region=sylhet");
  await expect(page.getByText(/National model: results are for Bangladesh/)).toBeVisible();
});

test("apply across platform: disabled with a reason at baseline, then carries the levers to every module", async ({ page }) => {
  await open(page);
  const apply = page.getByRole("button", { name: "Apply across platform" });
  await expect(apply).toBeDisabled();
  await expect(page.getByTestId("apply-hint")).toHaveText("Change a lever below to apply a scenario across the platform.");
  await page.getByRole("button", { name: "Dry year: rainfall −20%" }).click();
  await expect(page.getByTestId("apply-hint")).toHaveCount(0);
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole("button", { name: "Applied across platform" })).toBeDisabled();
  await expect(page.getByText(/^Scenario active: /)).toBeVisible();
  // move to another module the way a user does (the applied scenario lasts for the session, not across reloads)
  await page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Water Budget Sankey" }).click();
  await page.getByRole("radio", { name: "Monthly model (derived)" }).click();
  await expect(page.getByText(/Scenario applied: Rain -20%/)).toBeVisible(); // another module picks the scenario up
  await page.getByRole("button", { name: "Reset scenario to baseline" }).click();
  await expect(page.getByText(/^Scenario active: /)).toHaveCount(0);
});

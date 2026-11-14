import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page, path = "/prediction-lab") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Model card" })).toBeVisible();
}

test("national forecast: stored predictions, three horizons, uncertainty band and an honest model card", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("prediction-storage")).toContainText(/Stored prediction · generated .* from weather through \d{4}-\d{2}|Training-time prediction file/);
  await expect(page.getByTestId("prediction-storage")).toContainText("Area-weighted mean of the eight division predictions");
  for (const h of [1, 3, 6]) await expect(page.getByText(new RegExp(`^${h}-month prediction · \\d{4}-\\d{2}`))).toBeVisible();
  const chart = page.getByRole("figure", { name: /1, 3 and 6-month predictions with 90% intervals/ });
  await expect(chart).toBeVisible();
  await expect(page.getByText("Trained on real data")).toBeVisible();
  await expect(page.getByText(/predicted none of the \d+ dry months as dry/)).toBeVisible();
  await expect(page.getByText(/Select a division in the header to see the exact model inputs/i)).toBeVisible();
});

test("horizon is selectable, requested and kept in the URL", async ({ page }) => {
  await open(page);
  const req = page.waitForRequest((r) => r.url().includes("/api/predictions?") && r.url().includes("horizon=3"));
  await page.getByRole("radio", { name: "3 mo" }).click();
  await req;
  await expect(page).toHaveURL(/h=3/);
  await expect(page.getByText(/^3-month prediction · .*\(selected\)$/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "3 mo" })).toHaveAttribute("aria-checked", "true");
});

test("only the working model's category can be chosen, the others say why", async ({ page }) => {
  await open(page);
  const select = page.getByLabel("Category");
  await expect(select.locator("option", { hasText: "Climatic water balance" })).not.toHaveAttribute("disabled", /.*/);
  await expect(select.locator("option", { hasText: "Rainfall" })).toHaveAttribute("disabled", /.*/);
  await expect(page.getByText(/Rainfall: No rainfall model is trained/)).toBeVisible();
});

test("a division shows the exact stored model inputs", async ({ page }) => {
  await open(page, "/prediction-lab?region=dhaka");
  const btn = page.getByRole("button", { name: "View model inputs" });
  test.skip(!(await btn.isVisible()), "no stored prediction in this database");
  await btn.click();
  const drawer = page.getByRole("dialog", { name: /Model inputs · 1-month prediction/ });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("rowheader", { name: "Rainfall · issue month" })).toBeVisible();
  await expect(drawer.getByText(/Exact values stored with prediction #\d+/)).toBeVisible();
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page, path = "/water-budget") {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "National water budget" })).toBeVisible();
}

test("the national AQUASTAT budget is the default and shows values, units and reference years", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("radio", { name: "National statistics (AQUASTAT)" })).toHaveAttribute("aria-checked", "true");
  const sankey = page.getByRole("img", { name: /National water budget Sankey/ });
  await expect(sankey).toBeVisible();
  await expect(sankey.locator("text").filter({ hasText: "Agricultural withdrawal" })).toContainText(/km³\/yr · .*% · ref\. \d{4}/);
  await expect(page.getByRole("button", { name: /Data status: .*Reference year \d{4}/ }).first()).toBeVisible();
  await expect(page.getByText("Mixed reference years.")).toBeVisible();
});

test("hovering a node shows its quantity and clicking it opens the details", async ({ page }) => {
  await open(page);
  const node = page.locator('[data-node="environment"] rect');
  await node.hover();
  await expect(page.getByRole("tooltip")).toContainText(/Environmental flow requirement: .* km³\/yr \(.*% of total renewable resources\) · ref\. \d{4}/);
  await node.click();
  const drawer = page.getByRole("dialog", { name: "Environmental flow requirement" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("4549 · Environmental Flow Requirements")).toBeVisible();
  await expect(drawer.getByRole("region", { name: /genuine AQUASTAT reference years/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // keyboard path: the legend chips open the same details
  await page.getByRole("list", { name: "Budget parts (open details)" }).getByRole("button", { name: "Remainder", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Remainder" }).getByText("How it is derived")).toBeVisible();
});

test("year comparison offers only years with data and never invents a value", async ({ page }) => {
  await open(page);
  const select = page.getByLabel("Comparison year");
  const years = await select.locator("option").allTextContents();
  const api = await (await page.request.get("http://127.0.0.1:8013/api/water-budget")).json();
  expect(years.map(Number).sort()).toEqual([...api.data.national.comparisonYears].sort());
  await select.selectOption("1990");
  const row = page.getByRole("row").filter({ hasText: "Agricultural withdrawal" });
  await expect(row).toContainText("No data");
  await expect(page.getByRole("row").filter({ hasText: "Municipal withdrawal" })).toContainText(/\+.*%/);
});

test("the monthly model tab is national, derived and kept in the URL", async ({ page }) => {
  await open(page, "/water-budget?region=sylhet");
  await page.getByRole("radio", { name: "Monthly model (derived)" }).click();
  await expect(page).toHaveURL(/view=model/);
  await expect(page.getByRole("heading", { name: /Model water budget/ })).toBeVisible();
  await expect(page.getByText(/runs for Bangladesh as a whole/)).toBeVisible();
  await expect(page.getByText(/Balanced: input = output/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Monthly model (derived)" })).toHaveAttribute("aria-checked", "true");
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

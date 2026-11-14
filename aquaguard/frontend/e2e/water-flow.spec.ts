import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/water-flow");
  await expect(page.getByRole("heading", { name: "What is real here?" })).toBeVisible();
}

test("the page is labelled a conceptual illustration and marks what is real", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("status").filter({ hasText: "Conceptual illustration — a hypothetical network" })).toBeVisible();
  await expect(page.getByTestId("flow-scene").getByText("Conceptual illustration")).toBeVisible();
  await expect(page.getByTestId("real-parts")).toHaveText("none");
  await expect(page.getByText("Real national magnitudes (for scale)")).toBeVisible();
  await expect(page.getByRole("button", { name: /Data status: .*Reference year \d{4}/ }).first()).toBeVisible();
  await expect(page.getByText(/For scale: the conceptual network delivers .* m³\/day, about .*% of/)).toBeVisible();
});

test("play / pause and speed control the animation", async ({ page }) => {
  await open(page);
  const scene = page.getByTestId("flow-scene");
  await expect(scene).toHaveAttribute("data-running", "true");
  await page.getByRole("button", { name: "Pause animation" }).click();
  await expect(scene).toHaveAttribute("data-running", "false");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(scene).toHaveAttribute("data-running", "true");
  const speed = page.getByLabel("Animation speed");
  await speed.fill("4"); // index 4 = 2x
  await expect(page.getByText("2×")).toBeVisible();
  await expect(scene).toHaveAttribute("data-speed", "2");
});

test("layer switches hide labels and leak markers", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Pump", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Labels" }).uncheck();
  await expect(page.getByText("Pump", { exact: true })).toBeHidden();
  await expect(page.getByTestId("flow-scene")).toHaveAttribute("data-layers", "pipes,particles,leaks");
  await page.getByRole("checkbox", { name: "Leak on Residential branch" }).check();
  await expect(page.getByText(/^Leak \d+\.\d{3} m³\/s$/)).toBeVisible();
  await page.getByRole("checkbox", { name: "Leak markers" }).uncheck();
  await expect(page.getByText(/^Leak \d+\.\d{3} m³\/s$/)).toBeHidden();
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 160)).join(" | ")}`)).toEqual([]);
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = ["/", "/command-center", "/explorer", "/prediction-lab", "/water-flow", "/water-budget", "/what-if",
  "/irrigation", "/copilot", "/data-sources", "/settings"];

for (const route of ROUTES) {
  test(`axe: no serious or critical WCAG 2.1 A/AA violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("main h1").first()).toBeVisible();
    await page.waitForTimeout(1500); // let data views settle
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // third-party canvases (WebGL map and 3D scene) have no DOM content to audit
      .exclude(".maplibregl-canvas-container")
      .exclude("canvas")
      .analyze();
    const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    const report = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
    expect(report, report.join("\n")).toEqual([]);
  });
}

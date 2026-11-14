import { expect, test } from "@playwright/test";

// P5 check 11: no page scrolls sideways at phone and tablet widths (found and fixed: What-if, Irrigation, Data Sources).
const ROUTES = ["/command-center", "/explorer", "/prediction-lab", "/water-flow", "/water-budget", "/what-if", "/irrigation", "/copilot", "/data-sources", "/settings"];

for (const width of [375, 768]) {
  test(`no horizontal page scroll at ${width} px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const wide: string[] = [];
    for (const r of ROUTES) {
      await page.goto(r);
      await expect(page.locator("main h1").first()).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (sw > iw + 1) wide.push(`${r}: ${sw}px`);
    }
    expect(wide).toEqual([]);
  });
}

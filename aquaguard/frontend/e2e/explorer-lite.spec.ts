import { expect, test } from "@playwright/test";

// A high-DPI display exposes the regression: updating the toggle must resize the live canvas,
// rather than just change React state or the initial MapLibre constructor options.
test.use({ deviceScaleFactor: 2 });

test("2D Lite mode changes rendering resolution repeatedly without resetting the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/explorer");
  await page.getByRole("tab", { name: "2D Map", exact: true }).click();
  await expect(page.getByTestId("map-mode")).toContainText("2D map (MapLibre, flat)");
  await page.waitForFunction(() => typeof window.__explorerProject === "function");

  await page.locator("#region-select").selectOption("sylhet");
  const map = page.getByTestId("explorer-map");
  await expect(map).toHaveAttribute("data-selection", "division:sylhet");
  const canvas = map.locator("canvas.maplibregl-canvas");
  const original = await canvas.elementHandle();
  const resolution = () => canvas.evaluate((el) => (el as HTMLCanvasElement).width / el.clientWidth);
  const toggle = page.getByRole("button", { name: /^Lite mode (on|off)$/ });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect.poll(resolution).toBeCloseTo(2, 2);
  const center = await page.evaluate(() => window.__explorerProject?.(90.4125, 23.8103));

  for (let cycle = 0; cycle < 3; cycle++) {
    await toggle.click();
    await expect(toggle).toHaveText("Lite mode on");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(resolution).toBeCloseTo(1, 2);
    await toggle.click();
    await expect(toggle).toHaveText("Lite mode off");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(resolution).toBeCloseTo(2, 2);
  }

  expect(await canvas.evaluate((el, previous) => el === previous, original)).toBe(true);
  await expect(map).toHaveAttribute("data-selection", "division:sylhet");
  const after = await page.evaluate(() => window.__explorerProject?.(90.4125, 23.8103));
  expect(after?.x).toBeCloseTo(center!.x, 1);
  expect(after?.y).toBeCloseTo(center!.y, 1);
  expect(errors).toEqual([]);
});

import { expect, test, type Locator } from "@playwright/test";

async function scrub(slider: Locator, value: number) {
  await slider.evaluate((el, next) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("real history: modes, playback, slider, tooltip and monthly chart highlighting", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = page.waitForResponse((r) => r.url().includes("/weather/history?") && r.url().includes("dryness=true"));
  await page.goto("/command-center");
  const history = (await (await response).json()).data;
  const panel = page.getByRole("region", { name: "Water Rhythm", exact: true });
  const slider = panel.getByRole("slider", { name: "Water Rhythm month", exact: true });
  await slider.waitFor();
  await expect(page.getByRole("link", { name: "Explore Water Rhythm" })).toHaveCount(0);
  expect(await panel.evaluate((el) => el.parentElement?.firstElementChild === el)).toBe(true);
  await expect(page.locator("header").getByText("Command Center", { exact: true })).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  const get = (key: string, normal = false) => {
    const s = (normal ? history.normals : history.series).find((v: { variable: string }) => v.variable === key);
    return s.v[s.v.length - 1] as number;
  };
  await expect(panel.getByTestId("rhythm-value")).toHaveAttribute("data-value", String(get("precip_mm") - get("precip_mm", true)));
  await panel.getByRole("button", { name: "Water Balance", exact: true }).click();
  await expect(panel.getByTestId("rhythm-value")).toHaveAttribute("data-value", String(get("d_mm")));
  await panel.getByRole("button", { name: "Dryness", exact: true }).click();
  await expect(panel.getByTestId("rhythm-value")).toHaveAttribute("data-value", String(get("dryness_3m")));
  await panel.getByRole("button", { name: "Rainfall", exact: true }).click();
  const last = await slider.inputValue();
  await panel.getByRole("button", { name: "Previous Water Rhythm observation" }).click();
  await expect(slider).not.toHaveValue(last);
  await panel.getByRole("button", { name: "Next Water Rhythm observation" }).click();
  await expect(slider).toHaveValue(last);
  await panel.getByRole("combobox", { name: "Water Rhythm playback speed" }).selectOption("2");
  await panel.getByRole("button", { name: "Play Water Rhythm", exact: true }).click();
  await expect(slider).toHaveValue("0");
  await expect.poll(() => slider.inputValue()).not.toBe("0");
  await slider.focus(); await slider.press("Home");
  await expect(panel.getByRole("button", { name: "Play Water Rhythm", exact: true })).toBeVisible();
  await slider.press("ArrowRight"); await expect(slider).toHaveValue("1");
  await page.locator("#weather-analysis .js-plotly-plot").first().waitFor();
  await expect.poll(() => page.locator("#weather-analysis .js-plotly-plot").evaluateAll((plots) =>
    plots.map((p) => (p as unknown as { layout: { shapes: unknown[] } }).layout.shapes.length))).toEqual([1, 1]);
  const svg = panel.locator("svg[role=img]"); await svg.hover();
  await expect(panel.getByRole("tooltip")).toBeVisible();
  await panel.getByRole("link", { name: "View full analysis" }).click();
  await expect(page.locator("#weather-analysis")).toBeInViewport();
  await page.getByRole("region", { name: /Rainfall vs 1991/ }).getByRole("button", { name: "View as table" }).click();
  await expect(page.locator("#weather-analysis table").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("geography and date filters scope the shared weather request", async ({ page }) => {
  await page.goto("/command-center");
  const panel = page.getByRole("region", { name: "Water Rhythm", exact: true });
  await panel.getByRole("slider").waitFor();
  const division = page.waitForResponse((r) => r.url().includes("/weather/history?") && r.url().includes("region=dhaka") && r.url().includes("dryness=true"));
  await page.getByRole("combobox", { name: "Region", exact: true }).selectOption("dhaka");
  const history = (await (await division).json()).data;
  await expect(panel).toContainText("Representative divisional weather point");
  const months = history.series[0].t;
  const start = months[1], end = months[3];
  await page.locator("#date-from").fill(start);
  const ranged = page.waitForResponse((r) => r.url().includes("/weather/history?") && r.url().includes(`start=${start}`) && r.url().includes(`end=${end}`));
  await page.locator("#date-to").fill(end);
  await ranged;
  await expect(panel.getByRole("slider")).toHaveAttribute("max", "2");
  await expect(panel).toContainText("3 supported / 3 calendar months");
});

test("missing months remain gaps and unsupported dryness has an honest empty state", async ({ page }) => {
  await page.route("**/api/weather/history?**", async (route) => {
    const response = await route.fetch(); const body = await response.json();
    for (const s of body.data.series) {
      if (s.variable === "precip_mm") s.v[1] = null;
      if (s.variable === "dryness_3m") s.v = s.v.map(() => null);
    }
    body.meta.status = "stale";
    await route.fulfill({ response, json: body });
  });
  await page.goto("/command-center");
  const panel = page.getByRole("region", { name: "Water Rhythm", exact: true });
  const slider = panel.getByRole("slider"); await slider.waitFor();
  await scrub(slider, 1); await expect(panel.getByTestId("rhythm-value")).toHaveAttribute("data-value", "unavailable");
  await expect(panel.locator('svg g[aria-label*="no observation"]')).toHaveCount(1);
  await expect(panel.getByRole("button", { name: /Data status: Stale/ })).toBeVisible();
  await panel.getByRole("button", { name: "Next Water Rhythm observation" }).click(); await expect(slider).toHaveValue("2");
  await panel.getByRole("button", { name: "Dryness", exact: true }).click();
  await expect(panel).toContainText("No observations are available for the selected indicator, region and date range.");
  await expect(panel.getByRole("button", { name: "Play Water Rhythm", exact: true })).toBeDisabled();
});

test("loading, request errors and retry never substitute made-up values", async ({ page }) => {
  let fail = true;
  await page.route("**/api/weather/history?**", async (route) => {
    if (fail) return route.fulfill({ status: 503, json: { detail: "Weather archive test outage" } });
    return route.continue();
  });
  await page.goto("/command-center");
  const panel = page.getByRole("region", { name: "Water Rhythm", exact: true });
  await expect(panel).toContainText("Weather archive test outage");
  await expect(panel.getByTestId("rhythm-value")).toHaveCount(0);
  fail = false; await panel.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(panel.getByTestId("rhythm-value")).toBeVisible();
});

test("an empty archive with URL dates leaves loading and shows the no-data state", async ({ page }) => {
  await page.route("**/api/weather/history?**", async (route) => {
    const response = await route.fetch(); const body = await response.json();
    body.data.series = []; body.data.normals = []; body.meta.status = "unavailable";
    await route.fulfill({ response, json: body });
  });
  await page.goto("/command-center?from=2025-01&to=2025-03");
  const panel = page.getByRole("region", { name: "Water Rhythm", exact: true });
  await expect(panel).toContainText("No observations are available for the selected indicator, region and date range.");
  await expect(panel.getByRole("slider")).toBeDisabled();
});

test("mobile and reduced motion: no overflow or decorative animation; offscreen playback pauses", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/command-center");
  const panel = page.getByRole("region", { name: "Water Rhythm", exact: true });
  const slider = panel.getByRole("slider"); await slider.waitFor(); await panel.scrollIntoViewIfNeeded();
  await expect.poll(() => panel.locator('circle[r="12"]').evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await panel.scrollIntoViewIfNeeded(); await panel.getByRole("button", { name: "Play Water Rhythm", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(panel.locator("[data-active]")).toHaveAttribute("data-active", "false");
  const pausedAt = await slider.inputValue();
  await page.waitForTimeout(1400); await expect(slider).toHaveValue(pausedAt);
});

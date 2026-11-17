import { expect, type Page, test } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/irrigation?region=dhaka");
  await expect(page.getByRole("heading", { name: "Why this estimate" })).toBeVisible();
}

test("changing the crop re-estimates with the new crop", async ({ page }) => {
  await open(page);
  const req = page.waitForRequest((r) => r.url().includes("/api/irrigation/estimate") && (r.postData() ?? "").includes('"crop":"wheat"'));
  await page.getByLabel("Crop").selectOption("wheat");
  await req;
  await expect(page.getByText(/^Wheat \(spring\) · .* days\)$/)).toBeVisible();
});

test("choosing a growth stage changes the stage and Kc", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "Growth stage" }).check();
  await page.getByRole("combobox", { name: "Growth stage" }).selectOption("mid-season");
  await expect(page.getByTestId("crop-stage")).toHaveText("mid-season");
  await page.getByRole("combobox", { name: "Growth stage" }).selectOption("initial");
  await expect(page.getByTestId("crop-stage")).toHaveText("initial");
});

test("division change uses that division's weather point and input metrics omit source notes", async ({ page }) => {
  await open(page);
  await page.getByLabel("Division (weather point)").selectOption("rangpur");
  await expect(page.getByText("Rangpur representative point (one of eight divisional points)")).toBeVisible();
  const why = page.getByRole("region", { name: "Why this estimate" });
  await expect(why.getByText("Reference ET0")).toBeVisible();
  await expect(why.getByText(/retrieved .* ago/)).toHaveCount(0);
  await expect(why.getByText("Forecast", { exact: true })).toHaveCount(0);
  await expect(why.getByRole("listitem").filter({ hasText: "Reference ET0" }).locator("p").nth(1)).toContainText("mm");
});

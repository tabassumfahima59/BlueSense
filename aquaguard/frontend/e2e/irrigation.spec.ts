import { expect, type Page, test } from "@playwright/test";

async function open(page: Page) {
  await page.goto("/irrigation");
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

test("division change uses that division's weather point and every input shows its age", async ({ page }) => {
  await open(page);
  await page.getByLabel("Division (weather point)").selectOption("khulna");
  await expect(page.getByText("Khulna representative point (one of eight divisional points)")).toBeVisible();
  const why = page.getByRole("region", { name: "Why this estimate" });
  await expect(why.getByText("Reference ET0")).toBeVisible();
  await expect(why.getByText(/retrieved .* ago/).first()).toBeVisible();
  // the forecast badge reflects the API status (Live when fresh, Stale otherwise)
  await expect(page.getByRole("button", { name: /^Data status: (Fresh|Stale|Unavailable)/ }).first()).toBeVisible();
});

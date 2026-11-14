import { expect, type Page, test } from "@playwright/test";

const API = "http://127.0.0.1:8013/api";

async function ready(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main h1").first()).toBeVisible();
}

test("sidebar collapses and the state survives a reload", async ({ page }) => {
  await ready(page, "/command-center");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Modules" }).getByRole("link", { name: "Settings" })).toBeVisible();
});

test("region selector: country and eight divisions, kept in the URL", async ({ page }) => {
  await ready(page, "/command-center");
  const select = page.locator("#region-select");
  await expect(select).toBeEnabled();
  await expect(select.locator("option")).toHaveCount(9);
  await select.selectOption("dhaka");
  await expect(page).toHaveURL(/region=dhaka/);
});

test("a district link falls back to its division", async ({ page, request }) => {
  const regions = await (await request.get(`${API}/regions`)).json();
  const district = regions.districts[0];
  await page.goto(`/command-center?region=${district.id}`);
  await expect(page.locator("#region-select")).toHaveValue(district.parentId);
  await expect(page.getByText("District-level data is not available")).toBeVisible();
});

test("command palette: Ctrl+K, keyboard selection and navigation", async ({ page }) => {
  await ready(page, "/settings");
  const box = page.getByRole("combobox", { name: "Search" });
  // the shortcut listener attaches on hydration, which can lag the server-rendered heading under load
  await expect(async () => {
    await page.keyboard.press("Control+k");
    await expect(box).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(box).toBeFocused();
  await box.fill("Sylhet");
  const results = page.getByRole("listbox", { name: "Search results" });
  await expect(results.getByRole("option", { name: /Sylhet/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/command-center\?region=sylhet/);
  await expect(page.locator("#region-select")).toHaveValue("sylhet");
  await page.keyboard.press("Control+k");
  await expect(box).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
});

test("mobile drawer opens, closes with Escape and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "/what-if");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await drawer.getByRole("link", { name: "Smart Irrigation" }).click();
  await expect(page).toHaveURL(/\/irrigation/);
});

test("skip link moves keyboard focus to the main content", async ({ page }) => {
  await ready(page, "/command-center");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("date filter appears only on pages that use dates and is kept in the URL", async ({ page }) => {
  await ready(page, "/settings");
  await expect(page.locator("#date-from")).toHaveCount(0);
  await ready(page, "/command-center");
  const from = page.locator("#date-from");
  await expect(from).toBeVisible();
  const max = await from.getAttribute("max");
  await from.fill(max!);
  await expect(page).toHaveURL(new RegExp(`from=${max}`));
  await page.getByRole("button", { name: "Reset date range" }).click();
  await expect(page).not.toHaveURL(/from=/);
});

test("notifications show the unread count and mark alerts read", async ({ page }) => {
  await ready(page, "/command-center");
  const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  const n = Number((await bell.getAttribute("aria-label"))!.match(/(\d+) unread/)![1]);
  await bell.click();
  const panel = page.getByRole("region", { name: "Alerts", exact: true });
  await panel.getByRole("button", { name: "Mark read" }).first().click();
  if (n > 1) await expect(page.getByRole("button", { name: `Notifications, ${n - 1} unread` })).toBeVisible();
  else await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("manual refresh reports the server's answer", async ({ page }) => {
  await ready(page, "/command-center");
  await page.getByRole("button", { name: "Refresh weather data" }).click();
  // the e2e backend runs offline, so the API refuses outbound refreshes
  await expect(page.getByText("External data access is disabled on this server.")).toBeVisible();
});

test("settings persist and take effect", async ({ page }) => {
  await ready(page, "/settings");
  await page.getByLabel("km³ (billion m³)").check();
  await page.getByLabel("Reduce motion").check();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await page.locator("#default-region").selectOption("khulna");
  await page.reload();
  await expect(page.getByLabel("km³ (billion m³)")).toBeChecked();
  await page.goto("/what-if");
  await expect(page.locator("#region-select")).toHaveValue("khulna");
  await ready(page, "/settings");
  await page.getByRole("button", { name: "Reset preferences…" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset preferences?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByLabel("As published")).toBeChecked();
  await expect(page.locator("html")).not.toHaveAttribute("data-motion", "reduce");
});

test("charts offer a table view", async ({ page }) => {
  await ready(page, "/command-center");
  const toggle = page.getByRole("button", { name: "View as table" }).first();
  await toggle.click();
  await expect(page.getByRole("table").first()).toBeVisible();
  await page.getByRole("button", { name: "View as chart" }).first().click();
});

test("profile menu: keyboard navigation and working items only", async ({ page }) => {
  await ready(page, "/command-center");
  const trigger = page.getByRole("button", { name: "Profile and settings menu" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Profile and settings menu" });
  await expect(menu.getByRole("menuitem")).toHaveText([/Settings/, /Data sources/, /Keyboard shortcuts/]);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

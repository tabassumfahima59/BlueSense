import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (P4): shell, drawer, command palette, keyboard, settings, notifications and axe scans.
 * `npm run e2e` builds the app into .next-e2e with the e2e API URL, then runs these tests against
 * a backend on a copy of the database (backend/scripts/e2e_server.py, offline, no scheduler).
 */
const PY = process.platform === "win32" ? "..\\.venv\\Scripts\\python.exe" : "../.venv/bin/python";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  // software WebGL (SwiftShader) so the 3D Water Flow scene renders in headless Chromium
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } } }],
  webServer: [
    { command: `${PY} ../backend/scripts/e2e_server.py --port 8013`, url: "http://127.0.0.1:8013/api/health",
      timeout: 120_000, reuseExistingServer: false },
    { command: "npx next start -p 3100 -H 127.0.0.1", url: "http://127.0.0.1:3100/settings", timeout: 120_000,
      reuseExistingServer: false, env: { NEXT_DIST_DIR: ".next-e2e" } },
  ],
});

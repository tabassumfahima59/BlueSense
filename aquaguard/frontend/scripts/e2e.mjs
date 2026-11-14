// `npm run e2e`: build into .next-e2e with the e2e API URL (the regular .next build is untouched), then run
// Playwright (which starts the e2e backend and `next start`). Extra arguments are passed to Playwright.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cwd = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase());
const env = { ...process.env, NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_API_URL: "http://127.0.0.1:8013" };
const node = process.execPath;
const run = (args) => spawnSync(node, args, { cwd, env, stdio: "inherit" }).status ?? 1;

if (!process.argv.includes("--no-build")) {
  if (run([join(cwd, "scripts", "copy-maplibre-worker.mjs")]) !== 0) process.exit(1);
  if (run([join(cwd, "node_modules", "next", "dist", "bin", "next"), "build"]) !== 0) process.exit(1);
}
const extra = process.argv.slice(2).filter((a) => a !== "--no-build");
process.exit(run([join(cwd, "node_modules", "@playwright", "test", "cli.js"), "test", ...extra]));

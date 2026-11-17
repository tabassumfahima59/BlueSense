// Runs vitest with an upper-case Windows drive letter in the working directory.
// vitest 4 loads its runner twice when started from "c:\..." (lower-case drive, e.g. VS Code terminals on Windows),
// and every suite then fails with "Cannot read properties of undefined (reading 'config')". Other platforms are
// unaffected: the path is passed through unchanged.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cwd = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase());
const bin = join(cwd, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(result.status ?? 1);

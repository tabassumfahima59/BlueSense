import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// tsconfig keeps JSX for Next.js ("preserve"); tests transform it with the automatic runtime and resolve "@/".
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});

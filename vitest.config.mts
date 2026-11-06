import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", "tests/e2e/**", ".claude/**", "internal/**"],
    environment: "node",
    // Property tests (fast-check, simulations) are CPU-heavy and run 18 files in parallel.
    testTimeout: 30000,
  },
});

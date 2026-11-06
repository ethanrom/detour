import { defineConfig } from "@playwright/test";

// 3100 by default; set E2E_PORT to run beside another server that already holds 3100.
const PORT = Number(process.env.E2E_PORT ?? 3100);

// End-to-end tests run against the production build (same as Vercel) in the machine's installed Chrome.
// No browsers are downloaded: `channel: "chrome"` uses the system install.
export default defineConfig({
  testDir: "tests/e2e",
  // Reports and traces stay inside node_modules so they never show up in `git status`.
  outputDir: "node_modules/.cache/playwright-results",
  workers: 1,
  retries: 0,
  reporter: "list",
  // The live pipeline (extract, evaluate, plan) can take a while; every wait inside a spec is still explicit.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

const port = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Tests run against the production build, since every route is prerendered.
  webServer: {
    command: `npm run build && npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    // No DATABASE_URL in tests: places use the in-memory store; this is the edit code the tests type in,
    // and the enrichment pipeline uses its deterministic stand-in instead of the network.
    env: { PLACES_EDIT_CODE: "e2e-edit-code", PLACES_ENRICH_FAKE: "1" },
  },
});

import { defineConfig, devices } from "@playwright/test";
import { TEST_DSN } from "./e2e/db";

// E2E drives the real UI against the real backend against a DEDICATED test database
// (warehouse_test), on DEDICATED ports — API 8081, UI 5175 — so it never reuses or pollutes the
// dev servers/database (8080 / 5174 / postgres) the owner previews on. It can run while those are
// up. Prerequisite: `docker compose up -d` (postgres :5433).
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5175",
    locale: "en-US",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // ensure-test guarantees warehouse_test exists before gorm.Open runs — Playwright may start
      // this web server before global-setup, and the backend would otherwise crash on a missing DB.
      // global-setup still resets + migrates + seeds it (a fresh DB per run).
      command: "go run ./cmd/tool db ensure-test && go run ./cmd/app_development",
      cwd: "../backend",
      url: "http://localhost:8081/healthz",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        DATABASE_URL: TEST_DSN,
        ADDR: "localhost:8081",
        ALLOWED_ORIGINS: "http://localhost:5175",
        // Services call EACH OTHER over Connect at this URL. It must point at THIS backend's port,
        // or a cross-service RPC (e.g. TeamAccessList → team_service) silently hits the dev :8080.
        INTERNAL_BASE_URL: "http://localhost:8081",
      },
    },
    {
      command: "npm run dev -- --port 5175 --strictPort",
      url: "http://localhost:5175",
      reuseExistingServer: true,
      timeout: 120_000,
      env: { ...process.env, VITE_API_URL: "http://localhost:8081" },
    },
  ],
});

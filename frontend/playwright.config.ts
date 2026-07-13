import { defineConfig, devices } from "@playwright/test";

const DSN =
  "host=localhost port=5433 user=user password=password dbname=postgres sslmode=disable";

// E2E drives the real UI against the real backend against the real database.
// Prerequisite: `docker compose up -d` (postgres :5433).
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    locale: "en-US",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "go run ./cmd/app_development",
      cwd: "../backend",
      url: "http://localhost:8080/healthz",
      reuseExistingServer: true,
      timeout: 120_000,
      env: { DATABASE_URL: DSN },
    },
    {
      command: "npm run dev",
      url: "http://localhost:5174",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

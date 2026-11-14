import { defineConfig, devices } from "@playwright/test";
import { TEST_DSN } from "./e2e/db";
import { API_PORT, API_URL, DB_NAME, PUBSUB_PROJECT, UI_PORT, UI_URL, WORKER } from "./e2e/env";

// E2E drives the real UI against the real backend against a DEDICATED test database
// (warehouse_test), on DEDICATED ports — API 8081, UI 5175 — so it never reuses or pollutes the
// dev servers/database (8080 / 5174 / postgres) the owner previews on. It can run while those are
// up. Prerequisite: `docker compose up -d` (postgres :5433).
//
// ── ONE RUN, OR SEVERAL SIDE BY SIDE (backlog #51) ──────────────────────────────────────────────────────────────────
// With nothing set this file is the single run above, exactly as it always was. `go run ./tools/san test full
// --workers N` (docs/tools/san.md#test-full) starts N Playwright runs AT ONCE from the frozen copy, and tells each
// one by its environment where it lives (e2e/env.ts) — its own of everything a run touches:
//
//   worker  database (E2E_DB_NAME)  API (E2E_API_PORT)  UI (E2E_UI_PORT)  events (E2E_PUBSUB_PROJECT)
//   w1      warehouse_test_w1       8181                5181              warehouse-e2e-w1
//   w2      warehouse_test_w2       8182                5182              warehouse-e2e-w2
//   w3      warehouse_test_w3       8183                5183              warehouse-e2e-w3
//
// (A port another program holds is skipped for the next free one — san never kills a foreign process.)
// Each worker's database is CLONED from warehouse_test_tpl, which san migrates and seeds once
// (E2E_DB_TEMPLATE → `san db reset-test --template`), so a batch's reset costs a second, not the migrations. Each
// worker's events project has its own push subscriptions, pointed at its own API port (e2e/pubsub.ts), so no worker
// is pushed another's events. Its run lock (.e2e-lock.w1), output folder (test-results/w1), Vite cache
// (node_modules/.vite-e2e-w1) and saved sign-ins (e2e/.auth/w1/) are its own too. Inside a worker the specs still
// run one at a time, in NAME order, on its one database — so every "named to sort after orders.spec.ts" rule holds.
// Playwright's own `workers` stays 1: the parallelism is N whole runs, each with its own server and database.
export default defineConfig({
  testDir: "./e2e",
  outputDir: WORKER === "" ? "test-results" : `test-results/${WORKER}`,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: UI_URL,
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
      command: `go run ../tools/san db ensure-test --name ${DB_NAME} && go run ./cmd/app_development`,
      cwd: "../backend",
      url: `${API_URL}/healthz`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        DATABASE_URL: TEST_DSN,
        // Loopback by default; CI sets E2E_API_ADDR=0.0.0.0:8081 so the Pub/Sub emulator's container can push.
        ADDR: process.env.E2E_API_ADDR || `localhost:${API_PORT}`,
        // Its own emulator project — never the dev server's (e2e/pubsub.ts, PUBSUB_PROJECT), and a worker's own.
        PUBSUB_PROJECT,
        ALLOWED_ORIGINS: UI_URL,
        // Services call EACH OTHER over Connect at this URL. It must point at THIS backend's port,
        // or a cross-service RPC (e.g. TeamAccessList → team_service) silently hits the dev :8080.
        INTERNAL_BASE_URL: API_URL,
        // The document file endpoint clients PUT/GET through. Must be THIS backend's port, or a
        // browser image upload PUTs to the dead dev :8080 instead of :8081.
        DOCUMENT_BASE_URL: `${API_URL}/local-storage`,
      },
    },
    {
      command: `npm run dev -- --port ${UI_PORT} --strictPort`,
      url: UI_URL,
      reuseExistingServer: true,
      timeout: 120_000,
      // A worker's Vite keeps its own dependency cache: N dev servers optimising into one node_modules/.vite at once
      // replace each other's files mid-write (vite.config.ts reads VITE_CACHE_DIR).
      env: {
        ...process.env,
        VITE_API_URL: API_URL,
        ...(WORKER === "" ? {} : { VITE_CACHE_DIR: `node_modules/.vite-e2e-${WORKER}` }),
      },
    },
  ],
});

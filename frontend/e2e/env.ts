// WHERE THIS E2E RUN LIVES — its database, its two ports, its events project — read from the environment, so one
// suite can run as several WORKERS side by side, each on its own of everything (backlog #51, `san test full
// --workers N`, docs/tools/san.md#test-full).
//
// With nothing set, it is the single run it always was: warehouse_test, API :8081, UI :5175, the warehouse-e2e
// project. `san test full --workers N` starts N Playwright runs at once and gives each its own values:
//
//   E2E_WORKER          a label ("w1") — names the run lock, the output folder, Vite's cache and the saved sign-ins
//   E2E_API_PORT        the backend's port (default 8081)
//   E2E_UI_PORT         the Vite dev server's port (default 5175)
//   E2E_DB_NAME         the test database (default warehouse_test; must start with warehouse_test — san db refuses others)
//   E2E_DB_TEMPLATE     a migrated + seeded database to CLONE instead of migrating (CREATE DATABASE … TEMPLATE …)
//   E2E_PUBSUB_PROJECT  the emulator project (default warehouse-e2e), so no worker receives another's events
//
// ⚠ A spec never writes `localhost:8081` — it uses API_URL (Node side) or receives it as an argument of
// page.evaluate (browser side: a Node constant is not in scope inside the page).

function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name}=${raw} is not a port`);
  }

  return port;
}

/** The worker's label, "" for the classic single run. */
export const WORKER = process.env.E2E_WORKER ?? "";

export const API_PORT = envPort("E2E_API_PORT", 8081);
export const UI_PORT = envPort("E2E_UI_PORT", 5175);

/** The backend, as Node (and the browser) reach it. */
export const API_URL = `http://localhost:${API_PORT}`;

/** The app, as the browser opens it. */
export const UI_URL = `http://localhost:${UI_PORT}`;

/** This run's test database. */
export const DB_NAME = process.env.E2E_DB_NAME || "warehouse_test";

/** A database already migrated and seeded, cloned instead of migrating — set by `san test full --workers`. */
export const DB_TEMPLATE = process.env.E2E_DB_TEMPLATE || "";

/** The Pub/Sub emulator project this run's server publishes to and is pushed from. */
export const PUBSUB_PROJECT = process.env.E2E_PUBSUB_PROJECT || "warehouse-e2e";

/** A suffix for the files a run keeps beside the others' (".w1"), "" for the single run. */
export const WORKER_SUFFIX = WORKER === "" ? "" : `.${WORKER}`;

/** Where the setup saves a role's sign-in (a Playwright storageState), per worker — e2e/.auth/, gitignored. */
export function signInStatePath(username: string): string {
  return `${process.cwd()}/e2e/.auth/${WORKER === "" ? "single" : WORKER}/${username}.json`;
}

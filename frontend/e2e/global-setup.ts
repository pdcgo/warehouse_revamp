import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ADMIN_DSN, TEST_DSN } from "./db";
import { API_URL, DB_NAME, DB_TEMPLATE, UI_URL, signInStatePath } from "./env";
import { acquireRunLock } from "./lock";
import { ensurePubsubTopicsCommand, requirePubsubEmulator } from "./pubsub";

// The e2e drives the REAL backend against a REAL database — but the DEDICATED test database
// (warehouse_test), never the dev one. Requires `docker compose up -d` (postgres on :5433) AND the Pub/Sub
// emulator, `docker compose --profile pubsub up -d pubsub` (:8085) — checked first, see e2e/pubsub.ts.
//
// Migration order is a CONTRACT, not a preference: team_service seeds team 1, and user_service's
// root-user seed puts ROLE_ROOT *in team 1*. There is no cross-service foreign key to enforce it,
// so running them the other way round produces a role pointing at a team that does not exist yet.

export const ROOT_USERNAME = "root";
export const ROOT_PASSWORD = "rootpassword123";

// Root is seeded as user 1 (user_service 00003_seed_root_user.sql). A spec that creates a team through the API
// names it as the Owner: TeamCreate makes the NAMED person the Owner, never the caller
// (the-create-team-form-names-the-first-owner).
export const ROOT_USER_ID = "1";

// The services whose migrations run, DISCOVERED FROM THE FILESYSTEM rather than listed.
//
// This used to be a hand-maintained list, and it went stale exactly as you would expect: revenue_service
// (#75) shipped with migrations that were never added here, so `order_revenues` did not exist and the
// #78 screen failed against a table that was only missing in the e2e. A list of services that must be
// updated by hand every time a service is born is a bug with a delay on it.
//
// SEEDED FIRST is a contract, not a preference: team_service seeds team 1, and user_service's root-user
// seed puts ROLE_ROOT *in team 1*. There is no cross-service foreign key to enforce that, so the wrong
// order produces a role pointing at a team that does not exist yet. inventory_service follows them: its
// 00023 frees the table names supplier_service's 00001 creates (the-supplier-gets-its-own-service).
// Everything after them is independent by design (HARD RULE 3), so discovery order is fine.
function servicesToMigrate(): string[] {
  const seededFirst = ["team_service", "user_service", "inventory_service"];

  const discovered = readdirSync("../backend/services", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("_service"))
    .map((entry) => entry.name)
    // A service with no migrations of its own (mcp_service owns no table) has nothing to apply — as san_testdb says.
    .filter((name) => existsSync(`../backend/services/${name}/db_migrations`))
    .filter((name) => !seededFirst.includes(name))
    .sort();

  return [...seededFirst, ...discovered];
}

// The roles signed in once per run (e2e/session.ts). Root is the one nearly every spec signs in as; the other people
// a spec signs in as are made by that spec itself, so they are signed in by its own tests.
const SIGNED_IN_ONCE: Array<{ username: string; password: string }> = [
  { username: ROOT_USERNAME, password: ROOT_PASSWORD },
];

// saveSignIns signs each role in ONCE, through the real Login RPC, and saves it as a Playwright storageState: the token
// in localStorage, where the sign-in form's "Remember me" (on by default) puts it. The server is already up — Playwright
// starts the web servers before this setup — but it may still be booting, so its health is awaited first.
async function saveSignIns(): Promise<void> {
  const deadline = Date.now() + 120_000;

  for (;;) {
    try {
      const res = await fetch(`${API_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) break;
    } catch {
      // not up yet
    }

    if (Date.now() > deadline) throw new Error(`the e2e API at ${API_URL} never answered /healthz`);
    await new Promise((r) => setTimeout(r, 500));
  }

  for (const who of SIGNED_IN_ONCE) {
    const res = await fetch(`${API_URL}/warehouse.user.v1.AuthService/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(who),
    });
    if (!res.ok) throw new Error(`signing ${who.username} in once: ${res.status} ${await res.text()}`);

    const { token } = (await res.json()) as { token: string };
    const path = signInStatePath(who.username);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        cookies: [],
        origins: [{ origin: UI_URL, localStorage: [{ name: "warehouse_revamp.token", value: token }] }],
      }),
    );
  }
}

export default async function globalSetup(): Promise<void> {
  // Before ANYTHING: is the Pub/Sub emulator up? Without it the suite fails slowly and far from the cause
  // (e2e/pubsub.ts). Nothing has been touched yet, so stopping here costs nothing.
  await requirePubsubEmulator();

  // Then, before anything destructive: refuse to start if another run is already going. The next
  // line drops the shared database, and doing that under a live run is what made this suite look
  // flaky for a whole session. See e2e/lock.ts.
  acquireRunLock();

  const run = (cmd: string) =>
    execSync(cmd, { cwd: "../backend", stdio: "inherit", env: { ...process.env } });

  // The topics live in the emulator's memory, so a restarted emulator has none. Idempotent.
  run(ensurePubsubTopicsCommand());

  // A WORKER of `san test full --workers N` CLONES its database from a template san migrated and seeded once
  // (CREATE DATABASE … TEMPLATE …, about a second) — the template holds exactly what the steps below would make.
  // ⚠ san builds that template with these same steps (tools/san/test_workers.go, templateSteps): change both.
  if (DB_TEMPLATE !== "") {
    run(`go run ../tools/san db reset-test --name ${DB_NAME} --template ${DB_TEMPLATE} --admin-dsn "${ADMIN_DSN}"`);
    await saveSignIns();

    return;
  }

  // Start from a fresh, EMPTY test database every run — the dev database is never touched.
  run(`go run ../tools/san db reset-test --name ${DB_NAME} --admin-dsn "${ADMIN_DSN}"`);

  for (const service of servicesToMigrate()) {
    run(`go run ../tools/san migrate up --service ${service} --dsn "${TEST_DSN}"`);
  }
  // A TINY region fixture — one real chain (Aceh → … → Keude Bakongan), not the 91.599-row seed.
  // The order form's AddressPicker needs regions to be pickable at all, but making every e2e run load
  // the whole country would cost seconds and couple the suite to upstream reference data. Five rows
  // prove the cascade and the snapshot; the loader is the same one production uses.
  run(
    `go run ../tools/san region load-seed --file ../frontend/e2e/fixtures/regions.csv --dsn "${TEST_DSN}"`,
  );

  // The migration creates root with an EMPTY password, which bcrypt can never match. Without this
  // the account exists and cannot log in — which is the point.
  run(`go run ../tools/san seed root --password ${ROOT_PASSWORD} --dsn "${TEST_DSN}"`);

  // Sign in ONCE per role and save it (Playwright storageState) — specs reuse it instead of typing the form in every
  // test (e2e/session.ts). auth.spec.ts still types it: signing in is what it tests.
  await saveSignIns();
}

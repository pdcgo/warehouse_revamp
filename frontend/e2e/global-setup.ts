import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { ADMIN_DSN, TEST_DSN } from "./db";

// The e2e drives the REAL backend against a REAL database — but the DEDICATED test database
// (warehouse_test), never the dev one. Requires `docker compose up -d` (postgres on :5433).
//
// Migration order is a CONTRACT, not a preference: team_service seeds team 1, and user_service's
// root-user seed puts ROLE_ROOT *in team 1*. There is no cross-service foreign key to enforce it,
// so running them the other way round produces a role pointing at a team that does not exist yet.

export const ROOT_USERNAME = "root";
export const ROOT_PASSWORD = "rootpassword123";

// The services whose migrations run, DISCOVERED FROM THE FILESYSTEM rather than listed.
//
// This used to be a hand-maintained list, and it went stale exactly as you would expect: revenue_service
// (#75) shipped with migrations that were never added here, so `order_revenues` did not exist and the
// #78 screen failed against a table that was only missing in the e2e. A list of services that must be
// updated by hand every time a service is born is a bug with a delay on it.
//
// SEEDED FIRST is a contract, not a preference: team_service seeds team 1, and user_service's root-user
// seed puts ROLE_ROOT *in team 1*. There is no cross-service foreign key to enforce that, so the wrong
// order produces a role pointing at a team that does not exist yet. Everything after them is
// independent by design (HARD RULE 3), so discovery order is fine.
function servicesToMigrate(): string[] {
  const seededFirst = ["team_service", "user_service"];

  const discovered = readdirSync("../backend/services", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("_service"))
    .map((entry) => entry.name)
    .filter((name) => !seededFirst.includes(name))
    .sort();

  return [...seededFirst, ...discovered];
}

export default function globalSetup(): void {
  const run = (cmd: string) =>
    execSync(cmd, { cwd: "../backend", stdio: "inherit", env: { ...process.env } });

  // Start from a fresh, EMPTY test database every run — the dev database is never touched.
  run(`go run ./cmd/tool db reset-test --dsn "${ADMIN_DSN}"`);

  for (const service of servicesToMigrate()) {
    run(`go run ./cmd/tool migrate up --service ${service} --dsn "${TEST_DSN}"`);
  }
  // A TINY region fixture — one real chain (Aceh → … → Keude Bakongan), not the 91.599-row seed.
  // The order form's AddressPicker needs regions to be pickable at all, but making every e2e run load
  // the whole country would cost seconds and couple the suite to upstream reference data. Five rows
  // prove the cascade and the snapshot; the loader is the same one production uses.
  run(
    `go run ./cmd/tool region load-seed --file ../frontend/e2e/fixtures/regions.csv --dsn "${TEST_DSN}"`,
  );

  // The migration creates root with an EMPTY password, which bcrypt can never match. Without this
  // the account exists and cannot log in — which is the point.
  run(`go run ./cmd/tool seed root --password ${ROOT_PASSWORD} --dsn "${TEST_DSN}"`);
}

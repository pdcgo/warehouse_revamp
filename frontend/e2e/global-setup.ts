import { execSync } from "node:child_process";
import { ADMIN_DSN, TEST_DSN } from "./db";

// The e2e drives the REAL backend against a REAL database — but the DEDICATED test database
// (warehouse_test), never the dev one. Requires `docker compose up -d` (postgres on :5433).
//
// Migration order is a CONTRACT, not a preference: team_service seeds team 1, and user_service's
// root-user seed puts ROLE_ROOT *in team 1*. There is no cross-service foreign key to enforce it,
// so running them the other way round produces a role pointing at a team that does not exist yet.

export const ROOT_USERNAME = "root";
export const ROOT_PASSWORD = "rootpassword123";

export default function globalSetup(): void {
  const run = (cmd: string) =>
    execSync(cmd, { cwd: "../backend", stdio: "inherit", env: { ...process.env } });

  // Start from a fresh, EMPTY test database every run — the dev database is never touched.
  run(`go run ./cmd/tool db reset-test --dsn "${ADMIN_DSN}"`);

  run(`go run ./cmd/tool migrate up --service team_service --dsn "${TEST_DSN}"`);
  run(`go run ./cmd/tool migrate up --service user_service --dsn "${TEST_DSN}"`);
  run(`go run ./cmd/tool migrate up --service shipping_service --dsn "${TEST_DSN}"`);
  run(`go run ./cmd/tool migrate up --service product_service --dsn "${TEST_DSN}"`);
  run(`go run ./cmd/tool migrate up --service document_service --dsn "${TEST_DSN}"`);

  // The migration creates root with an EMPTY password, which bcrypt can never match. Without this
  // the account exists and cannot log in — which is the point.
  run(`go run ./cmd/tool seed root --password ${ROOT_PASSWORD} --dsn "${TEST_DSN}"`);
}

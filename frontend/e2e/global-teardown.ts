import { execSync } from "node:child_process";
import { ADMIN_DSN } from "./db";
import { holdsRunLock, releaseRunLock } from "./lock";

// Clean up after testing: drop the test database so a run leaves nothing behind. The drop uses
// WITH (FORCE), so a still-running e2e backend holding a connection can't block it.
export default function globalTeardown(): void {
  // ⚠ ONLY THE RUN THAT ACTUALLY STARTED CLEANS UP.
  //
  // Playwright calls this even when globalSetup THREW — so a run refused by the lock arrives here
  // too, and dropping the database from here would destroy the run it had just declined to disturb.
  // That is precisely the failure the lock exists to prevent, and the first version of this file
  // caused it: the refused run dropped the database while the live one was midway through its
  // migrations, killing it with `database "warehouse_test" does not exist`.
  //
  // A run that never began owns nothing and must remove nothing.
  if (!holdsRunLock()) return;

  execSync(`go run ./cmd/tool db drop-test --dsn "${ADMIN_DSN}"`, {
    cwd: "../backend",
    stdio: "inherit",
    env: { ...process.env },
  });

  releaseRunLock();
}

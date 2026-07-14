import { execSync } from "node:child_process";
import { ADMIN_DSN } from "./db";

// Clean up after testing: drop the test database so a run leaves nothing behind. The drop uses
// WITH (FORCE), so a still-running e2e backend holding a connection can't block it.
export default function globalTeardown(): void {
  execSync(`go run ./cmd/tool db drop-test --dsn "${ADMIN_DSN}"`, {
    cwd: "../backend",
    stdio: "inherit",
    env: { ...process.env },
  });
}

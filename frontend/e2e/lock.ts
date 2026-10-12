import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A run lock, because two e2e runs at once DESTROY EACH OTHER SILENTLY.
//
// The suite shares ONE database and ONE pair of ports, and both ends of its lifecycle are
// destructive:
//
//   global-setup    → `db reset-test`  DROPS and recreates warehouse_test
//   global-teardown → `db drop-test`   DROPS it WITH (FORCE), cutting live connections
//   playwright.config → reuseExistingServer: true, so a second run ATTACHES to the first's servers
//
// So a second run starting while a first is mid-flight wipes the first's data underneath it — and a
// first run finishing while a second is mid-flight does the same in reverse. Neither run is told.
// What you see instead is a test failing somewhere arbitrary because a list it just populated is
// suddenly empty, or the page it navigated to has no record behind it. It reads exactly like a flaky
// application.
//
// It cost most of a session to diagnose: the failure moved between tests on every run — shop options,
// team options, an order detail page — which is what sent the search after an application bug that
// was never there. Three fully sequential runs pass 14/14; overlapping ones do not.
//
// The lock turns that into a refusal with a reason, which is the same bargain `strictPort` makes in
// vite.config.ts and `ValidateDescriptors` makes at server boot: fail loudly at the start rather than
// mysteriously in the middle.
const LOCK_PATH = join(process.cwd(), ".e2e-lock");

interface LockFile {
  pid: number;
  startedAt: string;
}

// Is that process still alive? `kill(pid, 0)` sends no signal — it only asks. On Windows Node still
// answers this correctly, which is what makes a STALE lock reclaimable: a run killed with Ctrl-C
// never reaches teardown, and without this check its lock would block every future run.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

export function acquireRunLock(): void {
  if (existsSync(LOCK_PATH)) {
    let held: LockFile | undefined;

    try {
      held = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as LockFile;
    } catch {
      // An unreadable lock is a corrupt one, not a held one — treat it as stale.
      held = undefined;
    }

    if (held && held.pid !== process.pid && alive(held.pid)) {
      throw new Error(
        [
          "",
          "Another e2e run is already in progress (pid " + held.pid + ", started " + held.startedAt + ").",
          "",
          "Refusing to start, because these two runs would destroy each other: the suite shares ONE",
          "database, and this run's setup would DROP it while the other is mid-test. The other run",
          "would then fail somewhere arbitrary, with a list mysteriously empty — it would look like a",
          "flaky app, and it would not be.",
          "",
          "Wait for it to finish. If you are certain nothing is running, delete " + LOCK_PATH + ".",
          "",
        ].join("\n"),
      );
    }
  }

  const lock: LockFile = { pid: process.pid, startedAt: new Date().toISOString() };

  writeFileSync(LOCK_PATH, JSON.stringify(lock));
}

// Does THIS process hold the lock?
//
// ⚠ Teardown must ask before it cleans up, and the first version of this file did not — which
// reproduced, exactly, the bug the lock exists to prevent.
//
// Playwright runs globalTeardown even when globalSetup THREW. So the refused run went straight on to
// drop the shared database — while the run it had just declined to disturb was midway through its
// migrations. The victim died with `database "warehouse_test" does not exist`, which is the same
// silent, arbitrary-looking failure as before, now caused by the guard.
//
// A run that never started owns nothing and must clean up nothing.
export function holdsRunLock(): boolean {
  if (!existsSync(LOCK_PATH)) return false;

  try {
    const held = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as LockFile;

    return held.pid === process.pid;
  } catch {
    return false;
  }
}

// Only the holder clears it. A run that refused to start must not delete the lock belonging to the
// run it refused to disturb.
export function releaseRunLock(): void {
  if (!existsSync(LOCK_PATH)) return;

  try {
    const held = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as LockFile;

    if (held.pid !== process.pid) return;
  } catch {
    // Corrupt — clearing it is the useful outcome.
  }

  unlinkSync(LOCK_PATH);
}

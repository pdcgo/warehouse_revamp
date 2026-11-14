import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { signInStatePath } from "./env";

// SIGN IN ONCE PER ROLE (backlog #51). The setup signs each role in once, through the real Login RPC, and saves it as a
// Playwright storageState (global-setup.ts, saveSignIns — root today: the person nearly every spec signs in as). A
// test's sign-in then REUSES it — the token goes into the fresh page's storage and the app opens signed in — instead of
// typing the form, which cost two page loads and a bcrypt check in nearly every test of the suite.
//
// Only on a FRESH page (about:blank — a test's first sign-in): a page already signed in as someone else may still be
// renewing that person's token (CheckAccess on every load), and a late answer would write it back over the reused one.
// Such a page, and every role nobody saved, signs in through the form exactly as before. auth.spec.ts, profile.spec.ts
// and users.spec.ts keep their own form sign-in: signing in, and what a password change does to it, is what they test.
export async function signIn(page: Page, username: string, password: string): Promise<void> {
  const state = signInStatePath(username);
  const fresh = page.url() === "about:blank";

  if (fresh && existsSync(state)) {
    await page.context().setStorageState(state);
    await page.goto("/");
    await expect(page.getByTestId("current-user")).toHaveText(username);

    return;
  }

  await page.goto("/");

  // ⚠ A page already signed in (a second sign-in inside one test) renews that person's token on load (CheckAccess) and
  // writes the answer back: cleared before it lands, the old session is restored and /login redirects straight back
  // into the app — the Username field never shows. Let it settle first, as users.spec.ts does. Seen under the CPU load
  // of five parallel workers (2026-11-14); a fresh page has no token, so nothing to wait for.
  if (!fresh) {
    await page.waitForLoadState("networkidle");
  }

  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
}

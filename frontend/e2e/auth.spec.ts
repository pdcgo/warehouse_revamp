import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

async function login(page: import("@playwright/test").Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an unauthenticated visitor is sent to login", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // The brand: a readable tab title and the wordmark on the login card.
  await expect(page).toHaveTitle("PDC Warehouse");
  await expect(page.getByText("PDC Warehouse")).toBeVisible();
});

test("the password field can be revealed and hidden", async ({ page }) => {
  await page.goto("/login");

  const password = page.getByLabel("Password", { exact: true });
  await password.fill("hunter2");

  // Masked by default; the toggle flips it to plain text and back.
  await expect(password).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");

  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
});

test("bad credentials are refused, and do not reveal whether the account exists", async ({ page }) => {
  await login(page, ROOT_USERNAME, "wrong-password");

  const rootError = page.getByTestId("login-error");
  await expect(rootError).toBeVisible();
  const rootMessage = (await rootError.textContent())?.trim();

  await login(page, "no-such-user", "wrong-password");

  const unknownError = page.getByTestId("login-error");
  await expect(unknownError).toBeVisible();
  const unknownMessage = (await unknownError.textContent())?.trim();

  // IDENTICAL. A different message for a real vs. a fake account turns login into a username
  // oracle: an attacker learns which accounts exist and targets them.
  expect(unknownMessage).toBe(rootMessage);

  await expect(page).toHaveURL(/\/login$/);
});

test("root logs in, lands in the app, and sees the root team", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("home-user")).toContainText("root");

  // The team NAME proves TeamAccessList resolved it from team_service over RPC (TeamByIds) —
  // there is no SQL join across the service boundary.
  await expect(page.getByTestId("home-team")).toContainText("Root Team");
  await expect(page.getByTestId("current-user")).toHaveText("root");
});

test("the session survives a page reload (CheckAccess revalidates the stored token)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText("root");

  await page.reload();

  // Still in. The token came from localStorage and CheckAccess said it was good — no flash of
  // the login page, because AuthGate blocks the first render until that settles.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("home-user")).toContainText("root");
});

test("a scoped RPC works from the browser: the Teams page lists teams", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.getByRole("link", { name: "Teams" }).click();

  await expect(page).toHaveURL(/\/teams$/);
  await expect(page.getByTestId("teams-table")).toContainText("Root Team");
  await expect(page.getByTestId("teams-table")).toContainText("ROOT");
});

test("a corrupted token is discarded, not trusted", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText("root");

  // Forge a token. CheckAccess must reject the signature on the next load.
  await page.evaluate(() => {
    window.localStorage.setItem("warehouse_revamp.token", "not-a-real-token");
  });

  await page.reload();

  await expect(page).toHaveURL(/\/login$/);

  // And the bad token must be GONE — a rejected token that lingers means every subsequent
  // request carries a credential the server has already refused.
  const token = await page.evaluate(() => window.localStorage.getItem("warehouse_revamp.token"));
  expect(token).toBeNull();
});

test("sign out clears the session", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText("root");

  // Sign out lives inside the user card at the foot of the sidebar: open it, then pick "Sign out".
  await page.getByTestId("user-menu").click();
  await page.getByTestId("sign-out").click();

  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("the user menu switches the theme, and the choice sticks across a reload (#214/#213)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText("root");

  const html = page.locator("html");

  // Theme lives in the sidebar-foot user menu, as a switch row (the-account-menu-switches-theme-and-language).
  // Switch it on → Dark → the `.dark` class Chakra reads goes on <html>.
  await page.getByTestId("user-menu").click();
  await page.getByTestId("theme-switch").click();
  await expect(html).toHaveClass(/dark/);

  // The choice is persisted (localStorage), so it survives a full reload rather than snapping back.
  await page.reload();
  await expect(page.getByTestId("home-user")).toContainText("root");
  await expect(html).toHaveClass(/dark/);

  // And switched off again, back to Light, removes it.
  await page.getByTestId("user-menu").click();
  await page.getByTestId("theme-switch").click();
  await expect(html).not.toHaveClass(/dark/);
});

// ── #92 — a failed CheckAccess drops the token only on the server's verdict ────────────────────────────────────────────
//
// The rule (features/auth/tokenVerdict.ts; the bug it fixed: an aborted CheckAccess signed the person out): the stored
// token is dropped only when the SERVER says it is no good — Connect `unauthenticated` (expired, garbage, minted before a
// password reset) or `permission_denied` (suspended). A check that got no verdict — aborted (the browser cancels a page's
// fetches when the person moves on), the network, a 5xx — keeps the token and whoever is signed in; the next page load
// asks again.
//
// Each case: root signs in, then the page reloads with its CheckAccess stubbed (page.route), unrouted after. A dev build
// sends the check TWICE per load (StrictMode, AuthContext.tsx): "the page's second check" fails while the first answers,
// as when the person navigates on mid-load. When EVERY check of a load fails there is no answer naming the person, so
// that load has no one to show; what matters is that the token stays and the next load is in without the form.

const CHECK_ACCESS = "**/warehouse.user.v1.AuthService/CheckAccess";
const TOKEN_KEY = "warehouse_revamp.token";

// The stored token, wherever the sign-in kept it (tokenStorage.ts: sessionStorage, else localStorage).
async function storedToken(page: Page) {
  return page.evaluate((key: string) => window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key), TOKEN_KEY);
}

// CheckAccess, from the `from`-th call on (1 = every call), answered by `how`; the calls before it reach the server.
// Returns the live counts (`done`: the load's checks that have ended, answered or failed). The fake answers carry the CORS
// header — the API is another origin, and the app must READ them.
async function failCheckAccess(page: Page, how: "aborted" | "503" | "unauthenticated", from = 1) {
  const seen = { calls: 0, failed: 0, done: 0 };
  const isCheck = (r: { url: () => string; method: () => string }) =>
    r.method() === "POST" && r.url().includes("/warehouse.user.v1.AuthService/CheckAccess");
  page.on("requestfinished", (r) => {
    if (isCheck(r)) seen.done += 1;
  });
  page.on("requestfailed", (r) => {
    if (isCheck(r)) seen.done += 1;
  });
  await page.route(CHECK_ACCESS, async (route: Route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    seen.calls += 1;
    if (seen.calls < from) return route.continue();
    seen.failed += 1;
    if (how === "aborted") return route.abort("aborted");

    const headers = { "access-control-allow-origin": req.headers()["origin"] ?? "*", vary: "Origin" };
    if (how === "503") {
      return route.fulfill({ status: 503, headers, contentType: "text/plain", body: "Service Unavailable" });
    }

    return route.fulfill({
      status: 401,
      headers,
      contentType: "application/json",
      body: JSON.stringify({ code: "unauthenticated", message: "token expired (stubbed by the spec)" }),
    });
  });

  return seen;
}

// Every check the load sent has ended, and at least one of them was failed by the stub.
async function checksSettled(seen: { calls: number; failed: number; done: number }) {
  await expect
    .poll(() => seen.failed > 0 && seen.done >= seen.calls, "the load's CheckAccess calls ended, one failed by the stub")
    .toBe(true);
}

test.describe("signed in, the page reloads and its CheckAccess fails (#92)", () => {
  for (const how of ["aborted", "503"] as const) {
    const said = how === "aborted" ? "aborted" : "answered 503";

    test(`the page's second check ${said}, the first answered — still in the app shell, the token kept`, async ({ page }) => {
      await login(page, ROOT_USERNAME, ROOT_PASSWORD);
      await expect(page.getByTestId("home-user")).toContainText("root");
      expect(await storedToken(page)).not.toBeNull();

      const seen = await failCheckAccess(page, how, 2);
      try {
        await page.reload();
        await checksSettled(seen);

        // Still in: the app shell with root, not the Sign in form.
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByTestId("home-user")).toContainText("root");
        await expect(page.getByTestId("current-user")).toHaveText("root");
        await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
        expect(await storedToken(page), "the token after the failed check").not.toBeNull();
      } finally {
        await page.unroute(CHECK_ACCESS);
      }
    });

    test(`every check of the load ${said} — the token is kept, and the next page load is signed in`, async ({ page }) => {
      await login(page, ROOT_USERNAME, ROOT_PASSWORD);
      await expect(page.getByTestId("home-user")).toContainText("root");
      const before = await storedToken(page);
      expect(before).not.toBeNull();

      const seen = await failCheckAccess(page, how, 1);
      try {
        await page.reload();
        await checksSettled(seen);

        // No verdict on the token: it stays, exactly as it was (nothing renewed it either).
        expect(await storedToken(page), "the token after the failed load").toBe(before);
        test.info().annotations.push({ type: "the failed load shows", description: page.url() });
      } finally {
        await page.unroute(CHECK_ACCESS);
      }

      // The next page load asks again — and the person is in, without signing in.
      await page.goto("/");
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByTestId("home-user")).toContainText("root");
      await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
    });
  }

  test("the check answered unauthenticated (401) — back on the Sign in form, the token dropped", async ({ page }) => {
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    await expect(page.getByTestId("home-user")).toContainText("root");
    expect(await storedToken(page)).not.toBeNull();

    const seen = await failCheckAccess(page, "unauthenticated", 1);
    try {
      await page.reload();

      // The server's verdict: the token is dropped and the person is out.
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      expect(seen.failed, "the load's CheckAccess was answered unauthenticated").toBeGreaterThanOrEqual(1);
      await expect.poll(() => storedToken(page), "the token after the verdict").toBeNull();
    } finally {
      await page.unroute(CHECK_ACCESS);
    }

    // Gone for good: the next page load has no token to check, and opens on Sign in.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});

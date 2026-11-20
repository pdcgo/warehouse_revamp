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

// ── #92 / #96 — a failed CheckAccess drops the token only on the server's verdict, and never opens Sign in ─────────────
//
// The rule (features/auth/tokenVerdict.ts; the bug #92 fixed: an aborted CheckAccess signed the person out): the stored
// token is dropped only when the SERVER says it is no good — Connect `unauthenticated` (expired, garbage, minted before a
// password reset) or `permission_denied` (suspended). A check that got no verdict — aborted (the browser cancels a page's
// fetches when the person moves on), the network, a 5xx — keeps the token and whoever is signed in.
//
// #96: a load whose checks ALL get no verdict does not open Sign in either — nobody is known to be signed out. The shell
// keeps its spinner (`auth-checking`) and sends the check again after 1 s, 3 s and 6 s (~10 s); when every try failed, a
// *no answer* panel (`auth-no-answer`) with Try Again shows instead — the order form's accepted no-answer pattern
// (docs/business/order/context_decision.md, the-form-lock-and-try-again-are-accepted, no-answer-is-only-a-lost-
// connection). The connection coming back (`online`) or the window regaining focus asks once more by itself.
//
// Each case: root signs in, then the page reloads with its CheckAccess stubbed (page.route), unrouted after. A dev build
// sends the check TWICE per load (StrictMode, AuthContext.tsx): "the page's second check" fails while the first answers,
// as when the person navigates on mid-load; "every check" fails the pair and every retry after it.

const CHECK_ACCESS = "**/warehouse.user.v1.AuthService/CheckAccess";
const TOKEN_KEY = "warehouse_revamp.token";

// The panel stands once the retries (1 s + 3 s + 6 s) are spent; the margin covers a slow machine.
const RETRIES_SPENT = 20_000;

type Seen = { sent: number; calls: number; failed: number; done: number };

// The stored token, wherever the sign-in kept it (tokenStorage.ts: sessionStorage, else localStorage).
async function storedToken(page: Page) {
  return page.evaluate((key: string) => window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key), TOKEN_KEY);
}

// CheckAccess calls `from` through `upTo` (1-based; the default: every call) answered by `how` — `network` is a lost
// connection, `aborted` the browser cancelling the fetch; the calls outside that range reach the server.
// Returns the live counts: `sent` every check the page sent (also after the unroute), `calls` those the stub saw,
// `failed` those it failed, `done` those that have ended, answered or failed. The fake answers carry the CORS header —
// the API is another origin, and the app must READ them.
async function failCheckAccess(
  page: Page,
  how: "aborted" | "network" | "503" | "unauthenticated",
  from = 1,
  upTo = Number.POSITIVE_INFINITY,
): Promise<Seen> {
  const seen: Seen = { sent: 0, calls: 0, failed: 0, done: 0 };
  const isCheck = (r: { url: () => string; method: () => string }) =>
    r.method() === "POST" && r.url().includes("/warehouse.user.v1.AuthService/CheckAccess");
  page.on("request", (r) => {
    if (isCheck(r)) seen.sent += 1;
  });
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
    if (seen.calls < from || seen.calls > upTo) return route.continue();
    seen.failed += 1;
    if (how === "aborted") return route.abort("aborted");
    if (how === "network") return route.abort("internetdisconnected");

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
async function checksSettled(seen: Seen) {
  await expect
    .poll(() => seen.failed > 0 && seen.done >= seen.calls, "the load's CheckAccess calls ended, one failed by the stub")
    .toBe(true);
}

// What the gate showed during the page's load, recorded as it happened — a MutationObserver installed before the app's
// first script, so a panel or a Sign in form that flashed and went away is still caught.
type GateSeen = { checking: boolean; noAnswer: boolean; signIn: boolean };

async function watchTheGate(page: Page) {
  await page.addInitScript(() => {
    const seen = { checking: false, noAnswer: false, signIn: false };
    (window as unknown as { __gateSeen: typeof seen }).__gateSeen = seen;
    const look = () => {
      if (document.querySelector('[data-testid="auth-checking"]')) seen.checking = true;
      if (document.querySelector('[data-testid="auth-no-answer"]')) seen.noAnswer = true;
      if (window.location.pathname === "/login") seen.signIn = true;
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
  });
}

async function gateSeen(page: Page): Promise<GateSeen> {
  return page.evaluate(() => (window as unknown as { __gateSeen: GateSeen }).__gateSeen);
}

// Signed in as root, the page reloads with every CheckAccess failing `how`, until the no-answer panel stands. The stub
// is still on when this returns: the caller unroutes it.
async function reloadUntilNoAnswer(page: Page, how: "aborted" | "network" | "503") {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText("root");
  const before = await storedToken(page);
  expect(before).not.toBeNull();

  const seen = await failCheckAccess(page, how);
  const started = Date.now();
  await page.reload();

  await expect(page.getByTestId("auth-no-answer")).toBeVisible({ timeout: RETRIES_SPENT });
  test.info().annotations.push({ type: "the no-answer panel showed after", description: `${Date.now() - started} ms` });

  return { before, seen };
}

// Signed in as root, in the app shell, and no Sign in form.
async function signedInAsRoot(page: Page) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("home-user")).toContainText("root");
  await expect(page.getByTestId("current-user")).toHaveText("root");
  await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
  await expect(page.getByTestId("auth-no-answer")).toHaveCount(0);
}

test.describe("signed in, the page reloads and its CheckAccess fails (#92, #96)", () => {
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

    test(`every check of the load ${said} — the spinner stays, then the no-answer panel with Try Again, never Sign in; the token kept`, async ({
      page,
    }) => {
      await login(page, ROOT_USERNAME, ROOT_PASSWORD);
      await expect(page.getByTestId("home-user")).toContainText("root");
      const before = await storedToken(page);
      expect(before).not.toBeNull();

      const seen = await failCheckAccess(page, how);
      try {
        const started = Date.now();
        await page.reload();

        await test.step("no verdict yet: the shell keeps its spinner on the page, not Sign in, the token as it was", async () => {
          await expect(page.getByTestId("auth-checking")).toBeVisible();
          await expect(page).toHaveURL(/\/$/);
          await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
          expect(await storedToken(page), "the token while the checks fail").toBe(before);
        });

        await test.step("the retries spent: the no-answer panel with Try Again — still not Sign in, the token as it was", async () => {
          await expect(page.getByTestId("auth-no-answer")).toBeVisible({ timeout: RETRIES_SPENT });
          test.info().annotations.push({ type: "the no-answer panel showed after", description: `${Date.now() - started} ms` });
          await expect(page.getByTestId("auth-no-answer-title")).toBeVisible();
          await expect(page.getByTestId("auth-no-answer-try-again")).toBeVisible();
          await expect(page.getByTestId("auth-checking")).toHaveCount(0);
          await expect(page).toHaveURL(/\/$/);
          await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
          // The load's check(s), then the tries after 1 s, 3 s and 6 s — the panel only once they are spent.
          expect(seen.calls, "the checks the stub failed before the panel").toBeGreaterThanOrEqual(4);
          expect(seen.failed, "every check of the load failed").toBe(seen.calls);
          // No verdict on the token: it stays, exactly as it was (nothing renewed it either).
          expect(await storedToken(page), "the token on the no-answer panel").toBe(before);
        });
      } finally {
        await page.unroute(CHECK_ACCESS);
      }

      await test.step("the server answers again, Try Again: signed in as root, no Sign in form", async () => {
        await page.getByTestId("auth-no-answer-try-again").click();
        await signedInAsRoot(page);
        expect(await storedToken(page), "the token after Try Again").not.toBeNull();
      });

      await test.step("regression: the next page load is signed in, without the form", async () => {
        await page.waitForLoadState("networkidle");
        await page.goto("/");
        await signedInAsRoot(page);
      });
    });

    test(`the load's two checks ${said}, a retry answers — signed in, without the no-answer panel or the form`, async ({
      page,
    }) => {
      await login(page, ROOT_USERNAME, ROOT_PASSWORD);
      await expect(page.getByTestId("home-user")).toContainText("root");
      expect(await storedToken(page)).not.toBeNull();

      await watchTheGate(page);
      const seen = await failCheckAccess(page, how, 1, 2);
      try {
        await page.reload();
        await signedInAsRoot(page);

        expect(seen.failed, "the load's first two checks failed").toBe(2);
        expect(seen.calls, "a retry after them reached the server").toBeGreaterThan(2);
        const gate = await gateSeen(page);
        expect(gate.checking, "the spinner showed while the checks had no answer").toBe(true);
        expect(gate.noAnswer, "the no-answer panel never showed").toBe(false);
        expect(gate.signIn, "the Sign in page never showed").toBe(false);
        expect(await storedToken(page), "the token after the retry answered").not.toBeNull();
      } finally {
        await page.unroute(CHECK_ACCESS);
      }
    });
  }

  for (const [event, said] of [
    ["online", "the connection comes back"],
    ["focus", "the person returns to the window"],
  ] as const) {
    test(`the no-answer panel, then ${said} (${event}) — the page checks again by itself and is signed in, without Try Again`, async ({
      page,
    }) => {
      const { before, seen } = await reloadUntilNoAnswer(page, "network");
      try {
        expect(await storedToken(page), "the token on the no-answer panel").toBe(before);
      } finally {
        await page.unroute(CHECK_ACCESS);
      }

      // The server is reachable again, but nothing has asked yet: the panel still stands.
      await expect(page.getByTestId("auth-no-answer")).toBeVisible();
      const asked = seen.sent;

      await page.evaluate((name: string) => window.dispatchEvent(new Event(name)), event);

      await signedInAsRoot(page);
      expect(seen.sent, `a check went out on \`${event}\``).toBeGreaterThan(asked);
      expect(await storedToken(page), "the token after the check answered").not.toBeNull();
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

import { expect, test } from "@playwright/test";
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

  // Sign out now lives inside the top-right user menu: open it, then pick "Sign out".
  await page.getByTestId("user-menu").click();
  await page.getByTestId("sign-out").click();

  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// A unique suffix per run: the e2e talks to a real, persistent database, so a fixed username
// would collide with itself on the second run.
const SUFFIX = Date.now().toString().slice(-6);
const NEW_USER = `e2e${SUFFIX}`;

// The password this user has at each stage. The tests run SERIALLY and deliberately carry state
// forward — each one leaves the account in the state the next one expects.
const NEW_PASSWORD = "e2epassword1"; // set by CreateUser
const SELF_SET_PASSWORD = "changed-pass-1"; // set by the user themselves (ResetPassword)
const ADMIN_SET_PASSWORD = "admin-set-pass-1"; // set by an admin (AdminResetPassword)

// Switching accounts needs an explicit sign-out first: /login redirects an already-authenticated
// visitor straight back into the app, so navigating there while signed in does nothing.
async function login(page: Page, username: string, password: string) {
  await page.goto("/");

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

// loginExpectingFailure drives the form without asserting success.
async function loginExpectingFailure(page: Page, username: string, password: string) {
  await page.goto("/");

  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function gotoUsers(page: Page) {
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page.getByTestId("users-table")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("root can reach the Users screen", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await expect(page.getByTestId(`user-row-${ROOT_USERNAME}`)).toBeVisible();
});

test("CreateUser rejects an invalid username — lowercase alphanumeric only (#87)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await page.getByTestId("open-create-user").click();
  await page.getByTestId("new-username").fill("Bad_Name");
  await page.getByTestId("new-password").fill("e2epassword1");
  await page.getByTestId("new-name").fill("Nope");
  await page.getByTestId("submit-create-user").click();

  // The frontend blocks it with a validation error; no account is created.
  await expect(page.getByTestId("create-user-error")).toBeVisible();
  await expect(page.getByTestId("submit-create-user")).toBeVisible(); // dialog stays open
});

test("CreateUser: a new user appears, and can immediately sign in", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await page.getByTestId("open-create-user").click();
  await page.getByTestId("new-username").fill(NEW_USER);
  await page.getByTestId("new-password").fill(NEW_PASSWORD);
  await page.getByTestId("new-name").fill("E2E User");
  await page.getByTestId("submit-create-user").click();

  // CreateUser writes the account AND the membership in one transaction, so the new user shows
  // up in this team's list right away.
  await expect(page.getByTestId(`user-row-${NEW_USER}`)).toBeVisible();

  // And the account really works — not just a row in a table.
  await login(page, NEW_USER, NEW_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText(NEW_USER);
});

test("UpdateUser: an admin edits another user's name", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await page.getByTestId(`row-actions-${NEW_USER}`).click();
  await page.getByTestId(`edit-${NEW_USER}`).click();
  await page.getByTestId("edit-name").fill("Renamed By Admin");
  await page.getByTestId("submit-edit-user").click();

  await expect(page.getByTestId(`user-row-${NEW_USER}`)).toContainText("Renamed By Admin");
});

test("UserDetail: clicking a user opens their detail page", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  // Clicking the user item navigates to the dedicated detail PAGE (not a dialog).
  await page.getByTestId(`open-user-${NEW_USER}`).click();
  await expect(page.getByTestId("user-detail-page")).toBeVisible();
  await expect(page).toHaveURL(/\/users\/\d+$/);
  await expect(page.getByTestId("user-detail-page")).toContainText(NEW_USER);

  // Back returns to the list.
  await page.getByTestId("user-detail-back").click();
  await expect(page.getByTestId("users-table")).toBeVisible();
});

test("ResetPassword: a user changes their OWN password and stays signed in", async ({ page }) => {
  await login(page, NEW_USER, NEW_PASSWORD);

  await page.getByRole("link", { name: "Profile" }).click();
  await page.getByTestId("open-change-password").click();

  await page.getByTestId("old-password").fill(NEW_PASSWORD);
  await page.getByTestId("new-password-1").fill(SELF_SET_PASSWORD);
  await page.getByTestId("new-password-2").fill(SELF_SET_PASSWORD);
  await page.getByTestId("submit-change-password").click();

  // The dialog must actually close. Asserting only that the page behind it still shows the
  // username would pass even if the RPC failed and the dialog were sitting there with an error.
  await expect(page.getByTestId("password-error")).toBeHidden();
  await expect(page.getByTestId("submit-change-password")).toBeHidden();

  // STILL SIGNED IN. A password change kills every token issued before it — including this
  // browser's. The RPC hands back a fresh one and the client must store it, or the user would
  // log themselves out by changing their password.
  await expect(page.getByTestId("profile-username")).toContainText(NEW_USER);

  await page.reload();
  await expect(page.getByTestId("profile-username")).toContainText(NEW_USER);

  // The old password is dead; the new one works.
  await login(page, NEW_USER, SELF_SET_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText(NEW_USER);
});

test("AdminResetPassword: an admin sets a locked-out user's password", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await page.getByTestId(`row-actions-${NEW_USER}`).click();
  await page.getByTestId(`reset-password-${NEW_USER}`).click();
  await page.getByTestId("admin-new-password-1").fill(ADMIN_SET_PASSWORD);
  await page.getByTestId("admin-new-password-2").fill(ADMIN_SET_PASSWORD);
  await page.getByTestId("submit-admin-reset").click();

  await expect(page.getByTestId("admin-reset-error")).toBeHidden();
  await expect(page.getByTestId("submit-admin-reset")).toBeHidden();

  // The admin never knew the old password — that is the whole point of this being a separate
  // RPC. The user's previous password is now dead, and the admin-set one works.
  await loginExpectingFailure(page, NEW_USER, SELF_SET_PASSWORD);
  await expect(page.getByTestId("login-error")).toBeVisible();

  await login(page, NEW_USER, ADMIN_SET_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText(NEW_USER);
});

test("SuspendUser: suspending cuts the account off; restoring brings it back", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await page.getByTestId(`row-actions-${NEW_USER}`).click();
  await page.getByTestId(`suspend-${NEW_USER}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`suspended-${NEW_USER}`)).toBeVisible();

  // A suspended account cannot sign in. (The password is the one the admin set in the previous
  // test — these run serially and the state carries forward on purpose.)
  await loginExpectingFailure(page, NEW_USER, ADMIN_SET_PASSWORD);
  await expect(page.getByTestId("login-error")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  // Restore.
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);
  await page.getByTestId(`row-actions-${NEW_USER}`).click();
  await page.getByTestId(`suspend-${NEW_USER}`).click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId(`suspended-${NEW_USER}`)).toBeHidden();

  await login(page, NEW_USER, ADMIN_SET_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText(NEW_USER);
});

test("TeamUserUpdate + SearchUser: remove a member, find them again, add them back", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  // Remove from the team. The ACCOUNT survives — only the membership goes.
  await page.getByTestId(`row-actions-${NEW_USER}`).click();
  await page.getByTestId(`remove-${NEW_USER}`).click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId(`user-row-${NEW_USER}`)).toBeHidden();

  // They still exist — visible on the All User tab (#58), which lists everyone across teams.
  await page.getByTestId("users-tab-all").click();
  await expect(page.getByTestId(`user-row-${NEW_USER}`)).toBeVisible();
  await page.getByTestId("users-tab-team").click();

  // SearchUser is unscoped precisely so this works: finding someone who is NOT in your team.
  // The dialog now uses the shared UserSelect combobox (#62).
  await page.getByTestId("open-add-member").click();
  await page.getByTestId("user-select").locator("input").fill(NEW_USER);
  await page.getByTestId(`user-select-option-${NEW_USER}`).click();
  await page.getByTestId("submit-add-member").click();

  await expect(page.getByTestId(`user-row-${NEW_USER}`)).toBeVisible();
});

test("ForgotPassword: recover the account with an OTP, then sign in", async ({ page }) => {
  // The mock OTP backend (dev / test — no Twilio configured) approves this one fixed code for
  // everyone. See backend pkgs/san_verification/otp_mock.go: MockOtpCode.
  const OTP_CODE = "123456";
  const OTP_SET_PASSWORD = "otp-recovered-1";

  // Start signed out, from the login page.
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");

  // Step 1 — ask for a code by username. This ALWAYS advances: the server never reveals whether
  // the account exists, and neither does the UI.
  await page.getByTestId("open-forgot-password").click();
  await page.getByTestId("forgot-username").fill(NEW_USER);
  await page.getByTestId("request-otp").click();

  // Step 2 — enter the code and a new password.
  await page.getByTestId("otp-code").fill(OTP_CODE);
  await page.getByTestId("otp-new-password-1").fill(OTP_SET_PASSWORD);
  await page.getByTestId("otp-new-password-2").fill(OTP_SET_PASSWORD);
  await page.getByTestId("submit-otp-reset").click();

  // Wait for the SUCCESS TOAST before doing anything else. It only appears once the reset RPC
  // has resolved — navigating away sooner (as an earlier version did) aborts the in-flight
  // request, and the password is never actually changed.
  await expect(page.getByText("Password reset")).toBeVisible();

  // The recovery flow deliberately returns NO token, so the user signs in fresh with the new
  // password.
  await login(page, NEW_USER, OTP_SET_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText(NEW_USER);
});

test("DeleteUser: the account is gone for good", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await page.getByTestId(`row-actions-${NEW_USER}`).click();
  await page.getByTestId(`delete-${NEW_USER}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`user-row-${NEW_USER}`)).toBeHidden();

  // Really gone — not just filtered out of this team's view. The All User tab lists everyone.
  await page.getByTestId("users-tab-all").click();
  await expect(page.getByTestId(`user-row-${NEW_USER}`)).toBeHidden();
});

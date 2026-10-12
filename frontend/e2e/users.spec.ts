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
  // ⚠ Let the page SETTLE before clearing. On load the app renews its token (CheckAccess) and writes
  // the answer back — clear before that answer lands and the old session is restored, so /login
  // redirects straight back into the app as the previous user.
  await page.waitForLoadState("networkidle");

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
  // ⚠ Let the page SETTLE before clearing. On load the app renews its token (CheckAccess) and writes
  // the answer back — clear before that answer lands and the old session is restored, so /login
  // redirects straight back into the app as the previous user.
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

// Root's team is the ROOT team, whose only role on offer is the System Administrator — and a form there
// starts with NO role, because making someone an Administrator is never a default (defaultGrant).
const ROLE_ADMINISTRATOR = 2;

// Typing opens the list — a click on the field alone does not.
async function pickRole(page: Page, role: number, label: string) {
  await page.getByTestId("role-select").locator("input").fill(label);
  await page.getByTestId(`role-select-option-${role}`).click();
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

// An account is made ONLY from the Add Member popup, when its search finds nobody
// (an-account-is-made-only-from-the-member-search) — there is no New User button.
async function openCreate(page: Page, term: string) {
  await expect(page.getByTestId("open-create-user")).toHaveCount(0);
  await page.getByTestId("open-add-member").click();
  await page.getByTestId("add-member-search").fill(term);
  await page.getByTestId("add-member-create").click();
}

test("CreateUser rejects an invalid username — lowercase alphanumeric only (#87)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await openCreate(page, `nobody${SUFFIX}`);
  await page.getByTestId("add-member-new-username").fill("Bad_Name");
  await page.getByTestId("add-member-new-password").fill("e2epassword1");
  await page.getByTestId("add-member-new-name").fill("Nope");
  await pickRole(page, ROLE_ADMINISTRATOR, "Administrator");
  await page.getByTestId("submit-add-member").click();

  // The frontend blocks it with a validation error; no account is created.
  await expect(page.getByTestId("add-member-error")).toBeVisible();
  await expect(page.getByTestId("submit-add-member")).toBeVisible(); // dialog stays open
});

test("CreateUser: a new user appears, and can immediately sign in", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  // What was searched for is offered as the username.
  await openCreate(page, NEW_USER);
  await expect(page.getByTestId("add-member-new-username")).toHaveValue(NEW_USER);
  await page.getByTestId("add-member-new-password").fill(NEW_PASSWORD);
  await page.getByTestId("add-member-new-name").fill("E2E User");
  await pickRole(page, ROLE_ADMINISTRATOR, "Administrator");
  await page.getByTestId("submit-add-member").click();

  // CreateUser writes the account AND the membership in one transaction, so the new user shows
  // up in this team's list right away.
  await expect(page.getByTestId(`user-row-${NEW_USER}`)).toBeVisible();

  // And the account really works — not just a row in a table.
  await login(page, NEW_USER, NEW_PASSWORD);
  await expect(page.getByTestId("home-user")).toContainText(NEW_USER);
});

// The role column (UserList's MEMBERSHIP slice) and the membership log (every-role-change-is-logged) both come
// from the running server: the member made above shows their role, and the team's history has the add.
test("Members: the row shows the role, and the history records the add", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await expect(page.getByTestId(`role-${NEW_USER}`)).toContainText("Administrator");

  await page.getByTestId("users-tab-history").click();
  await expect(page.getByTestId("member-log")).toContainText(`${ROOT_USERNAME} added ${NEW_USER} as`);
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

  // The Add Member SEARCH POPUP (a-member-is-found-in-a-search-popup): Root searches by part, picks the
  // person from the list, and gives them a role.
  await page.getByTestId("open-add-member").click();
  await page.getByTestId("add-member-search").fill(NEW_USER);
  await page.getByTestId(`add-member-result-${NEW_USER}`).click();
  await pickRole(page, ROLE_ADMINISTRATOR, "Administrator");
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

test("a user is never deleted: the row offers no Delete", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  // a-user-is-never-deleted — a person who leaves is suspended, and erased on request; the row stays.
  await page.getByTestId(`row-actions-${NEW_USER}`).click();
  await expect(page.getByTestId(`edit-${NEW_USER}`)).toBeVisible();
  await expect(page.getByTestId(`delete-${NEW_USER}`)).toHaveCount(0);
});

// erase-keeps-the-row: a FORMER user — suspended first — is erased on request. The row stays and reads "Former user
// #…", the old username is free again, and the account can never sign in. Last, because it ends the account.
test("UserErase: a suspended account is erased, and its row becomes a former user", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  // Erase is offered only once the account is suspended.
  await page.getByTestId(`row-actions-${NEW_USER}`).click();
  await expect(page.getByTestId(`erase-${NEW_USER}`)).toHaveCount(0);
  await page.getByTestId(`suspend-${NEW_USER}`).click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId(`suspended-${NEW_USER}`)).toBeVisible();

  await page.getByTestId(`row-actions-${NEW_USER}`).click();
  await page.getByTestId(`erase-${NEW_USER}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`user-row-${NEW_USER}`)).toBeHidden();
  await expect(page.getByTestId("users-table")).toContainText("Former user #");

  await loginExpectingFailure(page, NEW_USER, "otp-recovered-1");
  await expect(page.getByTestId("login-error")).toBeVisible();
});

// The Add Member search as an Owner sees it, against the running server:
//  - managers-search-by-exact-username-phone-or-email: a fragment finds nobody; the whole username does, and so
//    does the phone however it is written (Q20d);
//  - a-result-shows-the-phones-last-four-digits: the result carries the ending;
//  - an-existing-member-gets-change-role: someone already in the team reads as Change Role, with their role.
test("SearchUser: an Owner finds only the whole handle, sees the phone ending, and a member reads as Change Role", async ({ page }) => {
  const owner = `own${SUFFIX}`;
  const staff = `stf${SUFFIX}`;
  const target = `tgt${SUFFIX}`;
  const targetPhone = `0813-77${SUFFIX.slice(0, 2)}-${SUFFIX.slice(2)}`;

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Two warehouses: the Owner's, with a Staff member in it, and another holding the person to find.
  await page.evaluate(
    async ([owner, staff, target, targetPhone, suffix, password]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const call = async (method: string, body: unknown) => {
        const res = await fetch(`http://localhost:8081/warehouse.${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
        return res.json();
      };

      const mine = await call("team.v1.TeamService/TeamCreate", { type: 3, name: `E2E Search A ${suffix}`, teamCode: `SA${suffix}`, ownerUserId: "1" });
      const other = await call("team.v1.TeamService/TeamCreate", { type: 3, name: `E2E Search B ${suffix}`, teamCode: `SB${suffix}`, ownerUserId: "1" });

      await call("user.v1.UserService/CreateUser", { teamId: mine.team.id, username: owner, password, name: "E2E Owner", role: "ROLE_WAREHOUSE_OWNER" });
      await call("user.v1.UserService/CreateUser", { teamId: mine.team.id, username: staff, password, name: "E2E Staff", role: "ROLE_WAREHOUSE_STAFF" });
      await call("user.v1.UserService/CreateUser", {
        teamId: other.team.id,
        username: target,
        password,
        name: "E2E Target",
        phoneNumber: targetPhone,
        role: "ROLE_WAREHOUSE_STAFF",
      });
    },
    [owner, staff, target, targetPhone, SUFFIX, NEW_PASSWORD] as const,
  );

  await login(page, owner, NEW_PASSWORD);
  await gotoUsers(page);
  await page.getByTestId("open-add-member").click();

  // A fragment is a browse, and an Owner does not browse.
  await page.getByTestId("add-member-search").fill(target.slice(0, 5));
  await expect(page.getByTestId("add-member-no-match")).toBeVisible();

  // The whole username finds them, with the phone's last four digits.
  await page.getByTestId("add-member-search").fill(target);
  await expect(page.getByTestId(`add-member-result-${target}`)).toContainText(`phone ending ${SUFFIX.slice(2)}`);

  // The same phone, written the international way.
  await page.getByTestId("add-member-search").fill(`+62 813 77${SUFFIX.slice(0, 2)} ${SUFFIX.slice(2)}`);
  await expect(page.getByTestId(`add-member-result-${target}`)).toBeVisible();

  // A member of this team reads as Change Role, with the role they hold.
  await page.getByTestId("add-member-search").fill(staff);
  await page.getByTestId(`add-member-result-${staff}`).click();
  await expect(page.getByTestId("add-member-current-role")).toContainText("Warehouse Staff");
  await expect(page.getByTestId("add-member-dialog")).toContainText("Change role");
});

// a-phone-or-email-belongs-to-one-account, against the running server: the phone of the person found above, written
// the international way, is refused at Create — and Find That Person brings that person up instead.
test("CreateUser: a phone already on an account is refused, and that person is offered", async ({ page }) => {
  const target = `tgt${SUFFIX}`;

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoUsers(page);

  await openCreate(page, `dup${SUFFIX}`);
  await page.getByTestId("add-member-new-password").fill(NEW_PASSWORD);
  await page.getByTestId("add-member-new-name").fill("E2E Duplicate");
  await page.getByTestId("add-member-new-phone").fill(`+62 813 77${SUFFIX.slice(0, 2)} ${SUFFIX.slice(2)}`);
  await pickRole(page, ROLE_ADMINISTRATOR, "Administrator");
  await page.getByTestId("submit-add-member").click();

  await expect(page.getByTestId("add-member-error")).toContainText("already another account's");

  await page.getByTestId("add-member-find-taken").click();
  await expect(page.getByTestId(`add-member-result-${target}`)).toBeVisible();
});

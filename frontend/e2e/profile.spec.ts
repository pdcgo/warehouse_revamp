import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { API_URL } from "./env";

// MY PROFILE, end to end on the real server. The form starts from ProfileDetail — the caller's OWN row, email and phone
// included — and a save sends only what changed, so a name-only save keeps the email and the phone a forgotten
// password's code is sent to. It used to start them blank and save them blank.

const SUFFIX = Date.now().toString().slice(-6);
const USERNAME = `e2eprofile${SUFFIX}`;
const PASSWORD = "e2epassword1";
const EMAIL = `${USERNAME}@example.test`;
const PHONE = `0812${SUFFIX}77`;
const STORED_PHONE = `+62812${SUFFIX}77`; // a-phone-is-saved-in-international-form

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  // ⚠ Let the page SETTLE before clearing — the app renews its token on load and would restore the old session.
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

// rpc calls the API with the page's own token, so a seed runs as the person the UI is signed in as.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      if (!res.ok) throw new Error(`${m}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
  ) as Promise<T>;
}

test.describe.configure({ mode: "serial" });

test("Setup: a person with an email and a phone", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // team 0: a teamless account, Root's to make.
  await rpc(page, "user.v1.UserService/CreateUser", {
    teamId: 0,
    username: USERNAME,
    password: PASSWORD,
    name: "Profile Person",
    email: EMAIL,
    phoneNumber: PHONE,
  });
});

test("Profile: the form shows my email and phone, and a name-only save keeps them", async ({ page }) => {
  await login(page, USERNAME, PASSWORD);

  await page.getByTestId("user-menu").click();
  await page.getByTestId("user-menu-profile").click();

  await expect(page.getByTestId("profile-name")).toHaveValue("Profile Person");
  await expect(page.getByTestId("profile-email")).toHaveValue(EMAIL);
  await expect(page.getByTestId("profile-phone")).toHaveValue(STORED_PHONE);

  await page.getByTestId("profile-name").fill("Profile Renamed");
  await page.getByTestId("save-profile").click();
  await expect(page.getByText("Profile updated")).toBeVisible();

  // What is STORED, read back — not what the form happens to still hold.
  const me = await rpc<{ user: { name: string; email: string; phoneNumber: string } }>(
    page,
    "user.v1.UserService/ProfileDetail",
    {},
  );
  expect(me.user.name).toBe("Profile Renamed");
  expect(me.user.email).toBe(EMAIL);
  expect(me.user.phoneNumber).toBe(STORED_PHONE);

  await page.reload();
  await expect(page.getByTestId("profile-name")).toHaveValue("Profile Renamed");
  await expect(page.getByTestId("profile-email")).toHaveValue(EMAIL);
  await expect(page.getByTestId("profile-phone")).toHaveValue(STORED_PHONE);
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #93 — the language switcher in the avatar menu (before Sign out). Today it persists the choice and
// sets the document language; translating the UI strings is the separate i18n effort (#65).

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

test("Language: switch language from the avatar menu; it persists across reload", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // The switcher lives in the avatar menu, alongside Sign out.
  await page.getByTestId("user-menu").click();
  await expect(page.getByTestId("lang-id")).toBeVisible();
  await expect(page.getByTestId("lang-en")).toBeVisible();
  await expect(page.getByTestId("sign-out")).toBeVisible();

  // Choosing a language reflects on the document…
  await page.getByTestId("lang-id").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");

  // …and survives a reload (persisted per device).
  await page.reload();
  await expect(page.getByTestId("current-user")).toHaveText(ROOT_USERNAME);
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
});

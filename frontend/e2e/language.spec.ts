import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #93/#97 — the language switcher in the avatar menu, and real translation via react-i18next. The
// shell (navigation, avatar menu) is translated; switching to Indonesian changes the text and
// persists per device.

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

test("Language: switching to Indonesian translates the shell and persists", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // The shell starts in English (default locale). The sidebar's Home link comes first in the DOM
  // (the breadcrumb also shows the page name), so .first() targets the nav link.
  await expect(page.getByRole("link", { name: "Home" }).first()).toBeVisible();

  // Switch to Indonesian from the avatar menu.
  await page.getByTestId("user-menu").click();
  await expect(page.getByTestId("lang-id")).toBeVisible();
  await expect(page.getByTestId("lang-en")).toBeVisible();
  await page.getByTestId("lang-id").click();

  // The navigation is translated and the document language reflects it.
  await expect(page.getByRole("link", { name: "Beranda" }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");

  // Page CONTENT translates too, not only the shell: the Products page heading is Indonesian (#97).
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: "Produk" }).first()).toBeVisible();
  await page.goto("/");

  // Persists across a reload.
  await page.reload();
  await expect(page.getByTestId("current-user")).toHaveText(ROOT_USERNAME);
  await expect(page.getByRole("link", { name: "Beranda" }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");

  // And back to English.
  await page.getByTestId("user-menu").click();
  await page.getByTestId("lang-en").click();
  await expect(page.getByRole("link", { name: "Home" }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { signIn } from "./session";

// #93/#97 — the language switcher in the avatar menu, and real translation via react-i18next. The
// shell (navigation, avatar menu) is translated; switching to Indonesian changes the text and
// persists per device.

async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);
}

test("Language: switching to Indonesian translates the shell and persists", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // The shell starts in English (default locale). The sidebar's Home link comes first in the DOM
  // (the breadcrumb also shows the page name), so .first() targets the nav link.
  await expect(page.getByRole("link", { name: "Home" }).first()).toBeVisible();

  // Switch to Indonesian from the avatar menu.
  await page.getByTestId("user-menu").click();
  // A switch row (the-account-menu-switches-theme-and-language): it reads EN, and one click makes it ID.
  await expect(page.getByTestId("lang-switch")).toContainText("EN");
  await page.getByTestId("lang-switch").click();

  // The navigation is translated and the document language reflects it.
  await expect(page.getByRole("link", { name: "Beranda" }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");

  // Page CONTENT translates too, not only the shell (#97).
  //
  // ⚠ NOT THE HEADING — the products page deliberately has none. The shell's breadcrumb already reads
  // "Dev Selling › My Product", so a heading was the same two words a second time and was removed;
  // this assertion outlived it and failed with "element not found", which reads as a broken
  // translation rather than a deleted element. Asserting an in-page CONTROL keeps the test's real
  // claim — that content translates, not just the chrome — without depending on a layout choice.
  await page.goto("/products");
  // By test id: an empty catalogue also shows an empty-list hint with the same "Produk Baru" button.
  await expect(page.getByTestId("open-create-product")).toHaveText("Produk Baru");
  await expect(page.getByPlaceholder("Cari kode produk atau nama")).toBeVisible();
  await page.goto("/");

  // Persists across a reload.
  await page.reload();
  await expect(page.getByTestId("current-user")).toHaveText(ROOT_USERNAME);
  await expect(page.getByRole("link", { name: "Beranda" }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");

  // And back to English.
  await page.getByTestId("user-menu").click();
  await page.getByTestId("lang-switch").click();
  await expect(page.getByRole("link", { name: "Home" }).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

// #155 — Settings' team picture card goes through i18n (`account.teamPicture*`): read in English first (the positive
// control), then switched to Indonesian on the same page, its heading, button and hint read id.json's words. Root is a
// team manager in the root team, so the hint is the format line (not the select-a-team / managers-only one).
test("Language: in Indonesian, Settings' team picture card reads its own words (#155)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/settings");
  await expect(page.getByTestId("change-team-picture")).toHaveText("Change picture");
  await expect(page.getByTestId("team-picture-hint")).toHaveText("JPG or PNG, shown across the app.");

  await page.getByTestId("user-menu").click();
  await expect(page.getByTestId("lang-switch")).toContainText("EN");
  await page.getByTestId("lang-switch").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await page.keyboard.press("Escape");

  await expect(page.getByRole("heading", { name: "Foto Tim" })).toBeVisible();
  await expect(page.getByTestId("change-team-picture")).toHaveText("Ubah foto");
  await expect(page.getByTestId("team-picture-hint")).toHaveText("JPG atau PNG, ditampilkan di seluruh aplikasi.");
});

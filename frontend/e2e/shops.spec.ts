import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #66 — Shop management (a selling team's marketplace storefronts): create / edit / delete.
//
// The Shops menu is intentionally shown only for a SELLING team, but root holds ROLE_ROOT so the
// shop RPCs are authorised in the root team. We reach the page by its route directly — the menu
// gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);
const CODE = `SH${SUFFIX}`;
const NAME = `E2E Shop ${SUFFIX}`;

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

async function gotoShops(page: Page) {
  await page.goto("/shops");
  await expect(page.getByTestId("shops-table")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("Create: a new shop appears; marketplace is required", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoShops(page);

  await page.getByTestId("open-create-shop").click();

  await page.getByTestId("shop-name").fill(NAME);
  await page.getByTestId("shop-code").fill(CODE);
  await page.getByTestId("shop-description").fill("created by e2e");

  // Marketplace is required — Create stays disabled until one is chosen.
  await expect(page.getByTestId("submit-shop")).toBeDisabled();

  await page.getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Shopee" }).click();

  await expect(page.getByTestId("submit-shop")).toBeEnabled();
  await page.getByTestId("submit-shop").click();

  await expect(page.getByTestId(`shop-row-${CODE}`)).toBeVisible();
  await expect(page.getByTestId(`shop-row-${CODE}`)).toContainText(NAME);
  await expect(page.getByTestId(`shop-row-${CODE}`)).toContainText("Shopee");
});

test("Edit: rename and change marketplace; both persist", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoShops(page);

  await page.getByTestId(`edit-${CODE}`).click();

  // Pre-filled from the row.
  await expect(page.getByTestId("shop-name")).toHaveValue(NAME);

  await page.getByTestId("shop-name").fill(`${NAME} renamed`);
  await page.getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Tokopedia" }).click();
  await page.getByTestId("submit-shop").click();

  await expect(page.getByTestId(`shop-row-${CODE}`)).toContainText(`${NAME} renamed`);
  await expect(page.getByTestId(`shop-row-${CODE}`)).toContainText("Tokopedia");
});

test("Delete: the shop is gone", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoShops(page);

  await page.getByTestId(`delete-${CODE}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`shop-row-${CODE}`)).toBeHidden();
});

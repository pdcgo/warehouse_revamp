import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #103 — Supplier management (the vendors a team buys stock from, under the Inventory area):
// create / edit / delete.
//
// The Suppliers menu lives in the Inventories sub-menu, shown for warehouse/selling teams, but root
// holds ROLE_ROOT so the supplier RPCs are authorised in the root team. We reach the page by its
// route directly — the menu gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);
const CODE = `SUP${SUFFIX}`;
const NAME = `E2E Supplier ${SUFFIX}`;

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

async function gotoSuppliers(page: Page) {
  await page.goto("/inventories/suppliers");
  await expect(page.getByTestId("suppliers-table")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("Create: a new supplier appears; code and name are required", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoSuppliers(page);

  await page.getByTestId("open-create-supplier").click();

  // Code and name are required — Create stays disabled until both are filled.
  await expect(page.getByTestId("submit-supplier")).toBeDisabled();

  await page.getByTestId("supplier-code").fill(CODE);
  await page.getByTestId("supplier-name").fill(NAME);
  await page.getByTestId("supplier-contact").fill("0812-3456-7890");
  await page.getByTestId("supplier-province").fill("West Java");
  await page.getByTestId("supplier-city").fill("Bandung");
  await page.getByTestId("supplier-address").fill("Jl. Merdeka 1");
  await page.getByTestId("supplier-description").fill("created by e2e");

  await expect(page.getByTestId("submit-supplier")).toBeEnabled();
  await page.getByTestId("submit-supplier").click();

  await expect(page.getByTestId(`supplier-row-${CODE}`)).toBeVisible();
  await expect(page.getByTestId(`supplier-row-${CODE}`)).toContainText(NAME);
  await expect(page.getByTestId(`supplier-row-${CODE}`)).toContainText("Bandung");
});

test("Edit: rename and change city; both persist", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoSuppliers(page);

  await page.getByTestId(`edit-${CODE}`).click();

  // Pre-filled from the row.
  await expect(page.getByTestId("supplier-name")).toHaveValue(NAME);

  await page.getByTestId("supplier-name").fill(`${NAME} renamed`);
  await page.getByTestId("supplier-city").fill("Jakarta");
  await page.getByTestId("submit-supplier").click();

  await expect(page.getByTestId(`supplier-row-${CODE}`)).toContainText(`${NAME} renamed`);
  await expect(page.getByTestId(`supplier-row-${CODE}`)).toContainText("Jakarta");
});

test("Delete: the supplier is gone", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoSuppliers(page);

  await page.getByTestId(`delete-${CODE}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`supplier-row-${CODE}`)).toBeHidden();
});

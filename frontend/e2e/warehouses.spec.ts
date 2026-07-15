import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #39 — Warehouse management in Root access: CRUD with (soft) delete.
//
// A warehouse IS a team of type WAREHOUSE, managed from the root-only Warehouses menu. This
// drives that view end to end: create, read (list + dedicated detail page), update, delete.

const SUFFIX = Date.now().toString().slice(-6);
const CODE = `WH${SUFFIX}`.slice(0, 10);
const NAME = `E2E Warehouse ${SUFFIX}`;

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

async function gotoWarehouses(page: Page) {
  // The Warehouses menu only renders for root/admin team types — reaching it at all is part of
  // "in Root Access".
  await page.getByRole("link", { name: "Warehouses" }).click();
  await expect(page.getByTestId("warehouses-table")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("Create: a new warehouse appears, typed WAREHOUSE and owned by its creator", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoWarehouses(page);

  await page.getByTestId("open-create-warehouse").click();

  // The type is locked to Warehouse in this view — it is not a choice here.
  await expect(page.getByTestId("new-team-type-fixed")).toHaveText("Warehouse");

  await page.getByTestId("new-team-name").fill(NAME);
  await page.getByTestId("new-team-code").fill(CODE);
  await page.getByTestId("new-team-description").fill("created by e2e");
  await page.getByTestId("submit-create-team").click();

  await expect(page.getByTestId(`warehouse-row-${CODE}`)).toBeVisible();
  await expect(page.getByTestId(`warehouse-row-${CODE}`)).toContainText(NAME);
});

test("Read: the dedicated warehouse detail page opens from the row", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoWarehouses(page);

  await page.getByTestId(`open-warehouse-${CODE}`).click();

  await expect(page.getByTestId("team-detail-page")).toBeVisible();
  await expect(page.getByTestId("team-detail-page")).toContainText(NAME);
  // TeamCreate makes the creator the owner, so root is a member of this warehouse team.
  await expect(page.getByTestId("team-detail-members")).toContainText(ROOT_USERNAME);

  await page.getByTestId("team-detail-back").click();
  await expect(page.getByTestId("warehouses-table")).toBeVisible();
});

test("Update: renaming the warehouse sticks; the code stays fixed", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoWarehouses(page);

  await page.getByTestId(`row-actions-warehouse-${CODE}`).click();
  await page.getByTestId(`edit-team-${CODE}`).click();
  await page.getByTestId("edit-team-name").fill(`${NAME} renamed`);
  await page.getByTestId("submit-edit-team").click();

  const row = page.getByTestId(`warehouse-row-${CODE}`);
  await expect(row).toContainText(`${NAME} renamed`);
  await expect(row).toContainText(CODE);
});

test("Delete: the warehouse is soft-deleted and drops out of the list", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoWarehouses(page);

  await page.getByTestId(`row-actions-warehouse-${CODE}`).click();
  await page.getByTestId(`delete-warehouse-${CODE}`).click();
  await page.getByTestId("confirm-action").click();

  // The list filters out soft-deleted teams (TeamList excludes deleted = true), so the row goes.
  await expect(page.getByTestId(`warehouse-row-${CODE}`)).toBeHidden();
});

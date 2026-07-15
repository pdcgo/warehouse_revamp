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
  // "in Root Access". Scope to the SIDEBAR nav (the first navigation): a warehouse detail page
  // also has a breadcrumb "Warehouses" link, which would otherwise be ambiguous.
  await page.getByRole("navigation").first().getByRole("link", { name: "Warehouses", exact: true }).click();
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

test("Update: edit is a dedicated page; name and weekly hours persist", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoWarehouses(page);

  // Edit opens a PAGE, not a popup (issue #39 comment 6).
  await page.getByTestId(`row-actions-warehouse-${CODE}`).click();
  await page.getByTestId(`edit-warehouse-${CODE}`).click();
  await expect(page.getByTestId("warehouse-edit-page")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/warehouses/\\d+/edit$`));

  await page.getByTestId("warehouse-edit-name").fill(`${NAME} renamed`);

  // Set Monday (weekday 1) operating hours 09:00–17:00.
  await page.getByTestId("operating-hours-open-1").click();
  await page.getByTestId("operating-hours-from-1").fill("09:00");
  await page.getByTestId("operating-hours-to-1").fill("17:00");

  // And Monday order-receiving hours 10:00–15:00 (narrower, as real warehouses are).
  await page.getByTestId("receiving-hours-open-1").click();
  await page.getByTestId("receiving-hours-from-1").fill("10:00");
  await page.getByTestId("receiving-hours-to-1").fill("15:00");

  await page.getByTestId("warehouse-edit-save").click();

  // Saving returns to the detail page, and the rename shows in the list.
  await gotoWarehouses(page);
  await expect(page.getByTestId(`warehouse-row-${CODE}`)).toContainText(`${NAME} renamed`);
  await expect(page.getByTestId(`warehouse-row-${CODE}`)).toContainText(CODE);

  // Reopen the editor: the hours we set must have persisted.
  await page.getByTestId(`row-actions-warehouse-${CODE}`).click();
  await page.getByTestId(`edit-warehouse-${CODE}`).click();
  await expect(page.getByTestId("warehouse-edit-page")).toBeVisible();
  await expect(page.getByTestId("operating-hours-from-1")).toHaveValue("09:00");
  await expect(page.getByTestId("operating-hours-to-1")).toHaveValue("17:00");
  await expect(page.getByTestId("receiving-hours-from-1")).toHaveValue("10:00");
  await expect(page.getByTestId("receiving-hours-to-1")).toHaveValue("15:00");
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

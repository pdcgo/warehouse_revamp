import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #129 — Rack management (the physical places inside a warehouse): create / edit / delete.
//
// The Racks menu lives in the Inventories sub-menu and only shows for a WAREHOUSE team, but root
// holds ROLE_ROOT so the rack RPCs are authorised in the root team. We reach the page by its route
// directly — the menu gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);
const CODE = `R${SUFFIX}`;
const NAME = `E2E Rack ${SUFFIX}`;

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

async function gotoRacks(page: Page) {
  await page.goto("/inventories/racks");
  await expect(page.getByTestId("racks-table")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("Create: a new rack appears; the code is required", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoRacks(page);

  await page.getByTestId("open-create-rack").click();

  // The code is the rack's identity — Create stays disabled until it is filled. Name and
  // description are optional.
  await expect(page.getByTestId("submit-rack")).toBeDisabled();

  await page.getByTestId("rack-code").fill(CODE);

  await expect(page.getByTestId("submit-rack")).toBeEnabled();

  await page.getByTestId("rack-name").fill(NAME);
  await page.getByTestId("rack-description").fill("created by e2e");
  await page.getByTestId("submit-rack").click();

  await expect(page.getByTestId(`rack-row-${CODE}`)).toBeVisible();
  await expect(page.getByTestId(`rack-row-${CODE}`)).toContainText(NAME);
  await expect(page.getByTestId(`rack-row-${CODE}`)).toContainText("created by e2e");
});

test("Edit: rename and change the description; both persist", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoRacks(page);

  await page.getByTestId(`edit-rack-${CODE}`).click();

  // Pre-filled from the row.
  await expect(page.getByTestId("rack-name")).toHaveValue(NAME);

  await page.getByTestId("rack-name").fill(`${NAME} renamed`);
  await page.getByTestId("rack-description").fill("edited by e2e");
  await page.getByTestId("submit-rack").click();

  await expect(page.getByTestId(`rack-row-${CODE}`)).toContainText(`${NAME} renamed`);
  await expect(page.getByTestId(`rack-row-${CODE}`)).toContainText("edited by e2e");
});

// #197 — the rack detail LAYOUT: the name and two header tiles across the top, then vertical tabs
// down the left with their content beside them.
//
// The rack created above is EMPTY, and that is the case worth pinning here: a shelf with nothing on
// it must read as "0 units, never counted" rather than as a broken header or an epoch date. The
// numbers with real goods behind them are covered by the Go tests, which can seed a restock without
// driving six screens to do it.
test("Detail: the header tiles and the five vertical tabs (#197)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoRacks(page);

  await page.getByTestId(`rack-row-${CODE}`).click();
  await expect(page.getByTestId("rack-detail-page")).toBeVisible();

  // The CODE is the heading — it is what is painted on the shelf, and how a person finds it.
  await expect(page.getByTestId("rack-detail-code")).toHaveText(CODE);

  // An empty shelf is worth nothing and has never been counted. Neither may render as a guess.
  await expect(page.getByTestId("rack-summary-count")).toContainText("0");
  await expect(page.getByTestId("rack-summary-last-counted")).toHaveText("Never counted");

  // Products is the tab that opens — it is what somebody standing at the shelf came for.
  await expect(page.getByTestId("rack-products-panel")).toBeVisible();
  await expect(page.getByTestId("rack-detail-empty")).toBeVisible();

  await page.getByTestId("rack-tab-info").click();
  await expect(page.getByTestId("rack-info-code")).toHaveText(CODE);

  await page.getByTestId("rack-tab-prices").click();
  await expect(page.getByTestId("rack-prices-panel")).toBeVisible();

  await page.getByTestId("rack-tab-stock-history").click();
  await expect(page.getByTestId("rack-stock-history-empty")).toBeVisible();

  await page.getByTestId("rack-tab-placement-history").click();
  await expect(page.getByTestId("rack-placement-history-empty")).toBeVisible();
});

test("Delete: the rack is gone", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoRacks(page);

  await page.getByTestId(`delete-rack-${CODE}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`rack-row-${CODE}`)).toBeHidden();
});

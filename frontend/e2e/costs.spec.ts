import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #170 — the costs screen: money the business spent that NO ORDER caused.
//
// Root is a ROOT team, so the Costs menu item is not offered (it is a selling-team surface), but root
// holds ROLE_ROOT and the RPCs are authorised in team 1 — so the route is reached directly, the same
// way orders.spec.ts reaches the selling screens. The menu gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);
const NOTE = `E2E electricity ${SUFFIX}`;

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

test.describe.configure({ mode: "serial" });

test("Costs: the screen opens on this month and starts empty", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/costs");

  await expect(page.getByTestId("costs-table")).toBeVisible();
  await expect(page.getByTestId("costs-empty")).toBeVisible();

  // The month picker is the primary control — a cost list without a period is meaningless, so it
  // opens on one rather than showing every cost ever recorded.
  const month = page.getByTestId("costs-month");
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  await expect(month).toHaveValue(expected);

  // Nothing spent, so every card reads zero.
  await expect(page.getByTestId("costs-total")).toHaveText("Rp 0");
});

// #170 — record a cost, correct it, then void it: the whole life of a number somebody typed.
test("Costs: record, correct, and void — the totals follow each step (#170)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/costs");

  const today = new Date().toISOString().slice(0, 10);

  // RECORD.
  await page.getByTestId("open-record-cost").click();

  // The page carries this picker TWICE — once as the list filter, once in this form — so each names
  // its own testid (the filter is "costs-kind-filter"). Without that, both the trigger and every
  // option are ambiguous and a test has to select by position.
  await page.getByTestId("cost-kind-select").click();
  await page.getByTestId("cost-kind-select-3").click(); // OPERATIONAL
  await page.getByTestId("cost-amount").fill("800000");
  await page.getByTestId("cost-date").fill(today);
  await page.getByTestId("cost-note").fill(NOTE);
  await page.getByTestId("submit-cost").click();

  await expect(page.getByTestId("costs-table")).toContainText(NOTE);
  // The amount is grouped the way money is written here (#166's CurrencyInput fed the raw digits).
  await expect(page.getByTestId("costs-total")).toHaveText("Rp 800.000");

  const row = page.getByTestId("costs-table").locator("tbody tr").first();
  const id = (await row.getAttribute("data-testid"))?.replace("cost-row-", "");
  expect(id).toBeTruthy();

  // CORRECT it — because a person typed it, and people mistype (#169).
  await page.getByTestId(`cost-actions-${id}`).click();
  await page.getByTestId(`cost-edit-${id}`).click();
  await page.getByTestId("cost-amount").fill("850000");
  await page.getByTestId("submit-cost").click();

  await expect(page.getByTestId("costs-total")).toHaveText("Rp 850.000");

  // VOID it. The row STAYS — voiding is not deleting, and an entry that was made and retracted is
  // exactly what somebody looking at a changed total wants to see.
  await page.getByTestId(`cost-actions-${id}`).click();
  await page.getByTestId(`cost-void-${id}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`cost-voided-${id}`)).toBeVisible();
  await expect(page.getByTestId(`cost-row-${id}`)).toContainText(NOTE);

  // …but it no longer counts.
  await expect(page.getByTestId("costs-total")).toHaveText("Rp 0");
});

// #170 — a month with nothing in it is empty, which is what makes the period filter real rather than
// decorative.
test("Costs: another month shows none of this month's costs (#170)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/costs");

  await page.getByTestId("costs-month").fill("2020-01");

  await expect(page.getByTestId("costs-empty")).toBeVisible();
  await expect(page.getByTestId("costs-total")).toHaveText("Rp 0");
});

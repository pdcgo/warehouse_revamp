import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #170 — the expenses screen: money the business spent that NO ORDER caused.
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

test("Expenses: the screen opens on this month and starts empty", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/expenses");

  await expect(page.getByTestId("expenses-table")).toBeVisible();
  await expect(page.getByTestId("expenses-empty")).toBeVisible();

  // The month picker is the primary control — a cost list without a period is meaningless, so it
  // opens on one rather than showing every cost ever recorded.
  const month = page.getByTestId("expenses-month");
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  await expect(month).toHaveValue(expected);

  // Nothing spent, so every card reads zero.
  await expect(page.getByTestId("expenses-total")).toHaveText("Rp 0");
});

// #170 — record a cost, correct it, then cancel it: the whole life of a number somebody typed. The expense itself
// never changes — every correction is a row of its own (every-correction-is-a-signed-adjustment).
test("Expenses: record, adjust, and cancel — the totals follow each step, every row stays (#170)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/expenses");

  const today = new Date().toISOString().slice(0, 10);

  // RECORD.
  await page.getByTestId("open-record-cost").click();

  // The page carries this picker TWICE — once as the list filter, once in this form — so each names
  // its own testid (the filter is "expenses-kind-filter"). Without that, both the trigger and every
  // option are ambiguous and a test has to select by position.
  await page.getByTestId("expense-kind-select").click();
  await page.getByTestId("expense-kind-select-3").click(); // OPERATIONAL
  await page.getByTestId("expense-amount").fill("800000");
  // The date picker is a button opening a calendar (it stopped being a native <input type="date">),
  // so today is CLICKED. `[data-today]` is the day cell the calendar marks itself — no date maths in
  // the spec, and no dependence on the machine's locale for the format.
  await page.getByTestId("expense-date").click();
  await page.locator('[data-testid="expense-date-content"] [data-today]').click();
  await page.getByTestId("expense-note").fill(NOTE);
  await page.getByTestId("submit-cost").click();

  await expect(page.getByTestId("expenses-table")).toContainText(NOTE);
  // The amount is grouped the way money is written here (#166's CurrencyInput fed the raw digits).
  await expect(page.getByTestId("expenses-total")).toHaveText("Rp 800.000");

  const row = page.getByTestId("expenses-table").locator("tbody tr").first();
  const id = (await row.getAttribute("data-testid"))?.replace("expense-row-", "");
  expect(id).toBeTruthy();

  // ADJUST it — because a person typed it, and people mistype (#169). The correction is typed, not the new total: 50.000
  // more. The expense keeps its 800.000 and says what it counts for now.
  await page.getByTestId(`expense-actions-${id}`).click();
  await page.getByTestId(`expense-adjust-${id}`).click();
  await page.getByTestId("adjust-direction-add").click();
  await page.getByTestId("adjust-amount").fill("50000");
  await expect(page.getByTestId("adjust-after")).toContainText("Rp 850.000");
  await page.getByTestId("submit-adjust").click();

  await expect(page.getByTestId("expenses-total")).toHaveText("Rp 850.000");
  await expect(page.getByTestId(`expense-amount-${id}`)).toHaveText("Rp 800.000");
  await expect(page.getByTestId(`expense-net-${id}`)).toContainText("Rp 850.000");

  // CANCEL it — Batalkan, an adjustment of minus the whole of what it counts for. Every row STAYS: an entry that was
  // made and taken back is exactly what somebody looking at a changed total wants to see.
  await page.getByTestId(`expense-actions-${id}`).click();
  await page.getByTestId(`expense-cancel-${id}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId("expenses-total")).toHaveText("Rp 0");
  await expect(page.getByTestId(`expense-row-${id}`)).toContainText(NOTE);
  await expect(page.getByTestId(`expense-net-${id}`)).toContainText("Rp 0");
  // The expense and its two corrections, on the expense's day.
  await expect(page.locator('[data-testid^="expense-adjustment-"]')).toHaveCount(2);
});

// #170 — a month with nothing in it is empty, which is what makes the period filter real rather than
// decorative.
test("Expenses: another month shows none of this month's expenses (#170)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/expenses");

  await page.getByTestId("expenses-month").fill("2020-01");

  await expect(page.getByTestId("expenses-empty")).toBeVisible();
  await expect(page.getByTestId("expenses-total")).toHaveText("Rp 0");
});

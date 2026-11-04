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

// rpc calls the API with the page's own token, so a seed runs as the person the UI is signed in as.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      if (!res.ok) throw new Error(`${m}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body] as const,
  ) as Promise<T>;
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
  // The business's month — Jakarta's (lib/period.ts thisMonth), whatever clock the test machine is on.
  const expected = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Jakarta" })
    .format(new Date())
    .slice(0, 7);
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

  // Every expense names the account that paid it (an-expense-must-name-the-account-that-paid) — one operational
  // account for the team, so the form has something to pick.
  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: "1",
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E expense ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-EXP-${SUFFIX}`,
    openingBalance: 0,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  // Paid from offers only accounts marked operational (operational-accounts-pay-for-operations).
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: "1",
    accountId: account.account.id,
    operational: true,
  });

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
  await page.getByTestId("expense-paid-from").click();
  await page.getByTestId(`expense-paid-from-option-${account.account.id}`).click();
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

// THE ACCOUNT THAT PAID MOVES (an-expense-must-name-the-account-that-paid, a-correction-follows-the-expenses-account):
// recording an expense posts it out of the account named in Paid from, and cancelling it gives the money back to that
// same account. The post travels the real way — expense_service publishes, the Pub/Sub emulator pushes to the e2e API,
// financial_account_service's listener posts — so the balance is POLLED, never read once.
test("Expenses: the account that paid goes down on record and comes back on cancel", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/expenses");

  const name = `E2E paid ${SUFFIX}`;
  const note = `E2E internet ${SUFFIX}`;
  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: "1",
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name,
    holderName: "E2E",
    accountNumber: `E2E-PAID-${SUFFIX}`,
    // Opens at 0, so the root team's total — which financial_accounts.spec asserts later in the same run — ends where it
    // started once the expense is cancelled.
    openingBalance: 0,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  const accountId = account.account.id;
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: "1",
    accountId,
    operational: true,
  });

  // The account's own page, re-read until the listener's post has landed.
  const balanceIs = async (text: string | RegExp) => {
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(text, { timeout: 3_000 });
    }).toPass({ timeout: 45_000 });
  };

  await balanceIs("Rp 0");

  // RECORD — OPERATIONAL, so no shop; paid from the new account.
  await page.goto("/expenses");
  await page.getByTestId("open-record-cost").click();
  await page.getByTestId("expense-kind-select").click();
  await page.getByTestId("expense-kind-select-3").click(); // OPERATIONAL
  await page.getByTestId("expense-amount").fill("250000");
  await page.getByTestId("expense-note").fill(note);
  await page.getByTestId("expense-paid-from").click();
  await page.getByTestId(`expense-paid-from-option-${accountId}`).click();
  await page.getByTestId("submit-cost").click();
  await expect(page.getByTestId("expenses-table")).toContainText(note);

  const row = page.getByTestId("expenses-table").locator("tbody tr").filter({ hasText: note }).first();
  const id = (await row.getAttribute("data-testid"))?.replace("expense-row-", "");
  expect(id).toBeTruthy();

  // Out of the account: 250.000, as an `expense` row naming the expense — below zero, warned, never refused. The screen
  // writes the typographic minus before "Rp" (a-negative-amount-puts-its-minus-before-rp).
  await balanceIs(/^[-−]Rp 250\.000$/);
  const top = page.getByTestId("account-log-table").getByRole("row").nth(1);
  await expect(top).toContainText(`Expense E-${id}`);

  // CANCEL — Batalkan, an adjustment of minus the whole net: the money goes back to the same account.
  await page.goto("/expenses");
  await page.getByTestId(`expense-actions-${id}`).click();
  await page.getByTestId(`expense-cancel-${id}`).click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId(`expense-net-${id}`)).toContainText("Rp 0");

  await balanceIs("Rp 0");
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

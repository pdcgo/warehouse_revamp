import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// #170 — the expenses screen: money the business spent that NO ORDER caused.
//
// Root in A SELLING TEAM OF THIS SPEC'S OWN, created by the first test with root as its owner. The screen starts empty
// and its totals are the WHOLE month's of the team, so they must be a team only this spec writes to: in root's own
// team they also counted every expense an earlier spec (in name order, on the one shared database) had recorded there.

const SUFFIX = Date.now().toString().slice(-6);
const NOTE = `E2E electricity ${SUFFIX}`;
const TEAM_NAME = `E2E Expense Team ${SUFFIX}`;
const TEAM_CODE = `EXT${SUFFIX}`;
// The spec's own selling team — set by the first test, read by every test after it (the file is serial).
let team = "";

async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);

  // Work in the spec's own team: the active team is per tab, in sessionStorage (TeamContext) — the next page load
  // opens in it.
  if (team !== "") {
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }
}

// rpc calls the API with the page's own token, so a seed runs as the person the UI is signed in as.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      if (!res.ok) throw new Error(`${m}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
  ) as Promise<T>;
}

test.describe.configure({ mode: "serial" });

test("Expenses: the screen opens on this month and starts empty", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      type: "TEAM_TYPE_SELLING",
      name: TEAM_NAME,
      teamCode: TEAM_CODE,
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);

  await page.goto("/expenses");
  await expect(page.getByTestId("team-switcher")).toContainText(TEAM_NAME);

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
    teamId: team,
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
    teamId: team,
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
    teamId: team,
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name,
    holderName: "E2E",
    accountNumber: `E2E-PAID-${SUFFIX}`,
    // Opens at 0, so the balance below reads only what this test's expense moved.
    openingBalance: 0,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  const accountId = account.account.id;
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: team,
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

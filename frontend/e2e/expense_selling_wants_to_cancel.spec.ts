import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── cancel expense — the checks behind docs/acceptances/financial_account/expense.md, given 26 ───────────────────────────
//
// cancel expense's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test per role, one test.step("then: …") per then.
//
// Business rules:
// - every-correction-is-a-signed-adjustment (docs/business/analytic/context_decision.md): Batalkan is the screen's
//   shortcut for an adjustment of minus what the expense counts for — its NET (the build detail recorded there): an
//   expense already reduced to Rp 400.000 is cancelled by −Rp 400.000, and every row stays on the list. An expense and its
//   corrections never sum below 0, so a second cancel is refused (failed_precondition) and the menu stops offering it.
// - an-adjustment-counts-on-the-day-it-fixes (same file): on the Expenses page the cancel sits on the EXPENSE's day, so
//   that month's total loses what the expense still counted for.
// - an-expense-correction-counts-on-the-day-it-is-made (docs/business/analytic/rpc_provide_decision.md): in Analytic a
//   cancel — a correction of the whole net — counts on the day it is MADE; the expense's day keeps its figure.
// - a-correction-follows-the-expenses-account (docs/business/financial_account/context_decision.md): the cancel posts to
//   the account the expense named in Paid from; the confirm names it.
//
// The WHEN, as the person does it: Biaya (/expenses, on the expense's month) → the row's ⋯ (`expense-actions-<id>`) →
// Cancel Expense (`expense-cancel-<id>`) → the confirm (`alertdialog` "Cancel Expense") → `confirm-action`. Done THROUGH
// THE PAGE by the role user.
//
// GROUND (beforeAll, as root, through the API) — one SELLING TEAM per role, root its owner, the role user its member, one
// BCA account opened at Rp 10.000.000 five days ago and marked operational, and, paid from that account, typed by root
// THREE DAYS AGO (Jakarta) — so "the expense's day" and "the day the cancel is made" (today) are two different days:
//   - the given's expense: Operasional › Listrik, Rp 500.000, then reduced by Rp 100.000 (root's ExpenseAdjust, made
//     today) — "already reduced to Rp 400.000";
//   - a second expense of the same month, Operasional › Internet, Rp 200.000 — so the month total reads a DECREASE
//     (Rp 600.000 → Rp 200.000) rather than merely Rp 0.
// The account then reads 10.000.000 − 500.000 − 200.000 + 100.000 = Rp 9.400.000, polled (the posts are event-driven:
// expense_service publishes, the Pub/Sub emulator pushes, financial_account's listener posts).
//
// How the thens are read:
// - `expense counts for Rp 0` — the ExpenseAdjust the cancel sends answers a −400.000 correction (the net, not −500.000)
//   dated the expense's day; the expense row keeps Rp 500.000 and reads "now Rp 0"; the cancel is its own row (Adjustment,
//   −Rp 400.000, "Cancelled", the expense's date cell) and the earlier reduction stays beside it.
// - `paying account gets Rp 400.000 back` — the account's own page, polled: Rp 9.400.000 → Rp 9.800.000; the confirm says
//   Rp 400.000 goes back to that account.
// - `month total decreases by Rp 400.000` — the month's Total, Rp 600.000 before the WHEN → Rp 200.000.
// - `cannot cancel again` — on BOTH layers: the row's ⋯ still offers Adjust but no Cancel Expense; the same cancel
//   (−400.000) sent anyway with the ROLE's token is refused `failed_precondition`; nothing changed — the list's rows, the
//   "now Rp 0", the Total and the account.
// - `cancel counted in expense analytic metric on the day it was made` — Analytic › Expenses by day (7 days), read as the
//   role: before the WHEN today reads −Rp 100.000 (the reduction) and the expense's day Rp 700.000; after it today reads
//   −Rp 500.000 (Total and Operational) and the expense's day still Rp 700.000.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-cancel-pass-1";
const OPENING = 10_000_000;
const EXPENSES_METRIC = "metrics/expenses";
const ADJUST = "expense.v1.ExpenseService/ExpenseAdjust";

const AMOUNT = 500_000; // the given's expense
const REDUCED = 100_000; // already taken off it
const NET = AMOUNT - REDUCED; // Rp 400.000 — what it counts for, and what the cancel takes back
const OTHER = 200_000; // the second expense of the month

const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
/** A signed figure as the screens write it — the typographic minus before "Rp" (or a plain hyphen). */
const minusRp = (n: number) => new RegExp(`^[-−]${rp(n).replace(/\./g, "\\.")}$`);

/** A Jakarta day `ago` days before today — the business's day. */
const day = (ago: number) =>
  new Date(Date.now() - ago * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const TODAY = day(0);
// The expenses' day: three days back, so the cancel's two days (the expense's, the one it is made on) differ.
const EARLIER = day(3);
const OPENING_ON = day(5);

const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "O", word: "Owner" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "A", word: "Admin" },
] as const;
type Role = (typeof ROLES)[number];

// One role's ground.
interface Seat {
  tag: string;
  team: string;
  account: string;
  accountName: string;
  expense: string;
  other: string;
  username: string;
}
const seats = new Map<string, Seat>();
const seatOf = (r: Role): Seat => {
  const s = seats.get(r.key);
  if (!s) throw new Error(`no ground for ${r.given}`);

  return s;
};

test.describe.configure({ timeout: 150_000 });

// An RPC as the signed-in person — the status and the JSON, so a refusal is asserted as well as a success.
async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, any> }> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, json: (await res.json()) as Record<string, any> };
    },
    [method, body, API_URL] as const,
  );
}

// The same, failing by name when refused.
async function rpc<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await send(page, method, body);
  if (res.status !== 200) throw new Error(`${method}: ${res.status} ${JSON.stringify(res.json)}`);

  return res.json as T;
}

// GROUND for one role: its selling team, its role user, its operational account, the given's expense (reduced), the
// month's second expense.
async function makeSeat(page: Page, r: Role): Promise<Seat> {
  const tag = `26${r.key}`;
  const team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      type: "TEAM_TYPE_SELLING",
      name: `E2E Cxl ${tag} ${SUFFIX}`,
      // A team code is at most 10 characters: Q + the tag (3) + the suffix (6).
      teamCode: `Q${tag}${SUFFIX}`,
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  // A username is lowercase letters and digits only.
  const username = `e2ecxl${tag}${SUFFIX}`.toLowerCase();
  await rpc(page, "user.v1.UserService/CreateUser", {
    teamId: team,
    username,
    password: PASSWORD,
    name: `Cxl ${tag} ${r.word} ${SUFFIX}`,
    role: r.role,
  });

  const accountName = `E2E Cxl BCA ${tag} ${SUFFIX}`;
  const account = (
    await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: accountName,
      holderName: "E2E",
      accountNumber: `E2E-CXL-${tag}-${SUFFIX}`,
      openingBalance: OPENING,
      openingOn: OPENING_ON,
    })
  ).account.id;
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: team,
    accountId: account,
    operational: true,
  });

  const expense = (
    await rpc<{ expense: { id: string } }>(page, "expense.v1.ExpenseService/ExpenseCreate", {
      teamId: team,
      kind: "EXPENSE_KIND_OPERATIONAL",
      type: "EXPENSE_TYPE_ELECTRICITY",
      amount: AMOUNT,
      occurredAt: EARLIER,
      note: `e2e cancel electricity ${tag} ${SUFFIX}`,
      financeAccountId: account,
    })
  ).expense.id;
  // "already reduced to Rp 400.000".
  await rpc(page, ADJUST, {
    teamId: team,
    expenseId: expense,
    amount: -REDUCED,
    note: `e2e cancel reduce first ${tag} ${SUFFIX}`,
  });

  const other = (
    await rpc<{ expense: { id: string } }>(page, "expense.v1.ExpenseService/ExpenseCreate", {
      teamId: team,
      kind: "EXPENSE_KIND_OPERATIONAL",
      type: "EXPENSE_TYPE_INTERNET",
      amount: OTHER,
      occurredAt: EARLIER,
      note: `e2e cancel internet ${tag} ${SUFFIX}`,
      financeAccountId: account,
    })
  ).expense.id;

  return { tag, team, account, accountName, expense, other, username };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  await Promise.all(
    ROLES.map(async (r) => {
      seats.set(r.key, await makeSeat(page, r));
    }),
  );

  await page.close();
});

// The role user, signed in, working in its seat's team (the active team is per tab, in sessionStorage — TeamContext).
async function signInAs(page: Page, s: Seat) {
  await signIn(page, s.username, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), s.team);
}

// Biaya on the month that holds `on` (it opens on this month; the expense may sit in the last one).
async function openExpenses(page: Page, on: string) {
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-table")).toBeVisible();
  if (on.slice(0, 7) !== TODAY.slice(0, 7)) {
    await page.getByTestId("expenses-month").fill(on.slice(0, 7));
  }
}

// The account's own page, re-read until the listener's post has landed.
async function balanceIs(page: Page, account: string, text: string) {
  await expect(async () => {
    await page.goto(`/financial-accounts/${account}`);
    await expect(page.getByTestId("account-detail-balance")).toHaveText(text, { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

// Analytic › Expenses by day, over 7 days, as the signed-in person; re-read until `check` holds (the fold is an event).
async function expensesByDay(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.goto(`/analytic?g=daily&m=${EXPENSES_METRIC}&r=7d`);
    await expect(page.getByTestId("analytic-table")).toBeVisible({ timeout: 5_000 });
    await check();
  }).toPass({ timeout: 45_000 });
}

// The team's expense rows as the server lists them (the expenses and their corrections), in the expenses' month.
async function listedIds(page: Page, s: Seat): Promise<string[]> {
  const listed = await rpc<{ ids?: string[] }>(page, "expense.v1.ExpenseService/ExpenseList", {
    teamId: s.team,
    filter: {},
    page: { page: 1, limit: 20 },
  });

  return [...(listed.ids ?? [])].sort();
}

test.describe("selling:owner · selling:admin wants to take back a cost (expense Rp 500.000 · already reduced to Rp 400.000)", () => {
  for (const r of ROLES) {
    test(`${r.given} cancel expense (expense Rp 500.000 · already reduced to Rp 400.000)`, async ({ page }) => {
      const s = seatOf(r);
      await signInAs(page, s);

      // The given: every post has landed on the account, Analytic reads the expenses on their own day and the reduction
      // today, and the list shows the expense counting for Rp 400.000 in a month totalling Rp 600.000.
      await balanceIs(page, s.account, rp(OPENING - AMOUNT - OTHER + REDUCED));
      await expensesByDay(page, async () => {
        await expect(page.getByTestId(`analytic-cell-${EARLIER}-total`)).toHaveText(rp(AMOUNT + OTHER), { timeout: 3_000 });
        await expect(page.getByTestId(`analytic-cell-${TODAY}-total`)).toHaveText(minusRp(REDUCED), { timeout: 3_000 });
      });
      await openExpenses(page, EARLIER);
      const row = page.getByTestId(`expense-row-${s.expense}`);
      await expect(row).toBeVisible();
      await expect(row.getByTestId(`expense-net-${s.expense}`)).toHaveText(`now ${rp(NET)}`);
      await expect(page.getByTestId("expenses-total")).toHaveText(rp(NET + OTHER));
      await expect(page.locator('[data-testid^="expense-row-"]')).toHaveCount(3);
      const before = await listedIds(page, s);

      // WHEN — cancel expense: the row's ⋯ → Cancel Expense → the confirm.
      await page.getByTestId(`expense-actions-${s.expense}`).click();
      await page.getByTestId(`expense-cancel-${s.expense}`).click();
      const confirm = page.getByRole("alertdialog", { name: "Cancel Expense" });
      await expect(confirm).toBeVisible();
      // It takes back the net, and says where the money goes (a-correction-follows-the-expenses-account).
      await expect.soft(confirm).toContainText(`minus ${rp(NET)}`);
      await expect.soft(confirm).toContainText(`${rp(NET)} goes back to ${s.accountName}`);
      const [answer] = await Promise.all([
        page.waitForResponse((res) => res.url().endsWith(`/warehouse.${ADJUST}`)),
        confirm.getByTestId("confirm-action").click(),
      ]);
      expect(answer.status(), "ExpenseAdjust (the cancel)").toBe(200);
      const cancel = ((await answer.json()) as { adjustment: { id: string; occurredAt: string; amount: number } })
        .adjustment;
      await expect(confirm).toBeHidden();

      await test.step("then: expense counts for Rp 0", async () => {
        // The cancel itself: minus the NET (not the 500.000 typed), on the expense's day.
        expect.soft(Number(cancel.amount)).toBe(-NET);
        expect.soft(cancel.occurredAt).toBe(EARLIER);
        // The expense keeps what was typed and counts for nothing now.
        await expect.soft(row.getByTestId(`expense-net-${s.expense}`)).toHaveText(`now ${rp(0)}`);
        await expect.soft(row.getByTestId(`expense-amount-${s.expense}`)).toHaveText(rp(AMOUNT));
        // Every row stays: the cancel is a row of its own beside the earlier reduction, on the expense's date cell.
        await expect.soft(page.locator('[data-testid^="expense-row-"]')).toHaveCount(4);
        await expect.soft(page.locator('[data-testid^="expense-adjustment-"]')).toHaveCount(2);
        const cancelRow = page.getByTestId(`expense-row-${cancel.id}`);
        await expect.soft(cancelRow.getByTestId(`expense-adjustment-${cancel.id}`)).toHaveText("Adjustment");
        await expect.soft(cancelRow.getByTestId(`expense-amount-${cancel.id}`)).toHaveText(minusRp(NET));
        await expect.soft(cancelRow).toContainText("Cancelled");
        const expenseDay = (await page.getByTestId(`expense-date-${s.expense}`).textContent())?.trim() ?? "";
        expect.soft(expenseDay).not.toBe("");
        await expect.soft(cancelRow.getByTestId(`expense-date-${cancel.id}`)).toHaveText(expenseDay);
      });

      await test.step("then: month total decreases by Rp 400.000", async () => {
        // Rp 600.000 before the WHEN; the second expense is untouched.
        await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(NET + OTHER - NET));
        await expect.soft(page.getByTestId(`expense-amount-${s.other}`)).toHaveText(rp(OTHER));
        await expect.soft(page.getByTestId(`expense-net-${s.other}`)).toHaveCount(0);
      });

      await test.step("then: cannot cancel again", async () => {
        // The menu: Adjust is still offered, Cancel Expense no more — there is nothing left to take back.
        await page.getByTestId(`expense-actions-${s.expense}`).click();
        await expect(page.getByTestId(`expense-adjust-${s.expense}`)).toBeVisible();
        await expect.soft(page.getByTestId(`expense-cancel-${s.expense}`)).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.getByTestId(`expense-adjust-${s.expense}`)).toBeHidden();

        // The server refuses the same cancel sent anyway, under the role's own token.
        const refused = await send(page, ADJUST, {
          teamId: s.team,
          expenseId: s.expense,
          amount: -NET,
          note: `e2e cancel again ${s.tag} ${SUFFIX}`,
        });
        expect.soft(refused.status, "a second cancel").not.toBe(200);
        expect.soft(refused.json.code).toBe("failed_precondition");

        // Nothing changed: one row more than before the WHEN (the cancel), still "now Rp 0", the Total, the account.
        const after = await listedIds(page, s);
        expect.soft(after).toEqual([...before, cancel.id].sort());
        await openExpenses(page, EARLIER);
        await expect(page.getByTestId(`expense-row-${s.expense}`)).toBeVisible();
        await expect.soft(page.locator('[data-testid^="expense-row-"]')).toHaveCount(4);
        await expect.soft(page.getByTestId(`expense-net-${s.expense}`)).toHaveText(`now ${rp(0)}`);
        await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(OTHER));
      });

      await test.step("then: paying account gets Rp 400.000 back", async () => {
        await balanceIs(page, s.account, rp(OPENING - AMOUNT - OTHER + REDUCED + NET));
      });

      await test.step("then: cancel counted in expense analytic metric on the day it was made", async () => {
        await expensesByDay(page, async () => {
          // Today: the earlier reduction (−100.000) and the cancel (−400.000).
          await expect(page.getByTestId(`analytic-cell-${TODAY}-total`)).toHaveText(minusRp(REDUCED + NET), {
            timeout: 3_000,
          });
          await expect(page.getByTestId(`analytic-cell-${TODAY}-operational`)).toHaveText(minusRp(REDUCED + NET), {
            timeout: 3_000,
          });
          // The expenses' day never changes.
          await expect(page.getByTestId(`analytic-cell-${EARLIER}-total`)).toHaveText(rp(AMOUNT + OTHER), {
            timeout: 3_000,
          });
        });
      });
    });
  }
});

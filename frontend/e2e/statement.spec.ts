import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// The daily statement — the same money as Revenue, Expenses and Profit, read DAY BY DAY.
//
// Two independent services answer one screen: RevenueDaily and ExpenseDaily each return a SPARSE series
// (days with nothing are absent), and the client builds the date spine, lines them up and subtracts. So
// the failures worth an e2e are the ones a unit test on either service cannot see — the join itself,
// the running total, and the footer staying the server's number.
//
// Root is a ROOT team, so the Daily Statement menu item is not offered (it is a selling-team surface),
// but root holds ROLE_ROOT and both RPCs are authorised in team 1 — so the route is reached directly,
// exactly as profit.spec.ts, expenses.spec.ts and revenue.spec.ts reach theirs. The menu gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);

// ⚠ DELTAS, NOT ABSOLUTES — the same rule profit.spec.ts follows, and for the same reason. Every spec in
// this suite shares one database and root's team 1, so by the time this runs the expense and revenue
// specs have already put money in this very period. An absolute expectation would be a test that passes
// only while it happens to run first.
const COST = 3_210_000;

async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);
}

// "Rp 1.234.567" → 1234567, and "−Rp 5.000" → -5000. The minus matters: a loss is the one figure here
// somebody has to notice, so a test that silently read it as positive would be worthless. ⚠ Either minus:
// the screen writes the typographic "−" before "Rp" (`a-negative-amount-puts-its-minus-before-rp`).
async function money(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const digits = text.replace(/[^0-9]/g, "");

  return (/[-−]/.test(text) ? -1 : 1) * Number(digits);
}

// One column's cell on one day's row, as a number — FOUND BY ITS HEADER, never by a fixed index.
//
// ⛔ IT USED TO BE `const OTHER_EXPENSES_CELL = 7`, counted for the SELLING layout
// (Date · Orders · Revenue · COGS · Shipping · Margin · Stock loss · Other expenses · Profit ·
// Running). Selling mode went with `revenue_service`, so the page now draws seven cells and `nth(7)`
// waited for one that does not exist — a 60s timeout that reads as a hung page rather than as a
// stale index. ⚠ Swapping 7 for 4 would only move the rot: the columns differ per mode and will
// change again. Reading the header is the only version of this that survives a layout change.
async function rowCell(page: Page, date: string, header: string): Promise<number> {
  const headers = page.getByTestId("statement-table").locator("thead th");
  const count = await headers.count();

  let index = -1;
  for (let i = 0; i < count; i++) {
    if (((await headers.nth(i).innerText()) ?? "").trim() === header) {
      index = i;
      break;
    }
  }

  if (index < 0) {
    throw new Error(`no "${header}" column on the statement table`);
  }

  const text = await page.getByTestId(`statement-row-${date}`).locator("td").nth(index).innerText();
  const digits = text.replace(/[^0-9]/g, "");

  return (text.includes("-") ? -1 : 1) * Number(digits);
}

// THE DEFAULT WINDOW'S LENGTH — the rolling last month ("Last 1 month"), as resolveRange draws it: the day AFTER the
// same date a month back, through today. That is 28 to 31 days depending on the month just gone, so it is counted,
// never written down — a literal 30 failed every day that followed a 31-day month.
function lastMonthDays(): number {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const back = new Date(first.getFullYear(), first.getMonth(), Math.min(now.getDate(), lastDay));
  const from = new Date(back.getFullYear(), back.getMonth(), back.getDate() + 1);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

function today(): string {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
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

// Every expense names the account that paid it — one of the team's OPERATIONAL accounts
// (an-expense-must-name-the-account-that-paid). Made once per run, opening at 0 — the costs take it below zero, which
// is warned, never refused (below-zero-is-warned-never-refused).
let payingAccountId: string | undefined;

async function payingAccount(page: Page): Promise<string> {
  if (payingAccountId) return payingAccountId;

  const created = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: "1",
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E statement ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-STM-${SUFFIX}`,
    openingBalance: 0,
    openingOn: today(),
  });
  // A Paid from may name only an account marked operational (operational-accounts-pay-for-operations).
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: "1",
    accountId: created.account.id,
    operational: true,
  });

  payingAccountId = created.account.id;

  return payingAccountId;
}

// Records one cost against root's own team, dated TODAY — the last day of the default window. OPERATIONAL, so it names
// no shop (an-expense-names-a-shop-only-for-ads); an ADS cost would have to name one.
async function recordCost(page: Page, amount: number, note: string) {
  await rpc(page, "expense.v1.ExpenseService/ExpenseCreate", {
    teamId: "1",
    kind: 3, // EXPENSE_KIND_OPERATIONAL
    type: "EXPENSE_TYPE_ELECTRICITY", // a type is required since #99 (expense-types-sit-under-groups)
    amount: String(amount),
    occurredAt: today(),
    note,
    financeAccountId: await payingAccount(page),
  });
}

test.describe.configure({ mode: "serial" });

// THE DATE SPINE. Both series are sparse, so this is the assertion that the CLIENT is building the
// calendar: the default window is the rolling last month, and every one of its days must be on screen even though almost none of them
// have an order or a cost. A missing row cannot tell a reader "nothing happened" apart from "that day
// did not load", which is the whole reason quiet days are rendered rather than skipped.
test("Statement: every day of the window has a row, including the quiet ones", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/statement");

  await expect(page.getByTestId("statement-summary")).toBeVisible();
  await expect(page.getByTestId("statement-table")).toBeVisible();

  // ⛔ THE "EXPECTED" NOTICE ASSERTION IS GONE, and deliberately. It belonged to the SELLING mode of
  // this page, whose income came from `revenue_service` — removed in `0d4cbc4`. `StatementMode` is
  // `"warehouse"` alone now and the page refuses a selling team at the door, so there is no
  // expectation half of the subtraction left to warn about.
  //
  // ⚠ IT COMES BACK WITH THE REPORT, not on its own. The daily report is DEFERRED, not cancelled
  // (the-daily-report-is-deferred) — the same deferral that tagged DailyStatementPage.stories.tsx out
  // of the story run. Restore this line when the selling statement returns.

  const days = lastMonthDays();
  await expect(page.getByTestId("statement-day-count")).toHaveText(`Showing ${days} of ${days} days`);
  await expect(page.locator('[data-testid="statement-table"] tbody tr')).toHaveCount(days);

  // Today is the LAST row of the rolling-month window, so it is always present — which is what the next
  // test relies on when it puts a cost there.
  await expect(page.getByTestId(`statement-row-${today()}`)).toBeVisible();
});

// THE JOIN AND THE ARITHMETIC, on one day.
//
// A cost recorded today must move today's row and the period footer by exactly its own amount, downwards,
// and must not touch the margin. This is the failure a per-service unit test cannot catch: each service
// is right on its own, and the screen still reads wrong if the two are lined up on the wrong dates or
// subtracted the wrong way round.
test("Statement: a cost recorded today comes off today's row and the footer, rupiah for rupiah", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/statement");
  await expect(page.getByTestId("statement-summary")).toBeVisible();

  const before = {
    margin: await money(page, "statement-total-margin"),
    expenses: await money(page, "statement-total-expenses"),
    profit: await money(page, "statement-total-profit"),
    footer: await money(page, "statement-footer-profit"),
    // TODAY'S ROW, as a delta like everything else here. expenses.spec.ts and profit.spec.ts also
    // record costs against root's team 1 dated today, so this cell is a SUM the moment more than one
    // spec has run — an absolute expectation would pass only while this file happened to go first.
    todayExpenses: await rowCell(page, today(), "Other expenses"),
  };

  // The header's three numbers agree with each other, and the table's footer agrees with the header —
  // both are the SERVER's totals, so a disagreement here means the screen grew a second opinion.
  expect(before.profit).toBe(before.margin - before.expenses);
  expect(before.footer).toBe(before.profit);

  await recordCost(page, COST, `E2E statement ${SUFFIX}`);
  await page.reload();
  await expect(page.getByTestId("statement-summary")).toBeVisible();

  const after = {
    margin: await money(page, "statement-total-margin"),
    expenses: await money(page, "statement-total-expenses"),
    profit: await money(page, "statement-total-profit"),
    footer: await money(page, "statement-footer-profit"),
  };

  expect(after.expenses).toBe(before.expenses + COST);
  // Spending money does not change what the orders were expected to make. A screen that moved both
  // would be reading one number into two places.
  expect(after.margin).toBe(before.margin);
  // DOWN by the same amount. The sign is the point — a `+` here would look like a very good month.
  expect(after.profit).toBe(before.profit - COST);
  expect(after.footer).toBe(after.profit);

  // And it landed on TODAY's row, not on some other day. This is the join: the cost is filed under
  // `occurred_at`, and the client has to place it on the matching date of its own spine. A cost that
  // moved the period total but landed on the wrong row would satisfy every assertion above.
  const row = page.getByTestId(`statement-row-${today()}`);
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("data-quiet", "true");

  expect(await rowCell(page, today(), "Other expenses")).toBe(before.todayExpenses + COST);
});

// THE RUNNING TOTAL is what makes this a statement rather than a table of days, and the one thing that
// proves the client's day-by-day arithmetic agrees with the server's period aggregate: the LAST day's
// running value must equal the footer. If the two ever disagree, one of them is summing a different set
// of rows — and both look entirely plausible on screen.
test("Statement: the last day's running total is the period's profit", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/statement");
  await expect(page.getByTestId("statement-table")).toBeVisible();

  const lastRunning = await page
    .locator('[data-testid="statement-table"] tbody tr')
    .last()
    .locator("td")
    .last()
    .innerText();

  const digits = lastRunning.replace(/[^0-9]/g, "");
  // Either minus, as money() reads it: the page prints U+2212, and a `-`-only test read a loss as a profit the
  // first time the period went negative (order fees reach the statement once the emulator pushes).
  const running = (/[-−]/.test(lastRunning) ? -1 : 1) * Number(digits);

  expect(running).toBe(await money(page, "statement-footer-profit"));
});

// HIDING QUIET DAYS FILTERS THE TABLE, NOT THE MONEY.
//
// The footer is the server's whole-period total and must not follow the filter. A footer that changed
// when somebody hid rows worth nothing would read as the filter having changed the money — which is the
// one thing a statement cannot afford to imply.
test("Statement: hiding quiet days leaves the period total alone", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/statement");
  await expect(page.getByTestId("statement-table")).toBeVisible();

  const rows = page.locator('[data-testid="statement-table"] tbody tr');
  const before = await rows.count();
  const footerBefore = await money(page, "statement-footer-profit");

  await page.getByTestId("statement-hide-quiet").click();

  // The previous test recorded a cost today, so at least one day is active and at least one is not —
  // the filter has something to remove and something to keep.
  await expect(rows).not.toHaveCount(before);
  expect(await rows.count()).toBeGreaterThan(0);

  expect(await money(page, "statement-footer-profit")).toBe(footerBefore);
  await expect(page.getByTestId("statement-day-count")).toContainText(`of ${before} days`);
});

// THE RANGE DRIVES THE SPINE. Picking a narrower window must re-ask both services AND rebuild the
// calendar to match — a spine that stayed 30 days long while the data covered 7 would render three
// weeks of invented quiet days, which is the most convincing kind of wrong.
//
// The relative shortcut is used rather than the absolute pane because it is one click and it is the
// path somebody actually takes. The 366-day cap is not driven from here: the quick ranges stop at 90
// days and the absolute pane is a month grid, so reaching an over-long range through the UI is eighty
// clicks of the calendar's back arrow. That guard is proven where it lives — six cases per handler in
// the unit tests, and verified over the wire (`InvalidArgument`, "at most 366 days").
test("Statement: narrowing the range rebuilds the day spine", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/statement");
  const days = lastMonthDays();
  await expect(page.getByTestId("statement-day-count")).toHaveText(`Showing ${days} of ${days} days`);

  await page.getByTestId("statement-range").click();
  await page.getByTestId("statement-range-quick-7").click();

  await expect(page.getByTestId("statement-day-count")).toHaveText("Showing 7 of 7 days");
  await expect(page.locator('[data-testid="statement-table"] tbody tr')).toHaveCount(7);

  // Today is the last day of any "last N days" window, so it survives the narrowing.
  await expect(page.getByTestId(`statement-row-${today()}`)).toBeVisible();
});

// ── THE GRAIN IS THE SERVER'S (periods-are-grouped-on-the-server) ──────────────────────────────────
//
// Bulanan and Tahunan are ASKED of both services — the grain is on the wire — and a month's row is the server's month:
// exactly the sum of its days. In a WAREHOUSE team of its own (backlog #50), so the figures are only this test's: three
// costs on the last day of the previous month, the first of this one and today — a month boundary inside the window.
//
// A new grain re-picks the window (the-yearly-statement-opens-on-five-years): Bulanan opens on the last twelve months,
// the first of them whole — twelve rows; Tahunan on 1 January four years back → today — five rows. So the test opens
// the statement on its default and switches the grain, as a person does.

// A Jakarta day, `yyyy-mm-dd` — the calendar the RPCs and the screen use, whatever the runner's clock zone.
function jakartaDay(daysFromToday = 0): string {
  return new Date(Date.now() + 7 * 3_600_000 + daysFromToday * 86_400_000).toISOString().slice(0, 10);
}

// The day before a `yyyy-mm-dd` — date arithmetic on the label itself, no zone.
function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

// The 1st of the month `months` before a `yyyy-mm-dd`'s month — the first day of the window Bulanan opens on.
function firstOfMonthBack(day: string, months: number): string {
  const [y, m] = day.split("-").map(Number);

  return new Date(Date.UTC(y!, m! - 1 - months, 1)).toISOString().slice(0, 10);
}

// Waits for both Daily reads at a grain over a window — the request the screen sends, its body read as JSON.
function asked(page: Page, groupBy: string, from: string, to: string) {
  return Promise.all(
    ["ExpenseDaily", "LiabilityDaily"].map((rpcName) =>
      page.waitForRequest((r) => {
        if (!r.url().endsWith(`/${rpcName}`)) return false;
        const body = JSON.parse(r.postData() ?? "{}") as { groupBy?: string; filter?: { from?: string; to?: string } };

        return body.groupBy === groupBy && body.filter?.from === from && body.filter?.to === to;
      }),
    ),
  );
}

test("Statement: Bulanan and Tahunan are the server's months and years — each the sum of its days", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      type: "TEAM_TYPE_WAREHOUSE",
      name: `E2E Statement Grain ${SUFFIX}`,
      teamCode: `STG${SUFFIX}`,
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  const account = (
    await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E statement grain ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-STG-${SUFFIX}`,
      openingBalance: 0,
      openingOn: jakartaDay(),
    })
  ).account.id;
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: team,
    accountId: account,
    operational: true,
  });

  const now = jakartaDay();
  const firstOfMonth = `${now.slice(0, 8)}01`;
  const lastOfPrevious = dayBefore(firstOfMonth);
  const costs: [string, number][] = [
    [lastOfPrevious, 1_100_000],
    [firstOfMonth, 220_000],
    [now, 33_000],
  ];

  for (const [day, amount] of costs) {
    await rpc(page, "expense.v1.ExpenseService/ExpenseCreate", {
      teamId: team,
      kind: 3, // EXPENSE_KIND_OPERATIONAL
      type: "EXPENSE_TYPE_ELECTRICITY", // a type is required since #99 (expense-types-sit-under-groups)
      amount: String(amount),
      occurredAt: day,
      note: `E2E statement grain ${SUFFIX}`,
      financeAccountId: account,
    });
  }

  const sumWhere = (keep: (day: string) => boolean) =>
    costs.filter(([day]) => keep(day)).reduce((total, [, amount]) => total + amount, 0);

  const thisMonth = now.slice(0, 7);
  const previousMonth = lastOfPrevious.slice(0, 7);

  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  await page.goto("/statement");
  await expect(page.getByTestId("statement-table")).toBeVisible();

  // BULANAN — the last twelve months, the first of them whole, asked of both services by month: twelve rows, and this
  // month and the previous one carry their own days, nothing more.
  const twelveMonthsFrom = firstOfMonthBack(now, 11);
  const askedMonthly = asked(page, "GROUP_TYPE_MONTHLY", twelveMonthsFrom, now);
  await page.getByTestId("statement-grain-month").click();
  await askedMonthly;

  await expect(page.getByTestId(`statement-row-${thisMonth}`)).toBeVisible();
  await expect(page.getByTestId(`statement-row-${twelveMonthsFrom.slice(0, 7)}`)).toBeVisible();
  await expect(page.locator('[data-testid="statement-table"] tbody tr')).toHaveCount(12);
  await expect(page).toHaveURL(new RegExp(`range=${twelveMonthsFrom}\\.\\.${now}`));

  await expect
    .poll(() => rowCell(page, thisMonth, "Other expenses"))
    .toBe(sumWhere((day) => day.startsWith(thisMonth)));
  expect(await rowCell(page, previousMonth, "Other expenses")).toBe(1_100_000);
  expect(await money(page, "statement-footer-profit")).toBe(-1_353_000);

  // TAHUNAN OPENS ON FIVE YEARS — 1 January four years back → today, asked by year: five rows, this year's carrying
  // its own days.
  const thisYear = now.slice(0, 4);
  const fiveYearsFrom = `${Number(thisYear) - 4}-01-01`;
  const askedYearly = asked(page, "GROUP_TYPE_YEARLY", fiveYearsFrom, now);
  await page.getByTestId("statement-grain-year").click();
  await askedYearly;

  await expect(page.locator('[data-testid="statement-table"] tbody tr')).toHaveCount(5);
  await expect(page.getByTestId(`statement-row-${Number(thisYear) - 4}`)).toBeVisible();
  await expect(page.getByTestId(`statement-row-${thisYear}`)).toBeVisible();
  await expect
    .poll(() => rowCell(page, thisYear, "Other expenses"))
    .toBe(sumWhere((day) => day.startsWith(thisYear)));
  expect(await money(page, "statement-footer-profit")).toBe(-1_353_000);

  // The server's month IS the sum of its days — the API at both grains, over the same two months.
  const period = { from: `${previousMonth}-01`, to: now, kind: 0, shopId: "0" };
  const days = await rpc<{ days: { date: string; total?: number; entries?: string }[] }>(
    page,
    "expense.v1.ExpenseService/ExpenseDaily",
    { teamId: team, filter: period },
  );
  const months = await rpc<{ days: { date: string; total?: number; entries?: string }[] }>(
    page,
    "expense.v1.ExpenseService/ExpenseDaily",
    { teamId: team, filter: period, groupBy: "GROUP_TYPE_MONTHLY" },
  );

  const rolled = new Map<string, { total: number; entries: number }>();
  for (const d of days.days) {
    const key = `${d.date.slice(0, 7)}-01`;
    const held = rolled.get(key) ?? { total: 0, entries: 0 };
    held.total += d.total ?? 0;
    held.entries += Number(d.entries ?? "0");
    rolled.set(key, held);
  }

  expect(months.days.map((m) => [m.date, m.total ?? 0, Number(m.entries ?? "0")])).toEqual(
    [...rolled.entries()].map(([date, b]) => [date, b.total, b.entries]),
  );
});

// ── THE SPAN EACH GRAIN UNLOCKS (periods-are-grouped-on-the-server) ────────────────────────────────
//
// Harian reads up to 366 days, Bulanan 60 months, Tahunan 20 years — so three years of Tahunan, picked by hand (the URL
// holds it), is ONE call per service answering three rows: a hand-picked range stays until the grain is switched. Back
// on Harian the grain re-picks its own window, the last month (the-yearly-statement-opens-on-five-years). Three years
// at Harian, picked by hand, are named by the line under the picker — never sent, never trimmed. In a WAREHOUSE team of
// its own (backlog #50): a cost in each of the three years, 31 December and 1 January among them.

// Every Daily read the page sends — which RPC, at which grain, over which window.
interface StatementRead {
  rpc: string;
  groupBy: string;
  from: string;
  to: string;
}

function recordStatementReads(page: Page): StatementRead[] {
  const reads: StatementRead[] = [];

  page.on("request", (request) => {
    const rpcName = ["ExpenseDaily", "LiabilityDaily"].find((name) => request.url().endsWith(`/${name}`));
    if (!rpcName) return;

    const body = JSON.parse(request.postData() ?? "{}") as { groupBy?: string; filter?: { from?: string; to?: string } };
    reads.push({
      rpc: rpcName,
      groupBy: body.groupBy ?? "GROUP_TYPE_UNSPECIFIED",
      from: body.filter?.from ?? "",
      to: body.filter?.to ?? "",
    });
  });

  return reads;
}

test("Statement: a hand-picked three years of Tahunan is three rows from one call — back on Harian it opens the last month", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const now = jakartaDay();
  const year = Number(now.slice(0, 4));
  const from = `${year - 2}-01-01`;

  const team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      type: "TEAM_TYPE_WAREHOUSE",
      name: `E2E Statement Years ${SUFFIX}`,
      teamCode: `STY${SUFFIX}`,
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  const account = (
    await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E statement years ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-STY-${SUFFIX}`,
      openingBalance: 0,
      openingOn: from,
    })
  ).account.id;
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: team,
    accountId: account,
    operational: true,
  });

  const costs: [string, number][] = [
    [`${year - 2}-03-10`, 410_000],
    [`${year - 1}-12-31`, 95_000],
    [`${year}-01-01`, 64_000],
    [now, 3_000],
  ];

  for (const [day, amount] of costs) {
    await rpc(page, "expense.v1.ExpenseService/ExpenseCreate", {
      teamId: team,
      kind: 3, // EXPENSE_KIND_OPERATIONAL
      type: "EXPENSE_TYPE_ELECTRICITY", // a type is required since #99 (expense-types-sit-under-groups)
      amount: String(amount),
      occurredAt: day,
      note: `E2E statement years ${SUFFIX}`,
      financeAccountId: account,
    });
  }

  const yearTotal = (y: number) =>
    costs.filter(([day]) => day.startsWith(String(y))).reduce((total, [, amount]) => total + amount, 0);

  // TAHUNAN OVER THREE YEARS — opened at its URL (the grain and the window live there).
  const reads = recordStatementReads(page);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  await page.goto(`/statement?grain=year&range=${from}..${now}`);

  await expect(page.locator('[data-testid="statement-table"] tbody tr')).toHaveCount(3);
  for (const y of [year - 2, year - 1, year]) {
    await expect.poll(() => rowCell(page, String(y), "Other expenses")).toBe(yearTotal(y));
  }
  expect(await money(page, "statement-footer-profit")).toBe(-(yearTotal(year - 2) + yearTotal(year - 1) + yearTotal(year)));

  // ONE call per service, by year, over the whole three years.
  expect(reads.sort((a, b) => a.rpc.localeCompare(b.rpc))).toEqual([
    { rpc: "ExpenseDaily", groupBy: "GROUP_TYPE_YEARLY", from, to: now },
    { rpc: "LiabilityDaily", groupBy: "GROUP_TYPE_YEARLY", from, to: now },
  ]);

  // BACK TO HARIAN — the grain re-picks its window: the last month, read by day (never three years by day), and the URL
  // drops both the grain and the range — the screen's defaults.
  await page.getByTestId("statement-grain-day").click();

  await expect(page.locator('[data-testid="statement-table"] tbody tr')).toHaveCount(lastMonthDays());
  await expect(page.getByTestId(`statement-row-${now}`)).toBeVisible();
  await expect(page.getByTestId("statement-range-invalid")).toHaveCount(0);
  await expect(page).not.toHaveURL(/range=|grain=/);
  await expect.poll(() => reads.length).toBe(4);
  expect(reads.slice(2).map((r) => [r.groupBy, r.to])).toEqual([
    ["GROUP_TYPE_DAILY", now],
    ["GROUP_TYPE_DAILY", now],
  ]);
  expect(new Set(reads.slice(2).map((r) => r.from)).size).toBe(1);

  // THREE YEARS PICKED BY HAND AT HARIAN — the line says it is more days than Harian reads, and nothing is sent: no
  // daily read left the browser, and no error came back.
  const days = Math.round((Date.parse(`${now}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  await page.goto(`/statement?range=${from}..${now}`);

  await expect(page.getByTestId("statement-range-invalid")).toHaveText(
    `That range covers ${days} days. Daily reads at most 366 days.`,
  );
  await expect(page).toHaveURL(new RegExp(`range=${from}\\.\\.${now}`));
  await expect(page.getByTestId("statement-table")).toHaveCount(0);
  await expect(page.getByTestId("statement-error")).toHaveCount(0);
  expect(reads).toHaveLength(4);

  // (The API checks below go through the page too, so the recorded reads stop being only the screen's from here.)

  // The server's year IS the sum of its months — the API at both grains, over the same three years (36 months or fewer,
  // inside Bulanan's 60).
  const period = { from, to: now, kind: 0, shopId: "0" };
  const yearly = await rpc<{ days: { date: string; total?: number }[] }>(page, "expense.v1.ExpenseService/ExpenseDaily", {
    teamId: team,
    filter: period,
    groupBy: "GROUP_TYPE_YEARLY",
  });
  const monthly = await rpc<{ days: { date: string; total?: number }[] }>(page, "expense.v1.ExpenseService/ExpenseDaily", {
    teamId: team,
    filter: period,
    groupBy: "GROUP_TYPE_MONTHLY",
  });
  const rolled = new Map<string, number>();
  for (const m of monthly.days) {
    const key = `${m.date.slice(0, 4)}-01-01`;
    rolled.set(key, (rolled.get(key) ?? 0) + (m.total ?? 0));
  }
  expect(yearly.days.map((y) => [y.date, y.total ?? 0])).toEqual([...rolled.entries()]);
  expect(yearly.days.map((y) => y.date)).toEqual([year - 2, year - 1, year].map((y) => `${y}-01-01`));

  // Harian's line is the server's own rule: three years by day is refused there too.
  const refused = await rpc(page, "expense.v1.ExpenseService/ExpenseDaily", { teamId: team, filter: period }).then(
    () => "",
    (err: Error) => err.message,
  );
  expect(refused).toContain("at most 366 days");
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

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

// "Rp 1.234.567" → 1234567, and "Rp -5.000" → -5000. The minus matters: a loss is the one figure here
// somebody has to notice, so a test that silently read it as positive would be worthless.
async function money(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const digits = text.replace(/[^0-9]/g, "");

  return (text.includes("-") ? -1 : 1) * Number(digits);
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

function today(): string {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

// Records one cost against root's own team, dated TODAY — the last day of the default 30-day window.
async function recordCost(page: Page, amount: number, note: string) {
  await page.evaluate(
    async ([amt, text, on]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch("http://localhost:8081/warehouse.expense.v1.ExpenseService/ExpenseCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          teamId: "1",
          kind: 3, // EXPENSE_KIND_OPERATIONAL
          amount: String(amt),
          occurredAt: on,
          note: text,
        }),
      });

      if (!res.ok) throw new Error(`ExpenseCreate: ${res.status} ${await res.text()}`);
    },
    [amount, note, today()] as const,
  );
}

test.describe.configure({ mode: "serial" });

// THE DATE SPINE. Both series are sparse, so this is the assertion that the CLIENT is building the
// calendar: the default window is 30 days, and all 30 must be on screen even though almost none of them
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

  await expect(page.getByTestId("statement-day-count")).toHaveText("Showing 30 of 30 days");
  await expect(page.locator('[data-testid="statement-table"] tbody tr')).toHaveCount(30);

  // Today is the LAST row of a "last 30 days" window, so it is always present — which is what the next
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
  const running = (lastRunning.includes("-") ? -1 : 1) * Number(digits);

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
  await expect(page.getByTestId("statement-day-count")).toHaveText("Showing 30 of 30 days");

  await page.getByTestId("statement-range").click();
  await page.getByTestId("statement-range-quick-7").click();

  await expect(page.getByTestId("statement-day-count")).toHaveText("Showing 7 of 7 days");
  await expect(page.locator('[data-testid="statement-table"] tbody tr')).toHaveCount(7);

  // Today is the last day of any "last N days" window, so it survives the narrowing.
  await expect(page.getByTestId(`statement-row-${today()}`)).toBeVisible();
});

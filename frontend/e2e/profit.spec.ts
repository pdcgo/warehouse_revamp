import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #172 — the profit screen: expected margin minus costs, for one month.
//
// This is the destination of the whole expense service, and the subtraction happens on the CLIENT (§2.4):
// revenue_service and expense_service are independent, so neither may own a number derived from the
// other's data. The screen asks both for the same period and does the arithmetic itself — which is
// exactly what these tests are here to check, because a sign error or a mis-read field would produce a
// perfectly plausible-looking number.
//
// Root is a ROOT team, so the Profit menu item is not offered (it is a selling-team surface), but root
// holds ROLE_ROOT and both list RPCs are authorised in team 1 — so the route is reached directly, the
// same way expenses.spec.ts and revenue.spec.ts reach theirs. The menu gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);

// ⚠ THE FIGURES ARE CHECKED AS DELTAS, NOT ABSOLUTES, and that is deliberate.
//
// Every spec in this suite shares one database and root's team 1, so expenses.spec.ts and revenue.spec.ts
// have both put money in this very month by the time this runs. An absolute expectation ("profit is
// Rp 50.000") would therefore be a test that passes only while it happens to run first. What this
// screen actually promises is a RELATIONSHIP between three numbers, and a delta tests the relationship
// without pretending to own the data.
const COST = 1_234_567;

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

// "Rp 1.234.567" → 1234567, and "Rp -5.000" → -5000. The minus matters: a loss is the one figure on
// this screen somebody has to notice, so a test that silently read it as positive would be worthless.
async function money(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).innerText();
  const digits = text.replace(/[^0-9]/g, "");

  return (text.includes("-") ? -1 : 1) * Number(digits);
}

// Records one cost against root's own team, dated TODAY so it lands in the month the screen opens on.
async function recordCost(page: Page, amount: number, note: string) {
  await page.evaluate(
    async ([amt, text]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate(),
      ).padStart(2, "0")}`;

      const res = await fetch("http://localhost:8081/warehouse.expense.v1.ExpenseService/ExpenseCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          teamId: "1",
          kind: 3, // EXPENSE_KIND_OPERATIONAL
          amount: String(amt),
          occurredAt: today,
          note: text,
        }),
      });

      if (!res.ok) throw new Error(`ExpenseCreate: ${res.status} ${await res.text()}`);
    },
    [amount, note] as const,
  );
}

test.describe.configure({ mode: "serial" });

test("Profit: the screen says these are EXPECTED figures (#172)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/profit");

  await expect(page.getByTestId("profit-summary")).toBeVisible();

  // Half of this subtraction is an expectation, not cash. An unlabelled money screen is read as the
  // bank balance, and none of the margin here has been reconciled against a real payout (§2.3).
  await expect(page.getByTestId("profit-expected-notice")).toBeVisible();
  await expect(page.getByTestId("profit-expected-notice")).toContainText("EXPECTED");
});

// THE ARITHMETIC. A cost recorded now must move the bottom line by exactly its own amount, downwards,
// and must not touch the margin — which is what "profit = margin − cost" means when written as a test
// rather than as a comment.
test("Profit: a recorded cost comes off the bottom line, rupiah for rupiah (#172)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/profit");
  await expect(page.getByTestId("profit-summary")).toBeVisible();

  const before = {
    margin: await money(page, "profit-margin"),
    cost: await money(page, "profit-cost"),
    profit: await money(page, "profit-total"),
  };

  // The three numbers agree with each other before anything is touched.
  expect(before.profit).toBe(before.margin - before.cost);

  await recordCost(page, COST, `E2E profit ${SUFFIX}`);
  await page.reload();
  await expect(page.getByTestId("profit-summary")).toBeVisible();

  const after = {
    margin: await money(page, "profit-margin"),
    cost: await money(page, "profit-cost"),
    profit: await money(page, "profit-total"),
  };

  // The cost half moved by exactly what was spent…
  expect(after.cost).toBe(before.cost + COST);
  // …the margin did not move at all — spending money does not change what the orders were expected
  // to make, and a screen that moved both would be reading one number into two places…
  expect(after.margin).toBe(before.margin);
  // …and the bottom line came DOWN by the same amount. The sign is the point: a `+` here would look
  // like a very good month.
  expect(after.profit).toBe(before.profit - COST);
});

// The PERIOD, applied to both halves. This is the failure #171 existed to prevent, seen from the
// screen that would have suffered it: if only one of the two reads were filtered, a month with no
// orders and no costs would still show one side of the subtraction and report it as profit.
test("Profit: a month with nothing in it is zero on both halves (#172)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/profit");
  await expect(page.getByTestId("profit-summary")).toBeVisible();

  // This month has money in it — the test above put some there.
  expect(await money(page, "profit-cost")).toBeGreaterThan(0);

  // A month long before this system existed has none, on EITHER side.
  await page.getByTestId("profit-month").fill("2020-01");

  await expect(page.getByTestId("profit-margin")).toHaveText("Rp 0");
  await expect(page.getByTestId("profit-cost")).toHaveText("Rp 0");
  await expect(page.getByTestId("profit-total")).toHaveText("Rp 0");
});

// #173 — A SLOW EARLIER RESPONSE MUST NOT OVERWRITE A NEWER ONE.
//
// The bug #173 found across 19 pages, tested here because this is the screen where it does the most
// damage: every figure is money, and a month's profit painted under a picker reading a different
// month is wrong in a way nobody can see. Both candidates are plausible numbers.
//
// #173 calls this class of bug "invisible to the e2e suite", and by accident it is — a race does not
// reproduce on demand. So this test does not wait for one: it DELAYS the first read at the network
// so the second is guaranteed to land first, which turns the race into a certainty.
test("Profit: a slow earlier month cannot overwrite a newer one (#173)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Hold the FIRST revenue read — the one for this month — until well after the second has been and
  // gone. Only the first: the reads for 2020-01 must arrive promptly or there is nothing to race.
  let seen = 0;
  await page.route("**/warehouse.revenue.v1.RevenueService/RevenueList", async (route) => {
    seen += 1;
    if (seen === 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    await route.continue();
  });

  await page.goto("/profit");

  // Switch months while that first read is still in flight. The header renders before the figures do,
  // so the picker is usable during the load — which is exactly how a real person triggers this.
  const month = page.getByTestId("profit-month");
  await expect(month).toBeVisible();
  await month.fill("2020-01");

  // 2020-01 is empty, so the honest answer is zero…
  await expect(page.getByTestId("profit-total")).toHaveText("Rp 0");

  // …and it MUST STILL BE ZERO after the stale read lands. Without the guard, this month's figures
  // arrive late and paint themselves over a screen whose picker says 2020-01.
  await page.waitForTimeout(5000);

  await expect(month).toHaveValue("2020-01");
  await expect(page.getByTestId("profit-margin")).toHaveText("Rp 0");
  await expect(page.getByTestId("profit-cost")).toHaveText("Rp 0");
  await expect(page.getByTestId("profit-total")).toHaveText("Rp 0");
});

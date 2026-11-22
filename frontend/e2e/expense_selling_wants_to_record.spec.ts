import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { openShops } from "./pickers";

// ── record expense — the checks behind docs/acceptances/financial_account/expense.md, givens 1–16 ──────────────────────
//
// record expense's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test per role, one test.step("then: …") per then. The
// rows' statuses are the owner's, set by hand — never by this file.
//
// Business rules (docs/business/financial_account/context_decision.md):
// - an-expense-must-name-the-account-that-paid — every expense names an OPERATIONAL account of the team, which goes down
//   by the amount; a team with none cannot record (the form says where an admin marks one; the server refuses).
// - an-expense-names-a-shop-only-for-ads (read per type) — Iklan marketplace names the team's shop, and must.
// - an-expense-posts-on-its-own-day — the date is the day the cost BELONGS TO: payroll paid on the 5th is last month's.
// - expense-types-sit-under-groups / the-expense-types-prototype-is-accepted — each type under its group (Iklan, Gaji,
//   Operasional, Lainnya); the month card's group and type totals and Total bulan ini; Iklan's types post `ads_expense`,
//   the rest `expense`; the Expenses metric counts each type in its GROUP's field and in `total`.
//
// The WHEN, as the person does it: /expenses → Catat biaya (`open-record-cost`) → the type, the amount, (the day), (the
// shop), Paid from (the one operational account is picked by itself), a note → Save. Recorded THROUGH THE DIALOG by the
// role user — the person recording.
//
// GROUND (beforeAll, as root, through the API): one SELLING TEAM per (given, role) — root its owner, the role user (a
// `selling:owner` or `selling:admin`) its member — so the month card and the metric read exactly this test's amount. Each
// team has one BCA account opened at Rp 10.000.000 on the first day of last month, marked operational — except given 5's
// (team with no operational account), whose account is left unmarked. Givens 3 and 4 also have one shop.
//
// How the thens are read:
// - `expense shown with who recorded it` — the new row in the list, its Recorded by (`expense-by-<id>`) the role user's name.
// - `operational account decreases by the amount` — the account's own page, POLLED (the post is event-driven: expense
//   service publishes, the Pub/Sub emulator pushes, financial_account's listener posts): Rp 10.000.000 − the amount.
// - `<group|type> and month total increase by the amount` — the month card, Rp 0 before the WHEN: the group's total
//   (`expenses-total-kind-<kind>`) or the type's line under its group (`expenses-total-type-<key>`), and Total bulan ini
//   (`expenses-total`), each reading the amount after.
// - `recorded in expense analytic metric` — MetricData (metrics/expenses, the summary over today) as the role user: the
//   type's GROUP field (contentEndorse is Iklan: `ads`) and `total` read the amount. `recorded in ads expense analytic
//   metric` — metrics/ads `amount` (and the Expenses metric's `ads`).
// - given 2 (October payroll recorded on 5 Nov · date 31 Oct) — the given's 31 Oct is THE LAST DAY OF THE PREVIOUS
//   MONTH (Jakarta), so the spec runs in any month: `counted in October` — this month's list and total do not hold it,
//   the month picker on last month shows the row and its totals; `account history shows it on 31 Oct` — the account's
//   history row for the expense is dated that day.
// - `cannot record expense` — on BOTH layers: the form holds (Save disabled, the reason listed / the no-account notice
//   with its link to Financial Accounts), the same ExpenseCreate sent anyway with the ROLE's token is refused, and
//   ExpenseList holds nothing.

const SUFFIX = Date.now().toString().slice(-6);
// This spec's own letter, beside the suffix, in every team code, account number, username and name.
const MARK = "V";
const PASSWORD = "e2e-record-pass-1";
const OPENING = 10_000_000;
const ADS_METRIC = "metrics/ads";
const EXPENSES_METRIC = "metrics/expenses";
const CREATE = "expense.v1.ExpenseService/ExpenseCreate";

// ExpenseKind — the group ids the month card's test ids carry.
const KIND = { ads: 1, payroll: 2, operational: 3, other: 4 } as const;

const rp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// proto3 JSON leaves a zero out — read it as 0.
const n = (v: number | undefined) => v ?? 0;

/** Today, as a Jakarta day — the business's day. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

/** The last day of the previous Jakarta month — the given 2's "31 Oct". */
function lastDayOfPreviousMonth(): string {
  const [y, m] = today().split("-").map(Number) as [number, number];

  return new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
}
const LAST_DAY = lastDayOfPreviousMonth();
const LAST_MONTH = LAST_DAY.slice(0, 7);
// The accounts open before the back-dated expense's day.
const OPENING_ON = `${LAST_MONTH}-01`;

const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "O", word: "Owner" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "A", word: "Admin" },
] as const;
type Role = (typeof ROLES)[number];

// The cost types of givens 6–16 — one given each, the same three thens. `then` is the type's own then, word for word.
const TYPE_GIVENS = [
  { id: 6, paren: "adjustment · uncovered transaction", type: "discrepancy", kind: KIND.operational, field: "operational", amount: 125_000, then: "then: adjustment and month total increase by the amount" },
  { id: 7, paren: "bank fee", type: "bankFee", kind: KIND.operational, field: "operational", amount: 6_500, then: "then: bank fee and month total increase by the amount" },
  { id: 8, paren: "content · endorsement", type: "contentEndorse", kind: KIND.ads, field: "ads", amount: 1_500_000, then: "then: content and month total increase by the amount" },
  { id: 9, paren: "tools · camera", type: "tools", kind: KIND.operational, field: "operational", amount: 2_250_000, then: "then: tools and month total increase by the amount" },
  { id: 10, paren: "equipment · office chair", type: "equipment", kind: KIND.operational, field: "operational", amount: 1_750_000, then: "then: equipment and month total increase by the amount" },
  { id: 11, paren: "electricity", type: "electricity", kind: KIND.operational, field: "operational", amount: 850_000, then: "then: electricity and month total increase by the amount" },
  { id: 12, paren: "kitchen · team meals", type: "kitchen", kind: KIND.operational, field: "operational", amount: 600_000, then: "then: kitchen and month total increase by the amount" },
  { id: 13, paren: "internet · data package", type: "internet", kind: KIND.operational, field: "operational", amount: 350_000, then: "then: internet and month total increase by the amount" },
  { id: 14, paren: "basic salary", type: "basicSalary", kind: KIND.payroll, field: "payroll", amount: 4_000_000, then: "then: basic salary and month total increase by the amount" },
  { id: 15, paren: "bonus · target reached", type: "bonus", kind: KIND.payroll, field: "payroll", amount: 1_000_000, then: "then: bonus and month total increase by the amount" },
  { id: 16, paren: "contributions", type: "contributions", kind: KIND.payroll, field: "payroll", amount: 450_000, then: "then: contributions and month total increase by the amount" },
] as const;

const GIVEN_IDS = [1, 2, 3, 4, 5, ...TYPE_GIVENS.map((g) => g.id)];
const WITH_SHOP = new Set([3, 4]);
const NO_OPERATIONAL = 5;

// One (given, role)'s ground.
interface Seat {
  tag: string;
  team: string;
  account: string;
  accountName: string;
  shop: string;
  shopName: string;
  username: string;
  name: string;
}
const seats = new Map<string, Seat>();
const seatOf = (given: number, r: Role): Seat => {
  const s = seats.get(`${given}${r.key}`);
  if (!s) throw new Error(`no ground for given ${given} · ${r.given}`);

  return s;
};

test.describe.configure({ timeout: 120_000 });

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

// GROUND for one (given, role): its selling team, its role user, its account (operational but on given 5), its shop.
async function makeSeat(page: Page, given: number, r: Role): Promise<Seat> {
  const tag = `${String(given).padStart(2, "0")}${r.key}`;
  const team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      type: "TEAM_TYPE_SELLING",
      name: `E2E Rec ${tag} ${MARK}${SUFFIX}`,
      teamCode: `${MARK}${tag}${SUFFIX}`,
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  // A username is lowercase letters and digits only.
  const username = `e2e${MARK}${tag}${SUFFIX}`.toLowerCase();
  const name = `Rec ${tag} ${r.word} ${MARK}${SUFFIX}`;
  await rpc(page, "user.v1.UserService/CreateUser", { teamId: team, username, password: PASSWORD, name, role: r.role });

  // ⚠ Seeded BEFORE the Biaya page opens: Paid from reads the operational accounts once, as reference data
  // (expenses.spec.ts says why). One account, so the form picks it by itself.
  const accountName = `E2E Rec BCA ${tag} ${MARK}${SUFFIX}`;
  const account = (
    await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: accountName,
      holderName: "E2E",
      accountNumber: `${MARK}${SUFFIX}${tag}`,
      openingBalance: OPENING,
      openingOn: OPENING_ON,
    })
  ).account.id;
  if (given !== NO_OPERATIONAL) {
    await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: team,
      accountId: account,
      operational: true,
    });
  }

  let shop = "";
  let shopName = "";
  if (WITH_SHOP.has(given)) {
    shopName = `E2E Rec Shop ${tag} ${MARK}${SUFFIX}`;
    shop = (
      await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
        teamId: team,
        name: shopName,
        shopCode: `${MARK}${tag}${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id;
  }

  return { tag, team, account, accountName, shop, shopName, username, name };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const jobs = GIVEN_IDS.flatMap((g) => ROLES.map((r) => [g, r] as const));
  // A few at a time — each seat's own calls stay in order.
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(
      jobs.slice(i, i + 4).map(async ([g, r]) => {
        seats.set(`${g}${r.key}`, await makeSeat(page, g, r));
      }),
    );
  }

  await page.close();
});

// The role user, signed in, on its team's Biaya page — nothing recorded yet.
async function openExpenses(page: Page, s: Seat) {
  await signIn(page, s.username, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), s.team);
  await page.goto("/expenses");
  await expect(page.getByTestId("expenses-empty")).toBeVisible();
  await expect(page.getByTestId("expenses-total")).toHaveText("Rp 0");
}

// The dialog's calendar on `day` — it opens on the form's day (today), so one step back to last month.
async function pickLastMonthDay(page: Page, day: string) {
  await page.getByTestId("expense-date").click();
  const content = page.getByTestId("expense-date-content");
  await expect(content).toBeVisible();
  await content.locator('[data-part="prev-trigger"]').filter({ visible: true }).click();
  await content
    .locator(`[data-part="table-cell-trigger"][data-value="${day}"]:not([data-outside-range])`)
    .filter({ visible: true })
    .click();
  await expect(content).toBeHidden();
}

// The dialog filled up to Save: the type, the amount, (the day), (the shop), Paid from read, a note.
async function fillForm(page: Page, s: Seat, o: { type: string; amount: number; note: string; day?: string; shop?: boolean }) {
  await page.getByTestId("open-record-cost").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("expense-type-select").click();
  await page.getByTestId(`expense-type-select-${o.type}`).click();
  await page.getByTestId("expense-amount").fill(String(o.amount));
  if (o.day) await pickLastMonthDay(page, o.day);
  if (o.shop) {
    await openShops(dialog);
    await dialog.getByTestId(`shop-select-option-${s.shop}`).click();
  }
  await page.getByTestId("expense-note").fill(o.note);

  return dialog;
}

// WHEN — record expense: the filled dialog saved; the expense ExpenseCreate answered with.
async function record(
  page: Page,
  s: Seat,
  o: { type: string; amount: number; note: string; day?: string; shop?: boolean },
): Promise<{ id: string; occurredAt: string }> {
  const dialog = await fillForm(page, s, o);
  // The team's one operational account, picked by itself.
  await expect(page.getByTestId("expense-paid-from")).toContainText(s.accountName);
  await expect(page.getByTestId("submit-cost")).toBeEnabled();

  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`/warehouse.${CREATE}`)),
    page.getByTestId("submit-cost").click(),
  ]);
  expect(answer.status(), "ExpenseCreate").toBe(200);
  const body = (await answer.json()) as { expense: { id: string; occurredAt: string } };
  await expect(dialog).toBeHidden();

  return body.expense;
}

// The account's own page, re-read until the listener's post has landed.
async function balanceIs(page: Page, account: string, text: string) {
  await expect
    .soft(async () => {
      await page.goto(`/financial-accounts/${account}`);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(text, { timeout: 3_000 });
    })
    .toPass({ timeout: 45_000 });
}

// The account history's row the expense posted ("Expense E-<id>"), once it has landed.
async function historyRowOf(page: Page, account: string, expenseId: string) {
  const row = page
    .getByTestId("account-log-table")
    .getByRole("row")
    .filter({ hasText: new RegExp(`Expense E-${expenseId}(?!\\d)`) });
  await expect
    .soft(async () => {
      await page.goto(`/financial-accounts/${account}`);
      await expect(row).toHaveCount(1, { timeout: 3_000 });
    })
    .toPass({ timeout: 45_000 });

  return row;
}

type Figures = Record<string, number | undefined>;
interface MetricDataAnswer {
  metricDatas: { adsSummary?: Figures; expensesSummary?: Figures }[];
}

// The team's analytic figures over one day, as the signed-in person reads them (every member reads its team's).
async function figures(page: Page, teamId: string, day: string) {
  const res = await rpc<MetricDataAnswer>(page, "expense.v1.ExpenseAnalyticService/MetricData", {
    teamId,
    groupBy: "GROUP_TYPE_SUMMARY",
    filters: [{ dateRangeFilter: { dateMin: day, dateMax: day } }],
    metricIds: [ADS_METRIC, EXPENSES_METRIC],
  });

  return { ads: res.metricDatas[0]?.adsSummary ?? {}, expenses: res.metricDatas[1]?.expensesSummary ?? {} };
}

// The Expenses metric's group field and total read the amount today.
async function expenseMetricReads(page: Page, teamId: string, field: string, amount: number) {
  await expect
    .soft(async () => {
      const f = await figures(page, teamId, today());
      expect({ [field]: n(f.expenses[field]), total: n(f.expenses.total) }).toEqual({ [field]: amount, total: amount });
    })
    .toPass({ timeout: 30_000 });
}

// How many expense rows the team holds, any day — the "nothing stored" of a refused record.
async function storedRows(page: Page, teamId: string): Promise<number> {
  const listed = await rpc<{ ids?: string[] }>(page, "expense.v1.ExpenseService/ExpenseList", {
    teamId,
    filter: {},
    page: { page: 1, limit: 10 },
  });

  return (listed.ids ?? []).length;
}

test.describe("selling:owner · selling:admin wants to record a cost (payroll · operational account)", () => {
  for (const r of ROLES) {
    test(`${r.given} record expense`, async ({ page }) => {
      const s = seatOf(1, r);
      const amount = 2_500_000;
      const note = `E2E payroll ${s.tag} ${SUFFIX}`;
      await openExpenses(page, s);
      await expect(page.getByTestId(`expenses-total-kind-${KIND.payroll}`)).toHaveText("Rp 0");

      // WHEN — Gaji › Gaji pokok, Rp 2.500.000, today, paid from the operational account.
      const expense = await record(page, s, { type: "basicSalary", amount, note });

      await test.step("then: expense shown with who recorded it", async () => {
        await expect.soft(page.getByTestId(`expense-row-${expense.id}`)).toContainText(note);
        await expect.soft(page.getByTestId(`expense-by-${expense.id}`)).toContainText(s.name);
      });

      await test.step("then: payroll and month total increase by the amount", async () => {
        await expect.soft(page.getByTestId(`expenses-total-kind-${KIND.payroll}`)).toHaveText(rp(amount));
        await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(amount));
      });

      await test.step("then: recorded in expense analytic metric", async () => {
        await expenseMetricReads(page, s.team, "payroll", amount);
      });

      await test.step("then: operational account decreases by the amount", async () => {
        await balanceIs(page, s.account, rp(OPENING - amount));
      });
    });
  }
});

test.describe("selling:owner · selling:admin wants to record a cost (October payroll recorded on 5 Nov · date 31 Oct)", () => {
  for (const r of ROLES) {
    test(`${r.given} record expense`, async ({ page }) => {
      const s = seatOf(2, r);
      const amount = 3_000_000;
      const note = `E2E last month's payroll ${s.tag} ${SUFFIX}`;
      await openExpenses(page, s);

      // WHEN — Gaji › Gaji pokok, Rp 3.000.000, dated the last day of last month (recorded today).
      const expense = await record(page, s, { type: "basicSalary", amount, note, day: LAST_DAY });
      expect(expense.occurredAt, "the day picked on the calendar").toBe(LAST_DAY);

      await test.step("then: counted in October", async () => {
        // This month (the page's own) neither lists it nor counts it.
        await expect.soft(page.getByTestId(`expense-row-${expense.id}`)).toHaveCount(0);
        await expect.soft(page.getByTestId("expenses-total")).toHaveText("Rp 0");
        // Last month does.
        await page.getByTestId("expenses-month").fill(LAST_MONTH);
        await expect.soft(page.getByTestId(`expense-row-${expense.id}`)).toContainText(note);
        await expect.soft(page.getByTestId(`expenses-total-kind-${KIND.payroll}`)).toHaveText(rp(amount));
        await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(amount));
      });

      await test.step("then: account history shows it on 31 Oct", async () => {
        const row = await historyRowOf(page, s.account, expense.id);
        // The day as the history writes it (formatUnixDate: the app's language, Jakarta).
        const shown = await page.evaluate(
          (day) =>
            new Date(`${day}T00:00:00+07:00`).toLocaleDateString(document.documentElement.lang || "en", {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "Asia/Jakarta",
            }),
          LAST_DAY,
        );
        // The row's date cell opens with that day (a "recorded on" line may follow it).
        await expect.soft(row.getByRole("cell").first()).toHaveText(new RegExp(`^${escapeRe(shown)}`));
      });
    });
  }
});

test.describe("selling:owner · selling:admin wants to record a cost (ads · shop)", () => {
  for (const r of ROLES) {
    test(`${r.given} record expense`, async ({ page }) => {
      const s = seatOf(3, r);
      const amount = 750_000;
      const note = `E2E ads ${s.tag} ${SUFFIX}`;
      await openExpenses(page, s);

      // WHEN — Iklan › Iklan marketplace on the team's shop, Rp 750.000, today.
      const expense = await record(page, s, { type: "adsMarketplace", amount, note, shop: true });

      await test.step("then: shop shown under the kind", async () => {
        // In the row's kind cell, under its Iklan › Iklan marketplace.
        const kindCell = page.getByTestId(`expense-row-${expense.id}`).getByRole("cell").nth(1);
        await expect.soft(kindCell.getByTestId(`expense-type-${expense.id}`)).toBeVisible();
        await expect.soft(kindCell.getByTestId(`expense-shop-${expense.id}`)).toHaveText(s.shopName);
      });

      await test.step("then: recorded in ads expense analytic metric", async () => {
        await expect
          .soft(async () => {
            const f = await figures(page, s.team, today());
            expect({ adsExpense: n(f.ads.amount), expensesAds: n(f.expenses.ads) }).toEqual({ adsExpense: amount, expensesAds: amount });
          })
          .toPass({ timeout: 30_000 });
      });

      await test.step("then: account history shows it as ads expense", async () => {
        const row = await historyRowOf(page, s.account, expense.id);
        // Its change type is Ads (`ads_expense`), never a plain Expense; out by the amount.
        await expect.soft(row.getByRole("cell").nth(1)).toHaveText("Ads");
        await expect.soft(row.getByRole("cell").nth(3)).toHaveText(new RegExp(`^[-−]${escapeRe(rp(amount))}$`));
      });
    });
  }
});

test.describe("selling:owner · selling:admin wants to record a cost (ads · no shop)", () => {
  for (const r of ROLES) {
    test(`${r.given} record expense`, async ({ page }) => {
      const s = seatOf(4, r);
      const amount = 400_000;
      const note = `E2E ads no shop ${s.tag} ${SUFFIX}`;
      await openExpenses(page, s);

      // WHEN — Iklan › Iklan marketplace, Rp 400.000, no shop picked.
      const dialog = await fillForm(page, s, { type: "adsMarketplace", amount, note });
      await expect(page.getByTestId("expense-paid-from")).toContainText(s.accountName);

      await test.step("then: cannot record expense", async () => {
        // The form holds — the shop asked for and listed as the one thing missing; Save disabled.
        await expect.soft(dialog.getByTestId("expense-shop-field")).toBeVisible();
        await expect.soft(page.getByTestId("expense-form-missing-shop")).toBeVisible();
        await expect.soft(page.locator('[data-testid^="expense-form-missing-"]')).toHaveCount(1);
        await expect.soft(page.getByTestId("submit-cost")).toBeDisabled();

        // The same record sent anyway with the role's token, no shop: refused.
        const refused = await send(page, CREATE, {
          teamId: s.team,
          kind: "EXPENSE_KIND_ADS",
          type: "EXPENSE_TYPE_ADS_MARKETPLACE",
          amount,
          occurredAt: today(),
          note,
          financeAccountId: s.account,
        });
        expect.soft(refused.status).not.toBe(200);
        expect.soft(refused.json.code).toBe("invalid_argument");
        expect.soft(String(refused.json.message)).toContain("shop");

        // Nothing stored — on the server and on the screen.
        expect.soft(await storedRows(page, s.team)).toBe(0);
        await dialog.getByRole("button", { name: "Cancel" }).click();
        await expect(dialog).toBeHidden();
        await page.reload();
        await expect.soft(page.getByTestId("expenses-empty")).toBeVisible();
        await expect.soft(page.getByTestId("expenses-total")).toHaveText("Rp 0");
      });
    });
  }
});

test.describe("selling:owner · selling:admin wants to record a cost (team with no operational account)", () => {
  for (const r of ROLES) {
    test(`${r.given} record expense`, async ({ page }) => {
      const s = seatOf(5, r);
      const amount = 300_000;
      const note = `E2E no operational ${s.tag} ${SUFFIX}`;
      await openExpenses(page, s);

      // WHEN — Gaji › Gaji pokok, Rp 300.000; the team's one account is not operational.
      await fillForm(page, s, { type: "basicSalary", amount, note });

      await test.step("then: cannot record expense", async () => {
        // The form holds: Paid from has nothing to offer, says so with its way to Financial Accounts; Save disabled.
        await expect.soft(page.getByTestId("expense-no-operational")).toBeVisible();
        await expect.soft(page.getByTestId("expense-paid-from")).toBeDisabled();
        await expect.soft(page.getByTestId("expense-form-missing-account")).toBeVisible();
        await expect.soft(page.getByTestId("submit-cost")).toBeDisabled();

        // The same record sent anyway with the role's token, naming the team's NON-operational account: refused.
        const refused = await send(page, CREATE, {
          teamId: s.team,
          kind: "EXPENSE_KIND_PAYROLL",
          type: "EXPENSE_TYPE_BASIC_SALARY",
          amount,
          occurredAt: today(),
          note,
          financeAccountId: s.account,
        });
        expect.soft(refused.status).not.toBe(200);
        expect.soft(refused.json.code).toBe("failed_precondition");
        expect.soft(String(refused.json.message)).toContain("not one of the team's active operational accounts");
        expect.soft(await storedRows(page, s.team)).toBe(0);

        // The notice's link opens Financial Accounts, where an admin marks one.
        await page.getByTestId("expense-open-accounts").click();
        await expect.soft(page).toHaveURL(/\/financial-accounts$/);
      });
    });
  }
});

// Givens 6–16 — one cost type each, the same three thens.
for (const g of TYPE_GIVENS) {
  test.describe(`selling:owner · selling:admin wants to record a cost (${g.paren})`, () => {
    for (const r of ROLES) {
      test(`${r.given} record expense`, async ({ page }) => {
        const s = seatOf(g.id, r);
        const note = `E2E ${g.type} ${s.tag} ${SUFFIX}`;
        await openExpenses(page, s);
        await expect(page.getByTestId(`expenses-total-type-${g.type}`)).toHaveCount(0);

        // WHEN — the type, its amount, today, paid from the operational account.
        await record(page, s, { type: g.type, amount: g.amount, note });

        await test.step(g.then, async () => {
          // The type's line, under its group, and the month's total — each now the amount.
          const line = page.getByTestId(`expenses-group-${g.kind}`).getByTestId(`expenses-total-type-${g.type}`);
          await expect.soft(line).toHaveText(new RegExp(`(^|[^\\d.])${escapeRe(rp(g.amount))}$`));
          await expect.soft(page.getByTestId("expenses-total")).toHaveText(rp(g.amount));
        });

        await test.step("then: recorded in expense analytic metric", async () => {
          await expenseMetricReads(page, s.team, g.field, g.amount);
        });

        await test.step("then: operational account decreases by the amount", async () => {
          await balanceIs(page, s.account, rp(OPENING - g.amount));
        });
      });
    }
  });
}

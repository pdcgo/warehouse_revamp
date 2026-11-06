import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// THE EXPENSE METRICS, END TO END (docs/business/analytic/rpc_provide_decision.md — expense-has-ads-and-expenses,
// expense-figures-are-read-from-its-own-records, an-expense-correction-counts-on-the-day-it-is-made,
// an-expense-correction-counts-for-who-made-it, the-expense-prototype-is-accepted) — against the real server and
// Postgres.
//
// A SELLING TEAM OF ITS OWN, owned by root, with its own shop, paying account and two members — so root's own team, whose
// totals financial_accounts.spec checks, is never touched, and no order is placed (orders.spec counts them). The file
// sorts after statement.spec.ts.
//
//   3 days ago   root types an ad of 500.000 on the team's shop, and a payroll of 2.000.000
//   today        Dewi (the team's admin) corrects the ad by −450.000
//
// In Analytic the correction counts TODAY, under Dewi; 3 days ago keeps its 500.000. The Expenses page and the
// statement keep the correction on the ad's own day. The composer's Created by offers the two of them — and only them —
// with nothing but expense metrics on the table (ExpensePersonList).

const SUFFIX = Date.now().toString().slice(-6);
const ADS = "metrics/ads";
const EXPENSES = "metrics/expenses";
const PASSWORD = "e2e-expense-pass-1";
// A username is lowercase letters and digits only.
const DEWI = `e2eexpdewi${SUFFIX}`;
const DEWI_NAME = `Dewi Expense ${SUFFIX}`;
const CS = `e2eexpcs${SUFFIX}`;

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** A Jakarta day `ago` days before today. */
const day = (ago: number) =>
  new Date(Date.now() - ago * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

async function login(page: Page, username = ROOT_USERNAME, password = ROOT_PASSWORD) {
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

// The real contract under the signed-in token; a refusal fails here, by name.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body] as const,
  ) as Promise<T>;
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const state = { team: "", shop: "", account: "", ad: "", dewi: "" };

type Figures = Record<string, number | undefined>;

interface MetricDataAnswer {
  metricDatas: {
    adsById?: { items: Record<string, Figures> };
    adsByDay?: { items: Record<string, Figures> };
    adsSummary?: Figures;
    expensesById?: { items: Record<string, Figures> };
    expensesByDay?: { items: Record<string, Figures> };
    expensesSummary?: Figures;
  }[];
}

const week = () => ({ dateRangeFilter: { dateMin: day(6), dateMax: day(0) } });
// proto3 JSON leaves a zero out — read it as 0.
const n = (v: number | undefined) => v ?? 0;

test.describe.configure({ mode: "serial" });

test("Setup: a selling team of its own, its shop, its paying account and its people", async ({ page }) => {
  await login(page);

  state.team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Expense Seller ${SUFFIX}`,
      teamCode: `EX${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  state.shop = (
    await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
      teamId: state.team,
      name: `E2E Expense Shop ${SUFFIX}`,
      shopCode: `EXS${SUFFIX}`,
      marketplace: "MARKETPLACE_SHOPEE",
    })
  ).shop.id;

  state.account = (
    await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E Expense BCA ${SUFFIX}`,
      holderName: "PT E2E",
      accountNumber: `88${SUFFIX}01`,
      openingBalance: 10_000_000,
      openingOn: day(5),
    })
  ).account.id;
  // An expense is paid from an operational account (an-expense-must-name-the-account-that-paid).
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.team,
    accountId: state.account,
    operational: true,
  });

  const dewi = await rpc<{ user: { id: string } }>(page, "user.v1.UserService/CreateUser", {
    teamId: state.team,
    username: DEWI,
    password: PASSWORD,
    name: DEWI_NAME,
    role: "ROLE_SELLING_ADMIN",
  });
  state.dewi = dewi.user.id;
  await rpc(page, "user.v1.UserService/CreateUser", { teamId: state.team, username: CS, password: PASSWORD, name: CS, role: "ROLE_SELLING_CS" });
});

test("Root types an ad and a payroll three days ago, Dewi corrects the ad today", async ({ page }) => {
  await login(page);

  state.ad = (
    await rpc<{ expense: { id: string } }>(page, "expense.v1.ExpenseService/ExpenseCreate", {
      teamId: state.team,
      kind: "EXPENSE_KIND_ADS",
      amount: 500_000,
      occurredAt: day(3),
      shopId: state.shop,
      note: "e2e ads",
      financeAccountId: state.account,
    })
  ).expense.id;
  await rpc(page, "expense.v1.ExpenseService/ExpenseCreate", {
    teamId: state.team,
    kind: "EXPENSE_KIND_PAYROLL",
    amount: 2_000_000,
    occurredAt: day(3),
    note: "e2e payroll",
    financeAccountId: state.account,
  });

  await login(page, DEWI, PASSWORD);
  const corrected = await rpc<{ adjustment: { occurredAt: string; createdBy: string } }>(page, "expense.v1.ExpenseService/ExpenseAdjust", {
    teamId: state.team,
    expenseId: state.ad,
    amount: -450_000,
    note: "e2e typo",
  });
  // The correction itself keeps the ad's day — the Expenses page's and the statement's.
  expect(corrected.adjustment.occurredAt).toBe(day(3));
  expect(corrected.adjustment.createdBy).toBe(state.dewi);
});

// an-expense-correction-counts-on-the-day-it-is-made: through MetricData itself — 3 days ago keeps 500.000, today reads
// −450.000; Expenses splits the kinds; Created by puts the correction under Dewi.
test("MetricData counts the correction on today, under Dewi; the ad's day keeps its 500.000", async ({ page }) => {
  await login(page);

  const days = [day(3), day(2), day(1), day(0)];
  const byDay = await rpc<MetricDataAnswer>(page, "expense.v1.ExpenseAnalyticService/MetricData", {
    teamId: state.team,
    groupBy: "GROUP_TYPE_DAILY",
    filters: [week()],
    keys: { days: { days } },
    metricIds: [ADS, EXPENSES],
  });
  const ads = byDay.metricDatas[0]!.adsByDay!.items;
  const expenses = byDay.metricDatas[1]!.expensesByDay!.items;
  expect(days.map((d) => n(ads[d]!.amount))).toEqual([500_000, 0, 0, -450_000]);
  expect([n(expenses[day(3)]!.ads), n(expenses[day(3)]!.payroll), n(expenses[day(3)]!.total)]).toEqual([500_000, 2_000_000, 2_500_000]);
  expect([n(expenses[day(0)]!.ads), n(expenses[day(0)]!.total)]).toEqual([-450_000, -450_000]);

  const byPerson = await rpc<MetricDataAnswer>(page, "expense.v1.ExpenseAnalyticService/MetricData", {
    teamId: state.team,
    groupBy: "GROUP_TYPE_USER",
    filters: [week()],
    keys: { ids: { ids: [ROOT_USER_ID, state.dewi] } },
    metricIds: [ADS],
  });
  const people = byPerson.metricDatas[0]!.adsById!.items;
  expect([n(people[ROOT_USER_ID]!.amount), n(people[state.dewi]!.amount)]).toEqual([500_000, -450_000]);

  // The headline nets it; by Seller the team is a row and the headline its own (the-expense-prototype-is-accepted).
  const head = await rpc<MetricDataAnswer>(page, "expense.v1.ExpenseAnalyticService/MetricData", {
    teamId: state.team,
    groupBy: "GROUP_TYPE_SUMMARY",
    rowsGroup: "GROUP_TYPE_TEAM",
    filters: [week()],
    metricIds: [ADS, EXPENSES],
  });
  expect(n(head.metricDatas[0]!.adsSummary!.amount)).toBe(50_000);
  expect(n(head.metricDatas[1]!.expensesSummary!.total)).toBe(2_050_000);

  const sellers = await rpc<{ keys: { ids: { ids: string[] } } }>(page, "expense.v1.ExpenseAnalyticService/MetricSearch", {
    teamId: state.team,
    groupBy: "GROUP_TYPE_TEAM",
    filters: [week()],
    sort: { metricId: EXPENSES, field: "total", sortType: "SORT_TYPE_DESC" },
    page: { offset: 0, limit: 20 },
  });
  expect(sellers.keys.ids.ids).toEqual([state.team]);

  // The Expenses page's own read keeps the correction on the ad's day: 3 days ago is 50.000 + 2.000.000, today nothing.
  const daily = await rpc<{ days: { date: string; total?: number }[] }>(page, "expense.v1.ExpenseService/ExpenseDaily", {
    teamId: state.team,
    filter: { from: day(6), to: day(0) },
  });
  expect(daily.days.map((d) => [d.date, n(d.total)])).toEqual([[day(3), 2_050_000]]);
});

// every-member-reads-every-metric-of-their-team: the team's CS reads its expense figures — payroll included — though
// ExpenseList refuses it.
test("A CS of the team reads its expense figures", async ({ page }) => {
  await login(page, CS, PASSWORD);

  const head = await rpc<MetricDataAnswer>(page, "expense.v1.ExpenseAnalyticService/MetricData", {
    teamId: state.team,
    groupBy: "GROUP_TYPE_SUMMARY",
    filters: [week()],
    metricIds: [EXPENSES],
  });
  expect([n(head.metricDatas[0]!.expensesSummary!.payroll), n(head.metricDatas[0]!.expensesSummary!.total)]).toEqual([2_000_000, 2_050_000]);
});

// The Analytic composer: Ads expense by Created by names Dewi and reads her −450.000; by day, today's row reads it and
// the ad's day keeps 500.000; the headline nets Rp 50.000.
test("The Analytic screen shows Created by with the corrector, and the correction on today", async ({ page }) => {
  await login(page);
  await useTeam(page, state.team);

  await page.goto(`/analytic?g=user&m=${ADS}&r=7d&s=${ADS}:amount:desc`);
  await expect(page.getByTestId("analytic-table")).toBeVisible();
  await expect(page.getByTestId(`analytic-row-${state.dewi}`)).toContainText(DEWI_NAME);
  await expect(page.getByTestId(`analytic-cell-${state.dewi}-amount`)).toHaveText(`−${rp(450_000)}`);
  await expect(page.getByTestId(`analytic-cell-${ROOT_USER_ID}-amount`)).toHaveText(rp(500_000));
  await expect(page.getByTestId("analytic-headline-amount-value")).toHaveText(rp(50_000));

  await page.goto(`/analytic?g=daily&m=${ADS}&r=7d`);
  await expect(page.getByTestId(`analytic-cell-${day(0)}-amount`)).toHaveText(`−${rp(450_000)}`);
  await expect(page.getByTestId(`analytic-cell-${day(3)}-amount`)).toHaveText(rp(500_000));
  await expect(page.getByTestId("analytic-headline-amount-value")).toHaveText(rp(50_000));

  // Expenses by Seller: the team is the one row, named, its total the headline's.
  await page.goto(`/analytic?g=team&m=${EXPENSES}&r=7d&s=${EXPENSES}:total:desc`);
  await expect(page.getByTestId(`analytic-row-${state.team}`)).toContainText(`E2E Expense Seller ${SUFFIX}`);
  await expect(page.getByTestId(`analytic-cell-${state.team}-total`)).toHaveText(rp(2_050_000));
  await expect(page.getByTestId("analytic-headline-total-value")).toHaveText(rp(2_050_000));
});

// a-who-filter-lists-the-people-on-its-rows: ExpensePersonList answers with the people on the team's expense rows — Dewi,
// who corrected today, then root, who typed three days ago — and nobody else (the CS typed nothing); a CS of the team may
// ask it (whoever-reads-a-list-may-filter-it).
test("ExpensePersonList names the corrector and the typist, latest first", async ({ page }) => {
  await login(page, CS, PASSWORD);

  const people = await rpc<{ ids: string[]; items: { person?: { mapData: Record<string, { lastDay: string }> } }[] }>(
    page,
    "expense.v1.ExpenseAnalyticService/ExpensePersonList",
    { teamId: state.team, filter: { metricIds: [ADS, EXPENSES] }, page: { page: 1, limit: 200 } },
  );
  expect(people.ids).toEqual([state.dewi, ROOT_USER_ID]);
  expect(people.items[0]!.person!.mapData[state.dewi]!.lastDay).toBe(day(0));
  expect(people.items[0]!.person!.mapData[ROOT_USER_ID]!.lastDay).toBe(day(3));
});

// The Analytic composer with ONLY the expense metrics on the table: Created by offers the corrector — Dewi, by name — and
// the typist, nobody else; picking Dewi narrows the table to her row and the headline to her −450.000.
test("The Created by filter offers the corrector, and picking her narrows the table", async ({ page }) => {
  await login(page);
  await useTeam(page, state.team);

  await page.goto(`/analytic?g=user&m=${ADS},${EXPENSES}&r=7d&s=${EXPENSES}:total:desc`);
  await expect(page.getByTestId(`analytic-row-${state.dewi}`)).toContainText(DEWI_NAME);
  await expect(page.getByTestId(`analytic-row-${ROOT_USER_ID}`)).toBeVisible();
  await expect(page.getByTestId("analytic-headline-total-value")).toHaveText(rp(2_050_000));

  await page.getByTestId("analytic-filter-user").getByRole("combobox").click();
  const dewi = page.getByTestId(`person-filter-option-${state.dewi}`).filter({ visible: true });
  await expect(dewi).toContainText(DEWI_NAME);
  await expect(page.getByTestId(`person-filter-option-${ROOT_USER_ID}`).filter({ visible: true })).toBeVisible();
  await expect(page.locator('[data-testid^="person-filter-option-"]:visible')).toHaveCount(2);

  await dewi.click();
  await expect(page).toHaveURL(new RegExp(`[?&]user=${state.dewi}(&|$)`));
  await expect(page.getByTestId(`analytic-row-${ROOT_USER_ID}`)).toHaveCount(0);
  await expect(page.getByTestId(/^analytic-row-/)).toHaveCount(1);
  await expect(page.getByTestId(`analytic-cell-${state.dewi}-total`)).toHaveText(`−${rp(450_000)}`);
  await expect(page.getByTestId("analytic-headline-total-value")).toHaveText(`−${rp(450_000)}`);
});

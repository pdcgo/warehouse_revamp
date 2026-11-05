import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// THE FINANCE METRICS, END TO END (docs/business/analytic/rpc_provide_decision.md — financial-accounts-serve-their-
// changes-and-their-types, the-balance-series-is-a-running-sum, finance-filters-by-account,
// every-team-reads-its-own-finance) — against the real server and Postgres.
//
// A SELLING TEAM AND A WAREHOUSE OF THEIR OWN, both owned by root, so root's own team — whose totals
// financial_accounts.spec checks — is never touched. The money is posted through the existing RPCs (an account's
// opening, a transfer, a capital out), then read back three ways: MetricSearch / MetricData directly, the Analytic
// composer, and the Financial Account Report, which reads the same two RPCs now.
//
//   3 days ago   BCA opens 1.000.000 · Kas opens 0
//   2 days ago   transfer 300.000 BCA → Kas
//   1 day ago    capital out 50.000 from Kas
//
// So BCA closes 700.000, Kas 250.000, the team 950.000. The warehouse holds Kas Gudang, 200.000.

const SUFFIX = Date.now().toString().slice(-6);
const CHANGES = "metrics/financial_accounts";
const TYPES = "metrics/financial_accounts/types";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** A Jakarta day `ago` days before today — the day a person picks. */
const day = (ago: number) =>
  new Date(Date.now() - ago * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

async function login(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(ROOT_USERNAME);
  await page.getByLabel("Password", { exact: true }).fill(ROOT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(ROOT_USERNAME);
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

const state = { seller: "", warehouse: "", bca: "", kas: "", gudang: "" };

type Figures = Record<string, number | undefined>;

interface MetricDataAnswer {
  metricDatas: { changesById?: { items: Record<string, Figures> }; changesByDay?: { items: Record<string, Figures> }; changesSummary?: Figures; typesById?: { items: Record<string, Figures> }; typesSummary?: Figures }[];
}

const window7 = () => ({ dateRangeFilter: { dateMin: day(6), dateMax: day(0) } });
// proto3 JSON leaves a zero out — read it as 0.
const n = (v: number | undefined) => v ?? 0;

test.describe.configure({ mode: "serial" });

test("Setup: a selling team and a warehouse of their own, and their money", async ({ page }) => {
  await login(page);

  const team = async (code: string, name: string, type: string) =>
    (await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: ROOT_USER_ID }))
      .team.id;
  state.seller = await team(`FS${SUFFIX}`, `E2E Finance Seller ${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.warehouse = await team(`FW${SUFFIX}`, `E2E Finance Gudang ${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

  const open = async (teamId: string, name: string, type: string, provider: string, opening: number, number = "") =>
    (
      await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId,
        type,
        provider,
        name,
        holderName: "PT E2E",
        accountNumber: number,
        openingBalance: opening,
        openingOn: day(3),
      })
    ).account.id;
  state.bca = await open(state.seller, `E2E Fin BCA ${SUFFIX}`, "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT", "FINANCIAL_ACCOUNT_PROVIDER_BCA", 1_000_000, `77${SUFFIX}01`);
  state.kas = await open(state.seller, `E2E Fin Kas ${SUFFIX}`, "FINANCIAL_ACCOUNT_TYPE_CASH", "FINANCIAL_ACCOUNT_PROVIDER_CASH", 0);
  state.gudang = await open(state.warehouse, `E2E Kas Gudang ${SUFFIX}`, "FINANCIAL_ACCOUNT_TYPE_CASH", "FINANCIAL_ACCOUNT_PROVIDER_CASH", 200_000);

  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountTransfer", {
    teamId: state.seller,
    fromAccountId: state.bca,
    toAccountId: state.kas,
    amount: 300_000,
    occurredOn: day(2),
    note: "e2e top-up",
  });
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountCapital", {
    teamId: state.seller,
    accountId: state.kas,
    direction: "CAPITAL_DIRECTION_OUT",
    amount: 50_000,
    occurredOn: day(1),
    note: "e2e owner takes cash",
  });
});

// The statement per account and per day — through the two RPCs themselves.
test("MetricSearch and MetricData read the postings back as a statement", async ({ page }) => {
  await login(page);

  const ranked = await rpc<{ keys: { ids: { ids: string[] } }; hasNext?: boolean }>(
    page,
    "financial_account.v1.FinancialAccountAnalyticService/MetricSearch",
    {
      teamId: state.seller,
      groupBy: "GROUP_TYPE_ACCOUNT",
      filters: [window7()],
      sort: { metricId: CHANGES, field: "closing_balance", sortType: "SORT_TYPE_DESC" },
      page: { offset: 0, limit: 20 },
    },
  );
  expect(ranked.keys.ids.ids).toEqual([state.bca, state.kas]);

  const byAccount = await rpc<MetricDataAnswer>(page, "financial_account.v1.FinancialAccountAnalyticService/MetricData", {
    teamId: state.seller,
    groupBy: "GROUP_TYPE_ACCOUNT",
    filters: [window7()],
    keys: { ids: { ids: [state.bca, state.kas] } },
    metricIds: [CHANGES, TYPES],
  });
  const bca = byAccount.metricDatas[0]!.changesById!.items[state.bca]!;
  const kas = byAccount.metricDatas[0]!.changesById!.items[state.kas]!;
  // Money out is negative; the opening deposit is the type `account_opening`, the position before it 0.
  expect([n(bca.openingBalance), n(bca.accountOpening), n(bca.transfer), n(bca.closingBalance)]).toEqual([0, 1_000_000, -300_000, 700_000]);
  expect([n(kas.transfer), n(kas.capital), n(kas.change), n(kas.closingBalance)]).toEqual([300_000, -50_000, 250_000, 250_000]);
  expect(n(byAccount.metricDatas[1]!.typesById!.items[state.kas]!.amount)).toBe(250_000);

  // By day, a running sum: every day opens where the one before closed.
  const days = [day(3), day(2), day(1)];
  const byDay = await rpc<MetricDataAnswer>(page, "financial_account.v1.FinancialAccountAnalyticService/MetricData", {
    teamId: state.seller,
    groupBy: "GROUP_TYPE_DAILY",
    filters: [window7()],
    keys: { days: { days } },
    metricIds: [CHANGES],
  });
  const items = byDay.metricDatas[0]!.changesByDay!.items;
  expect(days.map((d) => [n(items[d]!.openingBalance), n(items[d]!.closingBalance)])).toEqual([
    [0, 1_000_000],
    [1_000_000, 1_000_000],
    [1_000_000, 950_000],
  ]);

  // The headline: the window's edges, and the nine types add up to the net.
  const head = await rpc<MetricDataAnswer>(page, "financial_account.v1.FinancialAccountAnalyticService/MetricData", {
    teamId: state.seller,
    groupBy: "GROUP_TYPE_SUMMARY",
    filters: [window7()],
    metricIds: [CHANGES],
  });
  const total = head.metricDatas[0]!.changesSummary!;
  expect([n(total.openingBalance), n(total.change), n(total.closingBalance), n(total.capital), n(total.transfer)]).toEqual([
    0, 950_000, 950_000, -50_000, 0,
  ]);
});

// every-team-reads-its-own-finance: the warehouse reads its own Kas Gudang — and nothing of the seller's, even by naming
// the seller's account in the Account filter.
test("A warehouse reads its own accounts, and another team's reads nothing", async ({ page }) => {
  await login(page);

  const own = await rpc<MetricDataAnswer>(page, "financial_account.v1.FinancialAccountAnalyticService/MetricData", {
    teamId: state.warehouse,
    groupBy: "GROUP_TYPE_SUMMARY",
    filters: [window7()],
    metricIds: [CHANGES],
  });
  expect(n(own.metricDatas[0]!.changesSummary!.closingBalance)).toBe(200_000);

  const named = await rpc<MetricDataAnswer>(page, "financial_account.v1.FinancialAccountAnalyticService/MetricData", {
    teamId: state.warehouse,
    groupBy: "GROUP_TYPE_SUMMARY",
    filters: [window7(), { accountFilter: { accountIds: [state.bca] } }],
    metricIds: [CHANGES],
  });
  expect(n(named.metricDatas[0]!.changesSummary!.closingBalance)).toBe(0);
  expect(n(named.metricDatas[0]!.changesSummary!.change)).toBe(0);
});

// The Analytic composer: Finance › Account changes by account, the two accounts named, and the Account filter narrowing
// to one of them.
test("The Analytic screen reads Account changes by account, filtered by account", async ({ page }) => {
  await login(page);
  await useTeam(page, state.seller);

  await page.goto(`/analytic?g=account&m=${CHANGES}&r=7d&s=${CHANGES}:closing_balance:desc`);
  await expect(page.getByTestId("analytic-table")).toBeVisible();
  await expect(page.getByTestId(`analytic-row-${state.bca}`)).toContainText(`E2E Fin BCA ${SUFFIX}`);
  await expect(page.getByTestId(`analytic-cell-${state.bca}-closing_balance`)).toHaveText(rp(700_000));
  await expect(page.getByTestId(`analytic-cell-${state.kas}-capital`)).toHaveText(`−${rp(50_000)}`);
  await expect(page.getByTestId("analytic-headline-closing_balance-value")).toHaveText(rp(950_000));

  await page.goto(`/analytic?g=daily&m=${CHANGES}&r=7d&acc=${state.kas}`);
  await expect(page.getByTestId(`analytic-cell-${day(2)}-transfer`)).toHaveText(rp(300_000));
  await expect(page.getByTestId("analytic-headline-closing_balance-value")).toHaveText(rp(250_000));
  await expect(page.getByTestId("analytic-accounts-input")).toHaveAttribute("placeholder", `E2E Fin Kas ${SUFFIX}`);
});

// The Financial Account Report moved onto the same reads: its closing card is the team's 950.000.
test("The Financial Account Report reads the same figures", async ({ page }) => {
  await login(page);
  await useTeam(page, state.seller);

  await page.goto("/financial-accounts/report");
  await expect(page.getByTestId("account-report-page")).toBeVisible();
  await expect(page.getByTestId("account-report-close-value")).toHaveText(rp(950_000));
  await expect(page.getByTestId("account-report-series")).toBeVisible();
});

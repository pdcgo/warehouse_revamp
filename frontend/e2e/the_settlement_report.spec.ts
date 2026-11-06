import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// THE SETTLEMENT REPORT, END TO END — named to sort AFTER orders.spec.ts and statement.spec.ts (Playwright puts
// `statement_x` before `statement.spec`), as a spec posting money must; it runs on one shared database.
//
// The report (docs/business/settlement/analytic_context.md · settlement-serves-its-headline-and-its-
// breakdown · the-report-headline-is-position-to-date) — entries posted through the real SettlementPost, folded by the
// real fold off the broker's push, read back on /settlement/report.
//
// A SELLING TEAM OF ITS OWN with two shops of its own, so root's team — whose totals financial_accounts.spec checks — is
// never touched. No withdrawal (it would move a financial account) and no real order: each row names an order id far
// past any e2e order, so the orders screen orders.spec counts never sees them.
//
//   Shop A   order A sold 200.000 · 150.000 arrived                      gap 50.000
//   Shop B   order B sold 100.000 · 100.000 arrived · a 10.000 ads fee   gap 10.000
//
// So the team sold 300.000, received 240.000, and 60.000 never reached it — the position to date. Every row is posted
// TODAY, and `posted_on` is the database session's day — the Jakarta day (the-system-runs-on-jakarta-time).

const SUFFIX = Date.now().toString().slice(-6);

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Today in Jakarta — the day the fold buckets every row of this spec on. */
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

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

const state = { team: "", shopA: "", shopB: "" };

// Far past any order an e2e places, and apart per run.
const ORDER_A = `9${SUFFIX}01`;
const ORDER_B = `9${SUFFIX}02`;

test.describe.configure({ mode: "serial" });

test("Setup: a selling team with two shops, and their settlement entries", async ({ page }) => {
  await login(page);

  state.team = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Settlement Seller ${SUFFIX}`,
      teamCode: `SR${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  const shop = async (code: string, name: string) =>
    (
      await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
        teamId: state.team,
        name,
        shopCode: code,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id;
  state.shopA = await shop(`SRA${SUFFIX}`, `E2E Report Shop A ${SUFFIX}`);
  state.shopB = await shop(`SRB${SUFFIX}`, `E2E Report Shop B ${SUFFIX}`);

  // Positive is money toward us: a sale is posted NEGATIVE (the platform owes it), a fund positive, a fee negative.
  const post = async (shopId: string, orderId: string, key: string, type: string, change: number) =>
    rpc(page, "settlement.v1.SettlementWriteService/SettlementPost", {
      teamId: state.team,
      shopId,
      orderId,
      uniqueId: `e2e-report-${SUFFIX}-${key}`,
      settlementType: type,
      sourceType: "SOURCE_TYPE_MANUAL",
      change,
      occurredOn: today(),
      // The person ranking counts an order's rows for its creator (the-creator-is-stamped-on-the-state-row).
      createdByUserId: ROOT_USER_ID,
    });

  await post(state.shopA, ORDER_A, "a-sale", "SETTLEMENT_TYPE_INITIAL_TOTAL", -200_000);
  await post(state.shopA, ORDER_A, "a-fund", "SETTLEMENT_TYPE_FUND", 150_000);
  await post(state.shopB, ORDER_B, "b-sale", "SETTLEMENT_TYPE_INITIAL_TOTAL", -100_000);
  await post(state.shopB, ORDER_B, "b-fund", "SETTLEMENT_TYPE_FUND", 100_000);
  await post(state.shopB, ORDER_B, "b-ads", "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE", -10_000);
});

// The headline, today's row of the series, and the shops ranked by what they carry — once the fold has run (it is fed
// by the broker's push, so the page is polled until the figures land).
test("The report shows today's figures and ranks the shops by their position", async ({ page }) => {
  await login(page);
  await useTeam(page, state.team);

  await expect(async () => {
    await page.goto("/settlement/report?grain=day");
    await expect(page.getByTestId("report-sales-value")).toHaveText(rp(300_000), { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });

  await expect(page.getByTestId("report-received-value")).toHaveText(rp(240_000));
  await expect(page.getByTestId("report-gap-value")).toHaveText(rp(60_000));
  await expect(page.getByTestId("report-position-value")).toHaveText(rp(60_000));

  // Every row is on TODAY's Jakarta day — the session's CURRENT_DATE.
  const day = page.getByTestId(`report-series-row-${today()}`);
  await expect(day).toContainText(today());
  await expect(day).toContainText(rp(300_000));
  await expect(day).toContainText(rp(240_000));

  // By shop, the largest shortfall first: A carries 50.000, B 10.000.
  const rows = page.getByTestId("report-groups-table").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-testid", `report-group-row-${state.shopA}`);
  await expect(rows.nth(0)).toContainText(`E2E Report Shop A ${SUFFIX}`);
  await expect(rows.nth(0)).toContainText(rp(50_000));
  await expect(rows.nth(1)).toHaveAttribute("data-testid", `report-group-row-${state.shopB}`);
  await expect(rows.nth(1)).toContainText(rp(90_000));
  await expect(rows.nth(1)).toContainText(rp(10_000));
});

// A GROUPING CHANGE, both ways the screen offers: the series by month (one row, the month today opens), and the ranking
// by person — every row counts for the order's creator, root.
test("Grouped by month and by person, the same figures regroup", async ({ page }) => {
  await login(page);
  await useTeam(page, state.team);

  await page.goto("/settlement/report?grain=day");
  await expect(page.getByTestId("report-sales-value")).toHaveText(rp(300_000));

  await page.goto("/settlement/report?grain=month");
  const month = `${today().slice(0, 7)}-01`;
  const monthRow = page.getByTestId(`report-series-row-${month}`);
  await expect(monthRow).toContainText(today().slice(0, 7));
  await expect(monthRow).toContainText(rp(300_000));
  await expect(monthRow).toContainText(rp(60_000));

  await page.getByTestId("report-group-user").click();
  await expect(page).toHaveURL(/group=user/);
  const person = page.getByTestId(`report-group-row-${ROOT_USER_ID}`);
  await expect(person).toBeVisible();
  await expect(person).toContainText(rp(300_000));
  await expect(person).toContainText(rp(60_000));
  await expect(page.getByTestId("report-groups-table").locator("tbody tr")).toHaveCount(1);
});

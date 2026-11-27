import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { addMetric, asRoot, rupiah, signInAs, today } from "./metric_ground";

// ── add analytic metric, the expense kinds and the warehouse fee — the checks behind docs/acceptances/analytic/expense_metric.md givens 1–5 ──
//
// add analytic metric's checks for the three EXPENSE metrics on Analytic › Expense — *Expenses* (metrics/expenses: one
// column per typed kind and their total, never the stock loss), *Ads expense* (metrics/ads, readable per shop) and
// *Warehouse fee* (metrics/warehouse_fee, the fee frozen on each order less the cancelled ones, read by the warehouse
// too). Givens 6–22, one per expense type, are expense_metric_shows_each_type.spec.ts. An acceptance has no test file of
// its own (docs/acceptances/guide.md): one test.describe per given + when (named as the given, its case in parentheses
// VERBATIM), per role a test — selling:all = owner, admin, cs; warehouse:all = owner, admin, staff — and one
// test.step("then: …") per then, stored verbatim (acceptance_mark.py matches the literal text). A step that is no then
// is named `regression: …`.
//
// Business rules (docs/business/analytic/rpc_provide_decision.md):
// - expense-has-ads-and-expenses — Ads expense (`amount`, *Ads spend*) and Expenses (`ads` · `payroll` · `operational` ·
//   `other`, each group's spending, and `total`, *Total expenses*), under Expense beside Warehouse fee.
// - expense-figures-are-read-from-its-own-records — written in the expense's own transaction: no fold to wait for.
// - an-expense-correction-counts-on-the-day-it-is-made — 31 Oct keeps its figure, the correction reads on 5 Nov.
// - stock-loss-stays-out-of-analytic-expenses — Expenses carries only the kinds a person types; a STOCK_LOSS row (what
//   a warehouse writes off — `expensePoster`, posted to the WAREHOUSE's expenses) is in no column and not in the total.
// - a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day, a-warehouse-sees-its-own-fee-amount —
//   placed +1 / + the fee, cancelled −1 / − the fee, both today here; a warehouse reads the count AND the amount.
// - every-member-reads-every-metric-of-their-team — a CS reads its team's figures (it may not record an expense).
//
// GROUND (beforeAll, as root, through the API from the test runner): per given a selling team of its own with a user per
// selling role and one operational account (opened 6 days ago) — so each team's figures are exactly that given's:
//   1  today: Ads (marketplace ads on the team's shop) Rp 2.000.000 · Payroll (basic salary) Rp 5.000.000 · Operational
//      (electricity) Rp 1.000.000 · Other (other money out) Rp 500.000
//   2  two shops P and Q: today, marketplace ads of Rp 300.000 on P and Rp 200.000 on Q
//   3  5 days ago (the given's 31 Oct) an electricity expense of Rp 1.000.000; today (its 5 Nov) reduced by Rp 250.000
//      (ExpenseAdjust). A day cannot be back-dated, so the given's dates are the run's: 5 days apart, both in the window.
//   4  a warehouse W4 holding 5 of the team's units (Rp 10.000 each); today W4 writes 2 of them off as lost (StockAdjust
//      LOST — Rp 20.000 written off, posted as W4's STOCK_LOSS expense), and the team records an operational expense of
//      Rp 100.000 — so its total reads a figure, and the figure is the typed one alone
//   5  a warehouse W5 (fee 25%) with a user per warehouse role, holding the team's product at Rp 64.000 a unit: today two
//      orders of one unit (fee Rp 16.000 each) placed at W5, and one of them cancelled. beforeAll waits until the order
//      folds show 2 created and 1 cancelled, so the fee figure read is the settled one, never the 1 of a first placement.
// Nothing is written after the seed: every role only reads, so the roles share each given's ground.
//
// THE WHEN, as the person does it: Analytic over the last 7 days, grouped as the given says (daily, or by shop for
// given 2), then Add Metric › Expense › the given's metric, Done. The thens read today's row (and the 5-days-ago row).

const DIGITS = Date.now().toString().slice(-6);
// This spec's own letter: usernames, names and account numbers carry it, so no other spec collides.
const SUFFIX = `${DIGITS}k`;
const PASSWORD = "e2e-expense-kinds-pass-1";
const ADS = "metrics/ads";
const EXPENSES = "metrics/expenses";
const FEE = "metrics/warehouse_fee";

const SELLING = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "scs" },
] as const;
const WAREHOUSE = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "wstf" },
] as const;

// The givens' cases, VERBATIM (· is U+00B7), and their thens.
const G1 = {
  case: "group: daily · add type: expenses · ads Rp 2.000.000 · payroll Rp 5.000.000 · operational Rp 1.000.000 · other Rp 500.000 today",
  thenColumns: "then: each kind in its own column",
  thenTotal: "then: total Rp 8.500.000",
};
const G2 = { case: "group: shop · add type: ads expense · ads for 2 shops", then: "then: each shop's ads expense shown" };
const G3 = {
  case: "group: daily · add type: expenses · expense of 31 Oct reduced on 5 Nov",
  then: "then: correction counted on 5 Nov, not 31 Oct",
};
const G4 = { case: "group: daily · add type: expenses · stock written off today", then: "then: stock loss not counted" };
const G5 = {
  case: "group: daily · add type: warehouse fee · 2 orders with a fee today · 1 cancelled",
  then: "then: 1 fee transaction with its amount",
};

// Given 1's four typed kinds: the group's field, its column's words, the type recorded and the amount.
const KINDS = [
  { field: "ads", label: "Ads", type: "EXPENSE_TYPE_ADS_MARKETPLACE", amount: 2_000_000 },
  { field: "payroll", label: "Payroll", type: "EXPENSE_TYPE_BASIC_SALARY", amount: 5_000_000 },
  { field: "operational", label: "Operational", type: "EXPENSE_TYPE_ELECTRICITY", amount: 1_000_000 },
  { field: "other", label: "Other", type: "EXPENSE_TYPE_OTHER_OUT", amount: 500_000 },
] as const;
const G1_TOTAL = 8_500_000;
const ADS_P = 300_000;
const ADS_Q = 200_000;
const G3_AMOUNT = 1_000_000;
const G3_CUT = -250_000;
const G3_AGO = 5;
const G4_TYPED = 100_000;
const G4_UNIT = 10_000;
const G4_STOCK = 5;
const G4_LOST = 2;
const STOCK_LOSS_KIND = "5"; // EXPENSE_KIND_STOCK_LOSS
const G5_UNIT = 64_000;
const G5_FEE_PERCENT = 25;
const G5_FEE = 16_000; // 25% of the goods' Rp 64.000

/** A Jakarta day `ago` days before today. */
const day = (ago: number) =>
  new Date(Date.now() - ago * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
// A figure as Analytic writes it: a negative carries the typographic minus before Rp.
const money = (n: number) => (n < 0 ? `−${rupiah(-n)}` : rupiah(n));
// proto3 JSON leaves a zero out — read it as 0; an int64 arrives as a string.
const num = (v: unknown) => Number(v ?? 0);

const username = (g: number, key: string) => `e2exk${g}${key}${SUFFIX}`;

interface Team {
  id: string;
  account: string;
  cs: string; // the team's CS, put on every shop of the team
}

const ground = {
  teams: {} as Record<number, Team>,
  shops: {} as Record<string, string>, // "1" (given 1's), "P", "Q", "5"
  w4: "",
  w5: "",
};

async function team(name: string, teamCode: string, type: string): Promise<string> {
  return String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
}

// A given's selling team: a user per selling role, one operational account opened 6 days ago.
async function sellingTeam(g: number): Promise<Team> {
  const id = await team(`E2E Expense Kinds ${g} ${SUFFIX}`, `XK${g}S${DIGITS}`, "TEAM_TYPE_SELLING");
  let cs = "";
  for (const r of SELLING) {
    const made = await asRoot("user.v1.UserService/CreateUser", {
      teamId: id,
      username: username(g, r.key),
      password: PASSWORD,
      name: `Expense Kinds ${g} ${r.key} ${SUFFIX}`,
      role: r.role,
    });
    if (r.key === "scs") cs = String(made.user.id);
  }
  const account = String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: id,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E XK ${g} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-XK-${g}-${SUFFIX}`,
        openingBalance: 50_000_000,
        openingOn: day(6),
      })
    ).account.id,
  );
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: id,
    accountId: account,
    operational: true,
  });

  return { id, account, cs };
}

// A Shopee shop of the team's, root first (the first grant is the shop's primary CS), then the team's CS on it.
async function shop(t: Team, code: string): Promise<string> {
  const id = String(
    (
      await asRoot("selling.v1.ShopService/ShopCreate", {
        teamId: t.id,
        name: `E2E Expense Kinds Shop ${code} ${SUFFIX}`,
        shopCode: `XK${code}${DIGITS}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: t.id, shopId: id, userId: ROOT_USER_ID });
  await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: t.id, shopId: id, userId: t.cs });

  return id;
}

async function expense(t: Team, kind: string, type: string, amount: number, occurredAt: string, shopId?: string) {
  return String(
    (
      await asRoot("expense.v1.ExpenseService/ExpenseCreate", {
        teamId: t.id,
        kind: `EXPENSE_KIND_${kind.toUpperCase()}`,
        type,
        amount,
        occurredAt,
        ...(shopId ? { shopId } : {}),
        note: `E2E expense kinds ${SUFFIX}`,
        financeAccountId: t.account,
      })
    ).expense.id,
  );
}

// A product of the team's with `count` units on a fresh rack in `warehouseId`, accepted today at `unit` a unit.
async function stocked(t: Team, warehouseId: string, code: string, count: number, unit: number) {
  const category = (await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Expense Kinds ${code} ${SUFFIX}` })).category.id;
  const name = `Sabun Biaya ${code} ${SUFFIX}`;
  const made = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: t.id,
      productCodePart: `XK${code}${DIGITS}`,
      name,
      categoryId: category,
    })
  ).product;
  const product = { id: String(made.id), code: String(made.productCode), name };
  const rack = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: warehouseId, code: `xk${code}-${DIGITS}` })).rack.id);
  const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: t.id,
    warehouseId,
    financeAccountId: t.account,
    items: [{ productId: product.id, productCode: product.code, name, count, total: count * unit }],
  });
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: warehouseId,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: count, placements: [{ placementId: rack, quantity: count }] }],
  });

  return { product, rack };
}

// The order folds for given 5's team, today: created, cancelled and the fee's transactions (as root).
async function g5Folds() {
  const d = today();
  const res = await asRoot("selling.v1.OrderAnalyticService/MetricData", {
    teamId: ground.teams[5]!.id,
    groupBy: "GROUP_TYPE_DAILY",
    filters: [{ dateRangeFilter: { dateMin: d, dateMax: d } }],
    keys: { days: { days: [d] } },
    metricIds: ["metrics/orders/created", "metrics/orders/cancelled", FEE],
  });
  const m = res.metricDatas ?? [];

  return [
    num(m[0]?.createdByDay?.items?.[d]?.createdCount),
    num(m[1]?.cancelByDay?.items?.[d]?.cancelCount),
    num(m[2]?.warehouseFeeByDay?.items?.[d]?.transactionCount),
  ];
}

async function seed() {
  // GIVEN 1 — four typed kinds today.
  const t1 = (ground.teams[1] = await sellingTeam(1));
  ground.shops["1"] = await shop(t1, "1A");
  for (const k of KINDS) {
    await expense(t1, k.field, k.type, k.amount, today(), k.field === "ads" ? ground.shops["1"] : undefined);
  }

  // GIVEN 2 — marketplace ads on two shops today.
  const t2 = (ground.teams[2] = await sellingTeam(2));
  ground.shops.P = await shop(t2, "2P");
  ground.shops.Q = await shop(t2, "2Q");
  await expense(t2, "ads", "EXPENSE_TYPE_ADS_MARKETPLACE", ADS_P, today(), ground.shops.P);
  await expense(t2, "ads", "EXPENSE_TYPE_ADS_MARKETPLACE", ADS_Q, today(), ground.shops.Q);

  // GIVEN 3 — an expense 5 days ago, reduced today.
  const t3 = (ground.teams[3] = await sellingTeam(3));
  const e3 = await expense(t3, "operational", "EXPENSE_TYPE_ELECTRICITY", G3_AMOUNT, day(G3_AGO));
  await asRoot("expense.v1.ExpenseService/ExpenseAdjust", { teamId: t3.id, expenseId: e3, amount: G3_CUT, note: `E2E reduced ${SUFFIX}` });

  // GIVEN 4 — the team's goods written off at W4 today, and one typed expense.
  const t4 = (ground.teams[4] = await sellingTeam(4));
  ground.w4 = await team(`E2E Expense Kinds W4 ${SUFFIX}`, `XK4W${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  const s4 = await stocked(t4, ground.w4, "4K", G4_STOCK, G4_UNIT);
  const batches = await asRoot<{ ids?: string[] }>("inventory.v1.InventoryService/BatchList", {
    teamId: ground.w4,
    filter: { productId: s4.product.id },
    page: { page: 1, limit: 20 },
  });
  expect(batches.ids ?? [], "given 4's batches").toHaveLength(1);
  await asRoot("inventory.v1.InventoryService/StockAdjust", {
    warehouseId: ground.w4,
    productId: s4.product.id,
    reasonType: "STOCK_ADJUST_REASON_LOST",
    batchId: String(batches.ids![0]),
    quantity: G4_LOST,
    rackId: s4.rack,
    reason: `hilang dari rak ${SUFFIX}`,
  });
  await expense(t4, "operational", "EXPENSE_TYPE_ELECTRICITY", G4_TYPED, today());

  // GIVEN 5 — two orders with a fee at W5 today, one cancelled.
  const t5 = (ground.teams[5] = await sellingTeam(5));
  ground.w5 = await team(`E2E Expense Kinds W5 ${SUFFIX}`, `XK5W${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  await asRoot("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: t5.id, warehouseId: ground.w5 });
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.w5, feePercent: G5_FEE_PERCENT, minFee: 0 });
  for (const r of WAREHOUSE) {
    await asRoot("user.v1.UserService/CreateUser", {
      teamId: ground.w5,
      username: username(5, r.key),
      password: PASSWORD,
      name: `Expense Kinds 5 ${r.key} ${SUFFIX}`,
      role: r.role,
    });
  }
  const s5 = await stocked(t5, ground.w5, "5K", 2, G5_UNIT);
  ground.shops["5"] = await shop(t5, "5F");
  const orders: string[] = [];
  for (const n of [1, 2]) {
    const ref = `XK${DIGITS}O${n}`;
    const placed = await asRoot("selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-expense-kinds-${n}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: t5.id,
      shopId: ground.shops["5"],
      warehouseId: ground.w5,
      customerName: `E2E Kinds Buyer ${n} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: ref,
      receiptCode: `J${ref}`,
      items: [{ productId: s5.product.id, productCode: s5.product.code, name: s5.product.name, quantity: 1 }],
    });
    orders.push(String(placed.order.id));
  }
  await asRoot("selling.v1.OrderService/OrderCancel", { teamId: t5.id, orderId: orders[1] });
  // The folds are asynchronous (the order events' listeners): wait for both placements and the cancel.
  await expect.poll(g5Folds, { timeout: 60_000, message: "given 5's folds: created, cancelled, fee transactions" }).toEqual([2, 1, 1]);
}

/** The column headings of the Analytic table, whitespace folded. */
async function headings(page: Page): Promise<string[]> {
  return (await page.getByTestId("analytic-table").locator("thead th").allTextContents()).map((h) => h.replace(/\s+/g, " ").trim());
}

/** Signed in as the role on its team's Analytic, grouped and ranged by `query`, then THE WHEN: Add Metric › Expense › `metric`. */
async function when(page: Page, g: number, key: string, teamId: string, query: string, metric: string) {
  await signInAs(page, username(g, key), PASSWORD, teamId);
  await page.goto(`/analytic?${query}`);
  await expect(page.getByTestId("current-user")).toHaveText(username(g, key));
  await addMetric(page, "expense", metric);
}

test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await seed();
});

test.describe(`selling:all wants to see statistics (${G1.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const d = today();
      await when(page, 1, r.key, ground.teams[1]!.id, "g=daily&r=7d", EXPENSES);

      await test.step(G1.thenColumns, async () => {
        // Each typed kind is its own column, headed by its words, and today's cell reads that kind's amount alone.
        for (const k of KINDS) {
          await expect.soft(page.getByTestId(`analytic-sort-${k.field}`)).toHaveText(k.label);
          await expect.soft(page.getByTestId(`analytic-cell-${d}-${k.field}`)).toHaveText(money(k.amount));
        }
      });

      await test.step(G1.thenTotal, async () => {
        await expect.soft(page.getByTestId(`analytic-cell-${d}-total`)).toHaveText(money(G1_TOTAL));
        await expect.soft(page.getByTestId("analytic-sort-total")).toHaveText("Total expenses");
        // Nothing else in the window: the headline is today's total.
        await expect.soft(page.getByTestId("analytic-headline-total-value")).toHaveText(money(G1_TOTAL));
      });
    });
  }
});

test.describe(`selling:all wants to see statistics (${G2.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      await when(page, 2, r.key, ground.teams[2]!.id, "g=shop&r=7d", ADS);

      await test.step(G2.then, async () => {
        // Grouped by shop: exactly the team's two shops, each named and carrying its own ads spend.
        for (const [code, shopId, amount] of [
          ["2P", ground.shops.P!, ADS_P],
          ["2Q", ground.shops.Q!, ADS_Q],
        ] as const) {
          await expect.soft(page.getByTestId(`analytic-row-${shopId}`)).toContainText(`E2E Expense Kinds Shop ${code} ${SUFFIX}`);
          await expect.soft(page.getByTestId(`analytic-cell-${shopId}-amount`)).toHaveText(money(amount));
        }
        await expect.soft(page.getByTestId(/^analytic-row-/)).toHaveCount(2);
        await expect.soft(page.getByTestId("analytic-sort-amount")).toHaveText("Ads spend");
        await expect.soft(page.getByTestId("analytic-headline-amount-value")).toHaveText(money(ADS_P + ADS_Q));
      });
    });
  }
});

test.describe(`selling:all wants to see statistics (${G3.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const made = day(0); // the correction's day — the given's 5 Nov
      const spent = day(G3_AGO); // the expense's own day — the given's 31 Oct
      await when(page, 3, r.key, ground.teams[3]!.id, "g=daily&r=7d", EXPENSES);

      await test.step(G3.then, async () => {
        // The correction reads on the day it was made — its type, its group and the total.
        for (const f of ["electricity", "operational", "total"]) {
          await expect.soft(page.getByTestId(`analytic-cell-${made}-${f}`)).toHaveText(money(G3_CUT));
        }
        // The expense's own day keeps its whole figure: the correction never re-folds it.
        for (const f of ["electricity", "operational", "total"]) {
          await expect.soft(page.getByTestId(`analytic-cell-${spent}-${f}`)).toHaveText(money(G3_AMOUNT));
        }
        // The window nets them.
        await expect.soft(page.getByTestId("analytic-headline-total-value")).toHaveText(money(G3_AMOUNT + G3_CUT));
      });
    });
  }
});

test.describe(`selling:all wants to see statistics (${G4.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const d = today();
      await when(page, 4, r.key, ground.teams[4]!.id, "g=daily&r=7d", EXPENSES);

      await test.step(G4.then, async () => {
        // Today's total is the typed expense alone — not the Rp 20.000 written off beside it.
        await expect.soft(page.getByTestId(`analytic-cell-${d}-total`)).toHaveText(money(G4_TYPED));
        await expect.soft(page.getByTestId(`analytic-cell-${d}-operational`)).toHaveText(money(G4_TYPED));
        // No stock-loss column, sort or headline.
        await expect.soft(page.getByTestId(`analytic-cell-${d}-stock_loss`)).toHaveCount(0);
        await expect.soft(page.getByTestId("analytic-sort-stock_loss")).toHaveCount(0);
        await expect.soft(page.getByTestId("analytic-headline-stock_loss")).toHaveCount(0);
        expect.soft((await headings(page)).join(" | ")).not.toMatch(/stock loss/i);
      });

      await test.step("regression: the write-off is a real STOCK_LOSS expense of W4's, and W4's Expenses do not count it", async () => {
        const listed = await asRoot("expense.v1.ExpenseService/ExpenseList", {
          teamId: ground.w4,
          filter: { from: d, to: d },
          page: { page: 1, limit: 20 },
        });
        expect.soft(num(listed.totals?.byKind?.[STOCK_LOSS_KIND])).toBe(G4_LOST * G4_UNIT);
        const read = await asRoot("expense.v1.ExpenseAnalyticService/MetricData", {
          teamId: ground.w4,
          groupBy: "GROUP_TYPE_DAILY",
          filters: [{ dateRangeFilter: { dateMin: d, dateMax: d } }],
          keys: { days: { days: [d] } },
          metricIds: [EXPENSES],
        });
        expect.soft(num(read.metricDatas?.[0]?.expensesByDay?.items?.[d]?.total)).toBe(0);
      });
    });
  }
});

test.describe(`selling:all · warehouse:all wants to see statistics (${G5.case})`, () => {
  for (const r of [...SELLING, ...WAREHOUSE]) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const d = today();
      const teamId = r.key.startsWith("w") ? ground.w5 : ground.teams[5]!.id;
      await when(page, 5, r.key, teamId, "g=daily&r=7d", FEE);

      await test.step(G5.then, async () => {
        // Two placed, one cancelled on the same day: one fee transaction, its Rp 16.000 — for the seller who paid it and
        // for the warehouse it is income to.
        await expect.soft(page.getByTestId(`analytic-cell-${d}-transaction_count`)).toHaveText("1");
        await expect.soft(page.getByTestId(`analytic-cell-${d}-amount`)).toHaveText(money(G5_FEE));
        await expect.soft(page.getByTestId("analytic-sort-transaction_count")).toHaveText("Fee transactions");
        await expect.soft(page.getByTestId("analytic-sort-amount")).toHaveText("Fee amount");
        await expect.soft(page.getByTestId("analytic-headline-amount-value")).toHaveText(money(G5_FEE));
      });
    });
  }
});

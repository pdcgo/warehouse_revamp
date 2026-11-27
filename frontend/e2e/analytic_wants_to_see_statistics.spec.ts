import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { UI_URL } from "./env";
import { addMetric, asRoot, rupiah, signInAs, slugOf, today } from "./metric_ground";

// ── the Analitik screen itself — the checks behind docs/acceptances/analytic/report.md givens 1–9 ──────────────────────
//
// The report's own actions on /analytic: open analytic, add analytic metric, change analytic group, sort analytic
// report, view analytic as graph, open analytic link, change analytic period. An acceptance has no test file of its own
// (docs/acceptances/guide.md): one test.describe per given + when (named as the given, its case in parentheses
// VERBATIM), per role a test — selling:all = owner, admin, cs; warehouse:all = owner, admin, staff — and one
// test.step("then: …") per then, stored verbatim (acceptance_mark.py matches the literal text). A step that is no then
// is named `regression: …`.
//
// Business rules (docs/business/analytic/rpc_provide.md, rpc_provide_decision.md):
// - the-report-lives-in-the-url — the group, the metrics, the filters, the sort, the page and the view (`v=graph`) are
//   the address, so a link opened in another tab is the same report (compare-in-another-tab-for-now); a link carries
//   the report, never access.
// - a-new-metric-removes-the-filters-it-cannot-use + a-removed-filter-is-announced — Expenses names no shop, so adding
//   it removes a shop filter, every column reloads without it, and an info toast says which filter and why.
// - a-group-change-drops-the-columns-that-cannot-follow — Expenses cannot be grouped by shop: switching to Shop removes
//   it, with an info toast.
// - a-table-sorts-from-its-headings / one-sort-field-per-table — a heading sorts largest first, then flips.
// - the-table-and-the-graph-are-tabs + the-graph-draws-the-table — the Graph tab draws the table's own rows, one graph
//   per kind of number, a time group oldest first (a-time-graph-runs-oldest-first).
// - a-metric-reads-at-most-a-year — a range over 366 days is not read; the line under the picker says why.
// - a-money-metric-says-as-of-when — the figures say as of when.
// - a-warehouse-sees-no-seller-money — Restock's values come back unset for a warehouse, and their columns go.
// - the-rows-are-the-keys-step-one-sends — a time group sorted by its period is the window's every day (the spine).
//
// GROUND (beforeAll, as root, through the API from the test runner): one selling team S with a user per selling role
// and THREE shops — A, B, C — every selling user on each; one warehouse W with a user per warehouse role and a rack,
// stocked by S's restock of 10 units (Rp 100.000, created and accepted today). Today S places ONE order on A
// (platform total Rp 900.000), THREE on B (Rp 100.000 each) and TWO on C (Rp 200.000 each) — so by orders created the
// shops rank B, C, A while by MP total they rank A, C, B. Ads expense: A Rp 100.000 today and Rp 70.000 two days ago,
// B Rp 50.000 today. Nothing is written after the seed: every given only reads, so the roles share the ground.

const DIGITS = Date.now().toString().slice(-6);
const SUFFIX = `${DIGITS}a`;
const PASSWORD = "e2e-analytic-report-pass-1";
const PRODUCT = `Sabun Analitik ${SUFFIX}`;
const STOCK = 10;
const RESTOCK_TOTAL = 100_000;

const ORDERS = "metrics/orders/created";
const ADS = "metrics/ads";
const EXPENSES = "metrics/expenses";
const RESTOCK = "metrics/inventory/restock";

const SELLING = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "scs", side: "selling" },
] as const;
const WAREHOUSE = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "wstf", side: "warehouse" },
] as const;
type Role = (typeof SELLING)[number] | (typeof WAREHOUSE)[number];

// The shops: their orders today (count, platform total each) and their ads expense (today, two days ago).
const SHOPS = {
  A: { orders: 1, platformTotal: 900_000, adsToday: 100_000, adsBefore: 70_000 },
  B: { orders: 3, platformTotal: 100_000, adsToday: 50_000, adsBefore: 0 },
  C: { orders: 2, platformTotal: 200_000, adsToday: 0, adsBefore: 0 },
} as const;
type ShopKey = keyof typeof SHOPS;
const ORDERS_TODAY = 6;
const ADS_TODAY = 150_000;

const username = (key: string) => `e2eua${key}${SUFFIX}`;

const ground = {
  team: "",
  warehouse: "",
  shops: {} as Record<ShopKey, { id: string; name: string }>,
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The window's days, newest first — the spine a time group sorted by its period draws. */
const lastDays = (n: number) => Array.from({ length: n }, (_, i) => addDays(today(), -i));

async function seed() {
  const team = async (name: string, teamCode: string, type: string) =>
    String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Analytic Report Seller ${SUFFIX}`, `UAS${DIGITS}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Analytic Report WH ${SUFFIX}`, `UAW${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  await asRoot("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  const users: Record<string, string> = {};
  for (const r of [...SELLING, ...WAREHOUSE]) {
    const made = await asRoot("user.v1.UserService/CreateUser", {
      teamId: r.side === "selling" ? ground.team : ground.warehouse,
      username: username(r.key),
      password: PASSWORD,
      name: `Analytic Report ${r.key} ${SUFFIX}`,
      role: r.role,
    });
    users[r.key] = String(made.user.id);
  }

  // The product's units on W's rack, paid from S's operational account — Restock's row for given 9.
  const rack = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `ua-${DIGITS}` })).rack.id);
  const category = (await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Analytic Report ${SUFFIX}` })).category.id;
  const product = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: `UAK${DIGITS}`,
      name: PRODUCT,
      categoryId: category,
    })
  ).product;
  const account = (
    await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E analytic report ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-UA-${SUFFIX}`,
      openingBalance: 10_000_000,
      openingOn: addDays(today(), -7),
    })
  ).account.id;
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.team,
    accountId: account,
    operational: true,
  });
  const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count: STOCK, total: RESTOCK_TOTAL }],
  });
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: STOCK, placements: [{ placementId: rack, quantity: STOCK }] }],
  });

  for (const k of Object.keys(SHOPS) as ShopKey[]) {
    const s = SHOPS[k];
    const name = `E2E Analytic Shop ${k} ${SUFFIX}`;
    const shop = String(
      (
        await asRoot("selling.v1.ShopService/ShopCreate", {
          teamId: ground.team,
          name,
          shopCode: `UA${k}${DIGITS}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    // Root first — the first grant is the shop's primary CS; then every selling user, so each reads it as a filter.
    await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: ROOT_USER_ID });
    for (const r of SELLING) {
      await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: users[r.key] });
    }
    ground.shops[k] = { id: shop, name };

    for (let i = 1; i <= s.orders; i++) {
      const ref = `UA${DIGITS}${k}${i}`;
      await asRoot("selling.v1.OrderService/OrderCreate", {
        idempotencyKey: `e2e-analytic-report-${k}-${i}-${SUFFIX}`,
        shipmentChannelId: "1",
        teamId: ground.team,
        shopId: shop,
        warehouseId: ground.warehouse,
        customerName: `E2E Analytic Buyer ${k}${i} ${SUFFIX}`,
        platformTotal: s.platformTotal,
        platformCreatedAtUnix: Math.floor(Date.now() / 1000),
        orderExternalRefId: ref,
        receiptCode: `J${ref}`,
        items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
      });
    }

    const ads = async (amount: number, occurredAt: string) =>
      asRoot("expense.v1.ExpenseService/ExpenseCreate", {
        teamId: ground.team,
        kind: "EXPENSE_KIND_ADS",
        type: "EXPENSE_TYPE_ADS_MARKETPLACE",
        amount,
        occurredAt,
        shopId: shop,
        note: `E2E analytic report ads ${k} ${SUFFIX}`,
        financeAccountId: account,
      });
    if (s.adsToday > 0) await ads(s.adsToday, today());
    if (s.adsBefore > 0) await ads(s.adsBefore, addDays(today(), -2));
  }
}

const sign = (page: Page, r: Role) =>
  signInAs(page, username(r.key), PASSWORD, r.side === "selling" ? ground.team : ground.warehouse);

/** Signed in as the role, on the report's address, re-read until `testId` reads `want` (the folds are asynchronous). */
async function open(page: Page, r: Role, address: string, testId: string, want: string | RegExp) {
  await sign(page, r);
  await expect(async () => {
    await page.goto(address);
    await expect(page.getByTestId("current-user")).toHaveText(username(r.key), { timeout: 5_000 });
    await expect(page.getByTestId(testId)).toHaveText(want, { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

/** The table's rows, top to bottom, by their keys. */
async function rowKeys(page: Page): Promise<string[]> {
  return (await page.locator('[data-testid^="analytic-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""))).map(
    (id) => id.replace(/^analytic-row-/, ""),
  );
}

const toast = (page: Page, text: string) => page.locator('[data-scope="toast"][data-part="root"]').filter({ hasText: text });

// Picks a range on the report's calendar: `to`, then `from` (paging back or forth until the day is drawn), Apply.
async function pickRange(page: Page, from: string, to: string) {
  await page.getByTestId("analytic-range").click();
  await expect(page.getByTestId("analytic-range-panel")).toBeVisible();
  for (const day of [to, from]) {
    const cell = page.getByTestId(`analytic-range-day-${day}`);
    for (const step of ["prev", "next"] as const) {
      for (let i = 0; i < 24 && (await cell.count()) === 0; i++) {
        await page.getByTestId(`analytic-range-${step}`).click();
      }
    }
    await cell.click();
  }
  await page.getByTestId("analytic-range-apply").click();
  await expect(page.getByTestId("analytic-range-panel")).toBeHidden();
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await seed();
});

// ── 1 · open analytic — first open ─────────────────────────────────────────────────────────────────────────────────

test.describe("selling:all · warehouse:all wants to see statistics (first open)", () => {
  for (const r of [...SELLING, ...WAREHOUSE]) {
    test(`${r.given} open analytic`, async ({ page }) => {
      await sign(page, r);
      await page.goto("/");
      await expect(page.getByTestId("current-user")).toHaveText(username(r.key));
      const metricReads: string[] = [];
      page.on("request", (req) => {
        if (/\/Metric(Search|Data)$/.test(req.url())) metricReads.push(req.url());
      });

      // WHEN — Analytic, from the menu.
      await page.getByTestId("sidebar").locator('a[href="/analytic"]').click();
      await expect(page).toHaveURL(/\/analytic$/);
      await expect(page.getByTestId("analytic-page")).toBeVisible();

      await test.step("then: grouped by shop over the last 30 days", async () => {
        await expect(page.getByTestId("analytic-group")).toHaveText("Shop");
        await expect(page.getByTestId("analytic-range")).toHaveText("Last 30 days");
      });

      await test.step("then: hint to add a metric shown", async () => {
        await expect(page.getByTestId("analytic-empty")).toHaveText(
          "Add a metric to start — each metric becomes columns, and each of the shops a row.",
        );
        await expect(page.getByTestId("analytic-add-metric")).toBeVisible();
        // No metric: no table, and nothing asked of any service.
        await expect(page.getByTestId("analytic-table")).toHaveCount(0);
        expect(metricReads).toEqual([]);
      });
    });
  }
});

// ── 2 · add analytic metric — group daily · orders created · ads expense ──────────────────────────────────────────────

test.describe("selling:all wants to see statistics (group: daily · add type: orders created, ads expense)", () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const day = today();
      await sign(page, r);
      await page.goto("/analytic?g=daily&r=7d");
      await expect(page.getByTestId("current-user")).toHaveText(username(r.key));
      await expect(page.getByTestId("analytic-group")).toHaveText("Daily");

      // WHEN — Add Metric › Order › Orders created, then Add Metric › Expense › Ads expense.
      await addMetric(page, "order", ORDERS);
      await addMetric(page, "expense", ADS);
      await expect(page).toHaveURL(new RegExp(`[?&]m=${ORDERS.replaceAll("/", "%2F")}%2C${ADS.replaceAll("/", "%2F")}(&|$)`));
      // The orders' fold is asynchronous: re-read until today's row has them.
      await expect(async () => {
        await page.reload();
        await expect(page.getByTestId(`analytic-cell-${day}-created_count`)).toHaveText(String(ORDERS_TODAY), { timeout: 3_000 });
      }).toPass({ timeout: 45_000 });

      await test.step("then: each metric shown as its own column", async () => {
        await expect(page.getByTestId(`analytic-chip-${slugOf(ORDERS)}`)).toBeVisible();
        await expect(page.getByTestId(`analytic-chip-${slugOf(ADS)}`)).toBeVisible();
        // Orders created's three figures and Ads expense's one, each a heading of its own beside the period.
        const headings = (await page.getByTestId("analytic-table").locator("thead th").allTextContents()).map((h) =>
          h.replace(/\s+/g, " ").trim(),
        );
        expect(headings).toEqual(["Period", "Orders created", "Created total", "Created MP total", "Ads spend"]);
        // Today's row carries both: the six orders and the day's ads; two days ago only the ads.
        await expect(page.getByTestId(`analytic-cell-${day}-created_count`)).toHaveText(String(ORDERS_TODAY));
        await expect(page.getByTestId(`analytic-cell-${day}-amount`)).toHaveText(rupiah(ADS_TODAY));
        await expect(page.getByTestId(`analytic-cell-${addDays(day, -2)}-amount`)).toHaveText(rupiah(SHOPS.A.adsBefore));
        await expect(page.getByTestId(`analytic-cell-${addDays(day, -2)}-created_count`)).toHaveText(/^(0|—)$/);
      });

      await test.step("then: one row per day", async () => {
        // The last 7 days, newest first — each day once, none missing, the two metrics on the same row.
        expect(await rowKeys(page)).toEqual(lastDays(7));
        for (const key of lastDays(7)) {
          await expect(page.getByTestId(`analytic-row-${key}`).locator("td")).toHaveCount(5);
        }
      });

      await test.step("then: as-of date and time shown", async () => {
        await expect(page.getByTestId("analytic-as-of")).toHaveText(/^As of \d{1,2} [A-Z][a-z]{2,}( \d{4})? \d{2}:\d{2} WIB$/);
      });
    });
  }
});

// ── 3 · add analytic metric — group daily · ads expense · one shop chosen · add expenses ──────────────────────────────

test.describe("selling:all wants to see statistics (group: daily · type: ads expense · add type: expenses · one shop chosen)", () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const day = today();
      const a = ground.shops.A;
      // GIVEN — Ads expense by day, shop A chosen: today reads A's ads alone.
      await open(page, r, `/analytic?g=daily&m=${ADS}&r=7d&shop=${a.id}`, `analytic-cell-${day}-amount`, rupiah(SHOPS.A.adsToday));
      await expect(page.getByTestId("analytic-filter-shop").getByTestId("shop-select")).toHaveValue(a.name);

      // WHEN — Add Metric › Expense › Expenses.
      await addMetric(page, "expense", EXPENSES);

      await test.step("then: shop filter removed", async () => {
        await expect(page.getByTestId("analytic-filter-shop")).toHaveCount(0);
        await expect(page).not.toHaveURL(/[?&]shop=/);
        // Every column reloads without it: today's ads now read every shop's.
        await expect(page.getByTestId(`analytic-cell-${day}-amount`)).toHaveText(rupiah(ADS_TODAY));
        await expect(page.getByTestId(`analytic-chip-${slugOf(EXPENSES)}`)).toBeVisible();
      });

      await test.step("then: message says expenses cannot be filtered by shop", async () => {
        const said = toast(page, "Shop filter removed");
        await expect(said).toBeVisible();
        await expect(said).toContainText("Expenses cannot be filtered by shop.");
      });
    });
  }
});

// ── 4 · change analytic group — expenses on the table · group by shop ─────────────────────────────────────────────────

test.describe("selling:all wants to see statistics (group: daily · change to group: shop · type: expenses)", () => {
  for (const r of SELLING) {
    test(`${r.given} change analytic group`, async ({ page }) => {
      // GIVEN — Expenses on the table, by day.
      await open(page, r, `/analytic?g=daily&m=${EXPENSES}&r=7d`, "analytic-group", "Daily");
      await expect(page.getByTestId(`analytic-chip-${slugOf(EXPENSES)}`)).toBeVisible();
      await expect(page.getByTestId("analytic-table")).toBeVisible();

      // WHEN — Group by › Shop.
      await page.getByTestId("analytic-group").click();
      const option = page.getByTestId("analytic-group-option-shop");
      await expect(option).toBeVisible();
      await option.click();
      await expect(page.getByTestId("analytic-group")).toHaveText("Shop");

      await test.step("then: expenses removed", async () => {
        await expect(page.getByTestId(`analytic-chip-${slugOf(EXPENSES)}`)).toHaveCount(0);
        await expect(page).toHaveURL(/[?&]g=shop(&|$)/);
        await expect(page).not.toHaveURL(/[?&]m=/);
        await expect(page.getByTestId("analytic-empty")).toHaveText(
          "Add a metric to start — each metric becomes columns, and each of the shops a row.",
        );
      });

      await test.step("then: message says it cannot be grouped by shop", async () => {
        const said = toast(page, "Expenses removed");
        await expect(said).toBeVisible();
        await expect(said).toContainText("Cannot be grouped by shops.");
      });

      await test.step("regression: Expenses stays in Add Metric, greyed with the same reason", async () => {
        await page.getByTestId("analytic-add-metric").click();
        const menu = page.getByTestId("analytic-metric-menu");
        await menu.getByTestId("analytic-category-expense").click();
        await expect.soft(menu.getByTestId(`analytic-metric-${slugOf(EXPENSES)}-reason`)).toHaveText("Cannot be grouped by shops");
        await menu.getByTestId("analytic-metric-done").click();
      });
    });
  }
});

// ── 5 · sort analytic report — orders created by shop ───────────────────────────────────────────────────────────────

test.describe("selling:all wants to see statistics (group: shop · type: orders created)", () => {
  for (const r of SELLING) {
    test(`${r.given} sort analytic report`, async ({ page }) => {
      const { A, B, C } = ground.shops;
      const counts = async () => {
        const keys = await rowKeys(page);
        return Promise.all(keys.map(async (k) => Number(await page.getByTestId(`analytic-cell-${k}-created_count`).textContent())));
      };
      // GIVEN — Orders created by shop, ranked by MP total: A (Rp 900.000), C (Rp 400.000), B (Rp 300.000).
      await open(
        page,
        r,
        `/analytic?g=shop&m=${ORDERS}&r=7d&s=${ORDERS}:mp_total:desc`,
        `analytic-cell-${B.id}-created_count`,
        String(SHOPS.B.orders),
      );
      await expect.poll(() => rowKeys(page)).toEqual([A.id, C.id, B.id]);

      // WHEN — the Orders created heading: largest first.
      await page.getByTestId("analytic-sort-created_count").click();

      await test.step("then: rows ordered by orders created", async () => {
        await expect(page.getByTestId("analytic-sort-created_count")).toHaveAttribute("data-sort", "desc");
        await expect(page).toHaveURL(new RegExp(`[?&]s=${ORDERS.replaceAll("/", "%2F")}%3Acreated_count%3Adesc(&|$)`));
        await expect.poll(() => rowKeys(page)).toEqual([B.id, C.id, A.id]);
        expect(await counts()).toEqual([3, 2, 1]);
        // The heading again: flipped, smallest first.
        await page.getByTestId("analytic-sort-created_count").click();
        await expect(page.getByTestId("analytic-sort-created_count")).toHaveAttribute("data-sort", "asc");
        await expect.poll(() => rowKeys(page)).toEqual([A.id, C.id, B.id]);
        expect(await counts()).toEqual([1, 2, 3]);
      });
    });
  }
});

// ── 6 · view analytic as graph — orders created · group daily ───────────────────────────────────────────────────────

test.describe("selling:all wants to see statistics (group: daily · type: orders created)", () => {
  for (const r of SELLING) {
    test(`${r.given} view analytic as graph`, async ({ page }) => {
      const day = today();
      await open(page, r, `/analytic?g=daily&m=${ORDERS}&r=7d`, `analytic-cell-${day}-created_count`, String(ORDERS_TODAY));
      // The table's rows: the last 7 days, newest first, each named on its first cell.
      const keys = await rowKeys(page);
      expect(keys).toEqual(lastDays(7));
      const labels: string[] = [];
      for (const k of keys) labels.push(((await page.getByTestId(`analytic-row-${k}`).locator("td").first().textContent()) ?? "").trim());

      // WHEN — the Graph tab.
      await page.getByTestId("analytic-view-graph").click();

      await test.step("then: the same rows drawn as a graph", async () => {
        await expect(page).toHaveURL(/[?&]v=graph(&|$)/);
        await expect(page.getByTestId("analytic-graphs")).toBeVisible();
        await expect(page.getByTestId("analytic-table")).toHaveCount(0);
        // One graph per kind of number among the columns: the count, and the two money figures.
        const count = page.getByTestId("analytic-graph-count");
        const money = page.getByTestId("analytic-graph-money");
        await expect(count).toContainText("Orders created");
        await expect(money).toContainText("Created total");
        await expect(money).toContainText("MP total");
        // The same seven days along the bottom, oldest first — both ends always drawn, every tick one of the rows.
        const oldestFirst = [...labels].reverse();
        // The chart measures its box before it draws: poll its ticks. The x ticks are the ones naming a row (the side
        // axis's figures are ticks too); crowded ones give way, both ends always stay.
        const tick = count.locator(".recharts-cartesian-axis-tick-value");
        const xTicks = async () => (await tick.allTextContents()).map((t) => t.trim()).filter((t) => oldestFirst.includes(t));
        await expect.poll(async () => (await xTicks()).at(-1)).toBe(oldestFirst[oldestFirst.length - 1]);
        const ticks = await xTicks();
        expect(ticks[0]).toBe(oldestFirst[0]);
        expect(ticks[ticks.length - 1]).toBe(oldestFirst[oldestFirst.length - 1]);
        expect(ticks.every((t, i) => oldestFirst.indexOf(t) >= (i === 0 ? 0 : oldestFirst.indexOf(ticks[i - 1]!) + 1))).toBe(true);
        // A point per row on every line: 7 on the count graph's one line, 14 on the money graph's two.
        await expect(count.locator(".recharts-line-dot")).toHaveCount(keys.length);
        await expect(money.locator(".recharts-line-dot")).toHaveCount(keys.length * 2);
      });

      await test.step("regression: the Table tab draws the same rows again", async () => {
        await page.getByTestId("analytic-view-table").click();
        await expect.poll(() => rowKeys(page)).toEqual(keys);
        await expect.soft(page.getByTestId(`analytic-cell-${day}-created_count`)).toHaveText(String(ORDERS_TODAY));
      });
    });
  }
});

// ── 7 · open analytic link — report built · link opened in another tab ──────────────────────────────────────────────

test.describe("selling:all wants to see statistics (report built · link opened in another tab)", () => {
  for (const r of SELLING) {
    test(`${r.given} open analytic link`, async ({ page }) => {
      const { A, B } = ground.shops;
      // What a tab shows of the report: its group, range, metrics, sort, rows and every cell, in order.
      const report = async (p: Page) => ({
        group: (await p.getByTestId("analytic-group").textContent())?.trim(),
        range: (await p.getByTestId("analytic-range").textContent())?.trim(),
        chips: await p.locator('[data-testid^="analytic-chip-"]:not([data-testid$="-remove"])').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid"))),
        sort: await p.locator('[data-testid^="analytic-sort-"][data-sort]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid")}:${e.getAttribute("data-sort")}`)),
        rows: await p.locator('[data-testid^="analytic-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid"))),
        cells: await p.locator('[data-testid^="analytic-cell-"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid")}=${(e.textContent ?? "").trim()}`)),
      });

      // GIVEN — a report built on the screen: by shop, last 7 days, Orders created and Ads expense, sorted by ads.
      await open(page, r, "/analytic?g=shop&r=7d", "analytic-group", "Shop");
      await addMetric(page, "order", ORDERS);
      await addMetric(page, "expense", ADS);
      await page.getByTestId("analytic-sort-amount").click();
      await expect(page.getByTestId("analytic-sort-amount")).toHaveAttribute("data-sort", "desc");
      await expect(async () => {
        await expect(page.getByTestId(`analytic-cell-${A.id}-amount`)).toHaveText(rupiah(SHOPS.A.adsToday + SHOPS.A.adsBefore), { timeout: 3_000 });
        await expect(page.getByTestId(`analytic-cell-${A.id}-created_count`)).toHaveText(String(SHOPS.A.orders), { timeout: 3_000 });
      }).toPass({ timeout: 45_000 });
      await expect.poll(() => rowKeys(page)).toEqual([A.id, B.id]);
      const built = await report(page);
      const link = page.url();

      // WHEN — the link, opened in another tab.
      const tab = await page.context().newPage();
      await tab.goto(link);

      await test.step("then: the same report shown", async () => {
        await expect(tab).toHaveURL(link);
        await expect(tab.getByTestId(`analytic-cell-${A.id}-amount`)).toHaveText(rupiah(SHOPS.A.adsToday + SHOPS.A.adsBefore));
        await expect.poll(() => report(tab)).toEqual(built);
        expect(built.rows).toEqual([`analytic-row-${A.id}`, `analytic-row-${B.id}`]);
      });
      await tab.close();
    });
  }
});

// ── 8 · change analytic period — range longer than a year ───────────────────────────────────────────────────────────

test.describe("selling:all wants to see statistics (range longer than a year)", () => {
  for (const r of SELLING) {
    test(`${r.given} change analytic period`, async ({ page }) => {
      // Was ❌ (an-analytic-range-over-a-year-keeps-the-last-windows-figures): listQuery's keepPreviousData held a
      // DISABLED query's answer, so the last window's report stayed on screen. Fixed by #130 (`listQueryWhile(valid)`
      // keeps nothing while the range is refused) — the check below is the then, as written.
      const day = today();
      // A loaded report on screen first — the one a longer range must not keep showing.
      await open(page, r, `/analytic?g=daily&m=${ORDERS}&r=7d`, `analytic-cell-${day}-created_count`, String(ORDERS_TODAY));
      await expect(page.getByTestId("analytic-as-of")).toBeVisible();

      // Every metric read the page sends from here on.
      const reads: string[] = [];
      page.on("request", (req) => {
        if (/\/Metric(Search|Data)$/.test(req.url())) reads.push(req.url());
      });

      // WHEN — today and the 400 days before it (401 days), picked on the calendar.
      const from = addDays(day, -400);
      await pickRange(page, from, day);
      await expect(page).toHaveURL(new RegExp(`[?&]r=${from}\\.\\.${day}(&|$)`));

      await test.step("then: report not loaded, message says a year at most", async () => {
        await expect(page.getByTestId("analytic-range-invalid")).toHaveText(
          "That range covers 401 days. A report reads at most 366 — pick a year at most.",
        );
        await page.waitForLoadState("networkidle");
        // Not loaded: nothing is asked of any service for that window …
        expect(reads).toEqual([]);
        // … and no figure stays on screen — the last window's report is not kept up under the new range. (Soft, so a
        // run names every part still drawn.)
        await expect.soft(page.getByTestId(`analytic-row-${day}`)).toHaveCount(0, { timeout: 3_000 });
        await expect.soft(page.getByTestId("analytic-as-of")).toHaveCount(0, { timeout: 3_000 });
        await expect.soft(page.getByTestId("analytic-headline-created_count-value")).toHaveText("—", { timeout: 3_000 });
        // The message is the screen's own, not a refusal from the server.
        await expect(page.getByTestId("analytic-error")).toHaveCount(0);
      });
    });
  }
});

// ── 9 · add analytic metric — group by seller · restock ─────────────────────────────────────────────────────────────

test.describe("warehouse:all wants to see statistics (group: seller · add type: restock)", () => {
  const HIDDEN = ["ordered_value", "lost_value", "accepted_value"]; // InventoryRestockMetric's optional values
  for (const r of WAREHOUSE) {
    test(`${r.given} add analytic metric`, async ({ page, browser }) => {
      const seller = ground.team;
      await sign(page, r);
      await page.goto("/analytic?g=team&r=7d");
      await expect(page.getByTestId("current-user")).toHaveText(username(r.key));
      await expect(page.getByTestId("analytic-group")).toHaveText("Seller");

      // WHEN — Add Metric › Inventory › Restock.
      await addMetric(page, "inventory", RESTOCK);
      await expect(async () => {
        await page.reload();
        await expect(page.getByTestId(`analytic-cell-${seller}-ordered_count`)).toHaveText(String(STOCK), { timeout: 3_000 });
      }).toPass({ timeout: 45_000 });

      await test.step("then: seller's money columns not shown", async () => {
        for (const f of HIDDEN) {
          await expect(page.getByTestId(`analytic-cell-${seller}-${f}`)).toHaveCount(0);
          await expect(page.getByTestId(`analytic-sort-${f}`)).toHaveCount(0);
          await expect(page.getByTestId(`analytic-headline-${f}`)).toHaveCount(0);
        }
        // The units stay — and the courier's COD, which the warehouse paid itself (the-warehouse-sees-the-cod-it-paid).
        await expect(page.getByTestId(`analytic-cell-${seller}-accepted_count`)).toHaveText(String(STOCK));
        await expect(page.getByTestId(`analytic-cell-${seller}-cod_amount`)).toHaveCount(1);
      });

      await test.step("regression: the seller itself reads those columns on the same report", async () => {
        const ctx = await browser.newContext();
        const own = await ctx.newPage();
        await signInAs(own, username("sown"), PASSWORD, seller);
        await expect(async () => {
          await own.goto(`${UI_URL}/analytic?g=team&m=${RESTOCK}&r=7d`);
          await expect(own.getByTestId(`analytic-cell-${seller}-ordered_value`)).toHaveText(rupiah(RESTOCK_TOTAL), { timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        await expect.soft(own.getByTestId(`analytic-cell-${seller}-accepted_value`)).toHaveText(rupiah(RESTOCK_TOTAL));
        await ctx.close();
      });
    });
  }
});

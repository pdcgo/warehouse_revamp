import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { addMetric, asRoot, rupiah, signInAs, today } from "./metric_ground";

// ── add analytic metric, the two settlement metrics — the checks behind docs/acceptances/analytic/settlement_metric.md ──
//
// add analytic metric's checks for the SETTLEMENT METRICS on Analytic › Settlement — *Settlement* (sales, received,
// withdrawn, gap, take rate, position to date) and *Settlement by type* (one column per settlement type) — read by a
// selling team only (proto/warehouse/settlement/v1/settlement_analytic.proto; docs/business/settlement/analytic_context.md).
// They are the figures the settlement report shows, so the two screens must agree. An acceptance has no test file of its
// own (docs/acceptances/guide.md): one test.describe per given + when (named as the given, its case in parentheses
// VERBATIM), per role a test — selling:all = owner, admin, cs — and one test.step("then: …") per then, stored verbatim
// (acceptance_mark.py matches the literal text).
//
// Business rules (settlement_analytic.proto, settlement-serves-its-headline-and-its-breakdown):
// - sales = what buyers paid (the order's Estimate, its marketplace total); received = Σ the ten settlement types (a
//   payout, a fee …); gap = sales − received; take rate = gap ÷ sales; position to date = what buyers paid less
//   everything the platform moved, at the period's END.
// - posted-on-buckets-the-report — a row counts on the day it was LEARNED (posted), so every row here is today's.
// - the by-type fields keep the log's sign: a payout is positive, a fee the platform kept is negative.
//
// GROUND (beforeAll, as root, through the API from the test runner): one warehouse W (fee 10%) and THREE selling teams,
// one per given — a team's figures are its whole, so no given can see another's rows — each with a user per selling
// role, its own product stocked into W, and its own Shopee shop(s) with orders placed by root; each order's Estimate is
// posted by the order's own event (polled), then root posts the payout / fee rows by hand:
// - given 1 (team A): ONE order sold Rp 1.000.000, a Payout of Rp 900.000 on it — gap Rp 100.000, take rate 10%.
// - given 2 (team B): TWO shops, each ONE order with a payout: shop P sold Rp 300.000, paid out Rp 200.000 (position
//   Rp 100.000); shop Q sold Rp 500.000, paid out Rp 350.000 (position Rp 150.000).
// - given 3 (team C): ONE order sold Rp 400.000, and on that order a Payout of Rp 360.000 and an Ads fee of Rp 20.000.
// Nothing is written after the seed: every role only reads, so the roles share each given's ground.
//
// THE WHEN, as the person does it: Analytic over the last 7 days (given 1 and 3 by day, given 2 by shop), Add Metric ›
// Settlement › the given's metric, Done. The folds are asynchronous (settlement's own webhook), so the page is reloaded
// until the figures land. How each then is read:
// - `sales, received, gap and take rate shown on the day learned` — today's row: Selling price Rp 1.000.000, Received
//   Rp 900.000, Gap Rp 100.000, Take rate 10%; yesterday's row (a quiet day of the window) carries none of it.
// - `figures match the settlement report for the same dates` — the report opened on the SAME window (`?range=7d`, the
//   Analytic page's `r=7d`, both resolved by jakartaWindowOf): its six summary tiles equal the Analytic headline's six
//   cards, and its Over time table holds the same seven days with the same six figures on each. The report is read by
//   the role itself where its menu has it (owner, admin); a CS has no report in its menu (nav.ts, isTeamManager), so the
//   CS's Analytic figures are compared with the report as the team's OWNER reads it.
// - `each shop's position shown` — by shop, the table holds exactly team B's two shops, each row named for its shop and
//   carrying its own Position to date.
// - `payout and ads fee shown in their own columns` — Settlement by type by day: the headings hold a Payout column and an
//   Ads fee column apart, and today's row reads Rp 360.000 under Payout and −Rp 20.000 under Ads fee; every other type's
//   column reads Rp 0 (neither figure lumped into another type).

const DIGITS = Date.now().toString().slice(-6);
const SUFFIX = `${DIGITS}s`;
const PASSWORD = "e2e-settlement-figures-pass-1";
const UNIT_COST = 10_000;

const SALE = 1_000_000; // given 1
const PAYOUT = 900_000;
const P_SALE = 300_000; // given 2, shop P
const P_PAYOUT = 200_000;
const Q_SALE = 500_000; // given 2, shop Q
const Q_PAYOUT = 350_000;
const C_SALE = 400_000; // given 3
const C_PAYOUT = 360_000;
const C_ADS = 20_000;

const SELLING = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
] as const;
type Key = (typeof SELLING)[number]["key"];

const G1 = {
  case: "group: daily · add type: settlement · sale Rp 1.000.000 · payout Rp 900.000",
  thenDay: "then: sales, received, gap and take rate shown on the day learned",
  thenReport: "then: figures match the settlement report for the same dates",
};
const G2 = { case: "group: shop · add type: settlement · 2 shops", then: "then: each shop's position shown" };
const G3 = {
  case: "group: daily · add type: settlement per type · payout and ads fee on one order",
  then: "then: payout and ads fee shown in their own columns",
};

// The Settlement metric's six fields, in the order the report draws its tiles and its Over time columns.
const FIELDS = ["sales", "received", "withdrawn", "gap", "take_rate", "position_to_date"] as const;
const TILES = ["sales", "received", "withdrawn", "gap", "take-rate", "position"] as const;
// The ten settlement types of Settlement by type (SettlementTypeMetric's fields).
const TYPES = [
  "fund",
  "external_ads_fee",
  "affiliate_fee",
  "marketplace_adjustment",
  "shipment_adjustment",
  "logistic_reimbursement",
  "platform_reimbursement",
  "marketplace_program",
  "other",
  "system_adjustment",
] as const;

const username = (team: string, key: Key) => `e2esm${team.toLowerCase()}${key}${SUFFIX}`;

type TeamGround = { tag: string; team: string; productId: string; productCode: string; shops: string[]; names: string[] };
const ground = { warehouse: "", a: undefined as TeamGround | undefined, b: undefined as TeamGround | undefined, c: undefined as TeamGround | undefined };

// The order's live sale on its settlement account; −1 while the account has not opened (a 404 until the order's event
// posts the Estimate) — expect.poll does not retry a callback that throws.
async function liveSale(teamId: string, orderId: string): Promise<number> {
  try {
    const res = await asRoot("settlement.v1.SettlementService/OrderSettlementDetail", { teamId, orderId });
    return Number(res.settlement?.initialTotal ?? 0);
  } catch {
    return -1;
  }
}

async function seed() {
  const team = async (name: string, teamCode: string, type: string) =>
    String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  ground.warehouse = await team(`E2E Settlement Figures WH ${SUFFIX}`, `SMW${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 10, minFee: 0 });
  const category = (await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Settlement Figures ${SUFFIX}` })).category.id;

  // A selling team of its own: a user per selling role, its product stocked into W, `shops` Shopee shops (root first —
  // the first grant is the shop's primary CS — and the CS on each).
  const sellingTeam = async (tag: string, shops: number): Promise<TeamGround> => {
    const g: TeamGround = {
      tag,
      team: await team(`E2E Settlement Figures ${tag} ${SUFFIX}`, `SM${tag}${DIGITS}`, "TEAM_TYPE_SELLING"),
      productId: "",
      productCode: "",
      shops: [],
      names: [],
    };
    await asRoot("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId: g.team, warehouseId: ground.warehouse });
    const users: Record<string, string> = {};
    for (const r of SELLING) {
      const made = await asRoot("user.v1.UserService/CreateUser", {
        teamId: g.team,
        username: username(tag, r.key),
        password: PASSWORD,
        name: `Settlement Figures ${tag} ${r.key} ${SUFFIX}`,
        role: r.role,
      });
      users[r.key] = String(made.user.id);
    }

    const product = (
      await asRoot("product.v1.ProductService/ProductCreate", {
        teamId: g.team,
        productCodePart: `SMK${tag}${DIGITS}`,
        name: `Sabun Penyelesaian ${tag} ${SUFFIX}`,
        categoryId: category,
      })
    ).product;
    g.productId = String(product.id);
    g.productCode = product.productCode;
    const account = (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: g.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E settlement figures ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-STM-${tag}-${SUFFIX}`,
        openingBalance: 0,
        openingOn: today(),
      })
    ).account.id;
    await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: g.team,
      accountId: account,
      operational: true,
    });
    const rack = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `sm${tag.toLowerCase()}-${DIGITS}` })).rack.id);
    const count = shops + 1;
    const name = `Sabun Penyelesaian ${tag} ${SUFFIX}`;
    const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: g.team,
      warehouseId: ground.warehouse,
      financeAccountId: account,
      items: [{ productId: g.productId, productCode: g.productCode, name, count, total: count * UNIT_COST }],
    });
    await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouse,
      requestId: restock.request.id,
      lines: [{ itemId: restock.request.items[0].id, receivedCount: count, placements: [{ placementId: rack, quantity: count }] }],
    });

    for (let n = 1; n <= shops; n++) {
      const shopName = `E2E Settlement Figures Shop ${tag}${n} ${SUFFIX}`;
      const shop = String(
        (
          await asRoot("selling.v1.ShopService/ShopCreate", {
            teamId: g.team,
            name: shopName,
            shopCode: `SM${tag}${n}${DIGITS}`,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
      await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: g.team, shopId: shop, userId: ROOT_USER_ID });
      await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: g.team, shopId: shop, userId: users.cs });
      g.shops.push(shop);
      g.names.push(shopName);
    }

    return g;
  };

  // One order of `total` on the shop (1 unit), placed by root; returns once its Estimate has opened the account.
  const order = async (g: TeamGround, shop: string, key: string, total: number) => {
    const ref = `SM${DIGITS}${key}`;
    const placed = await asRoot("selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-settlement-figures-${key}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: g.team,
      shopId: shop,
      warehouseId: ground.warehouse,
      customerName: `E2E Settlement Buyer ${key} ${SUFFIX}`,
      platformTotal: total,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: ref,
      receiptCode: `J${ref}`,
      items: [{ productId: g.productId, productCode: g.productCode, name: `Sabun Penyelesaian ${g.tag} ${SUFFIX}`, quantity: 1 }],
    });
    const orderId = String(placed.order.id);
    await expect.poll(() => liveSale(g.team, orderId), { timeout: 30_000 }).toBe(total);

    return orderId;
  };
  // A row posted by hand by root on an order of the shop — a payout or a fee.
  const post = (g: TeamGround, shop: string, orderId: string, key: string, settlementType: string, change: number) =>
    asRoot("settlement.v1.SettlementWriteService/SettlementPost", {
      teamId: g.team,
      orderId,
      shopId: shop,
      uniqueId: `manual-sm-${SUFFIX}-${key}`,
      settlementType,
      sourceType: "SOURCE_TYPE_MANUAL",
      change,
      occurredOn: today(),
    });

  // Given 1 — one order sold Rp 1.000.000, Rp 900.000 paid out on it.
  const a = await sellingTeam("A", 1);
  const a1 = await order(a, a.shops[0]!, "a1", SALE);
  await post(a, a.shops[0]!, a1, "a1-fund", "SETTLEMENT_TYPE_FUND", PAYOUT);
  ground.a = a;

  // Given 2 — two shops, each one order with its payout.
  const b = await sellingTeam("B", 2);
  const p = await order(b, b.shops[0]!, "bp", P_SALE);
  await post(b, b.shops[0]!, p, "bp-fund", "SETTLEMENT_TYPE_FUND", P_PAYOUT);
  const q = await order(b, b.shops[1]!, "bq", Q_SALE);
  await post(b, b.shops[1]!, q, "bq-fund", "SETTLEMENT_TYPE_FUND", Q_PAYOUT);
  ground.b = b;

  // Given 3 — one order, a payout and an ads fee on it (a fee the platform kept is negative).
  const c = await sellingTeam("C", 1);
  const c1 = await order(c, c.shops[0]!, "c1", C_SALE);
  await post(c, c.shops[0]!, c1, "c1-fund", "SETTLEMENT_TYPE_FUND", C_PAYOUT);
  await post(c, c.shops[0]!, c1, "c1-ads", "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE", -C_ADS);
  ground.c = c;
}

/** THE WHEN on the open Analytic page: the metric added, then the named cells re-read until the fold has landed. */
async function whenAdded(page: Page, metric: string, want: Record<string, string>) {
  await addMetric(page, "settlement", metric);
  await expect(async () => {
    await page.reload();
    for (const [cell, text] of Object.entries(want)) {
      await expect(page.getByTestId(`analytic-cell-${cell}`)).toHaveText(text, { timeout: 3_000 });
    }
  }).toPass({ timeout: 45_000 });
}

/** The keys of the Analytic table's rows, as drawn. */
async function rowKeys(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="analytic-row-"]')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid")!.replace("analytic-row-", "")));
}

const yesterday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
// The report writes a take rate "10% of the selling price" where Analytic writes "10%".
const rate = (text: string) => text.trim().replace(/ of the selling price$/, "");

test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await seed();
});

test.describe(`selling:all wants to see statistics (${G1.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page, browser }) => {
      const g = ground.a!;
      const day = today();
      const cell = (key: string, field: string) => page.getByTestId(`analytic-cell-${key}-${field}`);
      await signInAs(page, username(g.tag, r.key), PASSWORD, g.team);

      // WHEN — Analytic by day over the last 7 days (the team's whole), Settlement added.
      await page.goto("/analytic?g=daily&r=7d");
      await expect(page.getByTestId("current-user")).toHaveText(username(g.tag, r.key));
      await whenAdded(page, "metrics/settlement", { [`${day}-sales`]: rupiah(SALE), [`${day}-received`]: rupiah(PAYOUT) });

      await test.step(G1.thenDay, async () => {
        await expect.soft(cell(day, "sales")).toHaveText(rupiah(SALE));
        await expect.soft(cell(day, "received")).toHaveText(rupiah(PAYOUT));
        await expect.soft(cell(day, "gap")).toHaveText(rupiah(SALE - PAYOUT));
        await expect.soft(cell(day, "take_rate")).toHaveText("10%");
        // On the day learned and no other: the day before is a quiet row of the window.
        const before = yesterday(day);
        await expect.soft(cell(before, "sales")).toHaveText(rupiah(0));
        await expect.soft(cell(before, "received")).toHaveText(rupiah(0));
        await expect.soft(cell(before, "gap")).toHaveText(rupiah(0));
        await expect.soft(cell(before, "take_rate")).toHaveText("—");
      });

      await test.step(G1.thenReport, async () => {
        // Analytic, as drawn: the six headline cards and every day row's six cells.
        const headline: string[] = [];
        for (const f of FIELDS) headline.push(rate(await page.getByTestId(`analytic-headline-${f}-value`).innerText()));
        const days = (await rowKeys(page)).sort();
        expect.soft(days).toHaveLength(7);
        const analytic: Record<string, string[]> = {};
        for (const d of days) {
          analytic[d] = [];
          for (const f of FIELDS) analytic[d].push(rate(await cell(d, f).innerText()));
        }

        // The settlement report on the same window — as the role itself, or the team's owner for a CS (no report in its menu).
        const reader = r.key === "cs" ? await browser.newPage() : page;
        if (reader !== page) await signInAs(reader, username(g.tag, "own"), PASSWORD, g.team);
        await reader.goto("/settlement/report?range=7d");
        await expect(reader.getByTestId("settlement-report-page")).toBeVisible({ timeout: 10_000 });
        await expect(reader.getByTestId("report-sales-value")).toHaveText(rupiah(SALE), { timeout: 10_000 });
        const tiles: string[] = [];
        for (const tile of TILES) tiles.push(rate(await reader.getByTestId(`report-${tile}-value`).innerText()));
        const rows = reader.getByTestId("report-series-table").locator("tbody tr");
        await expect(rows).toHaveCount(7);
        const report: Record<string, string[]> = {};
        for (const row of await rows.all()) {
          const texts = (await row.locator("td").allInnerTexts()).map(rate);
          report[texts[0]!] = texts.slice(1);
        }
        if (reader !== page) await reader.close();

        expect.soft(tiles).toEqual(headline);
        expect.soft(Object.keys(report).sort()).toEqual(days);
        for (const d of days) expect.soft(report[d], `the ${d} row`).toEqual(analytic[d]);
        // And the figures themselves — so two screens agreeing on nothing cannot pass.
        expect.soft(report[day]).toEqual([rupiah(SALE), rupiah(PAYOUT), rupiah(0), rupiah(SALE - PAYOUT), "10%", rupiah(SALE - PAYOUT)]);
      });
    });
  }
});

test.describe(`selling:all wants to see statistics (${G2.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const g = ground.b!;
      const [p, q] = g.shops as [string, string];
      await signInAs(page, username(g.tag, r.key), PASSWORD, g.team);

      // WHEN — Analytic by shop over the last 7 days, Settlement added.
      await page.goto("/analytic?g=shop&r=7d");
      await expect(page.getByTestId("current-user")).toHaveText(username(g.tag, r.key));
      await whenAdded(page, "metrics/settlement", {
        [`${p}-position_to_date`]: rupiah(P_SALE - P_PAYOUT),
        [`${q}-position_to_date`]: rupiah(Q_SALE - Q_PAYOUT),
      });

      await test.step(G2.then, async () => {
        // The team's two shops and only them, each row named for its shop with its own position.
        expect.soft((await rowKeys(page)).sort()).toEqual([p, q].sort());
        await expect.soft(page.getByTestId(`analytic-row-${p}`)).toContainText(g.names[0]!);
        await expect.soft(page.getByTestId(`analytic-row-${q}`)).toContainText(g.names[1]!);
        await expect.soft(page.getByTestId(`analytic-cell-${p}-position_to_date`)).toHaveText(rupiah(P_SALE - P_PAYOUT));
        await expect.soft(page.getByTestId(`analytic-cell-${q}-position_to_date`)).toHaveText(rupiah(Q_SALE - Q_PAYOUT));
      });
    });
  }
});

test.describe(`selling:all wants to see statistics (${G3.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const g = ground.c!;
      const day = today();
      await signInAs(page, username(g.tag, r.key), PASSWORD, g.team);

      // WHEN — Analytic by day over the last 7 days, Settlement by type added.
      await page.goto("/analytic?g=daily&r=7d");
      await expect(page.getByTestId("current-user")).toHaveText(username(g.tag, r.key));
      await whenAdded(page, "metrics/settlement/types", {
        [`${day}-fund`]: rupiah(C_PAYOUT),
        [`${day}-external_ads_fee`]: `−${rupiah(C_ADS)}`,
      });

      await test.step(G3.then, async () => {
        // A Payout column and an Ads fee column, apart — and under each, today's own figure.
        const headings = (await page.getByTestId("analytic-table").locator("thead th").allTextContents()).map((h) =>
          h.replace(/\s+/g, " ").trim(),
        );
        const payout = headings.indexOf("Payout");
        const ads = headings.indexOf("Ads fee");
        expect.soft(payout, `headings: ${headings.join(" | ")}`).toBeGreaterThan(0);
        expect.soft(ads, `headings: ${headings.join(" | ")}`).toBeGreaterThan(0);
        expect.soft(ads).not.toBe(payout);
        const todayCells = page.getByTestId(`analytic-row-${day}`).locator("td");
        await expect.soft(todayCells.nth(payout)).toHaveText(rupiah(C_PAYOUT));
        await expect.soft(todayCells.nth(ads)).toHaveText(`−${rupiah(C_ADS)}`);
        // Neither lumped into another type: the other eight columns read Rp 0 today.
        for (const t of TYPES.filter((t) => t !== "fund" && t !== "external_ads_fee")) {
          await expect.soft(page.getByTestId(`analytic-cell-${day}-${t}`), t).toHaveText(rupiah(0));
        }
      });
    });
  }
});

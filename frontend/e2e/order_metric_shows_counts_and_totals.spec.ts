import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { addMetric, asRoot, rupiah, signInAs, today } from "./metric_ground";

// ── add analytic metric, the five order metrics — the checks behind docs/acceptances/analytic/order_metric.md givens 1–6 ──
//
// add analytic metric's checks for the FIVE ORDER METRICS on Analytic › Order — orders created, cancelled, returns
// created, returns arrived, orders lost (docs/business/order/order_statistic_metric.md) — each a count, the orders' total
// and their marketplace total. (Givens 7–14, the status moves, are order_metric_shows_each_move.spec.ts.) An acceptance
// has no test file of its own (docs/acceptances/guide.md): one test.describe per given + when (named as the given, its
// case in parentheses VERBATIM), per role a test — selling:all = owner, admin, cs; warehouse:all = owner, admin, staff —
// and one test.step("then: …") per then, stored verbatim (acceptance_mark.py matches the literal text).
//
// Business rules (docs/business/order/order_statistic_metric_decision.md, docs/business/analytic/rpc_provide_decision.md):
// - a-total-is-the-total-cost — every `*_total` is the order's frozen total_cost (goods + the warehouse fee), every
//   `*_mp_total` its platform_total. So the order here is one unit costing Rp 64.000 at a warehouse charging 25% of the
//   goods: total cost Rp 80.000 (64.000 + 16.000), and the buyer paid Rp 120.000 on the storefront — given 1's figures.
// - each metric counts an order on the day of ITS event: created at placement, cancelled at the cancel, return created
//   at the move to return, return arrived at the warehouse's accept, lost at the mark — all today here.
// - a-warehouse-sees-no-seller-money / a-warehouse-reads-the-orders-it-ships — a warehouse reads the count of the orders
//   it ships, and the money fields come back unset, so their columns, sorts and headlines are not drawn.
//
// GROUND (beforeAll, as root, through the API from the test runner): one selling team S with a user per selling role, a
// warehouse W it ships from and returns to (fee 25%) and a second warehouse X (fee 25%) with a user per warehouse role;
// one product stocked on a rack in each at Rp 64.000 a unit. Per given a Shopee shop of S's of its own (root and the CS
// on it) with ONE order of one unit, platform total Rp 120.000, walked to the given's event: given 1 placed at W · 2
// cancelled · 3 handed to the courier and turned to return · 4 that return accepted back onto W's rack · 5 handed to the
// courier, marked shipped, then lost · 6 placed at X, the only order X ever ships. Nothing is written after the seed:
// every role only reads, so the roles share each given's ground.
//
// THE WHEN, as the person does it: Analytic grouped daily over the last 7 days — a selling role filtered to the given's
// shop (`?g=daily&r=7d&shop=<id>`), the warehouse unfiltered (it reads only what it ships) — Add Metric › Order › the
// given's metric, Done. The thens read today's row. The folds are asynchronous (order events' listeners), so the page is
// reloaded until the count lands.

const DIGITS = Date.now().toString().slice(-6);
const SUFFIX = `${DIGITS}f`;
const PASSWORD = "e2e-order-figures-pass-1";
const PRODUCT = `Sabun Angka ${SUFFIX}`;
const UNIT_COST = 64_000;
const FEE_PERCENT = 25;
const TOTAL_COST = 80_000; // UNIT_COST + 25% of it
const MP_TOTAL = 120_000;
const STOCK_W = 5; // one unit for each of givens 1–5
const STOCK_X = 2;

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

// The selling givens, in the file's order: `case` is the given's parentheses VERBATIM (· is U+00B7); `metric` the one
// the WHEN adds and its three fields (count, total, mp total); `walk` what happens to the given's one order.
type Walk = "placed" | "cancelled" | "return" | "return_accepted" | "lost";
type Fields = { count: string; total: string; mp: string };
const SELLING_GIVENS: { id: number; case: string; metric: string; fields: Fields; walk: Walk; thens: string[] }[] = [
  {
    id: 1,
    case: "group: daily · add type: orders created · 1 order today · total cost Rp 80.000 · MP Rp 120.000",
    metric: "metrics/orders/created",
    fields: { count: "created_count", total: "created_total", mp: "mp_total" },
    walk: "placed",
    thens: ["then: orders created 1 on today's row", "then: total created Rp 80.000", "then: MP total Rp 120.000"],
  },
  {
    id: 2,
    case: "group: daily · add type: orders cancelled · 1 order cancelled today",
    metric: "metrics/orders/cancelled",
    fields: { count: "cancel_count", total: "cancel_total", mp: "mp_total" },
    walk: "cancelled",
    thens: ["then: orders cancelled 1 with its totals"],
  },
  {
    id: 3,
    case: "group: daily · add type: returns created · 1 return made today",
    metric: "metrics/orders/return_created",
    fields: { count: "return_created_count", total: "return_created_total", mp: "return_created_mp_total" },
    walk: "return",
    thens: ["then: returns created 1 with its totals"],
  },
  {
    id: 4,
    case: "group: daily · add type: returns arrived · 1 return arrived today",
    metric: "metrics/orders/return_arrived",
    fields: { count: "return_arrived_count", total: "return_arrived_total", mp: "return_arrived_mp_total" },
    walk: "return_accepted",
    thens: ["then: returns arrived 1 with its totals"],
  },
  {
    id: 5,
    case: "group: daily · add type: orders lost · 1 order marked lost today",
    metric: "metrics/orders/lost_created",
    fields: { count: "lost_created_count", total: "lost_created_total", mp: "lost_created_mp_total" },
    walk: "lost",
    thens: ["then: orders lost 1 with its totals"],
  },
];
const G6 = {
  id: 6,
  case: "group: daily · add type: orders created · 1 order at this warehouse",
  metric: "metrics/orders/created",
  thenCount: "then: orders created 1",
  thenHidden: "then: totals not shown",
};

const username = (key: string) => `e2eof${key}${SUFFIX}`;

const ground = {
  team: "",
  warehouse: "", // W — ships and takes back givens 1–5
  other: "", // X — ships given 6's order, and nothing else
  rackW: "",
  // given id → its shop
  shops: {} as Record<number, string>,
};

async function move(teamId: string, orderId: string, to: string, label: string) {
  const res = await asRoot<{ results: { moved?: boolean; refusedReason?: string }[] }>(
    "selling.v1.OrderService/OrderStatusChange",
    { teamId, orderIds: [orderId], to: `ORDER_STATUS_${to}` },
  );
  expect(res.results[0]?.moved, `${label} #${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

async function seed() {
  const team = async (name: string, teamCode: string, type: string) =>
    String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Order Figures Seller ${SUFFIX}`, `OFS${DIGITS}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Order Figures WH ${SUFFIX}`, `OFW${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  ground.other = await team(`E2E Order Figures WX ${SUFFIX}`, `OFX${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  await asRoot("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  for (const wh of [ground.warehouse, ground.other]) {
    await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wh, feePercent: FEE_PERCENT, minFee: 0 });
  }

  const users: Record<string, string> = {};
  for (const r of [...SELLING, ...WAREHOUSE]) {
    const made = await asRoot("user.v1.UserService/CreateUser", {
      teamId: r.side === "selling" ? ground.team : ground.other,
      username: username(r.key),
      password: PASSWORD,
      name: `Order Figures ${r.key} ${SUFFIX}`,
      role: r.role,
    });
    users[r.key] = String(made.user.id);
  }

  // The product's units on a rack in each warehouse, Rp 64.000 a unit, paid from the seller's operational account.
  const category = (await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Order Figures ${SUFFIX}` })).category.id;
  const product = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: `OFK${DIGITS}`,
      name: PRODUCT,
      categoryId: category,
    })
  ).product;
  const account = (
    await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E order figures ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-OFM-${SUFFIX}`,
      openingBalance: 0,
      openingOn: today(),
    })
  ).account.id;
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.team,
    accountId: account,
    operational: true,
  });
  const stock = async (warehouseId: string, code: string, count: number) => {
    const rack = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: warehouseId, code })).rack.id);
    const restock = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.team,
      warehouseId,
      financeAccountId: account,
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count, total: count * UNIT_COST }],
    });
    await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouseId,
      requestId: restock.request.id,
      lines: [{ itemId: restock.request.items[0].id, receivedCount: count, placements: [{ placementId: rack, quantity: count }] }],
    });

    return rack;
  };
  ground.rackW = await stock(ground.warehouse, `of-${DIGITS}`, STOCK_W);
  await stock(ground.other, `ofx-${DIGITS}`, STOCK_X);

  // GIVEN — per given its shop and its ONE order, walked to the given's event.
  const place = async (id: number, warehouseId: string) => {
    const shop = String(
      (
        await asRoot("selling.v1.ShopService/ShopCreate", {
          teamId: ground.team,
          name: `E2E Order Figures Shop ${id} ${SUFFIX}`,
          shopCode: `OF${id}${DIGITS}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    // Root first — the first grant is the shop's primary CS; the CS on it too.
    await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: ROOT_USER_ID });
    await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: users.scs });
    ground.shops[id] = shop;

    const ref = `OF${DIGITS}G${id}`;
    const placed = await asRoot("selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-order-figures-${id}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId: shop,
      warehouseId,
      customerName: `E2E Figures Buyer ${id} ${SUFFIX}`,
      platformTotal: MP_TOTAL,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: ref,
      receiptCode: `J${ref}`,
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
    });

    return { orderId: String(placed.order.id), itemId: String(placed.order.items[0].id) };
  };

  for (const g of SELLING_GIVENS) {
    const { orderId, itemId } = await place(g.id, ground.warehouse);
    const label = `given ${g.id}`;
    if (g.walk === "cancelled") {
      await asRoot("selling.v1.OrderService/OrderCancel", { teamId: ground.team, orderId });
      continue;
    }
    if (g.walk === "placed") continue;
    // To the courier: the warehouse confirms, picks and hands it over.
    for (const s of ["PROCESSED", "PICKED", "SHIPPING"]) await move(ground.warehouse, orderId, s, label);
    if (g.walk === "lost") {
      await move(ground.team, orderId, "SHIPPED", label);
      await move(ground.team, orderId, "LOST", label);
      continue;
    }
    await move(ground.team, orderId, "RETURN", label);
    if (g.walk === "return_accepted") {
      // The return warehouse (W) takes the parcel in, its unit sound, back onto the rack.
      await asRoot("selling.v1.OrderService/OrderReturnAccept", {
        teamId: ground.warehouse,
        orderId,
        lines: [{ orderItemId: itemId, placements: [{ rackId: ground.rackW, quantity: 1 }] }],
      });
    }
  }
  await place(G6.id, ground.other);
}

/** THE WHEN on the open Analytic page, then today's row: the given's count cell, re-read until the fold has landed. */
async function whenAdded(page: Page, metric: string, countField: string) {
  await addMetric(page, "order", metric);
  const cell = page.getByTestId(`analytic-cell-${today()}-${countField}`);
  await expect(async () => {
    await page.reload();
    await expect(cell).toHaveText("1", { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await seed();
});

for (const g of SELLING_GIVENS) {
  test.describe(`selling:all wants to see statistics (${g.case})`, () => {
    for (const r of SELLING) {
      test(`${r.given} add analytic metric`, async ({ page }) => {
        const day = today();
        const cell = (field: string) => page.getByTestId(`analytic-cell-${day}-${field}`);
        await signInAs(page, username(r.key), PASSWORD, ground.team);

        // WHEN — Analytic by day over the last 7 days, filtered to the given's shop, the given's metric added.
        await page.goto(`/analytic?g=daily&r=7d&shop=${ground.shops[g.id]}`);
        await expect(page.getByTestId("current-user")).toHaveText(username(r.key));
        await whenAdded(page, g.metric, g.fields.count);

        if (g.id === 1) {
          await test.step(g.thens[0]!, async () => {
            await expect.soft(cell(g.fields.count)).toHaveText("1");
          });
          await test.step(g.thens[1]!, async () => {
            await expect.soft(cell(g.fields.total)).toHaveText(rupiah(TOTAL_COST));
          });
          await test.step(g.thens[2]!, async () => {
            await expect.soft(cell(g.fields.mp)).toHaveText(rupiah(MP_TOTAL));
          });
        } else {
          await test.step(g.thens[0]!, async () => {
            // The one order, with its totals: what it cost the seller (goods + the fee) and what the buyer paid.
            await expect.soft(cell(g.fields.count)).toHaveText("1");
            await expect.soft(cell(g.fields.total)).toHaveText(rupiah(TOTAL_COST));
            await expect.soft(cell(g.fields.mp)).toHaveText(rupiah(MP_TOTAL));
          });
        }
      });
    }
  });
}

test.describe(`warehouse:all wants to see statistics (${G6.case})`, () => {
  const HIDDEN = ["created_total", "mp_total"]; // OrderCreatedMetric's optional money, unset for a warehouse
  for (const r of WAREHOUSE) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const day = today();
      await signInAs(page, username(r.key), PASSWORD, ground.other);

      // WHEN — Analytic by day over the last 7 days (the warehouse reads the orders it ships), Orders created added.
      await page.goto("/analytic?g=daily&r=7d");
      await expect(page.getByTestId("current-user")).toHaveText(username(r.key));
      await whenAdded(page, G6.metric, "created_count");

      await test.step(G6.thenCount, async () => {
        await expect.soft(page.getByTestId(`analytic-cell-${day}-created_count`)).toHaveText("1");
      });

      await test.step(G6.thenHidden, async () => {
        // Only the period and the count are columns — no total, no MP total, no sort or headline for either.
        const headings = (await page.getByTestId("analytic-table").locator("thead th").allTextContents()).map((h) =>
          h.replace(/\s+/g, " ").trim(),
        );
        expect.soft(headings).toEqual(["Period", "Orders created"]);
        for (const f of HIDDEN) {
          await expect.soft(page.getByTestId(`analytic-cell-${day}-${f}`)).toHaveCount(0);
          await expect.soft(page.getByTestId(`analytic-sort-${f}`)).toHaveCount(0);
          await expect.soft(page.getByTestId(`analytic-headline-${f}`)).toHaveCount(0);
        }
        await expect.soft(page.getByTestId("analytic-table")).not.toContainText("Rp");
      });
    });
  }
});

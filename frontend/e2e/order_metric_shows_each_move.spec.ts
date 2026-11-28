import { expect, test } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { addMetric, asRoot, signInAs, today } from "./metric_ground";
import type { OrderMoveField } from "./order_moves_metric";

// ── add analytic metric, each order status move — the checks behind docs/acceptances/analytic/order_metric.md givens 7–14 ──
//
// add analytic metric's checks for ORDER STATUS MOVES on Analytic › Order (metrics/orders/moves, #84 + #97). An
// acceptance has no test file of its own (docs/acceptances/guide.md): one test.describe per given + when (named as the
// given, its case in parentheses verbatim), per role a test — selling:all = owner, admin, cs; warehouse:all = owner,
// admin, staff — and one test.step("then: …") per then, stored VERBATIM below (acceptance_mark.py matches the literal
// text). A step that is no then is named `regression: …`.
//
// Business rules (docs/business/analytic/rpc_provide_decision.md):
// - the-order-status-moves-prototype-is-accepted — ONE count per status an order moved TO, on the Jakarta day it moved,
//   under the order's shop; counts only, no money (order_moves_metric.ts lists the fields). A resolve (problem →
//   completed) is a Completed, and since #97 also its own Disputes resolved (its 🔄 2026-11-20).
// - a-warehouse-reads-the-orders-it-ships / a-warehouse-reads-the-newest-counts-as-accepted — a warehouse reads every
//   count of the orders it ships, so every given here names both teams.
// - every-member-reads-every-metric-of-their-team — a CS reads its team's moves.
//
// GROUND (beforeAll, as root, through the API from the test runner): one selling team with a user per selling role, one
// warehouse it ships from (its return warehouse too) with a user per warehouse role, 20 units of one product accepted
// onto a rack there. Per given a Shopee shop of its own (root and the CS on it) with TWO orders placed today: order A is
// walked to the given's state — its last move being the given's — and order B to the state A moved FROM, so the given's
// count reads A's one move and B adds nothing to it. The roles only read, so they share the given's shop.
//
// THE WHEN, as the person does it: Analytic grouped daily over the last 7 days, filtered to the given's shop
// (`?g=daily&r=7d&shop=<id>`), Add Metric › Order › Order status moves, Done. The then reads today's row: the given's
// count is exactly 1. The fold is asynchronous (an order event's listener), so the page is reloaded until it lands.

const DIGITS = Date.now().toString().slice(-6);
const SUFFIX = `${DIGITS}u`;
const PASSWORD = "e2e-order-moves-pass-1";
const MOVES = "metrics/orders/moves";
const PRODUCT = `Sabun Gerak ${SUFFIX}`;
const STOCK = 20;

const ROLES = [
  { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "sown", side: "selling" },
  { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "sadm", side: "selling" },
  { given: "selling:cs", role: "ROLE_SELLING_CS", key: "scs", side: "selling" },
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "wown", side: "warehouse" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "wadm", side: "warehouse" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "wstf", side: "warehouse" },
] as const;

// A move: the side that makes it (W the warehouse, S the selling team) and the status the order goes TO.
type Move = [side: "W" | "S", to: string];
const TO_SHIPPING: Move[] = [
  ["W", "PROCESSED"],
  ["W", "PICKED"],
  ["W", "SHIPPING"],
];

// The eight givens, in the file's order: `case` is the given's parentheses VERBATIM (· is U+00B7), `path` walks order A
// (its LAST move is the given's), order B walks the path minus that move; `field` is the count the then reads.
const GIVENS: {
  id: number;
  case: string;
  path: Move[];
  field: OrderMoveField;
  then: string;
  // Counts that A and B both reached — the shop holds both orders (B is counted, it just did not make this move).
  both?: OrderMoveField;
}[] = [
  {
    id: 7,
    case: "group: daily · add type: order status moves · 1 order confirmed today",
    path: [["W", "PROCESSED"]],
    field: "confirmed_count",
    then: "then: confirmed 1 on today's row",
  },
  {
    id: 8,
    case: "group: daily · add type: order status moves · 1 order handed back to pending today",
    path: [
      ["W", "PROCESSED"],
      ["W", "PENDING"],
    ],
    field: "back_to_pending_count",
    then: "then: back to pending 1",
    both: "confirmed_count",
  },
  {
    id: 9,
    case: "group: daily · add type: order status moves · 1 order picked today",
    path: [
      ["W", "PROCESSED"],
      ["W", "PICKED"],
    ],
    field: "picked_count",
    then: "then: picked 1",
    both: "confirmed_count",
  },
  {
    id: 10,
    case: "group: daily · add type: order status moves · 1 order handed over today",
    path: TO_SHIPPING,
    field: "handed_over_count",
    then: "then: handed over 1",
    both: "picked_count",
  },
  {
    id: 11,
    case: "group: daily · add type: order status moves · 1 order marked shipped today",
    path: [...TO_SHIPPING, ["S", "SHIPPED"]],
    field: "shipped_count",
    then: "then: shipped 1",
    both: "handed_over_count",
  },
  {
    id: 12,
    case: "group: daily · add type: order status moves · 1 order completed today",
    path: [...TO_SHIPPING, ["S", "SHIPPED"], ["S", "COMPLETED"]],
    field: "completed_count",
    then: "then: completed 1",
    both: "shipped_count",
  },
  {
    id: 13,
    case: "group: daily · add type: order status moves · 1 order marked problem today",
    path: [...TO_SHIPPING, ["S", "SHIPPED"], ["S", "PROBLEM"]],
    field: "problem_count",
    then: "then: problem 1",
    both: "shipped_count",
  },
  {
    id: 14,
    case: "group: daily · add type: order status moves · 1 dispute resolved today",
    path: [...TO_SHIPPING, ["S", "SHIPPED"], ["S", "PROBLEM"], ["S", "COMPLETED"]],
    field: "completed_count",
    then: "then: completed 1",
    both: "problem_count",
  },
];

// Given 14 has a second then beside its `completed 1` (stored verbatim — acceptance_mark.py matches the literal text).
const DISPUTES_RESOLVED_THEN = "then: disputes resolved 1";

const username = (key: string) => `e2eum${key}${SUFFIX}`;

const ground = {
  team: "",
  warehouse: "",
  // given id → its shop
  shops: {} as Record<number, string>,
  // given id → [order A, order B]
  orders: {} as Record<number, [string, string]>,
};

type MoveResult = { moved?: boolean; refusedReason?: string };

async function move(orderId: string, [side, to]: Move, label: string) {
  const res = await asRoot<{ results: MoveResult[] }>("selling.v1.OrderService/OrderStatusChange", {
    teamId: side === "W" ? ground.warehouse : ground.team,
    orderIds: [orderId],
    to: `ORDER_STATUS_${to}`,
    // A hand-back to pending carries its reason (the server holds the move without one).
    note: to === "PENDING" ? `E2E order moves ${label} ${SUFFIX}` : "",
  });
  expect(res.results[0]?.moved, `${label} #${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

async function seed() {
  const team = async (name: string, teamCode: string, type: string) =>
    String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Order Moves Seller ${SUFFIX}`, `UMS${DIGITS}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Order Moves WH ${SUFFIX}`, `UMW${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  await asRoot("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  const users: Record<string, string> = {};
  for (const r of ROLES) {
    const made = await asRoot("user.v1.UserService/CreateUser", {
      teamId: r.side === "selling" ? ground.team : ground.warehouse,
      username: username(r.key),
      password: PASSWORD,
      name: `Order Moves ${r.key} ${SUFFIX}`,
      role: r.role,
    });
    users[r.key] = String(made.user.id);
  }

  // The product's units on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await asRoot("inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `um-${DIGITS}` })).rack.id);
  const category = (await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Order Moves ${SUFFIX}` })).category.id;
  const product = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: `UMK${DIGITS}`,
      name: PRODUCT,
      categoryId: category,
    })
  ).product;
  const account = (
    await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E order moves ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-UM-${SUFFIX}`,
      openingBalance: 0,
      openingOn: today(),
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
    items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count: STOCK, total: STOCK * 10_000 }],
  });
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: STOCK, placements: [{ placementId: rack, quantity: STOCK }] }],
  });

  // GIVEN — per given its shop and its two orders, A walked to the given's state and B to the state A moved from.
  for (const g of GIVENS) {
    const shop = String(
      (
        await asRoot("selling.v1.ShopService/ShopCreate", {
          teamId: ground.team,
          name: `E2E Order Moves Shop ${g.id} ${SUFFIX}`,
          shopCode: `UM${g.id}${DIGITS}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    // Root first — the first grant is the shop's primary CS; the CS on it too.
    await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: ROOT_USER_ID });
    await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: users.scs });
    ground.shops[g.id] = shop;

    const place = async (slot: string) => {
      const ref = `UM${DIGITS}G${g.id}${slot}`;
      const placed = await asRoot("selling.v1.OrderService/OrderCreate", {
        idempotencyKey: `e2e-order-moves-${g.id}-${slot}-${SUFFIX}`,
        shipmentChannelId: "1",
        teamId: ground.team,
        shopId: shop,
        warehouseId: ground.warehouse,
        customerName: `E2E Moves Buyer ${g.id}${slot} ${SUFFIX}`,
        platformTotal: 100_000,
        platformCreatedAtUnix: Math.floor(Date.now() / 1000),
        orderExternalRefId: ref,
        receiptCode: `J${ref}`,
        items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
      });

      return String(placed.order.id);
    };
    const a = await place("A");
    const b = await place("B");
    for (const m of g.path) await move(a, m, `given ${g.id} A`);
    for (const m of g.path.slice(0, -1)) await move(b, m, `given ${g.id} B`);
    ground.orders[g.id] = [a, b];
  }
}

test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await seed();
});

for (const g of GIVENS) {
  test.describe(`selling:all · warehouse:all wants to see statistics (${g.case})`, () => {
    for (const r of ROLES) {
      test(`${r.given} add analytic metric`, async ({ page }) => {
        const shop = ground.shops[g.id]!;
        const day = today();
        const cell = (field: string) => page.getByTestId(`analytic-cell-${day}-${field}`);
        await signInAs(page, username(r.key), PASSWORD, r.side === "selling" ? ground.team : ground.warehouse);

        // WHEN — Analytic by day over the last 7 days, filtered to the given's shop, Order status moves added.
        await page.goto(`/analytic?g=daily&r=7d&shop=${shop}`);
        await expect(page.getByTestId("current-user")).toHaveText(username(r.key));
        await addMetric(page, "order", MOVES);

        await test.step(g.then, async () => {
          // Today's row counts the ONE move; the fold is asynchronous, so the page is reloaded until it lands.
          await expect(async () => {
            await page.reload();
            await expect(cell(g.field)).toHaveText("1", { timeout: 3_000 });
          }).toPass({ timeout: 30_000 });
        });

        if (g.both) {
          await test.step(`regression: the shop's other order, still where order A moved from, is counted in ${g.both} (2) and not in ${g.field}`, async () => {
            await expect.soft(cell(g.both!)).toHaveText("2");
          });
        }
        if (g.id === 14) {
          // Given 14's second then (hfrada, 224a7915): the resolve is also its own Disputes resolved — read on the same
          // row once the fold that made Completed 1 has landed.
          await test.step(DISPUTES_RESOLVED_THEN, async () => {
            await expect(cell("disputes_resolved_count")).toHaveText("1", { timeout: 10_000 });
          });
        }
      });
    }
  });
}

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { addMetric, asRoot, call, login, rupiah, signInAs, today } from "./metric_ground";

// ── add analytic metric, the stock counts — the checks behind docs/acceptances/analytic/inventory_metric.md givens 1–8 ──
//
// add analytic metric's checks for the INVENTORY METRICS on Analytic › Inventory — Restock at the accept, Transfer,
// Returned stock, Ready stock and Lost stock (docs/business/analytic/rpc_provide_decision.md). (Givens 9–14, Restock
// before the accept, are inventory_metric_shows_the_restock_before_the_accept.spec.ts.) An acceptance has no test file of
// its own (docs/acceptances/guide.md): one test.describe per given + when (named as the given, its case in parentheses
// VERBATIM), per role a test — selling:all = owner, admin, cs; warehouse:all = owner, admin, staff — and one
// test.step("then: …") per then, stored verbatim (acceptance_mark.py matches the literal text). A step that is no then
// is named `regression: …`.
//
// Business rules (docs/business/analytic/rpc_provide_decision.md):
// - the-inventory-metrics-prototype-is-accepted — Restock: what the warehouse ACCEPTED onto its racks and what its door
//   found broken or missing, on the accept day; the value accepted is the accepted units at the restock's price.
// - a-transfer-counts-each-side-on-its-own-day — the sender's units on the create day, the receiver's at its accept;
//   what is still on the road is In transit, a position at the period's edge.
// - Returned stock — a return's units back on the shelf and broken at the return warehouse's accept.
// - a-warehouse-sees-no-seller-money — a warehouse reads Restock (and Transfer, Returned stock) in units only: the value
//   fields come back unset, so their columns, sorts and headlines are not drawn.
// - a-warehouse-sees-ready-value-but-a-shelf-only-units — Ready stock's units AND value, for the seller and the warehouse.
// - inventory-lost-counts-the-warehouses-custody-losses / a-warehouse-sees-its-lost-amount — a count's shortage written
//   off as lost and a Stock Adjust "lost", at the batch's price, read by the warehouse that held the stock.
// - inventory-lost-is-gross — a Found claim never subtracts, a past day never changes.
//
// GROUND (beforeAll, as root, through the API from the test runner): one selling team S with a user per selling role;
// a warehouse W with a user per warehouse role, two racks (one only for the count) and a 25% fee — S's return warehouse;
// a second warehouse X that a transfer goes to. Every product is S's, of its own per given (so a product filter reads
// exactly that given), restocked into W at Rp 10.000 a unit and walked to the given's case today:
//   1/2  10 ordered — the door finds 9 in the box, 1 of them broken: 8 good on the rack, 1 broken, 1 missing;
//   3    5 on W's rack — 3 sent to X and accepted there, 2 more sent and shipped, still on the road;
//   4    3 on W's rack — one order of 3, handed to the courier, turned to return; W takes it back: 2 on the rack, 1 broken;
//   5    20 on W's rack;
//   6    5 on the count rack — W counts it (the staff counts 3, root finalizes): 2 lost;
//   7    5 on W's rack — a Stock Adjust "lost" of 1;
//   8    5 on W's rack — a Stock Adjust "lost" of 2, then 1 found on the rack (the staff reports it, root approves).
// Nothing is written after the seed: every role only reads, so the roles share each given's ground.
//
// ⚠ Given 8's loss is "yesterday" in the row; here it is TODAY. The server writes a loss's day at the write
// (inventory_mutations.foldLost, time.Now()) and no RPC back-dates it. The found is approved the same day, after the loss,
// so the rule the then checks — a found never takes a loss back, on its day or on the loss's — is read on today's row.
//
// THE WHEN, as the person does it: Analytic over the last 7 days, filtered to the given's product
// (`?g=daily|warehouse&r=7d&product=<id>`), Add Metric › Inventory › the given's metric, Done. The thens read today's
// row (given 5: the warehouse's row). The figures are written in each stock change's own transaction, but a read is still
// re-loaded until it lands.

const DIGITS = Date.now().toString().slice(-6);
const SUFFIX = `${DIGITS}s`;
const PASSWORD = "e2e-stock-counts-pass-1";
const PER_UNIT = 10_000;

const RESTOCK = "metrics/inventory/restock";
const TRANSFER = "metrics/inventory/transfer";
const RETURN = "metrics/inventory/return";
const READY = "metrics/inventory/ready";
const LOST = "metrics/inventory/lost";

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

// The givens' cases, VERBATIM (· is U+00B7), and their thens.
const G1 = {
  case: "group: daily · add type: restock · restock accepted today: 8 good · 1 broken · 1 missing",
  accepted: "then: accepted 8 with its value",
  broken: "then: broken 1",
  missing: "then: missing 1",
};
const G2 = { case: G1.case, then: "then: value column not shown" };
const G3 = { case: "group: daily · add type: transfer · 5 units sent · 3 received · 2 in transit", then: "then: sent 5, received 3, in transit 2" };
const G4 = {
  case: "group: daily · add type: returned stock · return of 3 units: 2 back on the shelf · 1 broken",
  back: "then: back 2",
  broken: "then: broken 1",
};
const G5 = { case: "group: warehouse · add type: ready stock · 20 units ready", then: "then: 20 units ready with their value" };
const G6 = { case: "group: daily · add type: lost stock · opname finds 2 units lost today", then: "then: lost 2 with their value" };
const G7 = { case: "group: daily · add type: lost stock · 1 unit adjusted as lost today", then: "then: lost 1 with its value" };
const G8 = { case: "group: daily · add type: lost stock · 2 units lost yesterday · 1 found today", then: "then: yesterday still shows lost 2" };

const username = (key: string) => `e2eim${key}${SUFFIX}`;

type Product = { id: string; code: string; name: string };

const ground = {
  team: "",
  warehouse: "", // W
  other: "", // X — a transfer's destination
  rack: "", // W's rack
  countRack: "", // W's rack for given 6's count, and nothing else
  otherRack: "",
  account: "",
  category: "",
  // given id → its product
  products: {} as Record<number, Product>,
};

async function product(id: number): Promise<Product> {
  const name = `Sabun Stok ${id} ${SUFFIX}`;
  const made = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: `IM${id}${DIGITS}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  const p = { id: String(made.id), code: String(made.productCode), name };
  ground.products[id] = p;

  return p;
}

// A restock of `count` units at Rp 10.000 a unit into W, raised today. Returns its request (for the accept).
async function raise(p: Product, count: number) {
  return asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
    financeAccountId: ground.account,
    items: [{ productId: p.id, productCode: p.code, name: p.name, count, total: count * PER_UNIT }],
  });
}

// A product of its own with `count` good units on `rack` in W, accepted today.
async function stocked(id: number, count: number, rack = ground.rack): Promise<Product> {
  const p = await product(id);
  const restock = await raise(p, count);
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: count, placements: [{ placementId: rack, quantity: count }] }],
  });

  return p;
}

async function batchOf(p: Product): Promise<string> {
  const listed = await asRoot<{ ids?: string[] }>("inventory.v1.InventoryService/BatchList", {
    teamId: ground.warehouse,
    filter: { productId: p.id },
    page: { page: 1, limit: 20 },
  });
  expect(listed.ids ?? [], `${p.name}'s batches`).toHaveLength(1);

  return String(listed.ids![0]);
}

async function adjustLost(p: Product, quantity: number) {
  await asRoot("inventory.v1.InventoryService/StockAdjust", {
    warehouseId: ground.warehouse,
    productId: p.id,
    reasonType: "STOCK_ADJUST_REASON_LOST",
    batchId: await batchOf(p),
    quantity,
    rackId: ground.rack,
    reason: `hilang dari rak ${SUFFIX}`,
  });
}

async function move(teamId: string, orderId: string, to: string) {
  const res = await asRoot<{ results: { moved?: boolean; refusedReason?: string }[] }>(
    "selling.v1.OrderService/OrderStatusChange",
    { teamId, orderIds: [orderId], to: `ORDER_STATUS_${to}` },
  );
  expect(res.results[0]?.moved, `order #${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

async function seed() {
  const team = async (name: string, teamCode: string, type: string) =>
    String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Stock Counts Seller ${SUFFIX}`, `IMS${DIGITS}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Stock Counts WH ${SUFFIX}`, `IMW${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  ground.other = await team(`E2E Stock Counts WX ${SUFFIX}`, `IMX${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  await asRoot("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 25, minFee: 0 });

  for (const r of [...SELLING, ...WAREHOUSE]) {
    await asRoot("user.v1.UserService/CreateUser", {
      teamId: r.side === "selling" ? ground.team : ground.warehouse,
      username: username(r.key),
      password: PASSWORD,
      name: `Stock Counts ${r.key} ${SUFFIX}`,
      role: r.role,
    });
  }
  const rack = async (teamId: string, code: string) =>
    String((await asRoot("inventory.v1.RackService/RackCreate", { teamId, code })).rack.id);
  ground.rack = await rack(ground.warehouse, `im-${DIGITS}`);
  ground.countRack = await rack(ground.warehouse, `imc-${DIGITS}`);
  ground.otherRack = await rack(ground.other, `imx-${DIGITS}`);
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Stock Counts ${SUFFIX}` })).category.id);
  ground.account = String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E stock counts ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-IM-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: today(),
      })
    ).account.id,
  );
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.team,
    accountId: ground.account,
    operational: true,
  });

  // GIVENS 1–2 — 10 ordered; the door finds 9 in the box, 1 of them broken: 8 good on the rack.
  const p1 = await product(1);
  const restock = await raise(p1, 10);
  await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [
      {
        itemId: restock.request.items[0].id,
        receivedCount: 9,
        brokenCount: 1,
        brokenNote: `sobek ${SUFFIX}`,
        placements: [{ placementId: ground.rack, quantity: 8 }],
      },
    ],
  });

  // GIVEN 3 — 5 on W's rack: 3 sent to X and accepted there, 2 more sent and shipped, still on the road.
  const p3 = await stocked(3, 5);
  const transfer = async (count: number, tag: string) => {
    const id = String(
      (
        await asRoot("inventory.v1.WarehouseTransferService/WarehouseTransferCreate", {
          teamId: ground.team,
          fromWarehouseId: ground.warehouse,
          toWarehouseId: ground.other,
          lines: [{ productId: p3.id, count: String(count) }],
        })
      ).transfer.id,
    );
    await asRoot("inventory.v1.WarehouseTransferService/WarehouseTransferProcess", { teamId: ground.warehouse, transferId: id });
    await asRoot("inventory.v1.WarehouseTransferService/WarehouseTransferShip", {
      teamId: ground.warehouse,
      transferId: id,
      receipt: `JIM${tag}${DIGITS}`,
    });

    return id;
  };
  const arrived = await transfer(3, "T1");
  const detail = await asRoot<{ transfer: { items: { id: string }[] } }>(
    "inventory.v1.WarehouseTransferService/WarehouseTransferDetail",
    { teamId: ground.other, transferId: arrived },
  );
  await asRoot("inventory.v1.WarehouseTransferService/WarehouseTransferAccept", {
    teamId: ground.other,
    transferId: arrived,
    lines: [{ itemId: detail.transfer.items[0]!.id, arrivedCount: "3", placements: [{ placementId: ground.otherRack, quantity: "3" }] }],
  });
  await transfer(2, "T2");

  // GIVEN 4 — one order of 3, handed to the courier, turned to return; W takes it back: 2 on the rack, 1 broken.
  const p4 = await stocked(4, 3);
  const shop = String(
    (
      await asRoot("selling.v1.ShopService/ShopCreate", {
        teamId: ground.team,
        name: `E2E Stock Counts Shop ${SUFFIX}`,
        shopCode: `IM4${DIGITS}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: ROOT_USER_ID });
  const ref = `IM${DIGITS}G4`;
  const placed = await asRoot("selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-stock-counts-4-${SUFFIX}`,
    shipmentChannelId: "1",
    teamId: ground.team,
    shopId: shop,
    warehouseId: ground.warehouse,
    customerName: `E2E Stock Counts Buyer ${SUFFIX}`,
    platformTotal: 60_000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: ref,
    receiptCode: `J${ref}`,
    items: [{ productId: p4.id, productCode: p4.code, name: p4.name, quantity: 3 }],
  });
  const orderId = String(placed.order.id);
  for (const s of ["PROCESSED", "PICKED", "SHIPPING"]) await move(ground.warehouse, orderId, s);
  await move(ground.team, orderId, "RETURN");
  await asRoot("selling.v1.OrderService/OrderReturnAccept", {
    teamId: ground.warehouse,
    orderId,
    lines: [
      {
        orderItemId: String(placed.order.items[0].id),
        broken: 1,
        note: `pecah ${SUFFIX}`,
        placements: [{ rackId: ground.rack, quantity: 2 }],
      },
    ],
  });

  // GIVEN 5 — 20 on W's rack.
  await stocked(5, 20);

  // GIVEN 7 — a Stock Adjust "lost" of 1.
  await adjustLost(await stocked(7, 5), 1);

  // GIVEN 8 — a Stock Adjust "lost" of 2, then 1 found on the rack: the staff reports it, root approves (never the
  // person who reported it).
  const p8 = await stocked(8, 5);
  await adjustLost(p8, 2);
  const staff = await login(username("wstf"), PASSWORD);
  const found = await call(staff, "inventory.v1.FoundRequestService/FoundRequestCreate", {
    teamId: ground.warehouse,
    productId: p8.id,
    rackId: ground.rack,
    quantity: 1,
    note: `ketemu di belakang kardus ${SUFFIX}`,
  });
  await asRoot("inventory.v1.FoundRequestService/FoundRequestApprove", {
    teamId: ground.warehouse,
    foundRequestId: String(found.foundRequest.id),
  });

  // GIVEN 6 — W counts the count rack: the staff counts 3 of its 5, root finalizes (nobody finalizes their own count).
  const p6 = await stocked(6, 5, ground.countRack);
  const session = String(
    (
      await asRoot("inventory.v1.OpnameService/OpnameSessionCreate", {
        teamId: ground.warehouse,
        plan: "OPNAME_PLAN_PLACEMENT",
        filterPlacementId: ground.countRack,
      })
    ).session.id,
  );
  const rows = await asRoot<{ items: { row?: { mapData: Record<string, { id: string; productId: string }> } }[] }>(
    "inventory.v1.OpnameService/OpnameRowList",
    { teamId: ground.warehouse, filter: { sessionId: session }, page: { page: 1, limit: 50 } },
  );
  const row = rows.items.flatMap((i) => Object.values(i.row?.mapData ?? {})).find((r) => String(r.productId) === p6.id);
  expect(row, "the count's row for given 6's product").toBeTruthy();
  await call(staff, "inventory.v1.OpnameService/OpnameRowCount", { teamId: ground.warehouse, rowId: row!.id, count: 3 });
  await call(staff, "inventory.v1.OpnameService/OpnameRowMarkCounted", {
    teamId: ground.warehouse,
    rowId: row!.id,
    lostNote: `tidak ada di rak, sudah dicari ${SUFFIX}`,
  });
  await asRoot("inventory.v1.OpnameService/OpnameSessionFinalize", { teamId: ground.warehouse, sessionId: session });
}

const sign = (page: Page, r: Role) =>
  signInAs(page, username(r.key), PASSWORD, r.side === "selling" ? ground.team : ground.warehouse);

/** THE WHEN — Analytic over the last 7 days in `group`, filtered to the given's product, `metric` added. */
async function when(page: Page, r: Role, group: "daily" | "warehouse", given: number, metric: string) {
  await page.goto(`/analytic?g=${group}&r=7d&product=${ground.products[given]!.id}`);
  await expect(page.getByTestId("current-user")).toHaveText(username(r.key));
  await addMetric(page, "inventory", metric);
}

/** The cell, re-read (the address now carries the metric) until it reads `want`. */
async function lands(page: Page, testId: string, want: string) {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId(testId)).toHaveText(want, { timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

const day = (field: string) => `analytic-cell-${today()}-${field}`;

test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await seed();
});

// ── 1 · Restock accepted today: 8 good, 1 broken, 1 missing — the seller ────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G1.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      await sign(page, r);
      await when(page, r, "daily", 1, RESTOCK);
      await lands(page, day("accepted_count"), "8");

      await test.step(G1.accepted, async () => {
        await expect.soft(page.getByTestId(day("accepted_count"))).toHaveText("8");
        await expect.soft(page.getByTestId(day("accepted_value"))).toHaveText(rupiah(8 * PER_UNIT));
      });
      await test.step(G1.broken, async () => {
        await expect.soft(page.getByTestId(day("broken_count"))).toHaveText("1");
      });
      await test.step(G1.missing, async () => {
        await expect.soft(page.getByTestId(day("missing_count"))).toHaveText("1");
      });
    });
  }
});

// ── 2 · the same restock — the warehouse ────────────────────────────────────────────────────────────────────────────

test.describe(`warehouse:all wants to see statistics (${G2.case})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      await sign(page, r);
      await when(page, r, "daily", 1, RESTOCK);
      await lands(page, day("accepted_count"), "8");

      await test.step("regression: the warehouse reads the units it took in — 8 good, 1 broken, 1 missing", async () => {
        await expect.soft(page.getByTestId(day("broken_count"))).toHaveText("1");
        await expect.soft(page.getByTestId(day("missing_count"))).toHaveText("1");
      });
      await test.step(G2.then, async () => {
        // No value accepted, ordered or lost — no column, no cell, no sort, no headline card.
        const headings = (await page.getByTestId("analytic-table").locator("thead th").allTextContents()).join(" | ");
        expect.soft(headings).not.toMatch(/value/i);
        for (const f of ["accepted_value", "ordered_value", "lost_value"]) {
          await expect.soft(page.getByTestId(day(f))).toHaveCount(0);
          await expect.soft(page.getByTestId(`analytic-sort-${f}`)).toHaveCount(0);
          await expect.soft(page.getByTestId(`analytic-headline-${f}`)).toHaveCount(0);
        }
      });
    });
  }
});

// ── 3 · Transfer: 5 sent, 3 received, 2 on the road ─────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G3.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      await sign(page, r);
      await when(page, r, "daily", 3, TRANSFER);
      await lands(page, day("sent_count"), "5");

      await test.step(G3.then, async () => {
        await expect.soft(page.getByTestId(day("sent_count"))).toHaveText("5");
        await expect.soft(page.getByTestId(day("received_count"))).toHaveText("3");
        await expect.soft(page.getByTestId(day("in_transit_count"))).toHaveText("2");
      });
    });
  }
});

// ── 4 · Returned stock: a return of 3, 2 back on the shelf, 1 broken ───────────────────────────────────────────────

test.describe(`selling:all wants to see statistics (${G4.case})`, () => {
  for (const r of SELLING) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      await sign(page, r);
      await when(page, r, "daily", 4, RETURN);
      await lands(page, day("back_count"), "2");

      await test.step(G4.back, async () => {
        await expect.soft(page.getByTestId(day("back_count"))).toHaveText("2");
      });
      await test.step(G4.broken, async () => {
        await expect.soft(page.getByTestId(day("broken_count"))).toHaveText("1");
      });
    });
  }
});

// ── 5 · Ready stock by warehouse: 20 units — the seller and the warehouse ──────────────────────────────────────────

test.describe(`selling:all · warehouse:all wants to see statistics (${G5.case})`, () => {
  for (const r of [...SELLING, ...WAREHOUSE]) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      const cell = (field: string) => `analytic-cell-${ground.warehouse}-${field}`;
      await sign(page, r);
      await when(page, r, "warehouse", 5, READY);
      await lands(page, cell("on_hand_count"), "20");

      await test.step(G5.then, async () => {
        await expect.soft(page.getByTestId(cell("on_hand_count"))).toHaveText("20");
        await expect.soft(page.getByTestId(cell("on_hand_value"))).toHaveText(rupiah(20 * PER_UNIT));
      });
    });
  }
});

// ── 6–8 · Lost stock — the warehouse ────────────────────────────────────────────────────────────────────────────────

test.describe(`warehouse:all wants to see statistics (${G6.case})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      await sign(page, r);
      await when(page, r, "daily", 6, LOST);
      await lands(page, day("lost_count"), "2");

      await test.step(G6.then, async () => {
        await expect.soft(page.getByTestId(day("lost_count"))).toHaveText("2");
        await expect.soft(page.getByTestId(day("lost_amount"))).toHaveText(rupiah(2 * PER_UNIT));
      });
    });
  }
});

test.describe(`warehouse:all wants to see statistics (${G7.case})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      await sign(page, r);
      await when(page, r, "daily", 7, LOST);
      await lands(page, day("lost_count"), "1");

      await test.step(G7.then, async () => {
        await expect.soft(page.getByTestId(day("lost_count"))).toHaveText("1");
        await expect.soft(page.getByTestId(day("lost_amount"))).toHaveText(rupiah(PER_UNIT));
      });
    });
  }
});

test.describe(`warehouse:all wants to see statistics (${G8.case})`, () => {
  for (const r of WAREHOUSE) {
    test(`${r.given} add analytic metric`, async ({ page }) => {
      await sign(page, r);
      await when(page, r, "daily", 8, LOST);
      await lands(page, day("lost_count"), "2");

      await test.step(G8.then, async () => {
        // The loss's day (today, see the header) still reads the 2 lost and their value after the found was approved —
        // the found never takes them back (inventory-lost-is-gross).
        await expect.soft(page.getByTestId(day("lost_count"))).toHaveText("2");
        await expect.soft(page.getByTestId(day("lost_amount"))).toHaveText(rupiah(2 * PER_UNIT));
      });
    });
  }
});

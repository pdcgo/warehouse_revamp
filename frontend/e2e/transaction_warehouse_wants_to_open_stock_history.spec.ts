import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { asRoot, call, login, signInAs, today } from "./metric_ground";

// ── open stock history — the checks behind docs/acceptances/inventory/transaction.md givens 1–4 ─────────────────────
//
// Every stock movement is one inventory transaction, and the warehouse reads them on the product's page
// (`/inventories/products/:id`), tab **Stock History** — every movement of the product HERE, newest first: When · What ·
// By · Batch · Place · Change · After (MovementTable, test ids `wp-history-table` / `wp-history-row-<id>`). Business:
// docs/business/inventory/transaction.md. An acceptance has no test file of its own (docs/acceptances/guide.md): one
// test.describe per given + when, its case VERBATIM in parentheses, per role a test — warehouse:all = owner, admin,
// staff — and one test.step("then: …") per then, its text verbatim (acceptance_mark.py matches the literal words). A
// step that is no then is named `regression: …`.
//
// Every then is checked in each role's own test of its given, read on the screen and on the server's StockHistory
// answer under that role's token. Backlog #142 / #143 built the four that were ❌ / 🚧 (the Batch column; the cancel,
// broken, found and price-corrected kinds), so no check is a test.fail any more:
//
//   1 (received by a restock · picked for an order · moved from rack A to rack B · a sample taken)
//     then: every movement listed, newest first, with its kind — Sample, Moved (B +5), Moved (A −5), Picked, Received;
//     then: each with its units, the stock after, who did it, its batch and its rack — the batch is the ONE the restock
//           minted on every row, by two of the decision's cases (#142, a-moves-batch-is-named-only-when-certain): the
//           receive, the take and the sample name the one batch their transaction wrote (one batch → named); the move
//           writes no batch row and names it because the warehouse had only ever held that one batch of the product
//           (a move → named when certain).
//   2 (an order's stock taken · the order then cancelled)
//     then: the cancelled order's units shown coming back, as a cancel — +3, "Cancelled" (MOVEMENT_KIND_CANCEL).
//   3 (1 damaged by adjust · 1 found report approved)
//     then: the damaged unit shown as broken — −1, "Broken" (MOVEMENT_KIND_BROKEN);
//     then: the found unit shown as found — +1, "Found" (MOVEMENT_KIND_FOUND).
//   4 (transferred out · transferred in · returned by a buyer · recounted · price corrected)
//     then: each shown with its own kind — Transferred out, Transferred in, Returned, Counted, and the price correction
//           (a batch row with no rack row, listed since #143 when no kind is asked) as "Price corrected · Rp 10.000 →
//           Rp 11.000", with its reason.
//   5 · filter stock history (product X in batch #12 and batch #13 · filter: batch #12)
//     then: only batch #12's movements — the tab's Batch filter (`wp-history-batch-filter`) set to the first delivery's
//           batch leaves exactly that batch's rows (its receive, a sample, a damaged unit), in the same order, none of
//           the second batch's (its receive, a damaged unit); the server's StockHistory narrowed to that batch lists the
//           same kinds and units. A regression step puts "All batches" back and every row returns.
//   6 · open placement history (10 product X received onto rack A · 10 moved from rack A to rack B · 2 picked from rack
//       B for an order) — the page's other tab, Placement History (`wp-placement-history-table`), product key 7:
//     then: a row: received onto rack A, +10, with who and when — ❌ the tab reads the moves alone, so the receive is
//           not on it (its own test.fail test per role);
//     then: a row: moved from rack A to rack B, 10, with who and when — the move's two legs, rack A −10 and rack B +10,
//           "Moved", by the admin who moved them, at the move's time;
//     then: the 2 picked from rack B not listed here, only in stock history — no Picked row on the tab; the −2 off
//           rack B, by the seller, on Stock History.
//   7 · filter placement history (product X moved on rack A and on rack B · filter: rack B) — product key 8:
//     then: only rack B's movements — the tab's Rack filter (`wp-ph-rack-filter`), picked by rack B's code as a person
//           picks it, leaves exactly rack B's two legs (B +3 of the move A → B, B −1 of the move B → D), each with its
//           rack, units, the rack after and who; none of rack A's, C's or D's (the A → C move, the A → B move's A leg,
//           the D leg, the receipt onto A). A regression step puts "All racks" back and every row returns.
//
// Regressions beside them, read by the warehouse owner:
//   - givens 2–4: the server's kinds in order, with the units and the count after — a cancelled take is CANCEL (it was
//     RETURN), a damaged unit BROKEN and a found one FOUND (both were ADJUST), a buyer's return still RETURN and a
//     recount still ADJUST; given 4's newest row is the price correction (its batch named, no rack);
//   - the Batch column's other cases (#142), on a product of their own with three deliveries: a take crossing two
//     batches off ONE rack reads one row per batch (several that add up → split); a move made once the warehouse has
//     held two batches reads "—" (a move → "—" when not certain); a take drawn by two batches off two racks reads each
//     rack row whole, "—" (several that do not add up).
//
// GROUND (beforeAll, through the API from the test runner): a selling team S (root's) with one person who sells — its
// shop's order taker — and its return warehouse W; W with a person per warehouse role; a second warehouse X a transfer
// goes to and comes back from. Each given has a product of its own, restocked into W at Rp 10.000 a unit, so its
// history holds exactly the given's movements. Given 1's are done by different people, so "who did it" is read per row:
// the warehouse OWNER accepts the restock, the SELLER's order takes 2, the ADMIN moves 5 from rack A to rack B, the STAFF
// hands 1 over as a sample. Every role only reads after that, so the roles share each given's ground.

const DIGITS = Date.now().toString().slice(-6);
const SUFFIX = `${DIGITS}h`;
const PASSWORD = "e2e-stock-history-pass-1";
const PER_UNIT = 10_000;

const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
] as const;
type Key = (typeof ROLES)[number]["key"];

const WHEN = "open stock history";
const PURPOSE = "warehouse:all wants to know what happened to a product's stock";

// The givens' cases, VERBATIM (· is U+00B7), and their thens.
const G1 = {
  case: "product X · received by a restock · picked for an order · moved from rack A to rack B · a sample taken",
  listed: "then: every movement listed, newest first, with its kind: received, picked, moved, sample",
  each: "then: each with its units, the stock after, who did it, its batch and its rack",
};
const G2 = {
  case: "product X · an order's stock taken · the order then cancelled",
  then: "then: the cancelled order's units shown coming back, as a cancel",
};
const G3 = {
  case: "product X · 1 damaged by adjust · 1 found report approved",
  broken: "then: the damaged unit shown as broken",
  found: "then: the found unit shown as found",
};
const G4 = {
  case:
    "product X · transferred out to another warehouse · transferred in from another warehouse · returned by a buyer · recounted · price corrected",
  then: "then: each shown with its own kind: transferred out, transferred in, returned, counted, price corrected",
};
// Given 5's when is its own: the same tab, filtered. Its product is key 6 below (key 5 is the Batch column's regression).
const WHEN5 = "filter stock history";
const G5 = {
  case: "product X in batch #12 and batch #13 · filter: batch #12",
  then: "then: only batch #12's movements",
};
// Given 6's when is the page's other tab, Placement History. Its product is key 7.
const WHEN6 = "open placement history";
const G6 = {
  case: "10 product X received onto rack A · 10 moved from rack A to rack B · 2 picked from rack B for an order",
  received: "then: a row: received onto rack A, +10, with who and when",
  moved: "then: a row: moved from rack A to rack B, 10, with who and when",
  picked: "then: the 2 picked from rack B not listed here, only in stock history",
};
// Given 7's when is Placement History, filtered by rack. Its product is key 8.
const WHEN7 = "filter placement history";
const G7 = {
  case: "product X moved on rack A and on rack B · filter: rack B",
  then: "then: only rack B's movements",
};

// A username is lowercase letters and digits only.
const username = (key: string) => `e2etsh${key}${DIGITS}`;
const personName = (key: string) => `Riwayat ${key} ${SUFFIX}`;

type Product = { id: string; code: string; name: string };

interface Movement {
  id: string;
  kind: string;
  delta?: string;
  balance?: string;
  rackId?: string;
  batchId?: string;
  actorUserId?: string;
  createdAt?: string;
  priceUnitBefore?: number;
  priceUnitAfter?: number;
  reason?: string;
}

const ground = {
  seller: "",
  warehouse: "", // W
  other: "", // X
  shop: "",
  account: "",
  category: "",
  sellerUser: "",
  users: {} as Record<Key, string>,
  racks: {} as Record<string, { id: string; code: string }>,
  otherRack: "",
  products: {} as Record<number, Product>,
  batch: {} as Record<number, string>, // given → its (first) restock's batch in W
  batches5: [] as string[], // the batch column's regression: its three deliveries' batches, oldest first
  batches6: [] as string[], // given 5: batch "#12" (the first delivery) and batch "#13" (the second)
};

const rackCode = (tag: string) => `tsh-${tag}-${DIGITS}`;

async function product(given: number): Promise<Product> {
  const name = `Sabun Riwayat ${given} ${SUFFIX}`;
  const made = (
    await asRoot("product.v1.ProductService/ProductCreate", {
      teamId: ground.seller,
      productCodePart: `TSH${given}${DIGITS}`,
      name,
      categoryId: ground.category,
    })
  ).product;
  const p = { id: String(made.id), code: String(made.productCode), name };
  ground.products[given] = p;

  return p;
}

/** The product's batches in W. */
async function batchIds(p: Product): Promise<string[]> {
  const listed = await asRoot<{ ids?: string[] }>("inventory.v1.InventoryService/BatchList", {
    teamId: ground.warehouse,
    filter: { productId: p.id },
    page: { page: 1, limit: 20 },
  });

  return (listed.ids ?? []).map(String);
}

// `count` units of `p` received into W onto `rack`, the restock accepted by `acceptor` (root by default) — and the ONE
// batch it minted.
async function restock(p: Product, count: number, rack: string, acceptor?: string): Promise<string> {
  const before = await batchIds(p);
  const made = await asRoot("inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.seller,
    warehouseId: ground.warehouse,
    financeAccountId: ground.account,
    items: [{ productId: p.id, productCode: p.code, name: p.name, count, total: count * PER_UNIT }],
  });
  const accept = {
    teamId: ground.warehouse,
    requestId: made.request.id,
    lines: [{ itemId: made.request.items[0].id, receivedCount: count, placements: [{ placementId: rack, quantity: count }] }],
  };
  if (acceptor) await call(acceptor, "inventory.v1.RestockRequestService/RestockRequestAccept", accept);
  else await asRoot("inventory.v1.RestockRequestService/RestockRequestAccept", accept);

  const minted = (await batchIds(p)).filter((id) => !before.includes(id));
  expect(minted, `${p.name}: the batch its restock of ${count} minted`).toHaveLength(1);

  return minted[0]!;
}

// The given's product, its first `count` units received into W onto `rack` — and the batch that minted.
async function stocked(given: number, count: number, rack: string, acceptor?: string): Promise<Product> {
  const p = await product(given);
  ground.batch[given] = await restock(p, count, rack, acceptor);

  return p;
}

async function orderOf(p: Product, quantity: number, tag: string, token?: string) {
  const body = {
    idempotencyKey: `e2e-stock-history-${tag}-${SUFFIX}`,
    shipmentChannelId: "1",
    teamId: ground.seller,
    shopId: ground.shop,
    warehouseId: ground.warehouse,
    customerName: `E2E Riwayat Buyer ${tag} ${SUFFIX}`,
    platformTotal: 50_000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `TSH${tag}${DIGITS}`,
    receiptCode: `JTSH${tag}${DIGITS}`,
    items: [{ productId: p.id, productCode: p.code, name: p.name, quantity }],
  };
  const placed = token ? await call(token, "selling.v1.OrderService/OrderCreate", body) : await asRoot("selling.v1.OrderService/OrderCreate", body);

  return placed.order as { id: string; items: { id: string }[] };
}

async function moveOrder(teamId: string, orderId: string, to: string) {
  const res = await asRoot<{ results: { moved?: boolean; refusedReason?: string }[] }>("selling.v1.OrderService/OrderStatusChange", {
    teamId,
    orderIds: [orderId],
    to: `ORDER_STATUS_${to}`,
  });
  expect(res.results[0]?.moved, `order #${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

// A warehouse transfer of `count` units of `p`, from → to, walked to the receiver's accept onto `toRack`.
async function transfer(p: Product, count: number, from: string, to: string, toRack: string, tag: string) {
  const id = String(
    (
      await asRoot("inventory.v1.WarehouseTransferService/WarehouseTransferCreate", {
        teamId: ground.seller,
        fromWarehouseId: from,
        toWarehouseId: to,
        lines: [{ productId: p.id, count: String(count) }],
      })
    ).transfer.id,
  );
  await asRoot("inventory.v1.WarehouseTransferService/WarehouseTransferProcess", { teamId: from, transferId: id });
  await asRoot("inventory.v1.WarehouseTransferService/WarehouseTransferShip", {
    teamId: from,
    transferId: id,
    receipt: `JTSH${tag}${DIGITS}`,
  });
  const detail = await asRoot<{ transfer: { items: { id: string }[] } }>("inventory.v1.WarehouseTransferService/WarehouseTransferDetail", {
    teamId: to,
    transferId: id,
  });
  await asRoot("inventory.v1.WarehouseTransferService/WarehouseTransferAccept", {
    teamId: to,
    transferId: id,
    lines: [{ itemId: detail.transfer.items[0]!.id, arrivedCount: String(count), placements: [{ placementId: toRack, quantity: String(count) }] }],
  });
}

// The product's Stock History in W, as `token` reads it — in the server's order (the screen's). With `batchId`, the
// server's own batch narrowing (batchHistory: the batch's rows, each with its rack).
async function history(token: string, productId: string, batchId?: string): Promise<Movement[]> {
  const res = await call<{ ids?: string[]; items?: { movement?: { mapData: Record<string, Movement> } }[] }>(
    token,
    "inventory.v1.InventoryService/StockHistory",
    {
      warehouseId: ground.warehouse,
      filter: batchId ? { productId, batchId } : { productId },
      dataRequest: ["STOCK_HISTORY_DATA_TYPE_MOVEMENT"],
      page: { page: 1, limit: 50 },
    },
  );
  const byId: Record<string, Movement> = Object.assign({}, ...(res.items ?? []).map((it) => it.movement?.mapData ?? {}));

  return (res.ids ?? []).map((id) => byId[String(id)]!).filter(Boolean);
}

async function seed() {
  const team = async (name: string, teamCode: string, type: string) =>
    String((await asRoot("team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.seller = await team(`E2E Riwayat Seller ${SUFFIX}`, `TSHS${DIGITS}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Riwayat WH ${SUFFIX}`, `TSHW${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  ground.other = await team(`E2E Riwayat WX ${SUFFIX}`, `TSHX${DIGITS}`, "TEAM_TYPE_WAREHOUSE");
  await asRoot("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.seller,
    warehouseId: ground.warehouse,
  });
  await asRoot("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  for (const r of ROLES) {
    ground.users[r.key] = String(
      (
        await asRoot("user.v1.UserService/CreateUser", {
          teamId: ground.warehouse,
          username: username(r.key),
          password: PASSWORD,
          name: personName(r.key),
          role: r.role,
        })
      ).user.id,
    );
  }
  ground.sellerUser = String(
    (
      await asRoot("user.v1.UserService/CreateUser", {
        teamId: ground.seller,
        username: username("sel"),
        password: PASSWORD,
        name: personName("sel"),
        role: "ROLE_SELLING_OWNER",
      })
    ).user.id,
  );
  ground.shop = String(
    (
      await asRoot("selling.v1.ShopService/ShopCreate", {
        teamId: ground.seller,
        name: `E2E Riwayat Shop ${SUFFIX}`,
        shopCode: `TSHP${DIGITS}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  for (const userId of [ROOT_USER_ID, ground.sellerUser]) {
    await asRoot("selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: ground.shop, userId });
  }

  const rack = async (teamId: string, tag: string) => {
    const code = rackCode(tag);
    return { id: String((await asRoot("inventory.v1.RackService/RackCreate", { teamId, code })).rack.id), code };
  };
  for (const tag of ["a", "b", "c", "d", "e"]) ground.racks[tag] = await rack(ground.warehouse, tag);
  ground.otherRack = (await rack(ground.other, "x")).id;
  ground.category = String((await asRoot("category.v1.CategoryService/CategoryCreate", { name: `E2E Riwayat ${SUFFIX}` })).category.id);
  ground.account = String(
    (
      await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E riwayat ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-TSH-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: today(),
      })
    ).account.id,
  );
  await asRoot("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.seller,
    accountId: ground.account,
    operational: true,
  });

  const token = {
    own: await login(username("own"), PASSWORD),
    adm: await login(username("adm"), PASSWORD),
    stf: await login(username("stf"), PASSWORD),
    sel: await login(username("sel"), PASSWORD),
  };

  // GIVEN 1 — 10 received onto rack A (the warehouse owner accepts), 2 taken by the seller's order, 5 moved from rack A
  // to rack B (the admin), 1 handed over from rack B as a sample (the staff). One delivery, so one batch all along.
  const p1 = await stocked(1, 10, ground.racks.a!.id, token.own);
  await orderOf(p1, 2, "G1", token.sel);
  await call(token.adm, "inventory.v1.RackService/RackMove", {
    teamId: ground.warehouse,
    fromRackId: ground.racks.a!.id,
    lines: [{ productId: p1.id, quantity: 5, toRackId: ground.racks.b!.id }],
  });
  await call(token.stf, "inventory.v1.RackService/RackSample", {
    teamId: ground.warehouse,
    rackId: ground.racks.b!.id,
    lines: [{ productId: p1.id, quantity: 1 }],
    recipient: "Pak Budi",
    description: `untuk foto produk ${SUFFIX}`,
  });

  // GIVEN 2 — 10 on rack C; an order takes 3, then the seller cancels it: inventory puts the 3 back when it hears
  // OrderCancelled (inventory-returns-stock-on-order-cancelled), so the row is polled.
  const p2 = await stocked(2, 10, ground.racks.c!.id);
  const cancelled = await orderOf(p2, 3, "G2");
  await asRoot("selling.v1.OrderService/OrderCancel", { teamId: ground.seller, orderId: cancelled.id });
  const reader = token.own;
  await expect
    .poll(async () => (await history(reader, p2.id)).filter((m) => Number(m.delta ?? 0) === 3).length, {
      message: "the cancelled order's 3 back on rack C",
      timeout: 45_000,
    })
    .toBe(1);

  // GIVEN 3 — 10 on rack D; 1 found damaged (Stock Adjust, Damaged, by the admin), then 1 reported found on rack D by
  // the staff and approved by the owner (never the person who reported it).
  const p3 = await stocked(3, 10, ground.racks.d!.id);
  await call(token.adm, "inventory.v1.InventoryService/StockAdjust", {
    warehouseId: ground.warehouse,
    productId: p3.id,
    reasonType: "STOCK_ADJUST_REASON_DAMAGED",
    batchId: ground.batch[3],
    quantity: 1,
    rackId: ground.racks.d!.id,
    reason: `kardus basah ${SUFFIX}`,
  });
  const found = await call(token.stf, "inventory.v1.FoundRequestService/FoundRequestCreate", {
    teamId: ground.warehouse,
    productId: p3.id,
    rackId: ground.racks.d!.id,
    quantity: 1,
    note: `ketemu di belakang kardus ${SUFFIX}`,
  });
  await call(token.own, "inventory.v1.FoundRequestService/FoundRequestApprove", {
    teamId: ground.warehouse,
    foundRequestId: String(found.foundRequest.id),
  });

  // GIVEN 4 — 10 on rack E; 3 sent to X (accepted there), 2 of them sent back and accepted onto rack E, an order of 2
  // handed to the courier and returned by the buyer (both back on rack E), rack E recounted 9 → 8, and the restock's
  // batch corrected from Rp 10.000 to Rp 11.000 by the owning team.
  const p4 = await stocked(4, 10, ground.racks.e!.id);
  await transfer(p4, 3, ground.warehouse, ground.other, ground.otherRack, "T1");
  await transfer(p4, 2, ground.other, ground.warehouse, ground.racks.e!.id, "T2");
  const returned = await orderOf(p4, 2, "G4");
  for (const s of ["PROCESSED", "PICKED", "SHIPPING"]) await moveOrder(ground.warehouse, returned.id, s);
  await moveOrder(ground.seller, returned.id, "RETURN");
  await asRoot("selling.v1.OrderService/OrderReturnAccept", {
    teamId: ground.warehouse,
    orderId: returned.id,
    lines: [{ orderItemId: String(returned.items[0]!.id), placements: [{ rackId: ground.racks.e!.id, quantity: 2 }] }],
  });
  await expect
    .poll(async () => (await history(reader, p4.id)).find((m) => m.kind === "MOVEMENT_KIND_RETURN")?.delta, {
      message: "the buyer's return back on rack E",
      timeout: 45_000,
    })
    .toBe("2");
  await asRoot("inventory.v1.InventoryService/StockAdjust", {
    warehouseId: ground.warehouse,
    productId: p4.id,
    reasonType: "STOCK_ADJUST_REASON_RECOUNT",
    onHand: 8,
    rackId: ground.racks.e!.id,
    reason: `hitung ulang rak E ${SUFFIX}`,
  });
  await asRoot("inventory.v1.InventoryService/BatchRevalue", {
    teamId: ground.seller,
    batchId: ground.batch[4],
    expectedPriceUnit: PER_UNIT,
    newPriceUnit: 11_000,
    reason: `harga supplier naik ${SUFFIX}`,
  });

  // PRODUCT 5 — the Batch column's other cases (#142, a regression): b1 10 and b2 5 onto rack A; an order takes 12 off
  // rack A, its only rack (b1's 10, then b2's 2 — one rack row, two batches adding up to it); the admin moves 1 from
  // rack A to rack B (two batches held by then); b3 5 onto rack A; an order takes 4 — rack B's 1 first (the fewest),
  // then 3 off rack A — out of b2's last 3 and b3's 1: two racks drawn by two batches.
  const p5 = await stocked(5, 10, ground.racks.a!.id);
  ground.batches5.push(ground.batch[5]!, await restock(p5, 5, ground.racks.a!.id));
  await orderOf(p5, 12, "R5A");
  await call(token.adm, "inventory.v1.RackService/RackMove", {
    teamId: ground.warehouse,
    fromRackId: ground.racks.a!.id,
    lines: [{ productId: p5.id, quantity: 1, toRackId: ground.racks.b!.id }],
  });
  ground.batches5.push(await restock(p5, 5, ground.racks.a!.id));
  await orderOf(p5, 4, "R5B");

  // GIVEN 5 (product key 6) — two deliveries, every row's batch certain: 10 onto rack A (the owner accepts → batch
  // "#12"); 1 handed over off rack A as a sample by the staff while that is the only batch held; 5 onto rack B (→ batch
  // "#13"); then the admin finds 1 damaged on rack B from batch #13 and 1 on rack A from batch #12 (Stock Adjust names
  // the batch). Batch #12: receive, sample, broken · batch #13: receive, broken. No move: a move once two batches are
  // held names none (a-moves-batch-is-named-only-when-certain), and this given is about rows that are a batch's.
  const p6 = await stocked(6, 10, ground.racks.a!.id, token.own);
  await call(token.stf, "inventory.v1.RackService/RackSample", {
    teamId: ground.warehouse,
    rackId: ground.racks.a!.id,
    lines: [{ productId: p6.id, quantity: 1 }],
    recipient: "Bu Sari",
    description: `contoh untuk toko ${SUFFIX}`,
  });
  ground.batches6.push(ground.batch[6]!, await restock(p6, 5, ground.racks.b!.id));
  for (const [rack, batch, why] of [
    [ground.racks.b!.id, ground.batches6[1]!, "segel rusak"],
    [ground.racks.a!.id, ground.batches6[0]!, "botol bocor"],
  ] as const) {
    await call(token.adm, "inventory.v1.InventoryService/StockAdjust", {
      warehouseId: ground.warehouse,
      productId: p6.id,
      reasonType: "STOCK_ADJUST_REASON_DAMAGED",
      batchId: batch,
      quantity: 1,
      rackId: rack,
      reason: `${why} ${SUFFIX}`,
    });
  }

  // GIVEN 6 (product key 7) — 10 received onto rack A (the warehouse owner accepts), all 10 moved from rack A to rack B
  // (the admin), then the seller's order takes 2 — off rack B, the only rack holding any by then.
  const p7 = await stocked(7, 10, ground.racks.a!.id, token.own);
  await call(token.adm, "inventory.v1.RackService/RackMove", {
    teamId: ground.warehouse,
    fromRackId: ground.racks.a!.id,
    lines: [{ productId: p7.id, quantity: 10, toRackId: ground.racks.b!.id }],
  });
  await orderOf(p7, 2, "G6", token.sel);

  // GIVEN 7 (product key 8) — moved on rack A and on rack B: 10 received onto rack A (the owner accepts); the admin
  // moves 4 from rack A to rack C (rack A's, not B's), then 3 from rack A to rack B (a leg on each); the staff moves 1
  // from rack B to rack D (rack B's). Rack B's movements: its +3 and its −1 — and no receipt is rack B's, so the
  // filtered rows are the same once the tab lists receipts too (given 6's ❌).
  const p8 = await stocked(8, 10, ground.racks.a!.id, token.own);
  for (const [who, from, to, quantity] of [
    [token.adm, "a", "c", 4],
    [token.adm, "a", "b", 3],
    [token.stf, "b", "d", 1],
  ] as const) {
    await call(who, "inventory.v1.RackService/RackMove", {
      teamId: ground.warehouse,
      fromRackId: ground.racks[from]!.id,
      lines: [{ productId: p8.id, quantity, toRackId: ground.racks[to]!.id }],
    });
  }
}

/** THE WHEN — open stock history: the product's page in W, its Stock History tab. */
async function openStockHistory(page: Page, r: (typeof ROLES)[number], given: number) {
  await signInAs(page, username(r.key), PASSWORD, ground.warehouse);
  await page.goto(`/inventories/products/${ground.products[given]!.id}`);
  await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
  await page.getByTestId("wp-tab-history").click();
  await expect(page.getByTestId("wp-history-table")).toBeVisible();
}

// The screen's rows, top to bottom — each row's own cells (When · What · By · Batch · Place · Change · After).
const screenRows = (page: Page) => page.getByTestId("wp-history-table").locator("tbody > tr");
const cellsOf = (page: Page, movementId: string): Locator => page.getByTestId(`wp-history-row-${movementId}`).locator(":scope > td");
const WHAT = 1,
  BY = 2,
  BATCH = 3,
  PLACE = 4,
  CHANGE = 5,
  AFTER = 6;

/** The movement ids in the order the screen lists them. */
async function screenIds(page: Page): Promise<string[]> {
  const ids = await screenRows(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-testid") ?? ""));
  return ids.map((t) => t.replace(/^wp-history-row-/, ""));
}

const change = (delta: string | undefined) => {
  const n = Number(delta ?? 0);
  return n > 0 ? `+${n}` : String(n);
};

/** The Batch cell for a batch id — `#id`, or "—" where none is named (0, dropped from the JSON). */
const batchCell = (batchId: string | undefined) => (batchId && batchId !== "0" ? `#${batchId}` : "—");

test.describe.configure({ timeout: 90_000 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await seed();
});

// ── 1 · received · picked · moved A → B · a sample ──────────────────────────────────────────────────────────────

// Newest first, as seeded: the sample off rack B, the move's two legs (B +5, A −5 — one kind, both in this warehouse),
// the order's take off rack A, the restock onto rack A. Each with the place's count after it and the person who did it.
const G1_ROWS = [
  { kind: "MOVEMENT_KIND_SAMPLE", word: "Sample", rack: "b", delta: "-1", after: "4", by: "stf" },
  { kind: "MOVEMENT_KIND_MOVE", word: "Moved", rack: "b", delta: "5", after: "5", by: "adm" },
  { kind: "MOVEMENT_KIND_MOVE", word: "Moved", rack: "a", delta: "-5", after: "3", by: "adm" },
  { kind: "MOVEMENT_KIND_PICK", word: "Picked", rack: "a", delta: "-2", after: "8", by: "sel" },
  { kind: "MOVEMENT_KIND_RECEIVE", word: "Received", rack: "a", delta: "10", after: "10", by: "own" },
] as const;

/** Given 1's server rows matched to G1_ROWS by kind + rack (the two move legs are told apart by their rack). */
function matchG1(rows: Movement[]) {
  return G1_ROWS.map((w) => rows.find((m) => m.kind === w.kind && String(m.rackId) === ground.racks[w.rack]!.id));
}

test.describe(`${PURPOSE} (${G1.case})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${G1.case})`, async ({ page }) => {
      await openStockHistory(page, r, 1);
      const rows = await history(await login(username(r.key), PASSWORD), ground.products[1]!.id);
      const matched = matchG1(rows);

      await test.step(G1.listed, async () => {
        // The ledger, under the role's own token: exactly the five, newest first.
        expect.soft(rows.map((m) => m.kind)).toEqual(G1_ROWS.map((w) => w.kind));
        expect.soft(matched.every(Boolean), "every movement of the given on the ledger").toBe(true);
        // The screen: the same five, in the same order, each with its kind.
        await expect.soft(screenRows(page)).toHaveCount(G1_ROWS.length);
        expect.soft(await screenIds(page)).toEqual(rows.map((m) => String(m.id)));
        await expect.soft(page.getByTestId("wp-history-table").getByRole("columnheader")).toHaveText([
          "When",
          "What",
          "By",
          "Batch",
          "Place",
          "Change",
          "After",
        ]);
        for (const [i, w] of G1_ROWS.entries()) {
          await expect.soft(screenRows(page).nth(i).locator(":scope > td").nth(WHAT), `row ${i + 1}: ${w.word}`).toContainText(w.word);
        }
      });

      // The batch on every row is the one the restock minted: the receive, the take and the sample by the one batch
      // their transaction wrote; the move's two legs because W had only ever held that batch of the product.
      await test.step(G1.each, async () => {
        for (const [i, w] of G1_ROWS.entries()) {
          const m = matched[i];
          expect.soft(m, `${w.word} ${w.rack} on the ledger`).toBeDefined();
          if (!m) continue;
          expect.soft(m.delta, `${w.word} ${w.rack}: units`).toBe(w.delta);
          expect.soft(m.balance, `${w.word} ${w.rack}: after`).toBe(w.after);
          const want = w.by === "sel" ? ground.sellerUser : ground.users[w.by];
          expect.soft(String(m.actorUserId), `${w.word} ${w.rack}: who`).toBe(want);
          expect.soft(String(m.batchId), `${w.word} ${w.rack}: batch on the ledger`).toBe(ground.batch[1]);
          const cells = cellsOf(page, String(m.id));
          await expect.soft(cells.nth(CHANGE)).toHaveText(change(w.delta));
          await expect.soft(cells.nth(AFTER)).toHaveText(w.after);
          await expect.soft(cells.nth(BY)).toHaveText(personName(w.by));
          await expect.soft(cells.nth(BATCH), `${w.word} ${w.rack}: batch`).toHaveText(`#${ground.batch[1]}`);
          await expect.soft(cells.nth(PLACE)).toHaveText(ground.racks[w.rack]!.code);
        }
      });
    });
  }
});

// ── the Batch column's other cases — several batches in the warehouse (#142) ──────────────────────────────────────

// Product 5's rows, newest first: [kind, rack, units, rack's count after, batch (0 = "—")]. The second take's two rack
// rows land in one transaction; their order between them is not pinned.
const B = (i: number) => ground.batches5[i]!;
const G5_ROWS = () =>
  [
    // a take drawn by two batches (b2's 3, b3's 1) off two racks (B's 1, A's 3): which rack fed which batch is not
    // recorded — each rack row whole, "—"
    ["MOVEMENT_KIND_PICK", "a", "-3", "4", "0"],
    ["MOVEMENT_KIND_PICK", "b", "-1", "0", "0"],
    ["MOVEMENT_KIND_RECEIVE", "a", "5", "7", B(2)],
    // a move once W has held two batches of the product: whose units it carried is not certain — "—"
    ["MOVEMENT_KIND_MOVE", "b", "1", "1", "0"],
    ["MOVEMENT_KIND_MOVE", "a", "-1", "2", "0"],
    // a take crossing from b1 into b2 off its one rack: one row per batch, each with the rack's count after its part
    ["MOVEMENT_KIND_PICK", "a", "-2", "3", B(1)],
    ["MOVEMENT_KIND_PICK", "a", "-10", "5", B(0)],
    ["MOVEMENT_KIND_RECEIVE", "a", "5", "15", B(1)],
    ["MOVEMENT_KIND_RECEIVE", "a", "10", "10", B(0)],
  ] as const;

const rackTag = (rackId: string | undefined) => Object.entries(ground.racks).find(([, r]) => r.id === String(rackId))?.[0] ?? `#${rackId}`;
const g5Row = (m: Movement) => [m.kind, rackTag(m.rackId), m.delta ?? "0", m.balance ?? "0", m.batchId ?? "0"].join(" ");

test.describe(`regression: ${WHEN} — a row's batch when the warehouse holds several`, () => {
  test("regression: a take over two batches off one rack is a row per batch; a move after a second batch and a take of two batches off two racks read —", async ({
    page,
  }) => {
    const r = ROLES[0];
    await openStockHistory(page, r, 5);
    const rows = await history(await login(username(r.key), PASSWORD), ground.products[5]!.id);
    const want = G5_ROWS().map((w) => w.join(" "));
    const got = rows.map(g5Row);

    // The ledger: nine rows, the split take's two parts counted as rows.
    expect.soft([...got.slice(0, 2)].sort(), "the second take's two rack rows").toEqual([...want.slice(0, 2)].sort());
    expect.soft(got.slice(2), "the rest, newest first").toEqual(want.slice(2));

    // The screen: the same rows in the same order, every id once, each row's batch, place, units and count after.
    await expect.soft(screenRows(page)).toHaveCount(want.length);
    const ids = await screenIds(page);
    expect.soft(ids).toEqual(rows.map((m) => String(m.id)));
    expect.soft(new Set(ids).size, "every row's id once").toBe(ids.length);
    for (const m of rows) {
      const cells = cellsOf(page, String(m.id));
      const what = g5Row(m);
      await expect.soft(cells.nth(BATCH), `${what}: batch`).toHaveText(batchCell(m.batchId));
      await expect.soft(cells.nth(PLACE), `${what}: place`).toHaveText(ground.racks[rackTag(m.rackId)]?.code ?? "?");
      await expect.soft(cells.nth(CHANGE), `${what}: change`).toHaveText(change(m.delta));
      await expect.soft(cells.nth(AFTER), `${what}: after`).toHaveText(m.balance ?? "0");
    }
  });
});

// ── 2 · an order's take, then the order cancelled ───────────────────────────────────────────────────────────────

test.describe(`${PURPOSE} (${G2.case})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${G2.case})`, async ({ page }) => {
      await openStockHistory(page, r, 2);
      const rows = await history(await login(username(r.key), PASSWORD), ground.products[2]!.id);

      await test.step(G2.then, async () => {
        const back = rows[0];
        expect.soft(back?.delta, "the newest row: the 3 coming back").toBe("3");
        expect.soft(back?.kind, "the newest row: a cancel").toBe("MOVEMENT_KIND_CANCEL");
        const cells = cellsOf(page, String(back?.id));
        await expect.soft(cells.nth(CHANGE)).toHaveText("+3");
        await expect.soft(cells.nth(AFTER)).toHaveText("10");
        await expect.soft(cells.nth(WHAT), "named as a cancel").toHaveText("Cancelled");
      });
    });
  }

  test(`regression: ${PURPOSE} (${G2.case}) — the cancelled order's 3 come back onto rack C as a cancel`, async ({ page }) => {
    const r = ROLES[0];
    await openStockHistory(page, r, 2);
    const rows = await history(await login(username(r.key), PASSWORD), ground.products[2]!.id);
    // A cancelled take reads as CANCEL since #143 (it read as RETURN) — and, one delivery, every row names its batch.
    expect.soft(rows.map((m) => [m.kind, m.delta, m.balance, m.batchId])).toEqual([
      ["MOVEMENT_KIND_CANCEL", "3", "10", ground.batch[2]],
      ["MOVEMENT_KIND_PICK", "-3", "7", ground.batch[2]],
      ["MOVEMENT_KIND_RECEIVE", "10", "10", ground.batch[2]],
    ]);
    await expect.soft(screenRows(page)).toHaveCount(3);
    const cells = cellsOf(page, String(rows[0]?.id));
    await expect.soft(cells.nth(CHANGE)).toHaveText("+3");
    await expect.soft(cells.nth(PLACE)).toHaveText(ground.racks.c!.code);
    await expect.soft(cells.nth(BATCH)).toHaveText(`#${ground.batch[2]}`);
    await expect.soft(cellsOf(page, String(rows[1]?.id)).nth(WHAT)).toContainText("Picked");
  });
});

// ── 3 · 1 damaged by adjust, 1 found report approved ────────────────────────────────────────────────────────────

test.describe(`${PURPOSE} (${G3.case})`, () => {
  // Newest first: the found +1 (rack D 10), the damaged −1 (rack D 9), the restock +10.
  const rowOf = (rows: Movement[], delta: string) => rows.find((m) => m.delta === delta && m.kind !== "MOVEMENT_KIND_RECEIVE");

  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${G3.case})`, async ({ page }) => {
      await openStockHistory(page, r, 3);
      const rows = await history(await login(username(r.key), PASSWORD), ground.products[3]!.id);

      await test.step(G3.broken, async () => {
        const broken = rowOf(rows, "-1");
        expect.soft(broken, "the damaged unit on the ledger").toBeDefined();
        expect.soft(broken?.kind, "the damaged unit: broken").toBe("MOVEMENT_KIND_BROKEN");
        const cells = cellsOf(page, String(broken?.id));
        await expect.soft(cells.nth(CHANGE)).toHaveText("-1");
        await expect.soft(cells.nth(WHAT), "named as broken").toHaveText("Broken");
      });

      await test.step(G3.found, async () => {
        const found = rowOf(rows, "1");
        expect.soft(found, "the found unit on the ledger").toBeDefined();
        expect.soft(found?.kind, "the found unit: found").toBe("MOVEMENT_KIND_FOUND");
        const cells = cellsOf(page, String(found?.id));
        await expect.soft(cells.nth(CHANGE)).toHaveText("+1");
        await expect.soft(cells.nth(WHAT), "named as found").toHaveText("Found");
      });
    });
  }

  test(`regression: ${PURPOSE} (${G3.case}) — the damaged −1 and the found +1 are on rack D`, async ({ page }) => {
    const r = ROLES[0];
    await openStockHistory(page, r, 3);
    const rows = await history(await login(username(r.key), PASSWORD), ground.products[3]!.id);
    // A damaged unit reads as BROKEN and a found one as FOUND since #143 (both read as ADJUST).
    expect.soft(rows.map((m) => [m.kind, m.delta, m.balance])).toEqual([
      ["MOVEMENT_KIND_FOUND", "1", "10"],
      ["MOVEMENT_KIND_BROKEN", "-1", "9"],
      ["MOVEMENT_KIND_RECEIVE", "10", "10"],
    ]);
    expect.soft(String(rows[1]?.actorUserId), "the damaged: the admin who adjusted it").toBe(ground.users.adm);
    await expect.soft(screenRows(page)).toHaveCount(3);
    await expect.soft(cellsOf(page, String(rows[0]?.id)).nth(CHANGE)).toHaveText("+1");
    await expect.soft(cellsOf(page, String(rows[1]?.id)).nth(CHANGE)).toHaveText("-1");
    await expect.soft(cellsOf(page, String(rows[1]?.id)).nth(PLACE)).toHaveText(ground.racks.d!.code);
  });
});

// ── 4 · transferred out, transferred in, returned by a buyer, recounted, price corrected ────────────────────────────

// Each unit-moving kind the then names, the word the screen says for it, and the units it moved on rack E (a price
// correction moves none: it is said by its own word and its Rp 10.000 → Rp 11.000).
const G4_KINDS = [
  { kind: "MOVEMENT_KIND_TRANSFER_OUT", word: "Transferred out", delta: "-3" },
  { kind: "MOVEMENT_KIND_TRANSFER_IN", word: "Transferred in", delta: "2" },
  { kind: "MOVEMENT_KIND_RETURN", word: "Returned", delta: "2" },
  { kind: "MOVEMENT_KIND_ADJUST", word: "Counted", delta: "-1" },
] as const;

test.describe(`${PURPOSE} (${G4.case})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN} (${G4.case})`, async ({ page }) => {
      await openStockHistory(page, r, 4);
      const rows = await history(await login(username(r.key), PASSWORD), ground.products[4]!.id);

      await test.step(G4.then, async () => {
        for (const w of G4_KINDS) {
          const m = rows.find((x) => x.kind === w.kind);
          expect.soft(m?.delta, `${w.word}: on the ledger`).toBe(w.delta);
          await expect.soft(cellsOf(page, String(m?.id)).nth(WHAT), w.word).toHaveText(w.word);
        }
        const price = rows.find((x) => x.kind === "MOVEMENT_KIND_REVALUATION");
        expect.soft(price, "the price correction on the ledger").toBeDefined();
        expect.soft([price?.priceUnitBefore, price?.priceUnitAfter], "its price before and after").toEqual([PER_UNIT, 11_000]);
        if (price) {
          const what = cellsOf(page, String(price.id)).nth(WHAT);
          await expect.soft(what, "Price corrected").toContainText("Price corrected");
          await expect.soft(page.getByTestId(`wp-history-row-${price.id}-price`)).toHaveText("Rp 10.000 → Rp 11.000");
          await expect.soft(page.getByTestId(`wp-history-row-${price.id}-reason`)).toContainText(`harga supplier naik ${SUFFIX}`);
        }
      });
    });
  }

  test(`regression: ${PURPOSE} (${G4.case}) — each by its own word on rack E, the price correction the newest row`, async ({ page }) => {
    const r = ROLES[0];
    await openStockHistory(page, r, 4);
    const rows = await history(await login(username(r.key), PASSWORD), ground.products[4]!.id);
    // Seven rows, newest first: the price correction (a batch row, listed since #143), the recount, the buyer's return,
    // the order's take, the transfer back in, the transfer out, the restock.
    expect.soft(rows.map((m) => m.kind)).toEqual([
      "MOVEMENT_KIND_REVALUATION",
      "MOVEMENT_KIND_ADJUST",
      "MOVEMENT_KIND_RETURN",
      "MOVEMENT_KIND_PICK",
      "MOVEMENT_KIND_TRANSFER_IN",
      "MOVEMENT_KIND_TRANSFER_OUT",
      "MOVEMENT_KIND_RECEIVE",
    ]);
    await expect.soft(screenRows(page)).toHaveCount(7);
    expect.soft(await screenIds(page)).toEqual(rows.map((m) => String(m.id)));
    for (const w of G4_KINDS) {
      const m = rows.find((x) => x.kind === w.kind);
      expect.soft(m?.delta, `${w.word}: on the ledger`).toBe(w.delta);
      const cells = cellsOf(page, String(m?.id));
      await expect.soft(cells.nth(WHAT), w.word).toHaveText(w.word);
      await expect.soft(cells.nth(CHANGE)).toHaveText(change(w.delta));
      await expect.soft(cells.nth(PLACE)).toHaveText(ground.racks.e!.code);
    }
    // The buyer's order took its 2 before they came back.
    expect.soft(rows.find((x) => x.kind === "MOVEMENT_KIND_PICK")?.delta).toBe("-2");
    // The recount left rack E at 8.
    expect.soft(rows[1]?.balance).toBe("8");
    // The price correction moved no unit and touched no rack: the restock's batch named, the place "—", no change.
    const price = rows[0];
    expect.soft(price?.delta, "the price correction moved no unit").toBeUndefined();
    expect.soft(String(price?.batchId), "the batch it corrected").toBe(ground.batch[4]);
    const cells = cellsOf(page, String(price?.id));
    await expect.soft(cells.nth(BATCH)).toHaveText(`#${ground.batch[4]}`);
    await expect.soft(cells.nth(PLACE)).toHaveText("—");
  });
});

// ── 5 · filter stock history: batch #12 of two ──────────────────────────────────────────────────────────────────

// Product 6's rows by batch, newest first: kind, rack, units. Every row is one batch's (no move — see the ground).
const G5_B12 = ["MOVEMENT_KIND_BROKEN a -1", "MOVEMENT_KIND_SAMPLE a -1", "MOVEMENT_KIND_RECEIVE a 10"];
const G5_B13 = ["MOVEMENT_KIND_BROKEN b -1", "MOVEMENT_KIND_RECEIVE b 5"];
const kindRackUnits = (m: Movement) => [m.kind, rackTag(m.rackId), m.delta ?? "0"].join(" ");

/** THE GIVEN for `r`: product 6's tab opened, its ledger under r's own token, both batches' rows proven on it and on
 * the screen, and the filter offering both batches. */
async function openG5(page: Page, r: (typeof ROLES)[number]) {
  await openStockHistory(page, r, 6);
  const token = await login(username(r.key), PASSWORD);
  const rows = await history(token, ground.products[6]!.id);
  const [b12, b13] = [ground.batches6[0]!, ground.batches6[1]!];
  const of = (batch: string) => rows.filter((m) => String(m.batchId) === batch);
  const filter = page.getByTestId("wp-history-batch-filter");

  expect(of(b12).map(kindRackUnits), "batch #12's rows on the ledger").toEqual(G5_B12);
  expect(of(b13).map(kindRackUnits), "batch #13's rows on the ledger").toEqual(G5_B13);
  expect(rows.length, "no row outside the two batches").toBe(G5_B12.length + G5_B13.length);
  await expect(screenRows(page)).toHaveCount(rows.length);
  await expect(filter.locator(`option[value="${b12}"]`)).toHaveCount(1);
  await expect(filter.locator(`option[value="${b13}"]`)).toHaveCount(1);

  return { token, rows, b12, b13, of, filter };
}

/** Only batch #12's rows on the screen, in the ledger's order, each naming it — none of batch #13's. */
async function onlyBatch12(page: Page, g: Awaited<ReturnType<typeof openG5>>) {
  await expect(screenRows(page)).toHaveCount(G5_B12.length);
  expect.soft(await screenIds(page)).toEqual(g.of(g.b12).map((m) => String(m.id)));
  for (const m of g.of(g.b13)) {
    await expect.soft(page.getByTestId(`wp-history-row-${m.id}`), `${kindRackUnits(m)}: batch #13's, not listed`).toHaveCount(0);
  }
}

test.describe(`${PURPOSE} (${G5.case})`, () => {
  // ❌ — the then as a person does it: the filter's option that reads what the Batch column calls batch #12. The
  // option for batch #12 reads its RESTOCK's number instead (`#<deliveryId>`, warehouse-product/index.tsx
  // batchOptions) while the column — and the batch's own page, "Batch #12" — read the batch's (`#<batchId>`,
  // MovementTable), so no option reads "#12". Filtering itself works: the regression below picks the batch by its own
  // option and passes.
  for (const r of ROLES) {
    test(`${r.given} ${WHEN5} (${G5.case})`, async ({ page }) => {
      test.fail(true, "❌ error — the Batch filter names batch #12 by its restock's number: e2e_report/tester/20261128-065603-acceptance-filter-stock-history.md");
      const g = await openG5(page, r);
      // What the screen calls batch #12, read off its own receive row.
      const name = (await cellsOf(page, String(g.of(g.b12).at(-1)!.id)).nth(BATCH).textContent())?.trim() ?? "";
      expect(name, "the Batch column names batch #12").toBe(`#${g.b12}`);

      await test.step(G5.then, async () => {
        await g.filter.selectOption({ label: name }, { timeout: 5_000 });
        await onlyBatch12(page, g);
      });
    });
  }

  test(`regression: ${PURPOSE} (${G5.case}) — batch #12's own option leaves only its movements; All batches brings all back`, async ({
    page,
  }) => {
    const g = await openG5(page, ROLES[0]);
    const label = (await g.filter.locator(`option[value="${g.b12}"]`).textContent())?.trim();
    test.info().annotations.push({ type: "batch filter option", description: `batch #${g.b12} reads "${label}"` });

    await g.filter.selectOption(g.b12);
    await expect(g.filter).toHaveValue(g.b12);
    await onlyBatch12(page, g);
    for (const m of g.of(g.b12)) {
      await expect.soft(cellsOf(page, String(m.id)).nth(BATCH), `${kindRackUnits(m)}: batch`).toHaveText(`#${g.b12}`);
    }
    // The server, narrowed to the batch under the owner's token: the same movements by kind, rack and units.
    const narrowed = await history(g.token, ground.products[6]!.id, g.b12);
    expect.soft(narrowed.map(kindRackUnits), "the server's batch #12").toEqual(G5_B12);

    await g.filter.selectOption("");
    await expect(screenRows(page)).toHaveCount(g.rows.length);
    expect.soft(await screenIds(page)).toEqual(g.rows.map((m) => String(m.id)));
  });
});

// ── 6 · open placement history: received onto A, all moved A → B, 2 picked off B ──────────────────────────────────

// Placement History is the page's other ledger (`wp-placement-history-table`, the same MovementTable: When · What · By ·
// Batch · Place · Change · After). Product 7's whole ledger, newest first, as seeded: the order's take off rack B, the
// move's two legs (B +10, A −10 — one kind, both in this warehouse), the restock onto rack A.
const G6_ROWS = {
  picked: { kind: "MOVEMENT_KIND_PICK", rack: "b", delta: "-2", after: "8", by: "sel" },
  moveB: { kind: "MOVEMENT_KIND_MOVE", rack: "b", delta: "10", after: "10", by: "adm" },
  moveA: { kind: "MOVEMENT_KIND_MOVE", rack: "a", delta: "-10", after: "0", by: "adm" },
  received: { kind: "MOVEMENT_KIND_RECEIVE", rack: "a", delta: "10", after: "10", by: "own" },
} as const;
type G6Row = (typeof G6_ROWS)[keyof typeof G6_ROWS];

const phRows = (page: Page) => page.getByTestId("wp-placement-history-table").locator("tbody > tr");
const phCellsOf = (page: Page, movementId: string): Locator =>
  page.getByTestId(`wp-placement-history-row-${movementId}`).locator(":scope > td");
const WHEN_CELL = 0;

/** The When cell's text for an RFC3339 instant, as the app writes it (lib/datetime.ts shortDateTime): Jakarta time,
 * "28 Nov 07:25", the year only when it is not this year — formatted in the browser, in the page's language. */
async function whenText(page: Page, createdAt: string): Promise<string> {
  return page.evaluate((iso) => {
    const fmt = new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Jakarta",
    });
    const parts = (at: Date) => Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
    const p = parts(new Date(iso));
    const year = p.year !== parts(new Date()).year ? ` ${p.year}` : "";
    return `${p.day} ${p.month}${year} ${p.hour}:${p.minute}`;
  }, createdAt);
}

/** THE GIVEN for `r`: product 7's ledger under r's own token holds exactly the given's four rows, and THE WHEN — its
 * page in W, the Placement History tab — has drawn (the move's B leg is on it). */
async function openG6(page: Page, r: (typeof ROLES)[number]) {
  await signInAs(page, username(r.key), PASSWORD, ground.warehouse);
  const rows = await history(await login(username(r.key), PASSWORD), ground.products[7]!.id);
  const find = (w: G6Row) => rows.find((m) => m.kind === w.kind && String(m.rackId) === ground.racks[w.rack]!.id);
  const m = {
    picked: find(G6_ROWS.picked),
    moveB: find(G6_ROWS.moveB),
    moveA: find(G6_ROWS.moveA),
    received: find(G6_ROWS.received),
  };
  expect(rows.map((x) => x.kind), "the given's movements on the ledger, newest first").toEqual([
    "MOVEMENT_KIND_PICK",
    "MOVEMENT_KIND_MOVE",
    "MOVEMENT_KIND_MOVE",
    "MOVEMENT_KIND_RECEIVE",
  ]);
  for (const [k, w] of Object.entries(G6_ROWS)) {
    const x = m[k as keyof typeof m];
    expect(x, `${k} on rack ${w.rack.toUpperCase()}`).toBeDefined();
    expect([x!.delta, x!.balance ?? "0", String(x!.actorUserId)], `${k}: units, the rack after, who`).toEqual([
      w.delta,
      w.after,
      w.by === "sel" ? ground.sellerUser : ground.users[w.by],
    ]);
  }

  await page.goto(`/inventories/products/${ground.products[7]!.id}`);
  await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
  await page.getByTestId("wp-tab-placement-history").click();
  await expect(page.getByTestId("wp-placement-history-table")).toBeVisible();
  await expect(page.getByTestId(`wp-placement-history-row-${m.moveB!.id}`), "the tab has drawn its rows").toBeVisible();

  return m as Record<keyof typeof m, Movement>;
}

/** One Placement History row read as a person reads it: what, where, the units, who and when. */
async function phRow(page: Page, m: Movement, w: { rack: string; delta: string; after: string; by: string }, word: string) {
  const cells = phCellsOf(page, String(m.id));
  const label = `${word} · rack ${w.rack.toUpperCase()}`;
  await expect.soft(cells.nth(WHAT), `${label}: what`).toHaveText(word);
  await expect.soft(cells.nth(PLACE), `${label}: the rack`).toHaveText(ground.racks[w.rack]!.code);
  await expect.soft(cells.nth(CHANGE), `${label}: units`).toHaveText(change(w.delta));
  await expect.soft(cells.nth(AFTER), `${label}: the rack after`).toHaveText(w.after);
  await expect.soft(cells.nth(BY), `${label}: who`).toHaveText(personName(w.by));
  await expect.soft(cells.nth(WHEN_CELL), `${label}: when`).toHaveText(await whenText(page, m.createdAt ?? ""));
}

test.describe(`${PURPOSE} (${G6.case})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN6} (${G6.case})`, async ({ page }) => {
      const m = await openG6(page, r);

      // The move reads as its two legs, as every ledger here writes it (Stock History given 1, a rack's history): rack
      // A −10 and rack B +10, one kind, both by the admin who moved them, at one time.
      await test.step(G6.moved, async () => {
        await expect.soft(page.getByTestId(`wp-placement-history-row-${m.moveA.id}`), "the move's leg off rack A").toBeVisible();
        await phRow(page, m.moveA, G6_ROWS.moveA, "Moved");
        await phRow(page, m.moveB, G6_ROWS.moveB, "Moved");
        expect.soft(m.moveA.createdAt, "the two legs: one move, one time").toBe(m.moveB.createdAt);
      });

      await test.step(G6.picked, async () => {
        // Not on Placement History (its rows drawn, above) …
        await expect.soft(page.getByTestId(`wp-placement-history-row-${m.picked.id}`), "the pick: not a placement").toHaveCount(0);
        await expect.soft(phRows(page).filter({ hasText: "Picked" }), "no Picked row on Placement History").toHaveCount(0);
        // … only on Stock History: −2 off rack B, by the seller whose order took it.
        await page.getByTestId("wp-tab-history").click();
        await expect.soft(page.getByTestId(`wp-history-row-${m.picked.id}`), "the pick on Stock History").toBeVisible();
        const cells = cellsOf(page, String(m.picked.id));
        await expect.soft(cells.nth(WHAT)).toHaveText("Picked");
        await expect.soft(cells.nth(PLACE)).toHaveText(ground.racks.b!.code);
        await expect.soft(cells.nth(CHANGE)).toHaveText("-2");
        await expect.soft(cells.nth(BY)).toHaveText(personName("sel"));
      });
    });

    // ❌ — Placement History reads the moves alone (StockHistory narrowed to MOVEMENT_KIND_MOVE, features/inventory/
    // queries.ts), so the receive onto rack A is not on it; the acceptance's Placement History is "the put-aways and the
    // moves between racks" (as a rack's *Hanya penempatan* lens reads, PLACEMENT_KINDS = receive + move).
    test(`${r.given} ${WHEN6} (${G6.case}) — the receive`, async ({ page }) => {
      test.fail(true, "❌ error — Placement History leaves out the receipt onto a rack: e2e_report/tester/20261128-072100-acceptance-open-placement-history.md");
      const m = await openG6(page, r);

      await test.step(G6.received, async () => {
        await expect(page.getByTestId(`wp-placement-history-row-${m.received.id}`), "the receive onto rack A listed").toBeVisible({
          timeout: 5_000,
        });
        await phRow(page, m.received, G6_ROWS.received, "Received");
      });
    });
  }
});

// ── 7 · filter placement history: moved on rack A and on rack B, the Rack filter set to rack B ─────────────────────

// Product 8's move legs as seeded — rack · units · the rack after · who: A −4 and C +4 (the admin), A −3 and B +3 (the
// admin), B −1 and D +1 (the staff). Rack B's movements are its two legs, B +3 → 3 and B −1 → 2.
const G7_LEGS = ["a -4 6 adm", "c 4 4 adm", "a -3 3 adm", "b 3 3 adm", "b -1 2 stf", "d 1 1 stf"];
const whoKey = (userId: string | undefined) =>
  (Object.entries(ground.users) as [Key, string][]).find(([, id]) => id === String(userId))?.[0] ?? `#${userId}`;
const g7Leg = (m: Movement) => [rackTag(m.rackId), m.delta ?? "0", m.balance ?? "0", whoKey(m.actorUserId)].join(" ");
const phIds = async (page: Page) =>
  (await phRows(page).evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-testid") ?? ""))).map((t) =>
    t.replace(/^wp-placement-history-row-/, ""),
  );

/** THE GIVEN for `r`: product 8's ledger under r's own token — its receipt onto rack A and the six move legs on racks
 * A, B, C and D — and THE WHEN's tab opened unfiltered: every leg on it, the Rack filter offering rack A and rack B. */
async function openG7(page: Page, r: (typeof ROLES)[number]) {
  await signInAs(page, username(r.key), PASSWORD, ground.warehouse);
  const rows = await history(await login(username(r.key), PASSWORD), ground.products[8]!.id);
  const legs = rows.filter((m) => m.kind === "MOVEMENT_KIND_MOVE");
  const others = rows.filter((m) => m.kind !== "MOVEMENT_KIND_MOVE");
  expect(legs.map(g7Leg).sort(), "the given's move legs on the ledger").toEqual([...G7_LEGS].sort());
  expect(others.map(kindRackUnits), "and its one receipt, onto rack A").toEqual(["MOVEMENT_KIND_RECEIVE a 10"]);

  await page.goto(`/inventories/products/${ground.products[8]!.id}`);
  await expect(page.getByTestId("warehouse-product-page")).toBeVisible();
  await page.getByTestId("wp-tab-placement-history").click();
  await expect(page.getByTestId("wp-placement-history-table")).toBeVisible();
  for (const m of legs) {
    await expect(page.getByTestId(`wp-placement-history-row-${m.id}`), `${g7Leg(m)}: on the tab, unfiltered`).toBeVisible();
  }
  const filter = page.getByTestId("wp-ph-rack-filter");
  for (const tag of ["a", "b"]) {
    await expect(filter.locator("option", { hasText: ground.racks[tag]!.code }), `the Rack filter offers rack ${tag.toUpperCase()}`).toHaveCount(1);
  }

  return {
    legs,
    receipt: others[0]!,
    onB: legs.filter((m) => String(m.rackId) === ground.racks.b!.id),
    filter,
    unfiltered: await phRows(page).count(),
  };
}

test.describe(`${PURPOSE} (${G7.case})`, () => {
  for (const r of ROLES) {
    test(`${r.given} ${WHEN7} (${G7.case})`, async ({ page }) => {
      const g = await openG7(page, r);
      const b = ground.racks.b!;

      await test.step(G7.then, async () => {
        // Rack B, picked by the code the person reads on the filter.
        await g.filter.selectOption({ label: b.code }, { timeout: 5_000 });
        await expect(g.filter).toHaveValue(b.id);
        // Exactly rack B's two legs …
        await expect(phRows(page)).toHaveCount(g.onB.length);
        expect.soft((await phIds(page)).sort(), "the rows left are rack B's legs").toEqual(g.onB.map((m) => String(m.id)).sort());
        const places = await phRows(page).evaluateAll((trs, at) => trs.map((tr) => tr.children[at]?.textContent?.trim() ?? ""), PLACE);
        expect.soft(places, "every row left is on rack B").toEqual(g.onB.map(() => b.code));
        for (const m of g.onB) {
          await phRow(page, m, { rack: "b", delta: m.delta ?? "0", after: m.balance ?? "0", by: whoKey(m.actorUserId) }, "Moved");
        }
        // … none of rack A's, C's or D's: the other legs, and the receipt onto rack A should the tab list it.
        for (const m of [...g.legs.filter((x) => !g.onB.includes(x)), g.receipt]) {
          const what = m === g.receipt ? kindRackUnits(m) : g7Leg(m);
          await expect.soft(page.getByTestId(`wp-placement-history-row-${m.id}`), `${what}: another rack's, not listed`).toHaveCount(0);
        }
      });

      await test.step("regression: All racks brings every movement back", async () => {
        await g.filter.selectOption("");
        await expect(phRows(page)).toHaveCount(g.unfiltered);
        for (const m of g.legs) await expect.soft(page.getByTestId(`wp-placement-history-row-${m.id}`)).toBeVisible();
      });
    });
  }
});

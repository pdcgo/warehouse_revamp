import { expect, test } from "@playwright/test";
import type { Browser, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { readyAt } from "./restock_helpers";

// ── accept return — the checks behind docs/acceptances/inventory/order.md (## return) ─────────────────────────────────────
//
// accept return's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are the
// owner's, set by hand — never by this file. (the_return_goes_back_on_the_shelf.spec.ts keeps the older end-to-end
// regression of the same page: wrong warehouse, door rows on the note, the minted batch.)
//
// Business rules:
// - only-the-return-warehouse-accepts-a-return + the-return-warehouse-is-read-when-the-return-happens
//   (docs/business/order/context_decision.md): only the selling team's return warehouse AS CONFIGURED NOW accepts; a
//   parcel an old label brought to another building waits there — the refusal names where it goes, with no Accept.
// - a-return-mints-one-batch-per-batch-the-order-took, a-short-return-is-missing-at-the-door,
//   a-broken-returned-unit-is-thrown-away-at-the-door, a-return-door-row-carries-an-optional-note
//   (docs/business/inventory/return_decision.md): the sound units go onto the racks chosen, the broken are thrown away
//   and the missing recorded as door rows, both named on ONE warehouse note on the order.
// - a-returned-borrowed-unit-is-relabelled-at-the-accept: a borrowed line comes back as the selling team's MAPPED own
//   product, whose label is printed and stuck over the lender's.
// - a-return-may-carry-the-couriers-ask (docs/business/balance/context_decision.md): the courier's charge at the door,
//   with its note, is the selling team's debt to the return warehouse.
// - a-lock-stops-sales-and-cancels-too: a stock count holding a rack refuses a put-away there, naming the count.
//
// `warehouse:all` → EVERY warehouse role (warehouse:owner, warehouse:admin, warehouse:staff), each signed in as itself,
// each on an order of its own. A then the selling team reads is read by selling:owner of seller A.
//
// The WHEN: the return warehouse's crew opens the order (/warehouse-orders/<id>), Accept Return, counts the parcel on the
// accept page (missing, broken, the sound units' rack), Accept Return, confirmed. For (return warehouse changed …) the
// crew has the parcel in hand: Receive a Return with the label's resi, then the accept page itself.
//
// How each then is read:
// - `status changed from return to return completed` — the record says ORDER_STATUS_RETURN_COMPLETED; the order stands
//   on the crew's Returns tab with the Return received badge (order-status-12).
// - `accept recorded in order timeline` — the crew's order page › Timeline: ONE "Return received by the warehouse" step
//   by the crew's @username, marked Warehouse; the record has one return_completed row, from the warehouse, by that user.
// - `ready stock of 1 product increases at return warehouse` / `… by good items only` / `… of mapped own product
//   increases` — the SELLER's Ready of the product at the return warehouse (the restock form's picker, as restock's
//   specs read it). Each role's product is its own and had no stock there, so Ready reads exactly the sound units.
// - `stock on 1 rack increases` — the rack's page: the product's on-hand on that rack.
// - `recorded in product history` — the seller's product page › History: ONE return row, +1.
// - `selling team sees order return completed` — selling:owner's order page: the stepper on Return received, the badge,
//   one return_completed step from the Warehouse; the seller's record reads RETURN_COMPLETED.
// - `return arrival recorded in analytic metric` — Analytic › Return arrived, last 7 days, by shop, the role's own shop
//   (its only accepted return): 1, re-read until the fold lands. Read by selling:owner: a warehouse's Analytic reads only
//   the orders it ships (a-warehouse-reads-the-orders-it-ships), and S shipped it, not R.
// - `broken items thrown away` — the rack holds only the sound unit, and Analytic › Returned stock by product reads the
//   broken unit as thrown away (broken_count 1).
// - `missing items recorded` — the same metric's missing_count 1, and the order's warehouse note names it.
// - `broken and missing items shown in order timeline` — ONE warehouse note row on the record naming both, shown in
//   Catatan on the crew's order page (from the Warehouse) and on the seller's.
// - `courier charge recorded in liability to return warehouse` — selling:owner's ledger with the return warehouse:
//   ONE entry for the order, reading the charge.
// - `cannot accept return` / `message names new return warehouse` / `message says to keep parcel aside` — Receive a
//   Return shows the found order with where it goes and no Accept; the accept page is the refusal with no Accept; the
//   accept sent anyway is refused naming the new warehouse, and the order stays in return.
// - `accept refused` / `message names opname` — Accept on the counted rack is answered with the count's refusal on the
//   page, the order stays in return and the rack holds what it held; the message names the count (#id).
// - `brokens on rack` is 🚧 and goes against a-broken-returned-unit-is-thrown-away-at-the-door: its own test, marked
//   test.fail, as warehouse:owner — the page offers no rack for broken units (field-agnostic: the day one is offered,
//   this turns red; ask the owner).
// - `can print barcode of mapped own product` — the accept of a borrowed line stays on its print step
//   (return-accept-relabels, the URL still the accept page): the line names the MAPPED own product's code and its sound
//   units; what prints (return-accept-relabels-root) is one sticker per sound unit, each with its QR and that code, never
//   the lender's; Print Labels reaches the browser's print (stubbed — headless opens no dialog), and Done goes back to
//   the order. Read first, on the page the accept lands on, before a later then navigates away.
//
// GROUND (beforeAll, as root, through the API):
// - SELLER A returns to warehouse R and ships from warehouse S (most orders) or from R itself (the count's product).
//   Its shops: one per warehouse role (that role's all-returned order — its shop counts ONE arrival) and one shared.
//   Own products: per role one for (all returned), one for (brokens · missing), one MAPPED for (cross product), plus one
//   shared (courier, brokens on rack) and one on R's counted rack.
// - LENDER L lends one product per role (crossMarkupBps), stocked at S; seller A maps each to its own product.
// - SELLER C ships from R and returned to R when its orders were placed; then its configuration names R2 — a new
//   return warehouse. R ships C's orders, so its crew can read them (the old return warehouse that holds the parcel).
// - R has a user per warehouse role, a rack the returns go onto and a rack a stock count holds (started last).
// - Every order is 1 unit (3 for brokens · missing, 2 for cross product — so its labels are one per unit, not one per
//   line), walked processed → picked → shipping by its warehouse and claimed back to `return` by its seller.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-accept-return-pass-1";
const CHARGE = 12_500;
const CHARGE_NOTE = "ongkir retur kurir";
const DOOR_NOTE = "sobek di sudut";
const R_CODE = `AQR${SUFFIX}`;
const R2_NAME = `E2E AcceptRet New WH ${SUFFIX}`;
const COUNT_STOCK = 6;
// The cross product's order: 2 units of the lender's product, so 2 labels of the mapped own product print.
const RELABEL_UNITS = 2;

const WAREHOUSE = [
  { key: "whown", role: "ROLE_WAREHOUSE_OWNER", label: "warehouse:owner" },
  { key: "whadm", role: "ROLE_WAREHOUSE_ADMIN", label: "warehouse:admin" },
  { key: "whstf", role: "ROLE_WAREHOUSE_STAFF", label: "warehouse:staff" },
] as const;

const userOf = (key: string) => `e2eaq${key}${SUFFIX}`;
const A_OWNER = `e2eaqao${SUFFIX}`;
// The marketplace's Order ID and the label's resi — both carry the run's suffix (a repeat within a team is refused).
const refOf = (slot: string) => `AQ${SUFFIX}${slot.toUpperCase()}`;
const resiOf = (slot: string) => `JQ${SUFFIX}${slot.toUpperCase()}`;
// Product codes, per case and role.
const codeOf = (tag: string) => `AQ${tag.toUpperCase()}${SUFFIX}`;

const ground = {
  sellerA: "",
  lender: "",
  sellerC: "",
  ship: "", // warehouse S
  ret: "", // warehouse R — seller A's return warehouse; seller C's OLD one
  ret2: "", // warehouse R2 — seller C's return warehouse now
  shipRack: "",
  retRack: "",
  countRack: "",
  countSession: "",
  shop: "",
  shopC: "",
  roleShops: {} as Record<string, string>,
  // product code → id
  products: {} as Record<string, string>,
  // slot → order id; order id → its one item's id
  orders: {} as Record<string, string>,
  items: {} as Record<string, string>,
  // user key → user id
  users: {} as Record<string, string>,
};

// ── the session ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// An RPC as the signed-in person — the status and the JSON body, never thrown.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      const text = await res.text();
      let json: any = {};
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      return { status: res.status, body: json };
    },
    [method, body, API_URL] as const,
  );
}

// A call that must succeed — its JSON body.
async function ok<T = any>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

async function move(page: Page, teamId: string, orderId: string, to: string) {
  const res = await ok<{ results: { moved?: boolean; refusedReason?: string }[] }>(
    page,
    "selling.v1.OrderService/OrderStatusChange",
    { teamId, orderIds: [orderId], to: `ORDER_STATUS_${to}` },
  );
  expect(res.results[0]?.moved, `${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// A person on a page of their own (a fresh context: the form sign-in), working in `teamId`.
async function pageAs(browser: Browser, username: string, teamId: string): Promise<Page> {
  const p = await browser.newPage();
  await signIn(p, username, PASSWORD);
  await useTeam(p, teamId);

  return p;
}

type Log = { status?: string; from?: string; actorId?: string; note?: string };
type OrderRecord = { status: string; timelineLogs?: Log[] };

// The order as the server keeps it, read in `teamId`.
async function orderOf(page: Page, orderId: string, teamId: string): Promise<OrderRecord> {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId, orderId })).order as OrderRecord;
}

const isNote = (l: Log) => !l.status || l.status === "ORDER_STATUS_UNSPECIFIED";

// ── the WHEN ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Count = { missing?: number; broken?: number; rack: string; charge?: number; chargeNote?: string };

// THE CREW OPENS THE ACCEPT — the order's page, Accept Return — and the accept page is on the order's line.
async function openAccept(page: Page, orderId: string) {
  await page.goto(`/warehouse-orders/${orderId}`);
  const accept = page.getByTestId("pick-order-accept-return");
  await expect(accept).toBeVisible({ timeout: 15_000 });
  await accept.click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}/accept-return$`));
  await expect(page.getByTestId(`return-accept-line-${ground.items[orderId]!}`)).toBeVisible({ timeout: 15_000 });
}

// …counts the parcel, puts the sound units on `rack`, Accept Return, confirmed. Returns the OrderReturnAccept answer.
async function countAndAccept(page: Page, orderId: string, c: Count): Promise<Response> {
  const itemId = ground.items[orderId]!;
  if (c.missing) await page.getByTestId(`return-accept-missing-${itemId}`).fill(String(c.missing));
  if (c.broken) await page.getByTestId(`return-accept-broken-${itemId}`).fill(String(c.broken));
  if (c.missing || c.broken) await page.getByTestId(`return-accept-note-${itemId}`).fill(DOOR_NOTE);

  const rackRow = page.getByTestId(`return-accept-rack-${itemId}-0`);
  await rackRow.getByTestId("rack-select").click();
  await rackRow.getByTestId(`rack-select-option-${c.rack}`).click();

  if (c.charge) {
    await page.getByTestId("return-accept-charge").fill(String(c.charge));
    await page.getByTestId("return-accept-charge-note").fill(c.chargeNote ?? "");
  }
  await expect(page.getByTestId("return-accept-ready")).toBeVisible();

  await page.getByTestId("return-accept-submit").click();
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderReturnAccept`)),
    page.getByTestId("confirm-action").click(),
  ]);

  return answer;
}

async function accepted(page: Page, orderId: string, c: Count) {
  await openAccept(page, orderId);
  const answer = await countAndAccept(page, orderId, c);
  expect(answer.status(), await answer.text()).toBe(200);
  await expect.soft(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}$`));

  return answer;
}

// ── the reads ───────────────────────────────────────────────────────────────────────────────────────────────────────────

// A product's on-hand on one rack, as the rack's page shows it (its stock table — the page draws the product twice).
async function onRack(page: Page, rackId: string, productId: string) {
  await page.goto(`/inventories/racks/${rackId}`);
  await expect(page.getByTestId("rack-detail-stock")).toBeVisible({ timeout: 15_000 });

  return page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${productId}`);
}

// A figure of Analytic, re-read until the fold lands.
async function metric(page: Page, url: string, cell: string, value: string) {
  await expect
    .soft(async () => {
      await page.goto(url);
      await expect(page.getByTestId(cell)).toHaveText(value, { timeout: 3_000 });
    })
    .toPass({ timeout: 30_000 });
}

// The seller's Ready of a product at the return warehouse — on a page of seller A's owner.
async function sellerReady(browser: Browser, code: string, value: string) {
  const seller = await pageAs(browser, A_OWNER, ground.sellerA);
  try {
    await expect.soft(await readyAt(seller, R_CODE, code)).toHaveText(value);
  } finally {
    await seller.close();
  }
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.sellerA = await team(`E2E AcceptRet Seller A ${SUFFIX}`, `AQA${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.lender = await team(`E2E AcceptRet Lender ${SUFFIX}`, `AQL${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.sellerC = await team(`E2E AcceptRet Seller C ${SUFFIX}`, `AQC${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.ship = await team(`E2E AcceptRet Ship WH ${SUFFIX}`, `AQS${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  ground.ret = await team(`E2E AcceptRet Return WH ${SUFFIX}`, R_CODE, "TEAM_TYPE_WAREHOUSE");
  ground.ret2 = await team(R2_NAME, `AQN${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

  const returnsTo = async (teamId: string, warehouseId: string) =>
    ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId, warehouseId });
  await returnsTo(ground.sellerA, ground.ret);
  await returnsTo(ground.lender, ground.ship);
  await returnsTo(ground.sellerC, ground.ret);
  for (const wh of [ground.ship, ground.ret]) {
    await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wh, feePercent: 1, minFee: 0 });
  }

  const user = async (teamId: string, key: string, username: string, role: string) => {
    const made = await ok(page, "user.v1.UserService/CreateUser", {
      teamId,
      username,
      password: PASSWORD,
      name: `AcceptRet ${key} ${SUFFIX}`,
      role,
    });
    ground.users[key] = String(made.user.id);
  };
  for (const r of WAREHOUSE) await user(ground.ret, r.key, userOf(r.key), r.role);
  await user(ground.sellerA, "ao", A_OWNER, "ROLE_SELLING_OWNER");

  const shop = async (teamId: string, name: string, shopCode: string) => {
    const id = String(
      (await ok(page, "selling.v1.ShopService/ShopCreate", { teamId, name, shopCode, marketplace: "MARKETPLACE_SHOPEE" })).shop
        .id,
    );
    await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId, shopId: id, userId: ROOT_USER_ID });

    return id;
  };
  ground.shop = await shop(ground.sellerA, `E2E AcceptRet Shop ${SUFFIX}`, `AQP${SUFFIX}`);
  for (const r of WAREHOUSE) {
    ground.roleShops[r.key] = await shop(ground.sellerA, `E2E AcceptRet Shop ${r.key} ${SUFFIX}`, `AQ${r.key.toUpperCase()}${SUFFIX}`);
  }
  ground.shopC = await shop(ground.sellerC, `E2E AcceptRet Shop C ${SUFFIX}`, `AQQ${SUFFIX}`);

  const rack = async (teamId: string, code: string) =>
    String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId, code })).rack.id);
  ground.shipRack = await rack(ground.ship, `aq-s-${SUFFIX}`);
  ground.retRack = await rack(ground.ret, `aq-r-${SUFFIX}`);
  ground.countRack = await rack(ground.ret, `aq-c-${SUFFIX}`);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E AcceptRet ${SUFFIX}` })).category.id;

  const product = async (teamId: string, code: string, cross = false) => {
    const made = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId,
        productCodePart: code,
        name: `E2E ${code}`,
        categoryId: category,
        ...(cross ? { crossMarkupBps: 2000 } : {}),
      })
    ).product as { id: string; productCode: string };
    ground.products[code] = String(made.id);

    return made;
  };
  const account = async (teamId: string, tag: string) => {
    const id = (
      await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E accept return ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-AQ-${tag}-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id;
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId,
      accountId: id,
      operational: true,
    });

    return id;
  };
  // `count` of each product, restocked by its owner into `warehouse` and accepted onto `rackId`.
  const restock = async (teamId: string, accountId: string, warehouse: string, rackId: string, lines: [string, number][]) => {
    const raised = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId,
      warehouseId: warehouse,
      financeAccountId: accountId,
      items: lines.map(([code, count]) => ({
        productId: ground.products[code],
        productCode: code,
        name: `E2E ${code}`,
        count,
        total: count * 10_000,
      })),
    });
    await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: raised.request.id,
      lines: (raised.request.items as { id: string }[]).map((item, i) => ({
        itemId: item.id,
        receivedCount: lines[i]![1],
        placements: [{ placementId: rackId, quantity: lines[i]![1] }],
      })),
    });
  };

  // Seller A's own products. The mapped ones need no stock: the return mints them at R.
  const accountA = await account(ground.sellerA, "A");
  const aLines: [string, number][] = [];
  for (const r of WAREHOUSE) {
    await product(ground.sellerA, codeOf(`g1${r.key}`));
    await product(ground.sellerA, codeOf(`g2${r.key}`));
    await product(ground.sellerA, codeOf(`map${r.key}`));
    aLines.push([codeOf(`g1${r.key}`), 2], [codeOf(`g2${r.key}`), 4]);
  }
  await product(ground.sellerA, codeOf("shared"));
  aLines.push([codeOf("shared"), 6]);
  await restock(ground.sellerA, accountA, ground.ship, ground.shipRack, aLines);
  // The count's product lives on R's counted rack — its orders ship from R itself.
  await product(ground.sellerA, codeOf("count"));
  await restock(ground.sellerA, accountA, ground.ret, ground.countRack, [[codeOf("count"), COUNT_STOCK]]);

  // The lender's products, one per role, stocked at S and mapped by seller A to its own.
  const accountL = await account(ground.lender, "L");
  for (const r of WAREHOUSE) await product(ground.lender, codeOf(`lent${r.key}`), true);
  await restock(ground.lender, accountL, ground.ship, ground.shipRack, WAREHOUSE.map((r) => [codeOf(`lent${r.key}`), 3]));
  for (const r of WAREHOUSE) {
    await ok(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
      teamId: ground.sellerA,
      sharedProductId: ground.products[codeOf(`lent${r.key}`)],
      ownProductId: ground.products[codeOf(`map${r.key}`)],
    });
  }

  // Seller C's product, stocked at R — R ships C's orders.
  const accountC = await account(ground.sellerC, "C");
  await product(ground.sellerC, codeOf("moved"));
  await restock(ground.sellerC, accountC, ground.ret, ground.retRack, [[codeOf("moved"), 4]]);

  // GIVEN — every order placed by root, walked to the courier by its warehouse and claimed back by its seller.
  const place = async (slot: string, seller: string, shopId: string, warehouse: string, code: string, quantity = 1) => {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-accept-return-${slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: seller,
      shopId,
      warehouseId: warehouse,
      customerName: `E2E AcceptRet Buyer ${slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(slot),
      receiptCode: resiOf(slot),
      items: [{ productId: ground.products[code], productCode: code, name: `E2E ${code}`, quantity }],
    });
    const id = String(placed.order.id);
    ground.orders[slot] = id;
    ground.items[id] = String(placed.order.items[0].id);
    for (const s of ["PROCESSED", "PICKED", "SHIPPING"]) await move(page, warehouse, id, s);
    await move(page, seller, id, "RETURN");
  };
  for (const r of WAREHOUSE) {
    await place(`g1${r.key}`, ground.sellerA, ground.roleShops[r.key]!, ground.ship, codeOf(`g1${r.key}`));
    await place(`g2${r.key}`, ground.sellerA, ground.shop, ground.ship, codeOf(`g2${r.key}`), 3);
    await place(`g4${r.key}`, ground.sellerA, ground.shop, ground.ship, codeOf(`lent${r.key}`), RELABEL_UNITS);
    await place(`g5${r.key}`, ground.sellerA, ground.shop, ground.ship, codeOf("shared"));
    await place(`g6${r.key}`, ground.sellerC, ground.shopC, ground.ret, codeOf("moved"));
    await place(`g7${r.key}`, ground.sellerA, ground.shop, ground.ret, codeOf("count"));
  }
  await place("g3", ground.sellerA, ground.shop, ground.ship, codeOf("shared"));

  // (return warehouse changed after order created) — seller C now returns to R2; its parcels are at R.
  await returnsTo(ground.sellerC, ground.ret2);
  await page.close();

  // (opname running on chosen rack) — R's admin starts a count of the rack the count's product is on.
  const counter = await pageAs(browser, userOf("whadm"), ground.ret);
  const session = await ok(counter, "inventory.v1.OpnameService/OpnameSessionCreate", {
    teamId: ground.ret,
    plan: "OPNAME_PLAN_PLACEMENT",
    filterPlacementId: ground.countRack,
  });
  ground.countSession = String(session.session.id);
  await counter.close();
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── (status: return · 1 product · own product · all returned · 1 rack · return warehouse · no courier charge) ───────────

test.describe("warehouse:all wants to accept a return (status: return · 1 product · own product · all returned · 1 rack · return warehouse · no courier charge)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page, browser }) => {
      const slot = `g1${r.key}`;
      const orderId = ground.orders[slot]!;
      const code = codeOf(slot);
      const productId = ground.products[code]!;
      const shop = ground.roleShops[r.key]!;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      // GIVEN — in return, addressed to R, the crew holding the whole parcel.
      expect((await orderOf(page, orderId, ground.ret)).status).toBe("ORDER_STATUS_RETURN");

      // WHEN — Accept Return: nothing missing, nothing broken, the unit onto R's rack, confirmed.
      await accepted(page, orderId, { rack: ground.retRack });

      await test.step("then: status changed from return to return completed", async () => {
        expect.soft((await orderOf(page, orderId, ground.ret)).status).toBe("ORDER_STATUS_RETURN_COMPLETED");
        await page.goto(`/warehouse-orders?step=return&q=${refOf(slot)}`);
        await expect(page.getByTestId("pick-tab-return")).toHaveAttribute("aria-selected", "true");
        const row = page.getByTestId(`pick-queue-row-${orderId}`);
        await expect.soft(row).toBeVisible({ timeout: 15_000 });
        await expect.soft(row.getByTestId("order-status-12")).toBeVisible();
      });

      await test.step("then: accept recorded in order timeline", async () => {
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        await page.getByTestId("order-detail-tab-timeline").click();
        await expect(page.getByTestId("order-detail-timeline")).toBeVisible();
        const step = page.getByTestId("order-timeline-return_completed");
        await expect.soft(step).toHaveCount(1);
        await expect.soft(step).toContainText("Return received");
        await expect.soft(page.getByTestId("order-timeline-return_completed-by")).toContainText(userOf(r.key));
        await expect.soft(page.getByTestId("order-timeline-return_completed-when")).toContainText("Warehouse");
        const rows = ((await orderOf(page, orderId, ground.ret)).timelineLogs ?? []).filter(
          (l) => l.status === "ORDER_STATUS_RETURN_COMPLETED",
        );
        expect.soft(rows.length, "return_completed rows on the record's timeline").toBe(1);
        expect.soft(rows[0]?.from).toBe("ORDER_TIMELINE_FROM_WAREHOUSE");
        expect.soft(String(rows[0]?.actorId ?? "")).toBe(ground.users[r.key]);
      });

      await test.step("then: ready stock of 1 product increases at return warehouse", async () => {
        await sellerReady(browser, code, "1");
      });

      await test.step("then: stock on 1 rack increases", async () => {
        await expect.soft(await onRack(page, ground.retRack, productId)).toHaveText("1");
      });

      const seller = await pageAs(browser, A_OWNER, ground.sellerA);
      try {
        // Read by the selling team: a warehouse's Analytic reads only the orders it SHIPS
        // (a-warehouse-reads-the-orders-it-ships), and S shipped this one — R, which accepted it, does not see it there.
        await test.step("then: return arrival recorded in analytic metric", async () => {
          await metric(
            seller,
            `/analytic?g=shop&m=metrics/orders/return_arrived&r=7d&shop=${shop}`,
            `analytic-cell-${shop}-return_arrived_count`,
            "1",
          );
        });

        await test.step("then: recorded in product history", async () => {
          await seller.goto(`/products/${productId}`);
          await seller.getByTestId("pd-tab-history").click();
          const rows = seller
            .getByTestId("pd-panel-history")
            .locator('[data-testid^="pd-history-row-"]')
            .filter({ hasText: /Return/ });
          await expect.soft(rows).toHaveCount(1, { timeout: 15_000 });
          await expect.soft(rows.first()).toContainText("+1");
        });

        await test.step("then: selling team sees order return completed", async () => {
          await seller.goto(`/orders/${orderId}`);
          const detail = seller.getByTestId("order-detail-page");
          await expect(detail).toBeVisible({ timeout: 15_000 });
          await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "return_completed");
          await expect.soft(detail.getByTestId("order-status-12").first()).toBeVisible();
          const step = seller.getByTestId("section-timeline").getByTestId("order-timeline-return_completed");
          await expect.soft(step).toHaveCount(1);
          await expect.soft(step).toContainText("Warehouse");
          expect.soft((await orderOf(seller, orderId, ground.sellerA)).status, "the order as its seller reads it").toBe(
            "ORDER_STATUS_RETURN_COMPLETED",
          );
        });
      } finally {
        await seller.close();
      }
    });
  }
});

// ── (status: return · 1 product · own product · brokens thrown away · missing items · 1 rack · return warehouse) ────────

test.describe("warehouse:all wants to accept a return (status: return · 1 product · own product · brokens thrown away · missing items · 1 rack · return warehouse)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page, browser }) => {
      const slot = `g2${r.key}`;
      const orderId = ground.orders[slot]!;
      const code = codeOf(slot);
      const productId = ground.products[code]!;
      const inventoryMetric = `/analytic?g=product&m=metrics/inventory/return&r=7d&product=${productId}`;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      // GIVEN — 3 ordered: 1 is not in the box, 1 is too damaged to sell.
      expect((await orderOf(page, orderId, ground.ret)).status).toBe("ORDER_STATUS_RETURN");

      // WHEN — Accept Return: 1 missing, 1 broken (with a note), the 1 sound onto R's rack, confirmed.
      await openAccept(page, orderId);
      const itemId = ground.items[orderId]!;
      const answer = await countAndAccept(page, orderId, { missing: 1, broken: 1, rack: ground.retRack });
      expect(answer.status(), await answer.text()).toBe(200);
      const sent = JSON.parse(answer.request().postData() ?? "{}") as { lines?: Record<string, unknown>[] };
      expect.soft(sent.lines?.[0]?.orderItemId).toBe(itemId);

      await test.step("then: ready stock increases by good items only", async () => {
        await sellerReady(browser, code, "1");
        await expect.soft(await onRack(page, ground.retRack, productId)).toHaveText("1");
      });

      await test.step("then: broken items thrown away", async () => {
        await expect.soft(await onRack(page, ground.retRack, productId), "the broken unit is not on the rack").toHaveText("1");
        await metric(page, inventoryMetric, `analytic-cell-${productId}-broken_count`, "1");
        await metric(page, inventoryMetric, `analytic-cell-${productId}-back_count`, "1");
      });

      await test.step("then: missing items recorded", async () => {
        await metric(page, inventoryMetric, `analytic-cell-${productId}-missing_count`, "1");
        const notes = ((await orderOf(page, orderId, ground.ret)).timelineLogs ?? []).filter(isNote);
        expect.soft(notes.map((n) => n.note ?? "").join("\n")).toContain("Missing from the returned parcel: 1 ×");
      });

      await test.step("then: broken and missing items shown in order timeline", async () => {
        const notes = ((await orderOf(page, orderId, ground.ret)).timelineLogs ?? []).filter(
          (l) => isNote(l) && (l.note ?? "").includes("Missing from the returned parcel"),
        );
        expect.soft(notes.length, "the warehouse note rows naming the door").toBe(1);
        expect.soft(notes[0]?.from).toBe("ORDER_TIMELINE_FROM_WAREHOUSE");
        expect.soft(notes[0]?.note ?? "").toContain("Broken, thrown away: 1 ×");
        expect.soft(notes[0]?.note ?? "").toContain(DOOR_NOTE);

        // The crew's order page — Catatan, from the Warehouse.
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        const row = page.getByTestId("order-detail-notes").getByTestId("order-note").filter({ hasText: "Missing from the returned parcel" });
        await expect.soft(row).toHaveCount(1, { timeout: 15_000 });
        await expect.soft(row).toHaveAttribute("data-from", "warehouse");
        await expect.soft(row).toContainText("Missing from the returned parcel: 1 ×");
        await expect.soft(row).toContainText("Broken, thrown away: 1 ×");

        // …and the seller's, where customer service claims it.
        const seller = await pageAs(browser, A_OWNER, ground.sellerA);
        try {
          await seller.goto(`/orders/${orderId}`);
          const box = seller.getByTestId("section-notes");
          await expect.soft(box).toContainText("Missing from the returned parcel: 1 ×", { timeout: 15_000 });
          await expect.soft(box).toContainText("Broken, thrown away: 1 ×");
        } finally {
          await seller.close();
        }
      });
    });
  }
});

// ── (status: return · 1 product · cross product · return map chosen · all returned · 1 rack · return warehouse) ─────────

test.describe("warehouse:all wants to accept a return (status: return · 1 product · cross product · return map chosen · all returned · 1 rack · return warehouse)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page, browser }) => {
      const orderId = ground.orders[`g4${r.key}`]!;
      const itemId = ground.items[orderId]!;
      const lentCode = codeOf(`lent${r.key}`);
      const lent = ground.products[lentCode]!;
      const mapCode = codeOf(`map${r.key}`);
      const mapped = ground.products[mapCode]!;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      // GIVEN — a borrowed line (2 units of the lender's product), mapped by seller A to its own product.
      expect((await orderOf(page, orderId, ground.ret)).status).toBe("ORDER_STATUS_RETURN");

      // WHEN — Accept Return: the borrowed line says the own code it comes back as; both units onto R's rack, confirmed.
      await openAccept(page, orderId);
      await expect.soft(page.getByTestId(`return-accept-line-${itemId}`)).toHaveAttribute("data-borrowed", "true");
      await expect.soft(page.getByTestId(`return-accept-relabel-code-${itemId}`)).toContainText(mapCode);
      const answer = await countAndAccept(page, orderId, { rack: ground.retRack });
      expect(answer.status(), await answer.text()).toBe(200);
      const body = (await answer.json()) as { labels?: { ownProductId?: string; quantity?: number }[] };
      expect.soft(body.labels?.[0]?.ownProductId, "the label to print names the mapped own product").toBe(mapped);
      expect.soft(body.labels?.[0]?.quantity, "one label per sound unit").toBe(RELABEL_UNITS);

      // First: the print step is the page the accept lands on — the units are still in the crew's hands.
      await test.step("then: can print barcode of mapped own product", async () => {
        const step = page.getByTestId("return-accept-relabels");
        await expect(step).toBeVisible({ timeout: 15_000 });
        await expect.soft(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}/accept-return$`));
        await expect.soft(page.getByTestId("return-accept-relabels-accepted")).toContainText(`#${orderId}`);
        await expect.soft(page.getByTestId("return-accept-relabels-total")).toContainText(`${RELABEL_UNITS} labels to print`);

        // The line: the MAPPED own product's code, and one label per sound unit, stuck over the lender's.
        await expect.soft(page.getByTestId(`return-accept-relabels-line-${itemId}`)).toBeVisible();
        await expect.soft(page.getByTestId(`return-accept-relabels-code-${itemId}`)).toContainText(mapCode);
        const count = page.getByTestId(`return-accept-relabels-count-${itemId}`);
        await expect.soft(count).toContainText(`Print ${RELABEL_UNITS} labels`);
        await expect.soft(count).toContainText(lentCode);

        // What prints: one sticker per sound unit, each with its QR and the mapped own product's code — never the lender's.
        const printed = page.getByTestId("return-accept-relabels-root");
        await expect.soft(printed.locator(".print-label")).toHaveCount(RELABEL_UNITS);
        await expect.soft(printed.locator(".print-label svg")).toHaveCount(RELABEL_UNITS);
        await expect.soft(printed.getByTestId("label-sku")).toContainText(Array<string>(RELABEL_UNITS).fill(mapCode));
        await expect.soft(printed.getByText(lentCode)).toHaveCount(0);

        // Print Labels reaches the browser's print (stubbed — headless opens no dialog).
        await page.evaluate(() => {
          const w = window as unknown as { __printed: number; print: () => void };
          w.__printed = 0;
          w.print = () => {
            w.__printed += 1;
          };
        });
        await page.getByTestId("return-accept-relabel-print").click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);

        // Done leaves the step — back to the order the accept was opened from.
        await page.getByTestId("return-accept-relabels-done").click();
        await expect.soft(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}$`));
        await expect.soft(step).toHaveCount(0);
      });

      await test.step("then: ready stock of mapped own product increases", async () => {
        await sellerReady(browser, mapCode, String(RELABEL_UNITS));
        await expect.soft(await onRack(page, ground.retRack, mapped)).toHaveText(String(RELABEL_UNITS));
        await expect
          .soft(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${lent}`), "the lender's product is not on R's rack")
          .toHaveCount(0);
      });
    });
  }
});

// ── (status: return · 1 product · own product · all returned · 1 rack · return warehouse · courier charge with note) ────

test.describe("warehouse:all wants to accept a return (status: return · 1 product · own product · all returned · 1 rack · return warehouse · courier charge with note)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page, browser }) => {
      const orderId = ground.orders[`g5${r.key}`]!;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      expect((await orderOf(page, orderId, ground.ret)).status).toBe("ORDER_STATUS_RETURN");

      // WHEN — Accept Return with the courier's ask at the door, its note typed.
      const answer = await accepted(page, orderId, { rack: ground.retRack, charge: CHARGE, chargeNote: CHARGE_NOTE });
      const sent = JSON.parse(answer.request().postData() ?? "{}") as { courierCharge?: number; courierChargeNote?: string };
      expect.soft(sent.courierCharge).toBe(CHARGE);
      expect.soft(sent.courierChargeNote).toBe(CHARGE_NOTE);

      await test.step("then: courier charge recorded in liability to return warehouse", async () => {
        const seller = await pageAs(browser, A_OWNER, ground.sellerA);
        try {
          await expect
            .soft(async () => {
              await seller.goto(`/liability/${ground.ret}`);
              const entry = seller
                .getByTestId("liability-detail-all")
                .locator('[data-testid^="liability-detail-entry-"]')
                .filter({ hasText: new RegExp(`order #${orderId}(?!\\d)`) });
              await expect(entry).toHaveCount(1, { timeout: 3_000 });
              await expect(entry).toContainText(CHARGE.toLocaleString("id-ID"));
            })
            .toPass({ timeout: 30_000 });
        } finally {
          await seller.close();
        }
      });
    });
  }
});

// ── (status: return · 1 product · own product · return warehouse changed after order created · parcel at old return warehouse)

test.describe("warehouse:all wants to accept a return (status: return · 1 product · own product · return warehouse changed after order created · parcel at old return warehouse)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page }) => {
      const slot = `g6${r.key}`;
      const orderId = ground.orders[slot]!;
      const itemId = ground.items[orderId]!;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      // GIVEN — in return; seller C returned to R when it ordered, and returns to R2 now. The parcel is at R.
      expect((await orderOf(page, orderId, ground.ret)).status).toBe("ORDER_STATUS_RETURN");

      // WHEN — the crew with the parcel in hand: Receive a Return, the label's resi; then the accept page itself; then the
      // accept sent anyway, as the role.
      await page.goto("/warehouse-orders");
      await page.getByTestId("pick-queue-receive").click();
      await expect(page.getByTestId("receive-return-dialog")).toBeVisible();
      await page.getByTestId("receive-return-input").fill(resiOf(slot));
      await page.getByTestId("receive-return-input").press("Enter");
      const found = page.getByTestId(`receive-return-row-${orderId}`);
      await expect(found).toBeVisible({ timeout: 15_000 });
      const elsewhere = found.getByTestId(`receive-return-elsewhere-${orderId}`);
      await expect.soft(elsewhere).toBeVisible();
      const offered = await found.getByTestId(`receive-return-accept-${orderId}`).count();
      const elsewhereText = (await elsewhere.textContent()) ?? "";
      await page.keyboard.press("Escape");

      await page.goto(`/warehouse-orders/${orderId}/accept-return`);
      const refusal = page.getByTestId("return-accept-refused");
      await expect.soft(refusal).toBeVisible({ timeout: 15_000 });
      const submits = await page.getByTestId("return-accept-submit").count();

      const sent = await call(page, "selling.v1.OrderService/OrderReturnAccept", {
        teamId: ground.ret,
        orderId,
        lines: [{ orderItemId: itemId, placements: [{ rackId: ground.retRack, quantity: 1 }] }],
      });

      await test.step("then: cannot accept return", async () => {
        expect.soft(offered, "Accept on the found order").toBe(0);
        expect.soft(submits, "Accept on the accept page").toBe(0);
        expect.soft(sent.status, JSON.stringify(sent.body)).toBe(400);
        expect.soft(sent.body.code).toBe("failed_precondition");
        expect.soft((await orderOf(page, orderId, ground.ret)).status, "the order after").toBe("ORDER_STATUS_RETURN");
      });

      await test.step("then: message names new return warehouse", async () => {
        expect.soft(elsewhereText).toContain(R2_NAME);
        await expect.soft(page.getByTestId("return-accept-refused-title")).toHaveText(`This return goes to ${R2_NAME}`);
        expect.soft(String(sent.body.message ?? "")).toContain(`this return goes to ${R2_NAME}`);
      });

      await test.step("then: message says to keep parcel aside", async () => {
        expect.soft(elsewhereText).toContain("keep the parcel aside");
        await expect.soft(refusal).toContainText(`Keep the parcel aside until it is carried to ${R2_NAME}`);
        expect.soft(String(sent.body.message ?? "")).toContain("the parcel waits here until it is carried there");
      });
    });
  }
});

// ── (status: return · 1 product · own product · return warehouse · opname running on chosen rack) ────────────────────────

test.describe("warehouse:all wants to accept a return (status: return · 1 product · own product · return warehouse · opname running on chosen rack)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page }) => {
      const orderId = ground.orders[`g7${r.key}`]!;
      const productId = ground.products[codeOf("count")]!;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      // GIVEN — in return at R, and a count of R's rack the product is on is running.
      expect((await orderOf(page, orderId, ground.ret)).status).toBe("ORDER_STATUS_RETURN");

      // WHEN — Accept Return, the unit onto the counted rack, confirmed.
      await openAccept(page, orderId);
      const answer = await countAndAccept(page, orderId, { rack: ground.countRack });
      const body = (await answer.json().catch(() => ({}))) as { code?: string; message?: string };

      await test.step("then: accept refused", async () => {
        expect.soft(answer.status(), JSON.stringify(body)).toBe(400);
        expect.soft(body.code).toBe("failed_precondition");
        await expect.soft(page.getByTestId("return-accept-submit-error")).toBeVisible();
        await expect.soft(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}/accept-return$`));
        expect.soft((await orderOf(page, orderId, ground.ret)).status, "the order after").toBe("ORDER_STATUS_RETURN");
        // The rack holds what it held: 6 counted in, 3 taken by the three orders.
        await expect.soft(await onRack(page, ground.countRack, productId)).toHaveText(String(COUNT_STOCK - 3));
      });

      await test.step("then: message names opname", async () => {
        expect.soft(body.message ?? "").toContain(`count #${ground.countSession}`);
        await page.goBack();
        await openAccept(page, orderId);
        const again = await countAndAccept(page, orderId, { rack: ground.countRack });
        expect.soft(again.status()).toBe(400);
        await expect.soft(page.getByTestId("return-accept-submit-error")).toContainText(`count #${ground.countSession}`);
        await expect.soft(page.getByTestId("return-accept-submit-error")).toContainText("being counted");
      });
    });
  }
});

// ── 🚧 — its own test, so the expected failure hides none of the thens above ───────────────────────────────────────────

test(`warehouse:owner accept return (status: return · 1 product · own product · brokens on rack · 1 rack · return warehouse): brokens on rack`, async ({
  page,
}) => {
  test.fail(
    true,
    "🚧 unimplemented (docs/acceptances/inventory/order.md) — against a business decision: a-broken-returned-unit-is-thrown-away-at-the-door (a broken returned unit is thrown away, never shelved)",
  );

  const orderId = ground.orders.g3!;
  const itemId = ground.items[orderId]!;
  await signIn(page, userOf("whown"), PASSWORD);
  await useTeam(page, ground.ret);
  await openAccept(page, orderId);
  await page.getByTestId(`return-accept-broken-${itemId}`).fill("1");
  await expect(page.getByTestId(`return-accept-thrown-${itemId}`)).toHaveText("1");

  // The page offers a rack for the broken unit — field-agnostic: any rack control named for the broken units. The day one
  // is offered, this turns red — ask the owner.
  await test.step("then: brokens on rack", async () => {
    await expect(
      page
        .locator(
          `[data-testid^="return-accept-broken-rack-${itemId}"], [data-testid^="return-accept-broken-to-rack-${itemId}"], [data-testid^="return-accept-broken-place-${itemId}"]`,
        )
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

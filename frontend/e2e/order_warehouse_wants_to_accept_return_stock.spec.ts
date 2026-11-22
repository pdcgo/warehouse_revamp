import { expect, test } from "@playwright/test";
import type { Browser, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── accept return — THE RETURN'S STOCK HALF: docs/acceptances/inventory/order.md givens 84–87 (= inventory/return.md 14–17)
//
// accept return's regression spec, second file (order_warehouse_wants_to_accept_return.spec.ts holds givens 77–83): the
// checks for the thens hfrada's merge added on what the accept MINTS — the batches, their price, expiry and supplier, the
// markup on a borrowed line, the newest-first door, who bears it, and the note. One test.describe per given + when, one
// test.step("then: …") per then. `warehouse:all` → warehouse:owner, warehouse:admin and warehouse:staff of the return
// warehouse R, each signed in as itself, each on an order of its own; a then another team reads is read by one role
// there (selling:owner of seller A, or of the lender).
//
// Business rules (docs/business/inventory/return_decision.md):
// - a-return-mints-one-batch-per-batch-the-order-took — one batch per layer the take drew, each keeping its price, expiry
//   and supplier; the total is the order's COGS; a borrowed line's layers at the markup the team paid, the lender's batches
//   untouched, the units back as the mapped own product; units that do not come back come off the NEWEST layer first.
// - a-short-return-is-missing-at-the-door, a-broken-returned-unit-is-thrown-away-at-the-door — door rows, borne by the
//   selling team: never the warehouse's payable, never claimable, not in Inventory Lost.
// - a-return-door-row-carries-an-optional-note — copied onto the order's warehouse note.
//
// How each then is read:
// - `2 batches made, each with its price, expiry and supplier` — R's batches of the product (the role's own BatchList):
//   exactly two, both minted by this order's return, one per source batch at S with that batch's unit cost, expiry and
//   supplier and its units; on screen: both rows on R's Batch list naming the order, each batch's page reading its unit
//   cost, its expiry and its units (the page's own BatchDetail answer carrying the supplier), and Analytic › Returned
//   stock by SUPPLIER reading 2 back at supplier X and 1 at supplier Y.
// - `returned value Rp 32.000, the order's cost` — the crew's order page reads Product total Rp 32.000; R's Ready stock
//   by product reads 3 units, Rp 32.000 (the product had none at R); seller A's Returned stock reads back Rp 32.000.
// - `made at the price the team paid, markup included` — the MAPPED own product's batches at R: Rp 12.000 × 2 and
//   Rp 14.400 × 1 (the lender's Rp 10.000 and Rp 12.000 + 20 %), and the crew's order page reads Product total Rp 38.400.
// - `the lender's batches untouched` — the lender's own product page, Batch section: the same rows, the same figures
//   after the accept as before it, none at R; R holds no batch of the lender's product.
// - `missing unit taken off the newest batch` — the take drew 1 from the older batch (supplier X) and 2 from the newer
//   (supplier Y): Returned stock by supplier reads the missing unit at Y and none at X; the one batch minted is X's
//   Rp 10.000 (the sound unit is the oldest layer's).
// - `missing and broken borne by the selling team, not the warehouse's debt` — the accept page's summary says the 2
//   units are borne by seller A, not this warehouse; the warehouse note names both; seller A's ledger with R holds no
//   entry for the order — read after a later return with a courier charge (a probe) has its entry there.
// - `not counted in lost stock` — once Returned stock reads the missing unit, Lost stock by product reads 0 for it.
// - `note copied onto the order's warehouse note` — the record's one warehouse note names the broken unit with the
//   crew's note; Catatan on the crew's order page (from the Warehouse) and on the seller's shows it.
//
// GROUND (beforeAll, as root, through the API):
// - SELLER A ships from warehouse S and returns to warehouse R. LENDER L lends one product per role (crossMarkupBps
//   2000), stocked at S, mapped by seller A to an own product with no stock.
// - Stock at S, two restocks a team, the second accepted after the first: round 1 at Rp 10.000 a unit (supplier X / the
//   lender's LX, expiry 2027-03-31), round 2 at Rp 12.000 (supplier Y / LY, expiry 2027-06-30). Per role: (84) 2 + 1,
//   (85, lent) 2 + 2, (86) 1 + 2, (87) 2 + 0, the probe 1 + 0 — so a take of 3 draws 2 + 1 (84, 85) or 1 + 2 (86).
// - Per role five orders, each walked processed → picked → shipping by S and claimed back to `return` by seller A.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-accept-return-stock-1";
const P1 = 10_000;
const P2 = 12_000;
const E1 = "2027-03-31";
const E2 = "2027-06-30";
const MARKUP = 0.2;
const DOOR_NOTE = "sobek di jahitan";
const CHARGE = 7_500;
const CHARGE_NOTE = "ongkir retur probe";
const SELLER_A_NAME = `E2E ARStock Seller A ${SUFFIX}`;
const R_NAME = `E2E ARStock Return WH ${SUFFIX}`;

const WAREHOUSE = [
  { key: "whown", role: "ROLE_WAREHOUSE_OWNER", label: "warehouse:owner" },
  { key: "whadm", role: "ROLE_WAREHOUSE_ADMIN", label: "warehouse:admin" },
  { key: "whstf", role: "ROLE_WAREHOUSE_STAFF", label: "warehouse:staff" },
] as const;

const userOf = (key: string) => `e2eqb${key}${SUFFIX}`;
const A_OWNER = `e2eqbao${SUFFIX}`;
const L_OWNER = `e2eqblo${SUFFIX}`;
const refOf = (slot: string) => `QB${SUFFIX}${slot.toUpperCase()}`;
const resiOf = (slot: string) => `JB${SUFFIX}${slot.toUpperCase()}`;
const codeOf = (tag: string) => `QB${tag.toUpperCase()}${SUFFIX}`;
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

type Batch = {
  id?: string;
  unitCost?: number;
  expiresOnUnix?: string;
  supplierId?: string;
  ready?: string;
  origin?: string;
  returnOrderId?: string;
};

const ground = {
  sellerA: "",
  lender: "",
  ship: "", // warehouse S
  ret: "", // warehouse R — seller A's return warehouse
  shipRack: "",
  retRack: "",
  shop: "",
  x: "", // seller A's suppliers
  y: "",
  lx: "", // the lender's
  ly: "",
  // product code → id
  products: {} as Record<string, string>,
  // product code → its batches at S as the restocks minted them, oldest first
  source: {} as Record<string, Batch[]>,
  // slot → order id; order id → its one item's id
  orders: {} as Record<string, string>,
  items: {} as Record<string, string>,
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

type Log = { status?: string; from?: string; note?: string };
type OrderRecord = { status: string; goodsCost?: number; timelineLogs?: Log[] };

async function orderOf(page: Page, orderId: string, teamId: string): Promise<OrderRecord> {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId, orderId })).order as OrderRecord;
}

const isNote = (l: Log) => !l.status || l.status === "ORDER_STATUS_UNSPECIFIED";

// A warehouse's batches of one product, as its own BatchList reads them.
async function batchesAt(page: Page, warehouseId: string, productId: string): Promise<Batch[]> {
  type Listed = { ids?: string[]; items?: { batch?: { mapData: Record<string, Batch> } }[] };
  const listed = await ok<Listed>(page, "inventory.v1.InventoryService/BatchList", {
    teamId: warehouseId,
    filter: { productId },
    page: { page: 1, limit: 20 },
  });
  const map = Object.assign({}, ...(listed.items ?? []).map((i) => i.batch?.mapData ?? {})) as Record<string, Batch>;

  return (listed.ids ?? []).map((id) => ({ ...map[String(id)], id: String(id) }));
}

// ── the WHEN ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Count = { missing?: number; broken?: number; note?: string; charge?: number; chargeNote?: string };

// The crew opens the order (/warehouse-orders/<id>), Accept Return — the accept page, on the order's line.
async function openAccept(page: Page, orderId: string) {
  await page.goto(`/warehouse-orders/${orderId}`);
  const accept = page.getByTestId("pick-order-accept-return");
  await expect(accept).toBeVisible({ timeout: 15_000 });
  await accept.click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}/accept-return$`));
  await expect(page.getByTestId(`return-accept-line-${ground.items[orderId]!}`)).toBeVisible({ timeout: 15_000 });
}

// …counts the parcel, the sound units onto R's rack — ready to Accept, not yet sent.
async function count(page: Page, orderId: string, c: Count) {
  const itemId = ground.items[orderId]!;
  if (c.missing) await page.getByTestId(`return-accept-missing-${itemId}`).fill(String(c.missing));
  if (c.broken) await page.getByTestId(`return-accept-broken-${itemId}`).fill(String(c.broken));
  if (c.note) await page.getByTestId(`return-accept-note-${itemId}`).fill(c.note);

  const rackRow = page.getByTestId(`return-accept-rack-${itemId}-0`);
  await rackRow.getByTestId("rack-select").click();
  await rackRow.getByTestId(`rack-select-option-${ground.retRack}`).click();

  if (c.charge) {
    await page.getByTestId("return-accept-charge").fill(String(c.charge));
    await page.getByTestId("return-accept-charge-note").fill(c.chargeNote ?? "");
  }
  await expect(page.getByTestId("return-accept-ready")).toBeVisible();
}

// …Accept Return, confirmed — the OrderReturnAccept answer, which must be a 200.
async function submit(page: Page): Promise<Response> {
  await page.getByTestId("return-accept-submit").click();
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderReturnAccept`)),
    page.getByTestId("confirm-action").click(),
  ]);
  expect(answer.status(), await answer.text()).toBe(200);

  return answer;
}

async function accepted(page: Page, orderId: string, c: Count = {}) {
  await openAccept(page, orderId);
  await count(page, orderId, c);

  return submit(page);
}

// ── the reads ───────────────────────────────────────────────────────────────────────────────────────────────────────────

// A figure of Analytic, re-read until the fold lands.
async function metric(page: Page, url: string, cell: string, value: string) {
  await expect
    .soft(async () => {
      await page.goto(url);
      await expect(page.getByTestId(cell)).toHaveText(value, { timeout: 3_000 });
    })
    .toPass({ timeout: 30_000 });
}

// A batch's page as the crew reads it: its unit cost, expiry and units on screen, and the page's own BatchDetail answer
// (which carries the supplier — the page draws none).
async function batchPage(page: Page, batchId: string) {
  const answer = page.waitForResponse((r) => r.url().endsWith("/BatchDetail") && r.status() === 200);
  await page.goto(`/inventories/batches/${batchId}`);
  const read = ((await (await answer).json()) as { batch?: Batch }).batch ?? {};
  await expect(page.getByTestId("batch-detail-unit-cost")).toBeVisible({ timeout: 15_000 });

  return read;
}

// The expiry date as the batch screens print it — the day, the month (Mar / Jun read the same in English and
// Indonesian) and the year.
const EXPIRY_TEXT: Record<string, RegExp[]> = { [E1]: [/31/, /Mar/, /2027/], [E2]: [/30/, /Jun/, /2027/] };

// R's minted batches of one product checked against the source layers they copy: one per layer, its unit cost (× the
// markup on a borrowed line), expiry, supplier and the units back from it.
async function mintedMatch(page: Page, orderId: string, productId: string, layers: { from: Batch; units: number; price: number; expires: string }[]) {
  const minted = await batchesAt(page, ground.ret, productId);
  expect.soft(minted.length, "batches minted at R").toBe(layers.length);
  for (const m of minted) {
    expect.soft(m.origin, `batch ${m.id}'s origin`).toBe("BATCH_ORIGIN_RETURN");
    expect.soft(m.returnOrderId, `batch ${m.id}'s order`).toBe(orderId);
  }
  const byPrice = (price: number) => minted.find((m) => Math.abs(Number(m.unitCost ?? 0) - price) < 0.01);

  await page.goto("/inventories/batches");
  for (const l of layers) {
    const m = byPrice(l.price);
    expect.soft(m, `a batch at ${rp(l.price)}`).toBeTruthy();
    if (!m) continue;

    expect.soft(m.expiresOnUnix, `batch ${m.id}'s expiry is its source's`).toBe(l.from.expiresOnUnix);
    expect.soft(m.supplierId, `batch ${m.id}'s supplier is its source's`).toBe(l.from.supplierId);
    expect.soft(String(m.ready ?? "0"), `batch ${m.id}'s units`).toBe(String(l.units));
  }

  // On screen — the Batch list's rows, each naming the order's return…
  for (const m of minted) {
    await expect.soft(page.getByTestId(`batches-row-${m.id}`)).toBeVisible({ timeout: 15_000 });
    await expect.soft(page.getByTestId(`batches-source-${m.id}`)).toContainText(`#${orderId}`);
  }
  // …and each batch's page.
  for (const l of layers) {
    const m = byPrice(l.price);
    if (!m) continue;
    const read = await batchPage(page, m.id!);
    await expect.soft(page.getByTestId("batch-detail-unit-cost")).toContainText(l.price.toLocaleString("id-ID"));
    for (const part of EXPIRY_TEXT[l.expires]!) await expect.soft(page.getByTestId("batch-detail-expiry")).toContainText(part);
    await expect.soft(page.getByTestId("batch-detail-ready")).toHaveText(String(l.units));
    expect.soft(read.supplierId, "the batch page's own answer names the source's supplier").toBe(l.from.supplierId);
  }

  return minted;
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.sellerA = await team(SELLER_A_NAME, `QBA${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.lender = await team(`E2E ARStock Lender ${SUFFIX}`, `QBL${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.ship = await team(`E2E ARStock Ship WH ${SUFFIX}`, `QBS${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  ground.ret = await team(R_NAME, `QBR${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

  const returnsTo = async (teamId: string, warehouseId: string) =>
    ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId, warehouseId });
  await returnsTo(ground.sellerA, ground.ret);
  await returnsTo(ground.lender, ground.ship);
  for (const wh of [ground.ship, ground.ret]) {
    await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wh, feePercent: 1, minFee: 0 });
  }

  const user = async (teamId: string, key: string, username: string, role: string) => {
    const made = await ok(page, "user.v1.UserService/CreateUser", {
      teamId,
      username,
      password: PASSWORD,
      name: `ARStock ${key} ${SUFFIX}`,
      role,
    });
    ground.users[key] = String(made.user.id);
  };
  for (const r of WAREHOUSE) await user(ground.ret, r.key, userOf(r.key), r.role);
  await user(ground.sellerA, "ao", A_OWNER, "ROLE_SELLING_OWNER");
  await user(ground.lender, "lo", L_OWNER, "ROLE_SELLING_OWNER");

  ground.shop = String(
    (
      await ok(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.sellerA,
        name: `E2E ARStock Shop ${SUFFIX}`,
        shopCode: `QBP${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.sellerA, shopId: ground.shop, userId: ROOT_USER_ID });

  const rack = async (teamId: string, code: string) =>
    String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId, code })).rack.id);
  ground.shipRack = await rack(ground.ship, `qb-s-${SUFFIX}`);
  ground.retRack = await rack(ground.ret, `qb-r-${SUFFIX}`);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E ARStock ${SUFFIX}` })).category.id;

  const supplier = async (teamId: string, tag: string) =>
    String(
      (
        await ok(page, "supplier.v1.SupplierService/SupplierCreate", {
          teamId,
          name: `E2E ARStock Pemasok ${tag} ${SUFFIX}`,
          contact: "0812-7700-1234",
          address: `Jl. Pemasok ${tag} No. 1, Bandung`,
        })
      ).supplier.id,
    );
  ground.x = await supplier(ground.sellerA, "X");
  ground.y = await supplier(ground.sellerA, "Y");
  ground.lx = await supplier(ground.lender, "LX");
  ground.ly = await supplier(ground.lender, "LY");

  const product = async (teamId: string, code: string, cross = false) => {
    const made = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId,
        productCodePart: code,
        name: `E2E ${code}`,
        categoryId: category,
        ...(cross ? { crossMarkupBps: 2000 } : {}),
      })
    ).product as { id: string };
    ground.products[code] = String(made.id);
  };
  const account = async (teamId: string, tag: string) => {
    const id = (
      await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E accept return stock ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-QB-${tag}-${SUFFIX}`,
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
  // One restock of `lines` [code, count], every unit at `price` from `supplierId`, accepted at S onto its rack with
  // `expiresOn` on every line.
  const restock = async (teamId: string, accountId: string, supplierId: string, price: number, expiresOn: string, lines: [string, number][]) => {
    const raised = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId,
      warehouseId: ground.ship,
      financeAccountId: accountId,
      items: lines.map(([code, n]) => ({
        productId: ground.products[code],
        productCode: code,
        name: `E2E ${code}`,
        count: n,
        total: n * price,
        supplierId,
      })),
    });
    await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.ship,
      requestId: raised.request.id,
      lines: (raised.request.items as { id: string }[]).map((item, i) => ({
        itemId: item.id,
        receivedCount: lines[i]![1],
        placements: [{ placementId: ground.shipRack, quantity: lines[i]![1] }],
        expiresOn,
      })),
    });
  };

  for (const r of WAREHOUSE) {
    for (const tag of ["b84", "b86", "b87", "pr", "m85"]) await product(ground.sellerA, codeOf(`${tag}${r.key}`));
    await product(ground.lender, codeOf(`l85${r.key}`), true);
  }
  const accountA = await account(ground.sellerA, "A");
  const accountL = await account(ground.lender, "L");
  // Round 1 — Rp 10.000, supplier X (LX), expiring first; round 2 — Rp 12.000, supplier Y (LY), accepted after it.
  const of = (tag: string, n: number) => WAREHOUSE.map((r) => [codeOf(`${tag}${r.key}`), n] as [string, number]);
  await restock(ground.sellerA, accountA, ground.x, P1, E1, [...of("b84", 2), ...of("b86", 1), ...of("b87", 2), ...of("pr", 1)]);
  await restock(ground.lender, accountL, ground.lx, P1, E1, of("l85", 2));
  await restock(ground.sellerA, accountA, ground.y, P2, E2, [...of("b84", 1), ...of("b86", 2)]);
  await restock(ground.lender, accountL, ground.ly, P2, E2, of("l85", 2));

  // The source layers at S, oldest first.
  for (const r of WAREHOUSE) {
    for (const tag of ["b84", "b86", "l85"]) {
      const code = codeOf(`${tag}${r.key}`);
      const batches = await batchesAt(page, ground.ship, ground.products[code]!);
      ground.source[code] = batches.sort((a, b) => Number(a.unitCost ?? 0) - Number(b.unitCost ?? 0));
      expect(ground.source[code]!.map((b) => Number(b.unitCost))).toEqual([P1, P2]);
    }
    await ok(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
      teamId: ground.sellerA,
      sharedProductId: ground.products[codeOf(`l85${r.key}`)],
      ownProductId: ground.products[codeOf(`m85${r.key}`)],
    });
  }

  // GIVEN — every order placed by root, walked to the courier by S and claimed back by seller A.
  const place = async (slot: string, code: string, quantity: number) => {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-accept-return-stock-${slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.sellerA,
      shopId: ground.shop,
      warehouseId: ground.ship,
      customerName: `E2E ARStock Buyer ${slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(slot),
      receiptCode: resiOf(slot),
      items: [{ productId: ground.products[code], productCode: code, name: `E2E ${code}`, quantity }],
    });
    const id = String(placed.order.id);
    ground.orders[slot] = id;
    ground.items[id] = String(placed.order.items[0].id);
    for (const s of ["PROCESSED", "PICKED", "SHIPPING"]) await move(page, ground.ship, id, s);
    await move(page, ground.sellerA, id, "RETURN");
  };
  for (const r of WAREHOUSE) {
    await place(`o84${r.key}`, codeOf(`b84${r.key}`), 3);
    await place(`o85${r.key}`, codeOf(`l85${r.key}`), 3);
    await place(`o86${r.key}`, codeOf(`b86${r.key}`), 3);
    await place(`o87${r.key}`, codeOf(`b87${r.key}`), 2);
    await place(`pr${r.key}`, codeOf(`pr${r.key}`), 1);
  }
  await page.close();
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── (status: return · 1 product · own product · 3 units taken 2 from a Rp 10.000 batch and 1 from a Rp 12.000 batch …) ──

test.describe("warehouse:all wants to accept a return (status: return · 1 product · own product · 3 units taken 2 from a Rp 10.000 batch and 1 from a Rp 12.000 batch · all returned · 1 rack · return warehouse)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page, browser }) => {
      const slot = `o84${r.key}`;
      const orderId = ground.orders[slot]!;
      const code = codeOf(`b84${r.key}`);
      const productId = ground.products[code]!;
      const [b1, b2] = ground.source[code]!;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      // GIVEN — in return at R; the take drew 2 × Rp 10.000 and 1 × Rp 12.000 — the order's cost, Rp 32.000.
      const before = await orderOf(page, orderId, ground.ret);
      expect(before.status).toBe("ORDER_STATUS_RETURN");
      expect(Number(before.goodsCost)).toBe(2 * P1 + P2);

      // WHEN — Accept Return: the whole parcel onto R's rack, confirmed.
      await accepted(page, orderId);

      await test.step("then: 2 batches made, each with its price, expiry and supplier", async () => {
        await mintedMatch(page, orderId, productId, [
          { from: b1!, units: 2, price: P1, expires: E1 },
          { from: b2!, units: 1, price: P2, expires: E2 },
        ]);
        // The suppliers on screen: Analytic › Returned stock by supplier — 2 back at X, 1 at Y.
        const bySupplier = `/analytic?g=supplier&m=metrics/inventory/return&r=7d&product=${productId}`;
        await metric(page, bySupplier, `analytic-cell-${ground.x}-back_count`, "2");
        await metric(page, bySupplier, `analytic-cell-${ground.y}-back_count`, "1");
      });

      await test.step("then: returned value Rp 32.000, the order's cost", async () => {
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        await expect.soft(page.getByTestId("order-detail-goods-cost")).toContainText(rp(2 * P1 + P2));

        const ready = `/analytic?g=product&m=metrics/inventory/ready&r=7d&product=${productId}`;
        await metric(page, ready, `analytic-cell-${productId}-on_hand_value`, rp(2 * P1 + P2));
        await expect.soft(page.getByTestId(`analytic-cell-${productId}-on_hand_count`)).toHaveText("3");

        // The value of what came back, as the selling team reads it — a warehouse reads Returned stock's units only.
        const seller = await pageAs(browser, A_OWNER, ground.sellerA);
        try {
          await metric(
            seller,
            `/analytic?g=product&m=metrics/inventory/return&r=7d&product=${productId}`,
            `analytic-cell-${productId}-back_value`,
            rp(2 * P1 + P2),
          );
        } finally {
          await seller.close();
        }
      });
    });
  }
});

// ── (status: return · 1 product · cross product · return map chosen · borrowed at 20% markup · all returned …) ─────────

test.describe("warehouse:all wants to accept a return (status: return · 1 product · cross product · return map chosen · borrowed at 20% markup · all returned · 1 rack · return warehouse)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page, browser }) => {
      const orderId = ground.orders[`o85${r.key}`]!;
      const lentCode = codeOf(`l85${r.key}`);
      const lent = ground.products[lentCode]!;
      const mapped = ground.products[codeOf(`m85${r.key}`)]!;
      const [b1, b2] = ground.source[lentCode]!;
      const paid1 = P1 * (1 + MARKUP);
      const paid2 = P2 * (1 + MARKUP);

      // The lender's batches of its product, as its own product page shows them — before the WHEN.
      const lender = await pageAs(browser, L_OWNER, ground.lender);
      const lenderRows = async () => {
        await lender.goto(`/products/${lent}`);
        const rows = lender.getByTestId("pd-batch-table").locator('[data-testid^="pd-batch-row-"]');
        await expect(rows.first()).toBeVisible({ timeout: 15_000 });

        return rows.evaluateAll((els) => els.map((e) => `${e.getAttribute("data-testid")} | ${(e.textContent ?? "").trim()}`));
      };
      const lenderBefore = await lenderRows();

      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      // GIVEN — a borrowed line of 3, mapped by seller A to its own product; the take drew the lender's 2 × Rp 10.000 and
      // 1 × Rp 12.000, which seller A paid at 20 % on top: Rp 38.400.
      const before = await orderOf(page, orderId, ground.ret);
      expect(before.status).toBe("ORDER_STATUS_RETURN");
      expect(Number(before.goodsCost)).toBe(2 * paid1 + paid2);

      // WHEN — Accept Return: the 3 onto R's rack, confirmed (the page then offers the labels to print).
      await accepted(page, orderId);

      await test.step("then: made at the price the team paid, markup included", async () => {
        await mintedMatch(page, orderId, mapped, [
          { from: b1!, units: 2, price: paid1, expires: E1 },
          { from: b2!, units: 1, price: paid2, expires: E2 },
        ]);
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        await expect.soft(page.getByTestId("order-detail-goods-cost")).toContainText(rp(2 * paid1 + paid2));
      });

      await test.step("then: the lender's batches untouched", async () => {
        try {
          const after = await lenderRows();
          expect.soft(after, "the lender's batch rows after the accept").toEqual(lenderBefore);
          expect.soft(after.join("\n"), "no batch of the lender's at R").not.toContain(R_NAME);
        } finally {
          await lender.close();
        }
        expect.soft((await batchesAt(page, ground.ret, lent)).length, "R's batches of the lender's product").toBe(0);
      });
    });
  }
});

// ── (status: return · 1 product · own product · 3 units · 1 missing · 1 broken · 1 rack · return warehouse) ─────────────

test.describe("warehouse:all wants to accept a return (status: return · 1 product · own product · 3 units · 1 missing · 1 broken · 1 rack · return warehouse)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page, browser }) => {
      const orderId = ground.orders[`o86${r.key}`]!;
      const probe = ground.orders[`pr${r.key}`]!;
      const code = codeOf(`b86${r.key}`);
      const productId = ground.products[code]!;
      const [b1] = ground.source[code]!;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      // GIVEN — 3 ordered: the take drew 1 from the older batch (Rp 10.000, supplier X) and 2 from the newer (Rp 12.000,
      // supplier Y); 1 is not in the box and 1 is too damaged to sell.
      const before = await orderOf(page, orderId, ground.ret);
      expect(before.status).toBe("ORDER_STATUS_RETURN");
      expect(Number(before.goodsCost)).toBe(P1 + 2 * P2);

      // WHEN — Accept Return: 1 missing, 1 broken (with a note), the 1 sound onto R's rack, confirmed. The summary is read
      // on the counted page, before it is sent.
      await openAccept(page, orderId);
      await count(page, orderId, { missing: 1, broken: 1, note: DOOR_NOTE });
      const borne = (await page.getByTestId("return-accept-summary-borne").textContent()) ?? "";
      await submit(page);

      await test.step("then: missing unit taken off the newest batch", async () => {
        const bySupplier = `/analytic?g=supplier&m=metrics/inventory/return&r=7d&product=${productId}`;
        await metric(page, bySupplier, `analytic-cell-${ground.y}-missing_count`, "1");
        const atX = page.getByTestId(`analytic-cell-${ground.x}-missing_count`);
        if ((await atX.count()) > 0) await expect.soft(atX, "missing at the older batch's supplier").toHaveText("0");
        await expect.soft(page.getByTestId(`analytic-cell-${ground.x}-back_count`)).toHaveText("1");
        // What came back sound is the OLDEST layer's: one batch, X's Rp 10.000.
        await mintedMatch(page, orderId, productId, [{ from: b1!, units: 1, price: P1, expires: E1 }]);
      });

      await test.step("then: missing and broken borne by the selling team, not the warehouse's debt", async () => {
        expect.soft(borne, "the accept page's summary").toContain(`2 units are borne by ${SELLER_A_NAME}, not this warehouse`);
        const notes = ((await orderOf(page, orderId, ground.ret)).timelineLogs ?? []).filter(
          (l) => isNote(l) && (l.note ?? "").includes("Missing from the returned parcel"),
        );
        expect.soft(notes.length, "the warehouse note naming the door").toBe(1);
        expect.soft(notes[0]?.note ?? "").toContain("Broken, thrown away: 1 ×");

        // Nothing posts to the ledger between seller A and R for it: read once a LATER return's courier charge (the
        // probe, accepted now by the same crew) has its entry there — so the ledger has caught up past this accept.
        await accepted(page, probe, { charge: CHARGE, chargeNote: CHARGE_NOTE });
        const seller = await pageAs(browser, A_OWNER, ground.sellerA);
        try {
          const entries = () => seller.getByTestId("liability-detail-all").locator('[data-testid^="liability-detail-entry-"]');
          await expect
            .soft(async () => {
              await seller.goto(`/liability/${ground.ret}`);
              const p = entries().filter({ hasText: new RegExp(`order #${probe}(?!\\d)`) });
              await expect(p).toHaveCount(1, { timeout: 3_000 });
              await expect(p).toContainText(CHARGE.toLocaleString("id-ID"));
            })
            .toPass({ timeout: 30_000 });
          await expect.soft(entries().filter({ hasText: new RegExp(`order #${orderId}(?!\\d)`) })).toHaveCount(0);
        } finally {
          await seller.close();
        }
      });

      await test.step("then: not counted in lost stock", async () => {
        await metric(
          page,
          `/analytic?g=product&m=metrics/inventory/return&r=7d&product=${productId}`,
          `analytic-cell-${productId}-missing_count`,
          "1",
        );
        await page.goto(`/analytic?g=product&m=metrics/inventory/lost&r=7d&product=${productId}`);
        await expect.soft(page.getByTestId("analytic-headline-lost_count-value")).toHaveText("0", { timeout: 15_000 });
        const cell = page.getByTestId(`analytic-cell-${productId}-lost_count`);
        if ((await cell.count()) > 0) await expect.soft(cell).toHaveText("0");
      });
    });
  }
});

// ── (status: return · 1 product · own product · 1 broken · note "sobek di jahitan" · 1 rack · return warehouse) ─────────

test.describe('warehouse:all wants to accept a return (status: return · 1 product · own product · 1 broken · note "sobek di jahitan" · 1 rack · return warehouse)', () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} accept return`, async ({ page, browser }) => {
      const orderId = ground.orders[`o87${r.key}`]!;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ret);

      expect((await orderOf(page, orderId, ground.ret)).status).toBe("ORDER_STATUS_RETURN");

      // WHEN — Accept Return: 1 of the 2 broken, its note typed, the sound one onto R's rack, confirmed.
      await accepted(page, orderId, { broken: 1, note: DOOR_NOTE });

      await test.step("then: note copied onto the order's warehouse note", async () => {
        const notes = ((await orderOf(page, orderId, ground.ret)).timelineLogs ?? []).filter(
          (l) => isNote(l) && (l.note ?? "").includes("Broken, thrown away"),
        );
        expect.soft(notes.length, "the warehouse note rows naming the door").toBe(1);
        expect.soft(notes[0]?.from).toBe("ORDER_TIMELINE_FROM_WAREHOUSE");
        expect.soft(notes[0]?.note ?? "").toContain("Broken, thrown away: 1 ×");
        expect.soft(notes[0]?.note ?? "").toContain(DOOR_NOTE);

        // The crew's order page — Catatan, from the Warehouse.
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        const row = page.getByTestId("order-detail-notes").getByTestId("order-note").filter({ hasText: "Broken, thrown away" });
        await expect.soft(row).toHaveCount(1, { timeout: 15_000 });
        await expect.soft(row).toHaveAttribute("data-from", "warehouse");
        await expect.soft(row).toContainText(DOOR_NOTE);

        // …and the seller's, where customer service claims it.
        const seller = await pageAs(browser, A_OWNER, ground.sellerA);
        try {
          await seller.goto(`/orders/${orderId}`);
          const box = seller.getByTestId("section-notes");
          await expect.soft(box).toContainText("Broken, thrown away: 1 ×", { timeout: 15_000 });
          await expect.soft(box).toContainText(DOOR_NOTE);
        } finally {
          await seller.close();
        }
      });
    });
  }
});

import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── return order — the checks behind docs/acceptances/inventory/order.md (## return) ─────────────────────────────────────
//
// return order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are the
// owner's, set by hand — never by this file.
//
// Business rules (docs/business/order/context_decision.md):
// - a-forced-return-follows-the-status-move: a return leaves `shipping`, `shipped`, `problem` or `completed` — never
//   `pending`, `processed` or `picked` (the goods never left) and never an end status. Customer service claims it back,
//   or the warehouse forces it; both are the plain move to `return`.
// - the seller's action table (features/orders/rowActions.ts, every-allowed-move-has-a-button): Return Goods on
//   `shipping`, `shipped`, `problem` and `completed`, behind a confirm; ABSENT (never greyed) on `picked`.
// - a-return-is-received-by-search-then-forced: the shipping warehouse's crew receives a parcel whose return nobody has
//   claimed — Receive a Return on its Orders, the label scanned, Force Return, confirmed, then straight on to Accept Return.
// - a-return-may-land-in-another-warehouse + only-the-return-warehouse-accepts-a-return: the return goes to the selling
//   team's CONFIGURED return warehouse — that warehouse reads the order once it is in `return`, and only it accepts.
// - the-warehouse-list-has-a-returns-tab: a warehouse's Returns tab lists the returns addressed to it.
// - the return metric: metrics/orders/return_created counts each order on its move to `return`.
//
// `selling:all` → EVERY selling role (selling:owner, selling:admin, selling:cs); `warehouse:all` → EVERY warehouse role
// (warehouse:owner, warehouse:admin, warehouse:staff). Each in its own browser session, each on an order of its own. A then
// seen by the other team is read by one role there: the return warehouse's crew (warehouse:staff), the selling team's
// owner (selling:owner).
//
// The WHENs:
// - selling — customer service works down Orders › <the order's status tab>: the order's row (the list narrowed by its
//   Order ID), its row menu, Return Goods, confirmed. (The order page's own Return Goods button is pressed by orders.spec's
//   return test.)
// - warehouse — the parcel is in the crew's hands before anyone claimed it back: Orders › Receive a Return, the label's
//   resi typed and Enter, the found order's Force Return, confirmed — which opens the accept page.
// - picked — the row menu is opened on Orders › Picked; Return Goods is not in it, and the move sent anyway is refused.
//
// How each then is read:
// - `status changed from <s> to return` — the order's own record says ORDER_STATUS_RETURN; on the seller's Orders it has
//   left the <s> tab and stands on the Return tab with the Return badge (order-status-11). For the warehouse's return: the
//   record, and the order on the warehouse's own Returns tab with the badge.
// - `return recorded in order timeline` — ONE "Return started" step (order-timeline-return), from the side that returned
//   it, naming its user — on the page that side reads (the seller's order page; the crew's order page, Timeline tab) — and
//   the record's timeline has ONE return row, from that side, by that user.
// - `return warehouse sees order return` — the configured return warehouse (NOT the one that shipped it): its crew finds
//   the order on its Returns tab with the Return badge, opens it with the badge, and reads it as ORDER_STATUS_RETURN.
// - `selling team sees order return` — selling:owner: the order page's stepper at Return with the badge, one "Return
//   started" step from the Warehouse, and the order on Orders › Return.
// - `return recorded in analytic metric` — Analytic › Return created, last 7 days, by shop, the role's own shop (its
//   only returned order): 1. The figure lands on a fold, so it is re-read until it does.
// - `return can be accepted` — the return warehouse's crew: the order's page offers Accept Return, the accept page opens
//   on the order's line, the unit goes onto the warehouse's rack, Accept is confirmed, and the order reads
//   ORDER_STATUS_RETURN_COMPLETED. (What the accept itself records — stock, history, metric — is accept return's spec.)
// - `cannot return order` — Return Goods is absent from the picked order's row menu and from its page; the move sent
//   anyway is refused, and the order stays picked.
//
// GROUND (beforeAll, as root, through the API):
// - SELLER A, with a user per selling role, a shop per role (the shipped order each role returns — so the role's shop
//   counts ONE return) and one shared shop (every other order), root and the CS on all four. It ships from warehouse S and
//   RETURNS TO warehouse R (a second building, with a rack and a warehouse:staff user).
// - SELLER B, with a selling:owner user and one shop: it ships from S and returns to S — the warehouse that holds the
//   parcel is the one that accepts it. S has a user per warehouse role and a rack.
// - One product per seller, its units accepted onto S's rack. Orders of 1 unit, walked to their given by the warehouse
//   (processed → picked → shipping) and the seller (→ shipped, → problem, → completed): for seller A, per role one
//   shipped (its own shop), one shipping, one problem, one completed, one picked; for seller B one shipped per warehouse
//   role and one picked (the regression). Seeded in beforeAll so a worker restarted after a failure seeds its own.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-return-pass-1";
const PRODUCT_A = `Sabun Retur ${SUFFIX}`;
const PRODUCT_B = `Sampo Retur ${SUFFIX}`;
const STOCK_A = 20;
const STOCK_B = 6;

const SELLING = [
  { key: "own", role: "ROLE_SELLING_OWNER", label: "selling:owner" },
  { key: "adm", role: "ROLE_SELLING_ADMIN", label: "selling:admin" },
  { key: "cs", role: "ROLE_SELLING_CS", label: "selling:cs" },
] as const;
type SellKey = (typeof SELLING)[number]["key"];

const WAREHOUSE = [
  { key: "whown", role: "ROLE_WAREHOUSE_OWNER", label: "warehouse:owner" },
  { key: "whadm", role: "ROLE_WAREHOUSE_ADMIN", label: "warehouse:admin" },
  { key: "whstf", role: "ROLE_WAREHOUSE_STAFF", label: "warehouse:staff" },
] as const;
type WhKey = (typeof WAREHOUSE)[number]["key"];

// The selling givens a return LEAVES (other than shipped), each with the tab its order stands on and how it got there.
const FROM = [
  { status: "shipping", tab: "shipping", record: "ORDER_STATUS_SHIPPING" },
  { status: "problem", tab: "problem", record: "ORDER_STATUS_PROBLEM" },
  { status: "completed", tab: "completed", record: "ORDER_STATUS_COMPLETED" },
] as const;

const userOf = (key: string) => `e2ern${key}${SUFFIX}`;
const nameOf = (key: string) => `Return ${key} ${SUFFIX}`;
const RC_USER = `e2ernrc${SUFFIX}`; // the return warehouse's crew
const B_OWNER = `e2ernbo${SUFFIX}`; // seller B's owner
// The marketplace's Order ID and the label's resi — both carry the run's suffix (a repeat within a team is refused).
const refOf = (slot: string) => `RN${SUFFIX}${slot.toUpperCase()}`;
const resiOf = (slot: string) => `JR${SUFFIX}${slot.toUpperCase()}`;

const ground = {
  sellerA: "",
  sellerB: "",
  ship: "", // warehouse S — ships every order; seller B's return warehouse
  ret: "", // warehouse R — seller A's return warehouse
  shipRack: "",
  retRack: "",
  shop: "", // seller A's shared shop
  shopB: "",
  // seller A's role → the shop of its shipped order
  roleShops: {} as Record<string, string>,
  // slot → order id / its one item's id
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

type MoveResult = { orderId?: string; moved?: boolean; refusedReason?: string };

async function tryMove(page: Page, teamId: string, orderId: string, to: string): Promise<MoveResult> {
  const res = await ok<{ results: MoveResult[] }>(page, "selling.v1.OrderService/OrderStatusChange", {
    teamId,
    orderIds: [orderId],
    to: `ORDER_STATUS_${to}`,
  });

  return res.results[0] ?? {};
}

async function move(page: Page, teamId: string, orderId: string, to: string) {
  const res = await tryMove(page, teamId, orderId, to);
  expect(res.moved, `${orderId} → ${to}: ${res.refusedReason}`).toBe(true);
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

type OrderRecord = {
  status: string;
  timelineLogs?: { status?: string; from?: string; actorId?: string; note?: string }[];
};

// The order as the server keeps it, read in `teamId` (the seller's, or a warehouse's).
async function orderOf(page: Page, orderId: string, teamId: string): Promise<OrderRecord> {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId, orderId })).order as OrderRecord;
}

// The seller's Orders on one status tab, narrowed by the order's Order ID — the list has drawn its answer (rows or the
// empty state) once this returns.
async function openOrdersTab(page: Page, status: string, ref: string) {
  await page.goto(`/orders?status=${status}&q=${ref}`);
  await expect(page.getByTestId(`orders-tab-${status}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("orders-table").or(page.getByTestId("orders-empty")).first()).toBeVisible({ timeout: 15_000 });
}

// THE SELLING WHEN — Orders › <tab>, the order's row menu, Return Goods, confirmed. Returns the OrderStatusChange sent.
async function returnGoods(page: Page, orderId: string, ref: string, tab: string) {
  await openOrdersTab(page, tab, ref);
  await expect(page.getByTestId(`order-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(`order-actions-${orderId}`).click();
  const item = page.getByTestId(`order-returnGoods-${orderId}`);
  await expect(item).toBeVisible();
  await expect.soft(item).toContainText("Return Goods");
  await item.click();

  // Destructive — it confirms first, and nothing moves until it is confirmed.
  const confirm = page.getByTestId("confirm-action");
  await expect(confirm).toBeVisible();
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
    confirm.click(),
  ]);
  expect(answer.status(), await answer.text()).toBe(200);
  const body = (await answer.json()) as { results: MoveResult[] };
  expect(body.results[0]?.moved, `return #${orderId}: ${body.results[0]?.refusedReason}`).toBe(true);

  return JSON.parse(answer.request().postData() ?? "{}") as { orderIds?: string[]; to?: string };
}

// `return can be accepted` — the return warehouse's crew on `p` (working in `warehouse`, whose rack is `rack`): the
// order's page offers Accept Return, the accept page takes the one unit onto the rack, and the order is accepted.
async function acceptReturn(p: Page, orderId: string, warehouse: string, rack: string) {
  await p.goto(`/warehouse-orders/${orderId}`);
  const accept = p.getByTestId("pick-order-accept-return");
  await expect(accept).toBeVisible({ timeout: 15_000 });
  await accept.click();
  await expect(p).toHaveURL(new RegExp(`/warehouse-orders/${orderId}/accept-return$`));

  const itemId = ground.items[orderId]!;
  await expect(p.getByTestId(`return-accept-line-${itemId}`)).toBeVisible({ timeout: 15_000 });
  await expect.soft(p.getByTestId("return-accept-refused")).toHaveCount(0);
  const rackRow = p.getByTestId(`return-accept-rack-${itemId}-0`);
  await rackRow.getByTestId("rack-select").click();
  await rackRow.getByTestId(`rack-select-option-${rack}`).click();
  await expect(p.getByTestId("return-accept-ready")).toBeVisible();

  await p.getByTestId("return-accept-submit").click();
  const [answer] = await Promise.all([
    p.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderReturnAccept`)),
    p.getByTestId("confirm-action").click(),
  ]);
  expect(answer.status(), await answer.text()).toBe(200);
  await expect.soft(p).toHaveURL(new RegExp(`/warehouse-orders/${orderId}$`));
  expect.soft((await orderOf(p, orderId, warehouse)).status, "the order once accepted").toBe("ORDER_STATUS_RETURN_COMPLETED");
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.sellerA = await team(`E2E Return Seller A ${SUFFIX}`, `RNA${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.sellerB = await team(`E2E Return Seller B ${SUFFIX}`, `RNB${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.ship = await team(`E2E Return Ship WH ${SUFFIX}`, `RNS${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  ground.ret = await team(`E2E Return Back WH ${SUFFIX}`, `RNR${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

  // Seller A's returns go to the OTHER building; seller B's come back to the one that ships.
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.sellerA,
    warehouseId: ground.ret,
  });
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.sellerB,
    warehouseId: ground.ship,
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.ship, feePercent: 1, minFee: 0 });

  const user = async (teamId: string, key: string, username: string, role: string) => {
    const made = await ok(page, "user.v1.UserService/CreateUser", {
      teamId,
      username,
      password: PASSWORD,
      name: nameOf(key),
      role,
    });
    ground.users[key] = String(made.user.id);
  };
  for (const r of SELLING) await user(ground.sellerA, r.key, userOf(r.key), r.role);
  for (const r of WAREHOUSE) await user(ground.ship, r.key, userOf(r.key), r.role);
  await user(ground.ret, "rc", RC_USER, "ROLE_WAREHOUSE_STAFF");
  await user(ground.sellerB, "bo", B_OWNER, "ROLE_SELLING_OWNER");

  const shop = async (teamId: string, name: string, shopCode: string, cs?: string) => {
    const id = String(
      (await ok(page, "selling.v1.ShopService/ShopCreate", { teamId, name, shopCode, marketplace: "MARKETPLACE_SHOPEE" })).shop
        .id,
    );
    // Root first — the first grant is the shop's primary CS; the CS on it too.
    await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId, shopId: id, userId: ROOT_USER_ID });
    if (cs) await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId, shopId: id, userId: cs });

    return id;
  };
  ground.shop = await shop(ground.sellerA, `E2E Retur Shop ${SUFFIX}`, `RNP${SUFFIX}`, ground.users.cs);
  for (const r of SELLING) {
    ground.roleShops[r.key] = await shop(
      ground.sellerA,
      `E2E Retur Shop ${r.key} ${SUFFIX}`,
      `RN${r.key.toUpperCase()}${SUFFIX}`,
      ground.users.cs,
    );
  }
  ground.shopB = await shop(ground.sellerB, `E2E Retur Shop B ${SUFFIX}`, `RNQ${SUFFIX}`);

  ground.shipRack = String(
    (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.ship, code: `rn-s-${SUFFIX}` })).rack.id,
  );
  ground.retRack = String(
    (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.ret, code: `rn-r-${SUFFIX}` })).rack.id,
  );
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Return ${SUFFIX}` })).category.id;

  // A product of each seller, its units on S's rack, paid from that seller's operational account.
  const stock = async (teamId: string, code: string, name: string, count: number, tag: string) => {
    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", { teamId, productCodePart: code, name, categoryId: category })
    ).product;
    const account = (
      await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E return ${tag} ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-RTN-${tag}-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id;
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId,
      accountId: account,
      operational: true,
    });
    const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId,
      warehouseId: ground.ship,
      financeAccountId: account,
      items: [{ productId: product.id, productCode: product.productCode, name, count, total: count * 10_000 }],
    });
    await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.ship,
      requestId: restock.request.id,
      lines: [
        { itemId: restock.request.items[0].id, receivedCount: count, placements: [{ placementId: ground.shipRack, quantity: count }] },
      ],
    });

    return product as { id: string; productCode: string };
  };
  const productA = await stock(ground.sellerA, `RNKA${SUFFIX}`, PRODUCT_A, STOCK_A, "A");
  const productB = await stock(ground.sellerB, `RNKB${SUFFIX}`, PRODUCT_B, STOCK_B, "B");

  // GIVEN — every order placed by root, walked by the warehouse (processed → picked → shipping) and by the seller.
  const PATHS: Record<string, { warehouse: string[]; seller: string[] }> = {
    picked: { warehouse: ["PROCESSED", "PICKED"], seller: [] },
    shipping: { warehouse: ["PROCESSED", "PICKED", "SHIPPING"], seller: [] },
    shipped: { warehouse: ["PROCESSED", "PICKED", "SHIPPING"], seller: ["SHIPPED"] },
    problem: { warehouse: ["PROCESSED", "PICKED", "SHIPPING"], seller: ["SHIPPED", "PROBLEM"] },
    completed: { warehouse: ["PROCESSED", "PICKED", "SHIPPING"], seller: ["SHIPPED", "COMPLETED"] },
  };
  const place = async (slot: string, seller: string, shopId: string, product: { id: string; productCode: string }, name: string, to: string) => {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-return-${slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: seller,
      shopId,
      warehouseId: ground.ship,
      customerName: `E2E Return Buyer ${slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(slot),
      receiptCode: resiOf(slot),
      items: [{ productId: product.id, productCode: product.productCode, name, quantity: 1 }],
    });
    const id = String(placed.order.id);
    ground.orders[slot] = id;
    ground.items[id] = String(placed.order.items[0].id);
    for (const s of PATHS[to]!.warehouse) await move(page, ground.ship, id, s);
    for (const s of PATHS[to]!.seller) await move(page, seller, id, s);
  };
  for (const r of SELLING) {
    await place(`g1${r.key}`, ground.sellerA, ground.roleShops[r.key]!, productA, PRODUCT_A, "shipped");
    for (const f of FROM) await place(`${f.status.slice(0, 4)}${r.key}`, ground.sellerA, ground.shop, productA, PRODUCT_A, f.status);
    await place(`pick${r.key}`, ground.sellerA, ground.shop, productA, PRODUCT_A, "picked");
  }
  for (const r of WAREHOUSE) await place(`g5${r.key}`, ground.sellerB, ground.shopB, productB, PRODUCT_B, "shipped");
  await place("g5pick", ground.sellerB, ground.shopB, productB, PRODUCT_B, "picked");

  await page.close();
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── (status: shipped · 1 order · 1 return warehouse) ───────────────────────────────────────────────────────────────────

test.describe("selling:all wants to return an order (status: shipped · 1 order · 1 return warehouse)", () => {
  for (const r of SELLING) {
    test(`${r.label} return order`, async ({ page, browser }) => {
      const slot = `g1${r.key}`;
      const orderId = ground.orders[slot]!;
      const ref = refOf(slot);
      const shop = ground.roleShops[r.key]!;
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.sellerA);

      // GIVEN — shipped: on its way, on the platform; the team returns to warehouse R, not the S that shipped it.
      expect((await orderOf(page, orderId, ground.sellerA)).status).toBe("ORDER_STATUS_SHIPPED");

      // WHEN — Orders › Shipped, the row's menu, Return Goods, confirmed.
      const sent = await returnGoods(page, orderId, ref, "shipped");
      expect.soft(sent.orderIds?.map(String)).toEqual([orderId]);
      expect.soft(sent.to).toBe("ORDER_STATUS_RETURN");

      await test.step("then: status changed from shipped to return", async () => {
        expect.soft((await orderOf(page, orderId, ground.sellerA)).status).toBe("ORDER_STATUS_RETURN");
        await openOrdersTab(page, "shipped", ref);
        await expect.soft(page.getByTestId(`order-row-${orderId}`)).toHaveCount(0);
        await openOrdersTab(page, "return", ref);
        const row = page.getByTestId(`order-row-${orderId}`);
        await expect.soft(row).toBeVisible();
        await expect.soft(row.getByTestId("order-status-11")).toBeVisible();
      });

      await test.step("then: return recorded in order timeline", async () => {
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "return");
        const step = page.getByTestId("section-timeline").getByTestId("order-timeline-return");
        await expect.soft(step).toHaveCount(1);
        await expect.soft(step).toContainText("Return started");
        await expect.soft(step).toContainText("Seller");
        await expect.soft(step).toContainText(nameOf(r.key));
        const rows = ((await orderOf(page, orderId, ground.sellerA)).timelineLogs ?? []).filter(
          (l) => l.status === "ORDER_STATUS_RETURN",
        );
        expect.soft(rows.length, "return rows on the record's timeline").toBe(1);
        expect.soft(rows[0]?.from).toBe("ORDER_TIMELINE_FROM_SELLING");
        expect.soft(String(rows[0]?.actorId ?? "")).toBe(ground.users[r.key]);
      });

      await test.step("then: return recorded in analytic metric", async () => {
        await expect
          .soft(async () => {
            await page.goto(`/analytic?g=shop&m=metrics/orders/return_created&r=7d&shop=${shop}`);
            await expect(page.getByTestId(`analytic-cell-${shop}-return_created_count`)).toHaveText("1", { timeout: 3_000 });
          })
          .toPass({ timeout: 30_000 });
      });

      const rc = await pageAs(browser, RC_USER, ground.ret);
      try {
        await test.step("then: return warehouse sees order return", async () => {
          // Its Returns tab — the returns addressed to it — narrowed by the Order ID.
          await rc.goto(`/warehouse-orders?step=return&q=${ref}`);
          await expect(rc.getByTestId("pick-tab-return")).toHaveAttribute("aria-selected", "true");
          const row = rc.getByTestId(`pick-queue-row-${orderId}`);
          await expect.soft(row).toBeVisible({ timeout: 15_000 });
          await expect.soft(row.getByTestId("order-status-11")).toBeVisible();

          await rc.goto(`/orders/${orderId}`);
          const detail = rc.getByTestId("order-detail-page");
          await expect(detail).toBeVisible({ timeout: 15_000 });
          await expect.soft(detail.getByTestId("order-status-11").first()).toBeVisible();

          expect.soft((await orderOf(rc, orderId, ground.ret)).status, "the order as the return warehouse reads it").toBe(
            "ORDER_STATUS_RETURN",
          );
        });

        await test.step("then: return can be accepted", async () => {
          await acceptReturn(rc, orderId, ground.ret, ground.retRack);
        });
      } finally {
        await rc.close();
      }
    });
  }
});

// ── (status: shipping · 1 order) · (status: problem · 1 order) · (status: completed · 1 order) ─────────────────────────

for (const f of FROM) {
  test.describe(`selling:all wants to return an order (status: ${f.status} · 1 order)`, () => {
    for (const r of SELLING) {
      test(`${r.label} return order`, async ({ page }) => {
        const slot = `${f.status.slice(0, 4)}${r.key}`;
        const orderId = ground.orders[slot]!;
        const ref = refOf(slot);
        await signIn(page, userOf(r.key), PASSWORD);
        await useTeam(page, ground.sellerA);

        // GIVEN — the order stands in its status.
        expect((await orderOf(page, orderId, ground.sellerA)).status).toBe(f.record);

        // WHEN — Orders › <its tab>, the row's menu, Return Goods, confirmed.
        const sent = await returnGoods(page, orderId, ref, f.tab);
        expect.soft(sent.to).toBe("ORDER_STATUS_RETURN");

        await test.step(`then: status changed from ${f.status} to return`, async () => {
          expect.soft((await orderOf(page, orderId, ground.sellerA)).status).toBe("ORDER_STATUS_RETURN");
          await openOrdersTab(page, f.tab, ref);
          await expect.soft(page.getByTestId(`order-row-${orderId}`)).toHaveCount(0);
          await openOrdersTab(page, "return", ref);
          const row = page.getByTestId(`order-row-${orderId}`);
          await expect.soft(row).toBeVisible();
          await expect.soft(row.getByTestId("order-status-11")).toBeVisible();
        });
      });
    }
  });
}

// ── (status: shipped · 1 order · parcel in warehouse before return claimed) ────────────────────────────────────────────

test.describe("warehouse:all wants to return an order (status: shipped · 1 order · parcel in warehouse before return claimed)", () => {
  for (const r of WAREHOUSE) {
    test(`${r.label} return order`, async ({ page, browser }) => {
      const slot = `g5${r.key}`;
      const orderId = ground.orders[slot]!;
      const ref = refOf(slot);
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.ship);

      // GIVEN — shipped, and nobody has claimed it back: the parcel is in the crew's hands.
      expect((await orderOf(page, orderId, ground.ship)).status).toBe("ORDER_STATUS_SHIPPED");

      // WHEN — Orders › Receive a Return, the label's resi, Force Return, confirmed.
      await page.goto("/warehouse-orders");
      await page.getByTestId("pick-queue-receive").click();
      const dialog = page.getByTestId("receive-return-dialog");
      await expect(dialog).toBeVisible();
      await page.getByTestId("receive-return-input").fill(resiOf(slot));
      await page.getByTestId("receive-return-input").press("Enter");
      const found = page.getByTestId(`receive-return-row-${orderId}`);
      await expect(found).toBeVisible({ timeout: 15_000 });
      await found.getByTestId(`receive-return-force-${orderId}`).click();
      const [answer] = await Promise.all([
        page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
        page.getByTestId("confirm-action").click(),
      ]);
      expect(answer.status(), await answer.text()).toBe(200);
      const body = (await answer.json()) as { results: MoveResult[] };
      expect(body.results[0]?.moved, `force return #${orderId}: ${body.results[0]?.refusedReason}`).toBe(true);
      // …and it goes straight on to the accept page.
      await expect.soft(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}/accept-return$`));

      await test.step("then: status changed from shipped to return", async () => {
        expect.soft((await orderOf(page, orderId, ground.ship)).status).toBe("ORDER_STATUS_RETURN");
        await page.goto(`/warehouse-orders?step=return&q=${ref}`);
        await expect(page.getByTestId("pick-tab-return")).toHaveAttribute("aria-selected", "true");
        const row = page.getByTestId(`pick-queue-row-${orderId}`);
        await expect.soft(row).toBeVisible({ timeout: 15_000 });
        await expect.soft(row.getByTestId("order-status-11")).toBeVisible();
      });

      await test.step("then: return recorded in order timeline", async () => {
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        await page.getByTestId("order-detail-tab-timeline").click();
        await expect(page.getByTestId("order-detail-timeline")).toBeVisible();
        const step = page.getByTestId("order-timeline-return");
        await expect.soft(step).toHaveCount(1);
        await expect.soft(step).toContainText("Return started");
        await expect.soft(page.getByTestId("order-timeline-return-by")).toContainText(userOf(r.key));
        await expect.soft(page.getByTestId("order-timeline-return-when")).toContainText("Warehouse");
        const rows = ((await orderOf(page, orderId, ground.ship)).timelineLogs ?? []).filter(
          (l) => l.status === "ORDER_STATUS_RETURN",
        );
        expect.soft(rows.length, "return rows on the record's timeline").toBe(1);
        expect.soft(rows[0]?.from).toBe("ORDER_TIMELINE_FROM_WAREHOUSE");
        expect.soft(String(rows[0]?.actorId ?? "")).toBe(ground.users[r.key]);
      });

      const seller = await pageAs(browser, B_OWNER, ground.sellerB);
      try {
        await test.step("then: selling team sees order return", async () => {
          await seller.goto(`/orders/${orderId}`);
          const detail = seller.getByTestId("order-detail-page");
          await expect(detail).toBeVisible({ timeout: 15_000 });
          await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "return");
          await expect.soft(detail.getByTestId("order-status-11").first()).toBeVisible();
          const step = seller.getByTestId("section-timeline").getByTestId("order-timeline-return");
          await expect.soft(step).toHaveCount(1);
          await expect.soft(step).toContainText("Warehouse");

          await openOrdersTab(seller, "return", ref);
          const row = seller.getByTestId(`order-row-${orderId}`);
          await expect.soft(row).toBeVisible();
          await expect.soft(row.getByTestId("order-status-11")).toBeVisible();
          expect.soft((await orderOf(seller, orderId, ground.sellerB)).status, "the order as its seller reads it").toBe(
            "ORDER_STATUS_RETURN",
          );
        });
      } finally {
        await seller.close();
      }

      await test.step("then: return can be accepted", async () => {
        await acceptReturn(page, orderId, ground.ship, ground.shipRack);
      });
    });
  }
});

// ── (status: picked · 1 order) ──────────────────────────────────────────────────────────────────────────────────────────

test.describe("selling:all wants to return an order (status: picked · 1 order)", () => {
  for (const r of SELLING) {
    test(`${r.label} return order`, async ({ page }) => {
      const slot = `pick${r.key}`;
      const orderId = ground.orders[slot]!;
      const ref = refOf(slot);
      await signIn(page, userOf(r.key), PASSWORD);
      await useTeam(page, ground.sellerA);

      // GIVEN — picked: the parcel is still in the warehouse.
      expect((await orderOf(page, orderId, ground.sellerA)).status).toBe("ORDER_STATUS_PICKED");

      // WHEN — Orders › Picked, the row's menu opened; and the move to return sent anyway, as the role.
      await openOrdersTab(page, "picked", ref);
      await expect(page.getByTestId(`order-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
      await page.getByTestId(`order-actions-${orderId}`).click();
      await expect(page.getByTestId(`order-detail-${orderId}`)).toBeVisible();
      const offered = await page.getByTestId(`order-returnGoods-${orderId}`).count();
      await page.keyboard.press("Escape");
      const sent = await tryMove(page, ground.sellerA, orderId, "RETURN");

      await test.step("then: cannot return order", async () => {
        expect.soft(offered, "Return Goods in the picked order's row menu").toBe(0);
        expect.soft(sent.moved ?? false, "the move to return sent anyway").toBe(false);
        expect.soft(sent.refusedReason ?? "", "the refusal says why").not.toBe("");

        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "picked");
        await expect.soft(page.getByTestId("order-action-returnGoods")).toHaveCount(0);
        expect.soft((await orderOf(page, orderId, ground.sellerA)).status, "the order after").toBe("ORDER_STATUS_PICKED");
        await openOrdersTab(page, "picked", ref);
        await expect.soft(page.getByTestId(`order-row-${orderId}`)).toBeVisible();
      });
    });
  }

  // ── regression ────────────────────────────────────────────────────────────────────────────────────────────────────────

  // THE WAREHOUSE CANNOT FORCE ONE EITHER (a-forced-return-follows-the-status-move): Receive a Return finds the picked
  // order and says why, with no Force Return — and the move sent anyway is refused.
  test("The warehouse's Receive a Return finds a picked order and says why — no Force Return", async ({ browser }) => {
    const orderId = ground.orders.g5pick!;
    const wh = await pageAs(browser, userOf("whstf"), ground.ship);
    try {
      await wh.goto("/warehouse-orders");
      await wh.getByTestId("pick-queue-receive").click();
      await expect(wh.getByTestId("receive-return-dialog")).toBeVisible();
      await wh.getByTestId("receive-return-input").fill(resiOf("g5pick"));
      await wh.getByTestId("receive-return-input").press("Enter");
      const found = wh.getByTestId(`receive-return-row-${orderId}`);
      await expect(found).toBeVisible({ timeout: 15_000 });
      await expect(wh.getByTestId(`receive-return-reason-${orderId}`)).toBeVisible();
      await expect(wh.getByTestId(`receive-return-force-${orderId}`)).toHaveCount(0);
      await expect(wh.getByTestId(`receive-return-accept-${orderId}`)).toHaveCount(0);

      const sent = await tryMove(wh, ground.ship, orderId, "RETURN");
      expect(sent.moved ?? false).toBe(false);
      expect((await orderOf(wh, orderId, ground.ship)).status).toBe("ORDER_STATUS_PICKED");
    } finally {
      await wh.close();
    }
  });
});

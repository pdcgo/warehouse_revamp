import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { expectMoveCounted, expectMovesOffered } from "./order_moves_metric";

// ── mark shipped order — the checks behind docs/acceptances/inventory/order.md (### process: delivery) ─────────────────
//
// mark shipped order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are
// the owner's, set by hand — never by this file.
//
// Business rules:
// - customer-service-sets-shipped-and-problem-by-hand (docs/business/order/context_decision.md): customer service reads
//   the platform and marks `shipping → shipped` BY HAND; `shipping` (the warehouse handed the parcel over) and `shipped`
//   (seen moving on the platform) stay two statuses; each move is ONE order_timeline_logs row, `from = selling`. The move
//   is the selling team's: the server refuses the warehouse ("only the selling team moves shipping to shipped").
// - the order's action table (features/orders/rowActions.ts, every-allowed-move-has-a-button): `shipping` offers Mark as
//   Shipped; `shipped` offers Complete Order (the status diagram's `shipped → completed`).
// - the order page's Pengiriman (pages/order-detail/pending.ts `shippingTracking`, kind `missing`): the courier trail is
//   not modelled — "nothing reads the courier back yet" — and the screen marks it so. What the order offers instead is
//   the courier's own page (an-orders-resi-links-to-the-couriers-tracking-page, a-tracking-link-must-carry-the-resi).
//
// `selling:all` → EVERY selling role (selling:owner, selling:admin, selling:cs), each in its own browser session, each on
// an order of its own. The then the WAREHOUSE sees is read by one warehouse role (warehouse:staff, the crew) on a second
// page of the same test.
//
// The WHEN — customer service works down Orders › Shipping: the order's row (the list narrowed by its Order ID), its row
// menu, Mark as Shipped. (The order page's own Mark as Shipped is pressed by order_warehouse_wants_to_hand_over.spec.ts's
// `order can be marked shipped`.)
//
// How each then is read:
// - `status changed from shipping to shipped` — the order's own record says ORDER_STATUS_SHIPPED; on Orders it has left
//   the Shipping tab and stands on the Shipped tab with the Shipped badge (order-status-7).
// - `shipped recorded in order timeline` — the order's page › Timeline: ONE "On its way" row (order-timeline-shipped),
//   from the Seller, naming the role's user; the record's timeline has ONE shipped row, from selling, by that user.
// - `warehouse sees order shipped` — the crew: its order page (WarehouseOrderDetail) shows the Shipped badge and, on its
//   Timeline tab, ONE shipped step; on its Orders the order has left Sudah diserahkan and is on Semua with the Shipped
//   badge; the order as the warehouse reads it is ORDER_STATUS_SHIPPED.
// - `order can be completed` — the order's page offers Complete Order; pressing it makes the order ORDER_STATUS_COMPLETED.
// - `shipped recorded in analytic metric` — Analytic › Order › Order status moves (`metrics/orders/moves`, #84) counts a
//   mark shipped as a Shipped, shipping → shipped (the-order-metric-ids-name-what-moved). Its own test per role — EVERY
//   selling role on a shop of its own with TWO shipping orders of which the role marks ONE shipped, read as that role:
//   Add Metric › Order offers
//   Order status moves, and Analytic by shop over the last 7 days, filtered to that shop, reads `created_count` 2 (the
//   fold landed) and `shipped_count` exactly 1 — the untouched order, still shipping, adds nothing
//   (order_moves_metric.ts). (Every earlier move — confirmed, picked, handed over — happened to BOTH orders.)
// - `parcel tracking shown on order` — NOW the resi links to the courier's own tracking page
//   (an-orders-resi-links-to-the-couriers-tracking-page, docs/business/shipment/context_decision.md — the owner's answer
//   to this row: "later we add A, but now B"; the aggregator that would draw the trail ON the order is the Later part,
//   not built and not checked here). Built by #103: the role's shipped order, on a courier whose link root keeps
//   (`https://…{resi}…`), shows ↗ beside its resi on its page — in the Info reference (order-reference-track) and in
//   Pengiriman's leg (shipment-outbound-track) — opening the courier's page for THIS resi (URL-encoded), in a new tab.
//   Read in each role's own test, on the order that role marked shipped. (Until #103 it was a 🚧 test.fail of its own,
//   asking for a trail.)
//
// GROUND (beforeAll, as root, through the API): a selling team of its own (root owns it) with a user per selling role, a
// Shopee shop (root and the CS on it), a warehouse it returns to with a warehouse:staff user, 14 units of one product
// accepted onto a rack there, and a courier of its own whose tracking link root keeps (ShipmentChannelCreate with
// `trackingUrl`). Orders of 1 unit on that courier, each walked by the warehouse to `shipping` (processed → picked →
// shipping): one per role, one for the warehouse's refused move; plus the metric check's own shop with its two. Seeded
// in beforeAll so a worker restarted after a failure seeds its own.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-markshipped-pass-1";
const PRODUCT = `Sabun Kirim ${SUFFIX}`;
const SKU = `MKK${SUFFIX}`;
const STOCK = 14;

const ROLES = [
  { key: "own", role: "ROLE_SELLING_OWNER", label: "selling:owner" },
  { key: "adm", role: "ROLE_SELLING_ADMIN", label: "selling:admin" },
  { key: "cs", role: "ROLE_SELLING_CS", label: "selling:cs" },
] as const;
type Key = (typeof ROLES)[number]["key"];

const COND = "status: shipping · 1 order";

// The orders, by slot: one per role (its key), the warehouse's refused move's, and per role the metric check's two (on
// that role's own shop: m<key>a is moved, m<key>b stays).
const SLOTS = ["own", "adm", "cs", "crew"] as const;
const metricSlots = (key: Key) => [`m${key}a`, `m${key}b`] as const;

const userOf = (key: Key) => `e2emk${key}${SUFFIX}`;
const nameOf = (key: Key) => `Mark Shipped ${key} ${SUFFIX}`;
const WH_USER = `e2emkwh${SUFFIX}`;
// The marketplace's Order ID — carries the run's suffix (a repeat within a team is refused).
const refOf = (slot: string) => `MK${SUFFIX}${slot.toUpperCase()}`;
const resiOf = (slot: string) => `JM${SUFFIX}${slot.toUpperCase()}`;

// The run's own courier and the tracking link root keeps on it — `{resi}` where the number goes (a-tracking-link-must-
// carry-the-resi). The order page opens it with the order's resi URL-encoded in place of `{resi}`.
const COURIER = `mkc_${SUFFIX}`;
const TRACKING_URL = `https://lacak.e2e-kurir.example/cek?awb={resi}&src=mk${SUFFIX}`;
const trackOf = (resi: string) => TRACKING_URL.split("{resi}").join(encodeURIComponent(resi));

const ground = {
  team: "",
  warehouse: "",
  shop: "",
  // role key → the metric check's own shop
  metricShops: {} as Record<string, string>,
  courier: "",
  // slot → order id
  orders: {} as Record<string, string>,
  // role key → user id
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

async function move(page: Page, teamId: string, orderId: string, to: string) {
  const res = await ok<{ results: MoveResult[] }>(page, "selling.v1.OrderService/OrderStatusChange", {
    teamId,
    orderIds: [orderId],
    to: `ORDER_STATUS_${to}`,
  });
  expect(res.results[0]?.moved, `${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function signInAs(page: Page, key: Key) {
  await signIn(page, userOf(key), PASSWORD);
  await useTeam(page, ground.team);
}

// The crew, on a page of its own (a fresh context: the form sign-in), working in the warehouse.
async function crewPage(browser: Browser): Promise<Page> {
  const wh = await browser.newPage();
  await signIn(wh, WH_USER, PASSWORD);
  await useTeam(wh, ground.warehouse);

  return wh;
}

type OrderRecord = {
  status: string;
  timelineLogs?: { status?: string; from?: string; actorId?: string; note?: string }[];
};

// The order as the server keeps it, read in `teamId` (the seller's, or the warehouse's).
async function orderOf(page: Page, orderId: string, teamId = ground.team): Promise<OrderRecord> {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId, orderId })).order as OrderRecord;
}

// The seller's Orders on one status tab, narrowed by the order's Order ID — the list has drawn its answer (rows or the
// empty state) once this returns.
async function openOrdersTab(page: Page, status: "shipping" | "shipped", ref: string) {
  await page.goto(`/orders?status=${status}&q=${ref}`);
  await expect(page.getByTestId(`orders-tab-${status}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("orders-table").or(page.getByTestId("orders-empty")).first()).toBeVisible({ timeout: 15_000 });
}

// THE WHEN — Orders › Shipping, the order's row menu, Mark as Shipped. Returns the OrderStatusChange the menu sent.
async function markShipped(page: Page, orderId: string, ref: string) {
  await openOrdersTab(page, "shipping", ref);
  await expect(page.getByTestId(`order-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(`order-actions-${orderId}`).click();
  const item = page.getByTestId(`order-ship-${orderId}`);
  await expect(item).toBeVisible();
  await expect.soft(item).toContainText("Mark as Shipped");
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
    item.click(),
  ]);
  expect(answer.status(), await answer.text()).toBe(200);
  const body = (await answer.json()) as { results: MoveResult[] };
  expect(body.results[0]?.moved, `mark shipped #${orderId}: ${body.results[0]?.refusedReason}`).toBe(true);

  return JSON.parse(answer.request().postData() ?? "{}") as { orderIds?: string[]; to?: string };
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Mark Shipped Seller ${SUFFIX}`, `MKS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Mark Shipped WH ${SUFFIX}`, `MKW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  for (const r of ROLES) {
    const made = await ok(page, "user.v1.UserService/CreateUser", {
      teamId: ground.team,
      username: userOf(r.key),
      password: PASSWORD,
      name: nameOf(r.key),
      role: r.role,
    });
    ground.users[r.key] = String(made.user.id);
  }
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: ground.warehouse,
    username: WH_USER,
    password: PASSWORD,
    name: `Mark Shipped crew ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  const shop = async (name: string, shopCode: string) => {
    const id = String(
      (await ok(page, "selling.v1.ShopService/ShopCreate", { teamId: ground.team, name, shopCode, marketplace: "MARKETPLACE_SHOPEE" }))
        .shop.id,
    );
    // Root first — the first grant is the shop's primary CS; the CS on it too.
    await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: id, userId: ROOT_USER_ID });
    await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: id, userId: ground.users.cs });

    return id;
  };
  ground.shop = await shop(`E2E Kirim Shop ${SUFFIX}`, `MKP${SUFFIX}`);
  for (const r of ROLES) {
    ground.metricShops[r.key] = await shop(`E2E Kirim Metric Shop ${r.key} ${SUFFIX}`, `MKQ${r.key.toUpperCase()}${SUFFIX}`);
  }

  // The product's units on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `mk-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Mark Shipped ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: SKU,
      name: PRODUCT,
      categoryId: category,
    })
  ).product;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E mark shipped ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-MKS-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: ground.team,
    accountId: account,
    operational: true,
  });
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count: STOCK, total: STOCK * 10_000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: STOCK, placements: [{ placementId: rack, quantity: STOCK }] }],
  });

  // GIVEN — every order placed by root and walked by the warehouse to the courier: confirmed, picked, handed over. On the
  // run's own courier, whose tracking link root keeps.
  ground.courier = String(
    (
      await ok(page, "shipment.v1.ShipmentChannelService/ShipmentChannelCreate", {
        code: COURIER,
        name: `E2E Kurir Lacak ${SUFFIX}`,
        trackingUrl: TRACKING_URL,
      })
    ).channel.id,
  );
  const place = async (slot: string, shopId: string) => {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-mkship-${slot}-${SUFFIX}`,
      shipmentChannelId: ground.courier,
      teamId: ground.team,
      shopId,
      warehouseId: ground.warehouse,
      customerName: `E2E Mark Shipped Buyer ${slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(slot),
      receiptCode: resiOf(slot),
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
    });
    const id = String(placed.order.id);
    for (const to of ["PROCESSED", "PICKED", "SHIPPING"]) {
      await move(page, ground.warehouse, id, to);
    }
    ground.orders[slot] = id;
  };
  for (const slot of SLOTS) await place(slot, ground.shop);
  for (const r of ROLES) for (const slot of metricSlots(r.key)) await place(slot, ground.metricShops[r.key]!);

  await page.close();
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── (status: shipping · 1 order) ────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to mark an order shipped (${COND})`, () => {
  for (const r of ROLES) {
    test(`${r.label} mark shipped order`, async ({ page, browser }) => {
      const orderId = ground.orders[r.key]!;
      const ref = refOf(r.key);
      await signInAs(page, r.key);

      // GIVEN — handed to the courier by the warehouse.
      expect((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_SHIPPING");

      // WHEN — Orders › Shipping, the row's menu, Mark as Shipped.
      const sent = await markShipped(page, orderId, ref);
      expect.soft(sent.orderIds?.map(String)).toEqual([orderId]);
      expect.soft(sent.to).toBe("ORDER_STATUS_SHIPPED");

      await test.step("then: status changed from shipping to shipped", async () => {
        expect.soft((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_SHIPPED");
        await openOrdersTab(page, "shipping", ref);
        await expect.soft(page.getByTestId(`order-row-${orderId}`)).toHaveCount(0);
        await openOrdersTab(page, "shipped", ref);
        const row = page.getByTestId(`order-row-${orderId}`);
        await expect.soft(row).toBeVisible();
        await expect.soft(row.getByTestId("order-status-7")).toBeVisible();
      });

      await test.step("then: shipped recorded in order timeline", async () => {
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        const step = page.getByTestId("section-timeline").getByTestId("order-timeline-shipped");
        await expect.soft(step).toHaveCount(1);
        await expect.soft(step).toContainText("On its way");
        await expect.soft(step).toContainText("Seller");
        await expect.soft(step).toContainText(nameOf(r.key));
        const rows = ((await orderOf(page, orderId)).timelineLogs ?? []).filter((l) => l.status === "ORDER_STATUS_SHIPPED");
        expect.soft(rows.length, "shipped rows on the record's timeline").toBe(1);
        expect.soft(rows[0]?.from).toBe("ORDER_TIMELINE_FROM_SELLING");
        expect.soft(String(rows[0]?.actorId ?? "")).toBe(ground.users[r.key]);
      });

      const wh = await crewPage(browser);
      try {
        await test.step("then: warehouse sees order shipped", async () => {
          await wh.goto(`/orders/${orderId}`);
          const detail = wh.getByTestId("order-detail-page");
          await expect(detail).toBeVisible({ timeout: 15_000 });
          await expect.soft(detail.getByTestId("order-status-7").first()).toBeVisible();
          await wh.getByTestId("order-detail-tab-timeline").click();
          await expect(wh.getByTestId("order-detail-timeline")).toBeVisible();
          await expect.soft(wh.getByTestId("order-timeline-shipped")).toHaveCount(1);
          await expect.soft(wh.getByTestId("order-timeline-shipped-by")).toContainText(userOf(r.key));

          // Its Orders: no longer on Sudah diserahkan; on Semua, with the Shipped badge.
          await wh.goto(`/warehouse-orders?step=handover&q=${ref}`);
          await expect(wh.getByTestId("pick-tab-handover")).toHaveAttribute("aria-selected", "true");
          await expect(wh.getByTestId("pick-queue-table")).toBeVisible({ timeout: 15_000 });
          await expect.soft(wh.getByTestId(`pick-queue-row-${orderId}`)).toHaveCount(0);
          await wh.getByTestId("pick-tab-all").click();
          await expect(wh.getByTestId("pick-tab-all")).toHaveAttribute("aria-selected", "true");
          const row = wh.getByTestId(`pick-queue-row-${orderId}`);
          await expect.soft(row).toBeVisible({ timeout: 15_000 });
          await expect.soft(row.getByTestId("order-status-7")).toBeVisible();

          expect.soft((await orderOf(wh, orderId, ground.warehouse)).status, "the order as the warehouse reads it").toBe(
            "ORDER_STATUS_SHIPPED",
          );
        });
      } finally {
        await wh.close();
      }

      await test.step("then: parcel tracking shown on order", async () => {
        // NOW a link to the courier's own page for this parcel (an-orders-resi-links-to-the-couriers-tracking-page): ↗
        // beside the resi in the Info reference and in Pengiriman's leg, opening in a new tab.
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "shipped", { timeout: 15_000 });
        const href = trackOf(resiOf(r.key));
        await expect.soft(page.getByTestId("order-reference-receipt")).toContainText(resiOf(r.key));
        const reference = page.getByTestId("order-reference-track");
        await expect.soft(reference).toHaveAttribute("href", href);
        await expect.soft(reference).toHaveAttribute("target", "_blank");
        await expect.soft(reference).toHaveAttribute("rel", /noopener/);
        const leg = page.getByTestId("section-shipping").getByTestId("shipment-outbound");
        await expect.soft(leg).toContainText(resiOf(r.key));
        await expect.soft(leg.getByTestId("shipment-outbound-track")).toHaveAttribute("href", href);
      });

      await test.step("then: order can be completed", async () => {
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "shipped", { timeout: 15_000 });
        const complete = page.getByTestId("order-action-complete");
        await expect(complete).toBeVisible();
        await expect.soft(complete).toContainText("Complete Order");
        const [answer] = await Promise.all([
          page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
          complete.click(),
        ]);
        expect.soft(answer.status()).toBe(200);
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "completed");
        expect.soft((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_COMPLETED");
      });
    });
  }

  // ── regression ────────────────────────────────────────────────────────────────────────────────────────────────────────

  // THE MOVE IS THE SELLING TEAM'S (customer-service-sets-shipped-and-problem-by-hand): the crew that handed the parcel over
  // cannot mark it shipped — the server refuses it by name and the order stays shipping, on Sudah diserahkan.
  test("The warehouse cannot mark an order shipped — refused, it stays shipping", async ({ browser }) => {
    const orderId = ground.orders.crew!;
    const wh = await crewPage(browser);
    try {
      const res = await ok<{ results: MoveResult[] }>(wh, "selling.v1.OrderService/OrderStatusChange", {
        teamId: ground.warehouse,
        orderIds: [orderId],
        to: "ORDER_STATUS_SHIPPED",
      });
      expect(res.results[0]?.moved ?? false).toBe(false);
      expect(res.results[0]?.refusedReason ?? "").toContain("only the selling team");
      expect((await orderOf(wh, orderId, ground.warehouse)).status).toBe("ORDER_STATUS_SHIPPING");

      await wh.goto(`/warehouse-orders?step=handover&q=${refOf("crew")}`);
      await expect(wh.getByTestId("pick-tab-handover")).toHaveAttribute("aria-selected", "true");
      await expect(wh.getByTestId(`pick-queue-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
    } finally {
      await wh.close();
    }
  });

  // The metric check — its own test per role: each moves one order of the role's own shop (see the head of this file).
  for (const r of ROLES) {
    test(`${r.label} mark shipped order (${COND}): shipped recorded in analytic metric`, async ({ page }) => {
      await signInAs(page, r.key);
      const [moved, kept] = metricSlots(r.key);
      const [orderId, left] = [ground.orders[moved]!, ground.orders[kept]!];
      const shop = ground.metricShops[r.key]!;
      expect(await orderOf(page, orderId).then((o) => o.status)).toBe("ORDER_STATUS_SHIPPING");

      // WHEN — Mark as Shipped on one of the shop's two orders; the other stays shipping.
      await markShipped(page, orderId, refOf(moved));
      expect((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_SHIPPED");
      expect((await orderOf(page, left)).status).toBe("ORDER_STATUS_SHIPPING");

      await test.step("then: shipped recorded in analytic metric", async () => {
        // Order status moves is offered under Order, and the shop's Shipped reads the ONE mark shipped.
        await expectMovesOffered(page);
        await expectMoveCounted(page, shop, "shipped_count");
      });
    });
  }
});

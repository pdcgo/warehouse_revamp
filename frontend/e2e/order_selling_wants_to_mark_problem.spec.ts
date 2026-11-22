import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { expectMoveCounted, expectMovesOffered } from "./order_moves_metric";

// ── mark problem order — the checks behind docs/acceptances/inventory/order.md (## problem and lost) ─────────────────────
//
// mark problem order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are
// the owner's, set by hand — never by this file.
//
// Business rules:
// - customer-service-sets-shipped-and-problem-by-hand (docs/business/order/context_decision.md): customer service reads
//   the platform and moves `shipped → problem` by hand; each move is ONE order_timeline_logs row, `from = selling`. The
//   server's table (orderMoves, order_transition.go) gives `shipped → problem` to the selling team only: the warehouse is
//   refused ("only the selling team moves shipped to problem").
// - the status diagram (same file): `problem` is a holding state — it still completes, returns or is lost.
// - the order's action table (features/orders/rowActions.ts, #11): `shipped` offers Mark as Problem (not destructive: no
//   confirm); `problem` offers Resolve Dispute, Return Goods, Mark as Lost.
// - the-order-status-moves-prototype-is-accepted (docs/business/analytic/rpc_provide_decision.md, #84): Analytic › Order ›
//   Order status moves counts a `shipped → problem` move as a Problem (the-order-metric-ids-name-what-moved).
//
// `selling:all` → EVERY selling role (selling:owner, selling:admin, selling:cs), each in its own browser session, each on
// an order of its own. The then the WAREHOUSE sees is read by one warehouse role (warehouse:staff, the crew) on a second
// page of the same test.
//
// The WHEN — customer service works down Orders › Shipped: the order's row (the list narrowed by its Order ID), its row
// menu, Mark as Problem. (The order page's own Mark as Problem button is pressed by orders.spec.ts's "Moves: a shipped
// order is marked a problem, then returned (#11)".)
//
// How each then is read:
// - `status changed from shipped to problem` — the order's own record says ORDER_STATUS_PROBLEM; on Orders it has left
//   the Shipped tab and stands on the Problem tab with the Problem badge (order-status-9).
// - `problem recorded in order timeline` — the order's page › Timeline: ONE "A delivery problem" row
//   (order-timeline-problem), from the Seller, naming the role's user; the record's timeline has ONE problem row, from
//   selling, by that user.
// - `warehouse sees order problem` — the crew: its order page (WarehouseOrderDetail) shows the Problem badge and, on its
//   Timeline tab, ONE problem step by the seller's user; on its Orders › Semua the order carries the Problem badge; the
//   order as the warehouse reads it is ORDER_STATUS_PROBLEM.
// - `dispute can be resolved` — read LAST (pressing it moves the order on): the Problem tab's row menu offers Resolve
//   Dispute, and the order page's Resolve Dispute button completes the order (stepper on Completed, the record
//   ORDER_STATUS_COMPLETED). The resolve itself, then by then, is resolve dispute order's own spec.
// - `problem recorded in analytic metric` — Analytic › Order › Order status moves (`metrics/orders/moves`, #84) counts a
//   mark problem as a Problem, shipped → problem. Its own test per role, LAST in the file — EVERY selling role on a shop
//   of its own with TWO shipped orders of which the role marks ONE a problem, read as that role: Add Metric › Order
//   offers Order status moves,
//   and Analytic by shop over the last 7 days, filtered to that shop, reads `created_count` 2 (the fold landed) and
//   `problem_count` exactly 1 — the untouched order, still shipped, adds nothing (order_moves_metric.ts). (Every earlier
//   move — confirmed, picked, handed over, shipped — happened to BOTH orders.)
//
// GROUND (beforeAll, as root, through the API): a selling team of its own (root owns it) with a user per selling role, a
// Shopee shop (root and the CS on it), a warehouse it returns to with a warehouse:staff user, 14 units of one product
// accepted onto a rack there. Orders of 1 unit, each walked by the warehouse to `shipping` (processed → picked → shipping)
// and by the selling team on to `shipped`: one per role, one for the warehouse's refused move; plus the metric check's own
// shop with its two. Seeded in beforeAll so a worker restarted after a failure seeds its own.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-problem-pass-1";
const PRODUCT = `Sabun Masalah ${SUFFIX}`;
const SKU = `PMK${SUFFIX}`;
const STOCK = 14;

const ROLES = [
  { key: "own", role: "ROLE_SELLING_OWNER", label: "selling:owner" },
  { key: "adm", role: "ROLE_SELLING_ADMIN", label: "selling:admin" },
  { key: "cs", role: "ROLE_SELLING_CS", label: "selling:cs" },
] as const;
type Key = (typeof ROLES)[number]["key"];

const COND = "status: shipped · 1 order";

// The orders, by slot: one per role (its key), the warehouse's refused move's, and per role the metric check's two (on
// that role's own shop: m<key>a is moved, m<key>b stays).
const SLOTS = ["own", "adm", "cs", "crew"] as const;
const metricSlots = (key: Key) => [`m${key}a`, `m${key}b`] as const;

const userOf = (key: Key) => `e2epm${key}${SUFFIX}`;
const nameOf = (key: Key) => `Problem ${key} ${SUFFIX}`;
const WH_USER = `e2epmwh${SUFFIX}`;
// The marketplace's Order ID — carries the run's suffix (a repeat within a team is refused).
const refOf = (slot: string) => `PM${SUFFIX}${slot.toUpperCase()}`;
const resiOf = (slot: string) => `JPM${SUFFIX}${slot.toUpperCase()}`;

const ground = {
  team: "",
  warehouse: "",
  shop: "",
  // role key → the metric check's own shop
  metricShops: {} as Record<string, string>,
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
async function openOrdersTab(page: Page, status: "shipped" | "problem", ref: string) {
  await page.goto(`/orders?status=${status}&q=${ref}`);
  await expect(page.getByTestId(`orders-tab-${status}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("orders-table").or(page.getByTestId("orders-empty")).first()).toBeVisible({ timeout: 15_000 });
}

// THE WHEN — Orders › Shipped, the order's row menu, Mark as Problem (no confirm: problem ends nothing). Returns the
// OrderStatusChange the menu sent.
async function markProblem(page: Page, orderId: string, ref: string) {
  await openOrdersTab(page, "shipped", ref);
  await expect(page.getByTestId(`order-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(`order-actions-${orderId}`).click();
  const item = page.getByTestId(`order-markProblem-${orderId}`);
  await expect(item).toBeVisible();
  await expect.soft(item).toContainText("Mark as Problem");
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
    item.click(),
  ]);
  expect(answer.status(), await answer.text()).toBe(200);
  const body = (await answer.json()) as { results: MoveResult[] };
  expect(body.results[0]?.moved, `problem #${orderId}: ${body.results[0]?.refusedReason}`).toBe(true);

  return JSON.parse(answer.request().postData() ?? "{}") as { orderIds?: string[]; to?: string };
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Problem Seller ${SUFFIX}`, `PMS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Problem WH ${SUFFIX}`, `PMW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
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
    name: `Problem crew ${SUFFIX}`,
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
  ground.shop = await shop(`E2E Masalah Shop ${SUFFIX}`, `PMP${SUFFIX}`);
  for (const r of ROLES) {
    ground.metricShops[r.key] = await shop(`E2E Masalah Metric Shop ${r.key} ${SUFFIX}`, `PMQ${r.key.toUpperCase()}${SUFFIX}`);
  }

  // The product's units on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `pm-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Problem ${SUFFIX}` })).category.id;
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
      name: `E2E problem ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-PRB-${SUFFIX}`,
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

  // GIVEN — every order placed by root, walked by the warehouse to the courier (confirmed, picked, handed over), then
  // marked shipped by the selling team.
  const place = async (slot: string, shopId: string) => {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-problem-${slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId,
      warehouseId: ground.warehouse,
      customerName: `E2E Problem Buyer ${slot} ${SUFFIX}`,
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
    await move(page, ground.team, id, "SHIPPED");
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

// ── (status: shipped · 1 order) ─────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to mark an order as problem (${COND})`, () => {
  for (const r of ROLES) {
    test(`${r.label} mark problem order`, async ({ page, browser }) => {
      const orderId = ground.orders[r.key]!;
      const ref = refOf(r.key);
      await signInAs(page, r.key);

      // GIVEN — shipped: on its way, on the platform.
      expect((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_SHIPPED");

      // WHEN — Orders › Shipped, the row's menu, Mark as Problem.
      const sent = await markProblem(page, orderId, ref);
      expect.soft(sent.orderIds?.map(String)).toEqual([orderId]);
      expect.soft(sent.to).toBe("ORDER_STATUS_PROBLEM");

      await test.step("then: status changed from shipped to problem", async () => {
        expect.soft((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_PROBLEM");
        await openOrdersTab(page, "shipped", ref);
        await expect.soft(page.getByTestId(`order-row-${orderId}`)).toHaveCount(0);
        await openOrdersTab(page, "problem", ref);
        const row = page.getByTestId(`order-row-${orderId}`);
        await expect.soft(row).toBeVisible();
        await expect.soft(row.getByTestId("order-status-9")).toBeVisible();
      });

      await test.step("then: problem recorded in order timeline", async () => {
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "problem");
        const step = page.getByTestId("section-timeline").getByTestId("order-timeline-problem");
        await expect.soft(step).toHaveCount(1);
        await expect.soft(step).toContainText("A delivery problem");
        await expect.soft(step).toContainText("Seller");
        await expect.soft(step).toContainText(nameOf(r.key));
        const rows = ((await orderOf(page, orderId)).timelineLogs ?? []).filter((l) => l.status === "ORDER_STATUS_PROBLEM");
        expect.soft(rows.length, "problem rows on the record's timeline").toBe(1);
        expect.soft(rows[0]?.from).toBe("ORDER_TIMELINE_FROM_SELLING");
        expect.soft(String(rows[0]?.actorId ?? "")).toBe(ground.users[r.key]);
      });

      const wh = await crewPage(browser);
      try {
        await test.step("then: warehouse sees order problem", async () => {
          await wh.goto(`/orders/${orderId}`);
          const detail = wh.getByTestId("order-detail-page");
          await expect(detail).toBeVisible({ timeout: 15_000 });
          await expect.soft(detail.getByTestId("order-status-9").first()).toBeVisible();
          await wh.getByTestId("order-detail-tab-timeline").click();
          await expect(wh.getByTestId("order-detail-timeline")).toBeVisible();
          await expect.soft(wh.getByTestId("order-timeline-problem")).toHaveCount(1);
          await expect.soft(wh.getByTestId("order-timeline-problem-by")).toContainText(userOf(r.key));

          // Its Orders › Semua: the order, with the Problem badge.
          await wh.goto(`/warehouse-orders?step=all&q=${ref}`);
          await expect(wh.getByTestId("pick-tab-all")).toHaveAttribute("aria-selected", "true");
          const row = wh.getByTestId(`pick-queue-row-${orderId}`);
          await expect.soft(row).toBeVisible({ timeout: 15_000 });
          await expect.soft(row.getByTestId("order-status-9")).toBeVisible();

          expect.soft((await orderOf(wh, orderId, ground.warehouse)).status, "the order as the warehouse reads it").toBe(
            "ORDER_STATUS_PROBLEM",
          );
        });
      } finally {
        await wh.close();
      }

      // LAST, because pressing it moves the order on (problem → completed).
      await test.step("then: dispute can be resolved", async () => {
        // The Problem tab's row menu offers it …
        await openOrdersTab(page, "problem", ref);
        await expect(page.getByTestId(`order-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
        await page.getByTestId(`order-actions-${orderId}`).click();
        const item = page.getByTestId(`order-resolveDispute-${orderId}`);
        await expect.soft(item).toBeVisible();
        await expect.soft(item).toContainText("Resolve Dispute");
        await page.keyboard.press("Escape");

        // … and the order page's button resolves it: the order completes.
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "problem", { timeout: 15_000 });
        const resolve = page.getByTestId("order-action-resolveDispute");
        await expect(resolve).toBeVisible();
        await expect.soft(resolve).toContainText("Resolve Dispute");
        const [answer] = await Promise.all([
          page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
          resolve.click(),
        ]);
        expect.soft(answer.status()).toBe(200);
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "completed");
        expect.soft((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_COMPLETED");
      });
    });
  }

  // ── regression ────────────────────────────────────────────────────────────────────────────────────────────────────────

  // THE MOVE IS THE SELLING TEAM'S (orderMoves: shipped → problem is sideSelling): the crew that handed the parcel over
  // cannot mark it a problem — the server refuses it by name and the order stays shipped.
  test("The warehouse cannot mark an order a problem — refused, it stays shipped", async ({ browser }) => {
    const orderId = ground.orders.crew!;
    const wh = await crewPage(browser);
    try {
      const res = await ok<{ results: MoveResult[] }>(wh, "selling.v1.OrderService/OrderStatusChange", {
        teamId: ground.warehouse,
        orderIds: [orderId],
        to: "ORDER_STATUS_PROBLEM",
      });
      expect(res.results[0]?.moved ?? false).toBe(false);
      expect(res.results[0]?.refusedReason ?? "").toContain("only the selling team");
      expect((await orderOf(wh, orderId, ground.warehouse)).status).toBe("ORDER_STATUS_SHIPPED");

      await wh.goto(`/warehouse-orders?step=all&q=${refOf("crew")}`);
      await expect(wh.getByTestId("pick-tab-all")).toHaveAttribute("aria-selected", "true");
      const row = wh.getByTestId(`pick-queue-row-${orderId}`);
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByTestId("order-status-7")).toBeVisible();
    } finally {
      await wh.close();
    }
  });

  // Its own test per role, LAST in the file: each moves one order of the role's own shop (see the head of this file).
  for (const r of ROLES) {
    test(`${r.label} mark problem order (${COND}): problem recorded in analytic metric`, async ({ page }) => {
      await signInAs(page, r.key);
      const [moved, kept] = metricSlots(r.key);
      const [orderId, left] = [ground.orders[moved]!, ground.orders[kept]!];
      const shop = ground.metricShops[r.key]!;
      expect(await orderOf(page, orderId).then((o) => o.status)).toBe("ORDER_STATUS_SHIPPED");

      // WHEN — Mark as Problem on one of the shop's two orders; the other stays shipped.
      await markProblem(page, orderId, refOf(moved));
      expect((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_PROBLEM");
      expect((await orderOf(page, left)).status).toBe("ORDER_STATUS_SHIPPED");

      await test.step("then: problem recorded in analytic metric", async () => {
        // Order status moves is offered under Order, and the shop's Problem reads the ONE mark problem.
        await expectMovesOffered(page);
        await expectMoveCounted(page, shop, "problem_count");
      });
    });
  }
});

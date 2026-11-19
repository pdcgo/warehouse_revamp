import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── mark lost order — the checks behind docs/acceptances/inventory/order.md (## problem and lost) ────────────────────────
//
// mark lost order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are
// the owner's, set by hand — never by this file.
//
// Business rules:
// - the status diagram (docs/business/order/context.md): `shipped → lost`, `problem → lost` and `return → lost` (the
//   parcel never came back), each by customer service. The server's table (orderMoves, order_transition.go) gives all
//   three to the selling team only: the warehouse is refused ("only the selling team moves shipped to lost").
// - lost-is-final (docs/business/order/context_decision.md): nothing moves out of `lost` — every move is refused. A parcel
//   that turns up is a found stock-in naming the order (a-found-lost-parcel-is-a-found-stock-in, report found's spec),
//   and the order stays lost.
// - every-allowed-move-has-a-button (same file): Mark as Lost on `shipped` (and on `problem`, `return`), CONFIRMED — it is
//   destructive (features/orders/rowActions.ts: MARK_LOST); the lost row offers nothing to press.
// - lost-is-a-metric-and-completed-is-not (docs/business/order/order_statistic_metric_decision.md): Order Lost Created
//   (`metrics/orders/lost_created`, `lost_created_count`) counts an order on the day it was marked lost.
//
// `selling:all` → EVERY selling role (selling:owner, selling:admin, selling:cs), each in its own browser session, each on
// an order of its own. The then the WAREHOUSE sees is read by one warehouse role (warehouse:staff, the crew) on a second
// page of the same test.
//
// The WHEN — customer service works down Orders › <the order's status tab>: the order's row (the list narrowed by its
// Order ID), its row menu, Mark as Lost, and the confirm. (The order page's own Mark as Lost button is pressed by
// orders.spec.ts's "Moves: a shipped order is written off as lost directly" and "Moves: a problem order is written off
// as lost (#11)".)
//
// How each then is read:
// - `status changed from <s> to lost` — the order's own record says ORDER_STATUS_LOST; on Orders it has left the <s> tab
//   and stands on the Lost tab with the Lost badge (order-status-10).
// - `lost recorded in order timeline` — the order's page: the stepper on Lost, and on its timeline ONE "Parcel lost" row
//   (order-timeline-lost), from the Seller, naming the role's user; the record's timeline has ONE lost row, from
//   selling, by that user.
// - `warehouse sees order lost` — the crew: its order page (WarehouseOrderDetail) shows the Lost badge and, on its
//   Timeline tab, ONE lost step by the seller's user; on its Orders › Semua the order carries the Lost badge; the order
//   as the warehouse reads it is ORDER_STATUS_LOST.
// - `lost recorded in analytic metric` — Analytic › Order Lost Created, by shop, last 7 days, filtered to the role's
//   shop: 1. Each role's shipped order is on a shop of its OWN (nothing else is lost there), so the figure is that order.
// - `no status change available on lost order` — the Lost tab's row menu offers only "open the order", none of the
//   moves; the order page draws no action bar; the server refuses every move out of lost for the seller (shipped,
//   completed, problem, return), and the crew's page offers no return / accept / cancel and its forced return is refused.
//   The order stays lost.
//
// GROUND (beforeAll, as root, through the API): a selling team of its own (root owns it) with a user per selling role, a
// warehouse it returns to with a warehouse:staff user, 12 units of one product accepted onto a rack there, a Shopee shop
// per role (for its shipped order and its metric) and one shared shop (the problem and return orders, the warehouse's
// refused move) — root and the CS on every shop. Orders of 1 unit, each walked by the warehouse to `shipping`
// (processed → picked → shipping) and by the selling team on to `shipped`, then to `problem` or `return` for those
// givens. Seeded in beforeAll so a worker restarted after a failure seeds its own.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-lost-pass-1";
const PRODUCT = `Sabun Hilang ${SUFFIX}`;
const SKU = `MLK${SUFFIX}`;
const STOCK = 12;

const ROLES = [
  { key: "own", role: "ROLE_SELLING_OWNER", label: "selling:owner" },
  { key: "adm", role: "ROLE_SELLING_ADMIN", label: "selling:admin" },
  { key: "cs", role: "ROLE_SELLING_CS", label: "selling:cs" },
] as const;
type Key = (typeof ROLES)[number]["key"];

const COND_SHIPPED = "status: shipped · 1 order";
const COND_PROBLEM = "status: problem · 1 order";
const COND_RETURN = "status: return · 1 order";

// Every row action an order can offer (features/orders/rowActions.ts › RowActionId) — none may be on a lost row.
const MOVES = ["cancel", "editReceipt", "ship", "returnGoods", "complete", "markLost", "markProblem", "resolveDispute"];

const userOf = (key: Key) => `e2eml${key}${SUFFIX}`;
const nameOf = (key: Key) => `Lost ${key} ${SUFFIX}`;
const WH_USER = `e2emlwh${SUFFIX}`;
// The marketplace's Order ID — carries the run's suffix (a repeat within a team is refused).
const refOf = (slot: string) => `ML${SUFFIX}${slot.toUpperCase()}`;
const resiOf = (slot: string) => `JML${SUFFIX}${slot.toUpperCase()}`;

const ground = {
  team: "",
  warehouse: "",
  // the shared shop: the problem and return orders, the warehouse's refused move
  shop: "",
  // role key → its own shop (its shipped order and its metric)
  shops: {} as Record<string, string>,
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

type Tab = "shipped" | "problem" | "return" | "lost";

// The seller's Orders on one status tab, narrowed by the order's Order ID — the list has drawn its answer (rows or the
// empty state) once this returns.
async function openOrdersTab(page: Page, status: Tab, ref: string) {
  await page.goto(`/orders?status=${status}&q=${ref}`);
  await expect(page.getByTestId(`orders-tab-${status}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("orders-table").or(page.getByTestId("orders-empty")).first()).toBeVisible({ timeout: 15_000 });
}

// THE WHEN — Orders › <from>, the order's row menu, Mark as Lost, and the confirm (lost is final, so it asks first).
// Returns the OrderStatusChange the confirm sent.
async function markLost(page: Page, orderId: string, ref: string, from: Tab) {
  await openOrdersTab(page, from, ref);
  await expect(page.getByTestId(`order-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(`order-actions-${orderId}`).click();
  const item = page.getByTestId(`order-markLost-${orderId}`);
  await expect(item).toBeVisible();
  await expect.soft(item).toContainText("Mark as Lost");
  await item.click();

  // The confirm names the order; nothing is sent before it is pressed.
  const confirm = page.getByTestId("confirm-action");
  await expect(confirm).toBeVisible();
  await expect.soft(page.getByText(`Mark order #${orderId} as lost?`, { exact: false })).toBeVisible();
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
    confirm.click(),
  ]);
  expect(answer.status(), await answer.text()).toBe(200);
  const body = (await answer.json()) as { results: MoveResult[] };
  expect(body.results[0]?.moved, `lost #${orderId}: ${body.results[0]?.refusedReason}`).toBe(true);

  return JSON.parse(answer.request().postData() ?? "{}") as { orderIds?: string[]; to?: string };
}

// `status changed from <from> to lost` — the record, the <from> tab without it, the Lost tab with it and its badge.
async function statusChangedToLost(page: Page, orderId: string, ref: string, from: Tab) {
  expect.soft((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_LOST");
  await openOrdersTab(page, from, ref);
  await expect.soft(page.getByTestId(`order-row-${orderId}`)).toHaveCount(0);
  await openOrdersTab(page, "lost", ref);
  const row = page.getByTestId(`order-row-${orderId}`);
  await expect.soft(row).toBeVisible();
  await expect.soft(row.getByTestId("order-status-10")).toBeVisible();
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Lost Seller ${SUFFIX}`, `MLS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Lost WH ${SUFFIX}`, `MLW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
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
    name: `Lost crew ${SUFFIX}`,
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
  ground.shop = await shop(`E2E Hilang Shop ${SUFFIX}`, `MLP${SUFFIX}`);
  for (const r of ROLES) {
    ground.shops[r.key] = await shop(`E2E Hilang ${r.key} Shop ${SUFFIX}`, `ML${r.key.toUpperCase()}${SUFFIX}`);
  }

  // The product's units on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `ml-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Lost ${SUFFIX}` })).category.id;
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
      name: `E2E lost ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-MLO-${SUFFIX}`,
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
  // marked shipped by the selling team — and on to `then` (problem, return) for those givens.
  const place = async (slot: string, shopId: string, then: string[] = []) => {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-lost-${slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId,
      warehouseId: ground.warehouse,
      customerName: `E2E Lost Buyer ${slot} ${SUFFIX}`,
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
    for (const to of ["SHIPPED", ...then]) {
      await move(page, ground.team, id, to);
    }
    ground.orders[slot] = id;
  };
  for (const r of ROLES) {
    await place(r.key, ground.shops[r.key]!);
    await place(`${r.key}p`, ground.shop, ["PROBLEM"]);
    await place(`${r.key}r`, ground.shop, ["RETURN"]);
  }
  await place("crew", ground.shop);

  await page.close();
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── (status: shipped · 1 order) ─────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to mark an order lost (${COND_SHIPPED})`, () => {
  for (const r of ROLES) {
    test(`${r.label} mark lost order`, async ({ page, browser }) => {
      const orderId = ground.orders[r.key]!;
      const ref = refOf(r.key);
      const shop = ground.shops[r.key]!;
      await signInAs(page, r.key);

      // GIVEN — shipped: on its way, on the platform.
      expect((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_SHIPPED");

      // WHEN — Orders › Shipped, the row's menu, Mark as Lost, confirm.
      const sent = await markLost(page, orderId, ref, "shipped");
      expect.soft(sent.orderIds?.map(String)).toEqual([orderId]);
      expect.soft(sent.to).toBe("ORDER_STATUS_LOST");

      await test.step("then: status changed from shipped to lost", async () => {
        await statusChangedToLost(page, orderId, ref, "shipped");
      });

      await test.step("then: lost recorded in order timeline", async () => {
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "lost");
        const step = page.getByTestId("section-timeline").getByTestId("order-timeline-lost");
        await expect.soft(step).toHaveCount(1);
        await expect.soft(step).toContainText("Parcel lost");
        await expect.soft(step).toContainText("Seller");
        await expect.soft(step).toContainText(nameOf(r.key));
        const rows = ((await orderOf(page, orderId)).timelineLogs ?? []).filter((l) => l.status === "ORDER_STATUS_LOST");
        expect.soft(rows.length, "lost rows on the record's timeline").toBe(1);
        expect.soft(rows[0]?.from).toBe("ORDER_TIMELINE_FROM_SELLING");
        expect.soft(String(rows[0]?.actorId ?? "")).toBe(ground.users[r.key]);
      });

      const wh = await crewPage(browser);
      try {
        await test.step("then: warehouse sees order lost", async () => {
          await wh.goto(`/orders/${orderId}`);
          const detail = wh.getByTestId("order-detail-page");
          await expect(detail).toBeVisible({ timeout: 15_000 });
          await expect.soft(detail.getByTestId("order-status-10").first()).toBeVisible();
          await wh.getByTestId("order-detail-tab-timeline").click();
          await expect(wh.getByTestId("order-detail-timeline")).toBeVisible();
          await expect.soft(wh.getByTestId("order-timeline-lost")).toHaveCount(1);
          await expect.soft(wh.getByTestId("order-timeline-lost-by")).toContainText(userOf(r.key));

          // Its Orders › Semua: the order, with the Lost badge.
          await wh.goto(`/warehouse-orders?step=all&q=${ref}`);
          await expect(wh.getByTestId("pick-tab-all")).toHaveAttribute("aria-selected", "true");
          const row = wh.getByTestId(`pick-queue-row-${orderId}`);
          await expect.soft(row).toBeVisible({ timeout: 15_000 });
          await expect.soft(row.getByTestId("order-status-10")).toBeVisible();

          expect.soft((await orderOf(wh, orderId, ground.warehouse)).status, "the order as the warehouse reads it").toBe(
            "ORDER_STATUS_LOST",
          );
        });

        await test.step("then: lost recorded in analytic metric", async () => {
          // Order Lost Created, by shop, the role's own shop: its one lost order (the fold lands on an event — re-read).
          await expect
            .soft(async () => {
              await page.goto(`/analytic?g=shop&m=metrics/orders/lost_created&r=7d&shop=${shop}`);
              await expect(page.getByTestId(`analytic-cell-${shop}-lost_created_count`)).toHaveText("1", { timeout: 3_000 });
            })
            .toPass({ timeout: 45_000 });
        });

        await test.step("then: no status change available on lost order", async () => {
          // The Lost tab's row menu: only "open the order" — none of the moves.
          await openOrdersTab(page, "lost", ref);
          await expect(page.getByTestId(`order-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
          await page.getByTestId(`order-actions-${orderId}`).click();
          await expect(page.getByTestId(`order-detail-${orderId}`)).toBeVisible();
          for (const m of MOVES) {
            await expect.soft(page.getByTestId(`order-${m}-${orderId}`), `row menu offers ${m}`).toHaveCount(0);
          }
          await expect.soft(page.locator(`[role="menuitem"][data-testid$="-${orderId}"]`)).toHaveCount(1);
          await page.keyboard.press("Escape");

          // The order page: no action bar at all.
          await page.goto(`/orders/${orderId}`);
          await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "lost", { timeout: 15_000 });
          await expect.soft(page.getByTestId("order-action-bar")).toHaveCount(0);
          await expect.soft(page.getByTestId("order-action-more")).toHaveCount(0);

          // The server: every move out of lost is refused for the seller (lost-is-final).
          for (const to of ["SHIPPED", "COMPLETED", "PROBLEM", "RETURN"]) {
            const res = await tryMove(page, ground.team, orderId, to);
            expect.soft(res.moved ?? false, `lost → ${to} by the seller`).toBe(false);
            expect.soft(res.refusedReason ?? "", `lost → ${to} by the seller`).toContain("cannot move");
          }

          // The crew: no return, accept or cancel on its page, and its forced return is refused.
          await wh.goto(`/orders/${orderId}`);
          await expect(wh.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
          await expect.soft(wh.getByTestId("order-status-10").first()).toBeVisible();
          for (const id of ["order-force-return", "order-accept-return", "order-cancel"]) {
            await expect.soft(wh.getByTestId(id), `the crew's page offers ${id}`).toHaveCount(0);
          }
          const forced = await tryMove(wh, ground.warehouse, orderId, "RETURN");
          expect.soft(forced.moved ?? false, "lost → return by the warehouse").toBe(false);

          expect.soft((await orderOf(page, orderId)).status, "the order after every refused move").toBe("ORDER_STATUS_LOST");
        });
      } finally {
        await wh.close();
      }
    });
  }

  // ── regression ────────────────────────────────────────────────────────────────────────────────────────────────────────

  // THE MOVE IS THE SELLING TEAM'S (orderMoves: shipped → lost is sideSelling): the crew that handed the parcel over
  // cannot write it off — the server refuses it by name and the order stays shipped.
  test("The warehouse cannot mark an order lost — refused, it stays shipped", async ({ browser }) => {
    const orderId = ground.orders.crew!;
    const wh = await crewPage(browser);
    try {
      const res = await tryMove(wh, ground.warehouse, orderId, "LOST");
      expect(res.moved ?? false).toBe(false);
      expect(res.refusedReason ?? "").toContain("only the selling team");
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
});

// ── (status: problem · 1 order) ─────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to mark an order lost (${COND_PROBLEM})`, () => {
  for (const r of ROLES) {
    test(`${r.label} mark lost order`, async ({ page }) => {
      const orderId = ground.orders[`${r.key}p`]!;
      const ref = refOf(`${r.key}p`);
      await signInAs(page, r.key);

      // GIVEN — a problem: customer service is disputing it on the platform.
      expect((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_PROBLEM");

      // WHEN — Orders › Problem, the row's menu, Mark as Lost, confirm.
      const sent = await markLost(page, orderId, ref, "problem");
      expect.soft(sent.to).toBe("ORDER_STATUS_LOST");

      await test.step("then: status changed from problem to lost", async () => {
        await statusChangedToLost(page, orderId, ref, "problem");
      });
    });
  }
});

// ── (status: return · 1 order) ──────────────────────────────────────────────────────────────────────────────────────────

test.describe(`selling:all wants to mark an order lost (${COND_RETURN})`, () => {
  for (const r of ROLES) {
    test(`${r.label} mark lost order`, async ({ page }) => {
      const orderId = ground.orders[`${r.key}r`]!;
      const ref = refOf(`${r.key}r`);
      await signInAs(page, r.key);

      // GIVEN — a return on its way back that never arrived.
      expect((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_RETURN");

      // WHEN — Orders › Return, the row's menu, Mark as Lost, confirm.
      const sent = await markLost(page, orderId, ref, "return");
      expect.soft(sent.to).toBe("ORDER_STATUS_LOST");

      await test.step("then: status changed from return to lost", async () => {
        await statusChangedToLost(page, orderId, ref, "return");
      });
    });
  }
});

import { expect, test } from "@playwright/test";
import type { Browser, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { expectMoveCounted, expectMovesOffered } from "./order_moves_metric";

// ── back to pending order — the checks behind docs/acceptances/inventory/order.md (### process: confirm) ───────────────
//
// back to pending order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the
// checks for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows'
// statuses are the owner's, set by hand — never by this file.
//
// Business rules:
// - missing-goods-send-the-order-back-to-pending (docs/business/inventory/order_decision.md): when no rack has a line's
//   goods, the WAREHOUSE sends the order processed → pending and writes why on the order's timeline (from = warehouse);
//   the selling team decides what happens next — from pending it may cancel (it amends
//   no-cancel-after-the-warehouse-confirms).
// - a-platform-cancel-goes-back-through-pending (same file): the marketplace cancelled after the warehouse confirmed —
//   customer service notes it on the timeline (from = selling), the staff unpack and put the goods back on a rack, and
//   the warehouse hands the order back to pending with a note; customer service cancels.
// - only-the-selling-team-cancels (docs/business/order/context_decision.md): the warehouse never cancels — it hands the
//   order back; the move is the warehouse's, with a note in order_timeline_logs.
// - the warehouse's list makes the move (the pick page says "a move back to pending is the list's"): a row's menu ›
//   back to Perlu konfirmasi opens a dialog that asks for the reason, and the reason travels with the move.
//
// `warehouse:all` → EVERY warehouse role (warehouse:owner, warehouse:admin, warehouse:staff), each in its own browser
// session, each on orders of its own. The selling team's thens are read by its owner (selling:owner) on a second page.
//
// The WHEN — the role opens Orders on the order's step (Dikonfirmasi for processed, Sudah diambil for picked), narrowed
// by its Order ID, opens the row's menu › back to Perlu konfirmasi, types the reason and confirms: ONE
// OrderStatusChange to pending carrying that note.
//
// How each then is read:
// - `status changed from processed to pending` / `… from picked to pending` — the move's answer says moved, pending; the
//   order's own record reads ORDER_STATUS_PENDING; on Orders it has left its step's tab and stands on Perlu konfirmasi
//   again; its pick page offers Confirm Order once more.
// - `note shown in order timeline` — the warehouse's order detail › Timeline: a second pending step, "Handed back to
//   pending", by the role's person, from the Warehouse, with the reason under it; the record has ONE pending row
//   carrying that note, from the warehouse, the role's person as its actor. (A note row the seller wrote stays out of
//   the Timeline — it is Catatan's, a-note-is-a-timeline-row.)
// - `selling team sees order pending` — selling:owner opens the order: its stepper stands on pending, and its timeline
//   rail's newest step is the hand-back with the reason; the record read as the seller says pending.
// - `order can be cancelled` — the same selling:owner: Cancel Order is offered, it and its confirm answer 200, and the
//   order is cancelled (its stepper and its record).
// - `back to pending recorded in analytic metric` — Analytic › Order › Order status moves (`metrics/orders/moves`, #84)
//   counts a hand-back as a Back to pending, processed or picked → pending (the-order-metric-ids-name-what-moved). Its own
//   test per role, LAST in the file — EVERY warehouse role on a shop of its own with TWO processed orders of which the
//   role hands ONE back, read as that role (a warehouse reads every count of the orders it ships): Add Metric › Order
//   offers Order status moves,
//   and Analytic by shop over the last 7 days, filtered to that shop, reads `created_count` 2 (the fold landed) and
//   `back_to_pending_count` exactly 1 — the untouched order, still processed, adds nothing (order_moves_metric.ts).
//
// Regression beside them (no then): the dialog holds its confirm while the reason is empty; the server refuses a
// hand-back with no note, and refuses the SELLING team making the move (only the warehouse hands back) — the order stays
// processed.
//
// GROUND (beforeAll, as root, through the API): a selling team of its own (root owns it) with its owner, a warehouse it
// returns to with a user per warehouse role, a Shopee shop, 20 units of one product accepted onto a rack there. Per role
// two orders of 1 unit: one confirmed (processed), one confirmed and picked with customer service's note that the
// platform cancelled it; per role the metric check's own shop with two processed orders; one processed order for the
// regression.
// Seeded in beforeAll so a worker restarted after a failure seeds its own.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-handback-pass-1";
const PRODUCT = `Kaos Hitam Balik ${SUFFIX}`;
const SKU = `OHB${SUFFIX}`;

const WAREHOUSE_ROLES = [
  { key: "wown", role: "ROLE_WAREHOUSE_OWNER", label: "warehouse:owner" },
  { key: "wadm", role: "ROLE_WAREHOUSE_ADMIN", label: "warehouse:admin" },
  { key: "wstf", role: "ROLE_WAREHOUSE_STAFF", label: "warehouse:staff" },
] as const;
type Role = (typeof WAREHOUSE_ROLES)[number];
const SELLER = "sown";

const PROCESSED_COND = "status: processed · goods missing on rack · note";
const PICKED_COND = "status: picked · cancelled on platform · goods back on rack · note";

const userOf = (key: string) => `e2eoh${key}${SUFFIX}`;
const nameOf = (label: string) => `Hand Back ${label} ${SUFFIX}`;
// The marketplace's Order ID — carries the run's suffix (a repeat within a team is refused).
const refOf = (slot: string) => `OH${SUFFIX}${slot.toUpperCase()}`;
// Each order's reason is its own, so a reason found on a page can only be the one that role wrote.
const missingNoteOf = (key: string) => `${PRODUCT} missing on Rak A, no rack has it — ${key}`;
const platformNoteOf = (key: string) => `Dibatalkan di Shopee, barang sudah dibongkar dan kembali ke Rak A — ${key}`;
const CS_NOTE = `Pembeli membatalkan di Shopee — ${SUFFIX}`;

const ground = {
  team: "",
  warehouse: "",
  shop: "",
  // role key → the metric check's own shop
  metricShops: {} as Record<string, string>,
  // slot ("pr-<role>", "pk-<role>", "met1-<role>", "met2-<role>", "reg") → order id
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

type MoveResult = { orderId?: string; moved?: boolean; status?: string; refusedReason?: string };

async function move(page: Page, teamId: string, orderId: string, to: string, note = ""): Promise<MoveResult> {
  const res = await ok<{ results: MoveResult[] }>(page, "selling.v1.OrderService/OrderStatusChange", {
    teamId,
    orderIds: [orderId],
    to: `ORDER_STATUS_${to}`,
    note,
  });

  return res.results[0] ?? {};
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function signInAs(page: Page, key: string, teamId: string) {
  await signIn(page, userOf(key), PASSWORD);
  await useTeam(page, teamId);
}

// The selling team's reader, on a page of its own (a fresh context: the form sign-in).
async function sellerPage(browser: Browser): Promise<Page> {
  const p = await browser.newPage();
  await signInAs(p, SELLER, ground.team);

  return p;
}

type Log = { note?: string; status?: string; from?: string; actorId?: string };
type OrderRecord = { status: string; timelineLogs?: Log[] };

// The order as the server keeps it, read in `teamId` (the seller's, or the warehouse's).
async function orderOf(page: Page, orderId: string, teamId: string): Promise<OrderRecord> {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId, orderId })).order as OrderRecord;
}

// The record's hand-back rows carrying this note — pending status rows with the reason.
function handBacksIn(order: OrderRecord, note: string): Log[] {
  return (order.timelineLogs ?? []).filter((l) => l.status === "ORDER_STATUS_PENDING" && l.note === note);
}

// The order's page, drawn.
async function openOrder(page: Page, orderId: string) {
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
}

// Orders on one step's tab, narrowed by the order's Order ID.
async function openStep(page: Page, step: string, slot: string) {
  await page.goto(`/warehouse-orders?step=${step}&q=${refOf(slot)}`);
  await expect(page.getByTestId(`pick-tab-${step}`)).toHaveAttribute("aria-selected", "true");
}

// THE WHEN — Orders on the order's step › the row's menu › back to Perlu konfirmasi › the reason › confirm. Returns the
// OrderStatusChange the page sent and its answer.
async function handBack(page: Page, step: string, slot: string, reason: string): Promise<Response> {
  const orderId = ground.orders[slot]!;
  await openStep(page, step, slot);
  await expect(page.getByTestId(`pick-queue-row-${orderId}`)).toBeVisible({ timeout: 15_000 });

  await page.getByTestId(`pick-queue-actions-${orderId}`).click();
  await page.getByTestId(`pick-queue-move-${orderId}-toConfirm`).click();

  const dialog = page.getByTestId("step-back-dialog");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByTestId("step-back-confirm");
  // Regression: no reason, no move — the confirm is held while the box is empty.
  await expect.soft(confirm, "held while the reason is empty").toBeDisabled();
  await dialog.getByTestId("step-back-reason").fill(reason);
  await expect(confirm).toBeEnabled();

  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
    confirm.click(),
  ]);
  await expect(dialog).toBeHidden();

  return answer;
}

// then: status changed from <step> to pending — the answer, the record, the tabs, the pick page.
async function expectBackToPending(page: Page, answer: Response, step: string, slot: string, reason: string) {
  const orderId = ground.orders[slot]!;
  expect.soft(answer.status()).toBe(200);
  const sent = JSON.parse(answer.request().postData() ?? "{}") as { teamId?: string; orderIds?: string[]; to?: string; note?: string };
  expect.soft(sent.teamId, "moved as the warehouse").toBe(ground.warehouse);
  expect.soft(sent.orderIds).toEqual([orderId]);
  expect.soft(sent.to).toBe("ORDER_STATUS_PENDING");
  expect.soft(sent.note, "the reason travels with the move").toBe(reason);
  const results = ((await answer.json()) as { results: MoveResult[] }).results;
  expect.soft(results.length).toBe(1);
  expect.soft(results[0]?.moved, results[0]?.refusedReason).toBe(true);
  expect.soft(results[0]?.status).toBe("ORDER_STATUS_PENDING");

  expect.soft((await orderOf(page, orderId, ground.warehouse)).status).toBe("ORDER_STATUS_PENDING");

  // Off its step's tab, back on Perlu konfirmasi.
  await openStep(page, step, slot);
  await expect(page.getByTestId("pick-queue-table").or(page.getByTestId("pick-queue-empty")).first()).toBeVisible();
  await expect.soft(page.getByTestId(`pick-queue-row-${orderId}`)).toHaveCount(0);
  await openStep(page, "toConfirm", slot);
  await expect.soft(page.getByTestId(`pick-queue-row-${orderId}`)).toBeVisible({ timeout: 15_000 });

  // The pick page: pending again — Confirm Order is its first job once more.
  await page.goto(`/warehouse-orders/${orderId}`);
  await expect.soft(page.getByTestId("order-status-1")).toBeVisible({ timeout: 15_000 });
  await expect.soft(page.getByTestId("pick-order-advance")).toContainText("Confirm Order");
}

// then: note shown in order timeline — the warehouse's detail › Timeline, and the record.
async function expectHandBackInTimeline(page: Page, r: Role, slot: string, reason: string) {
  const orderId = ground.orders[slot]!;
  await openOrder(page, orderId);
  await page.getByTestId("order-detail-tab-timeline").click();
  await expect(page.getByTestId("order-detail-timeline")).toBeVisible();

  // Two pending steps: the placement, then the hand-back — oldest first, so the hand-back is the last.
  const pendings = page.getByTestId("order-detail-timeline").getByTestId("order-timeline-pending");
  await expect.soft(pendings).toHaveCount(2);
  const back = pendings.last();
  await expect.soft(back).toContainText("Handed back to pending");
  await expect.soft(back.getByTestId("order-timeline-pending-note")).toHaveText(reason);
  await expect.soft(back.getByTestId("order-timeline-pending-by")).toContainText(userOf(r.key));
  await expect.soft(back.getByTestId("order-timeline-pending-when")).toContainText("Warehouse");
  // The reason is the hand-back's alone — on no other step.
  await expect.soft(page.getByTestId("order-detail-timeline").getByText(reason)).toHaveCount(1);

  const rows = handBacksIn(await orderOf(page, orderId, ground.warehouse), reason);
  expect.soft(rows.length, `pending rows noting "${reason}"`).toBe(1);
  expect.soft(rows[0]?.from).toBe("ORDER_TIMELINE_FROM_WAREHOUSE");
  expect.soft(String(rows[0]?.actorId ?? ""), "its writer").toBe(ground.users[r.key]);
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Hand Back Seller ${SUFFIX}`, `OHS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Hand Back WH ${SUFFIX}`, `OHW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  const seller = await ok(page, "user.v1.UserService/CreateUser", {
    teamId: ground.team,
    username: userOf(SELLER),
    password: PASSWORD,
    name: nameOf("selling:owner"),
    role: "ROLE_SELLING_OWNER",
  });
  ground.users[SELLER] = String(seller.user.id);
  for (const r of WAREHOUSE_ROLES) {
    const made = await ok(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouse,
      username: userOf(r.key),
      password: PASSWORD,
      name: nameOf(r.label),
      role: r.role,
    });
    ground.users[r.key] = String(made.user.id);
  }

  const shop = async (name: string, code: string) => {
    const id = String(
      (await ok(page, "selling.v1.ShopService/ShopCreate", { teamId: ground.team, name, shopCode: code, marketplace: "MARKETPLACE_SHOPEE" }))
        .shop.id,
    );
    // Root first — the first grant is the shop's primary CS; the seller's owner on it too.
    await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: id, userId: ROOT_USER_ID });
    await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: id, userId: ground.users[SELLER] });

    return id;
  };
  ground.shop = await shop(`E2E Hand Back Shop ${SUFFIX}`, `OHP${SUFFIX}`);
  // The metric check's own shop per role, so no other test's hand-back counts on it.
  for (const r of WAREHOUSE_ROLES) {
    ground.metricShops[r.key] = await shop(`E2E Hand Back Metric ${r.key} ${SUFFIX}`, `OHM${r.key.toUpperCase()}${SUFFIX}`);
  }

  // 20 units of the product on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `oh-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Hand Back ${SUFFIX}` })).category.id;
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
      name: `E2E hand back ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-OHB-${SUFFIX}`,
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
    items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count: 20, total: 200_000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 20, placements: [{ placementId: rack, quantity: 20 }] }],
  });

  // The orders: processed (the warehouse confirmed it) for the goods-missing given, the metric shop and the regression;
  // processed then picked for the platform-cancel given, with customer service's note that the platform cancelled it.
  const walks: { slot: string; shop: string; to: string[]; csNote?: boolean }[] = [];
  for (const r of WAREHOUSE_ROLES) {
    walks.push({ slot: `pr-${r.key}`, shop: ground.shop, to: ["PROCESSED"] });
    walks.push({ slot: `pk-${r.key}`, shop: ground.shop, to: ["PROCESSED", "PICKED"], csNote: true });
  }
  for (const r of WAREHOUSE_ROLES) {
    walks.push({ slot: `met1-${r.key}`, shop: ground.metricShops[r.key]!, to: ["PROCESSED"] });
    walks.push({ slot: `met2-${r.key}`, shop: ground.metricShops[r.key]!, to: ["PROCESSED"] });
  }
  walks.push({ slot: "reg", shop: ground.shop, to: ["PROCESSED"] });

  for (const w of walks) {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-ohback-${w.slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId: w.shop,
      warehouseId: ground.warehouse,
      customerName: `E2E Hand Back Buyer ${w.slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(w.slot),
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
    });
    const id = String(placed.order.id);
    for (const status of w.to) {
      const moved = await move(page, ground.warehouse, id, status);
      expect(moved.moved, `${w.slot} → ${status}: ${moved.refusedReason}`).toBe(true);
    }
    if (w.csNote) {
      await ok(page, "selling.v1.OrderService/OrderNoteCreate", { teamId: ground.team, orderId: id, note: CS_NOTE });
    }
    ground.orders[w.slot] = id;
  }

  await page.close();
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── warehouse:all · (status: processed · goods missing on rack · note) ─────────────────────────────────────────────────

test.describe(`warehouse:all wants to hand an order back to pending (${PROCESSED_COND})`, () => {
  for (const r of WAREHOUSE_ROLES) {
    test(`${r.label} back to pending order`, async ({ page, browser }) => {
      const slot = `pr-${r.key}`;
      const orderId = ground.orders[slot]!;
      const reason = missingNoteOf(r.key);
      await signInAs(page, r.key, ground.warehouse);

      // GIVEN — processed: the warehouse confirmed it, and the goods are on no rack.
      expect((await orderOf(page, orderId, ground.warehouse)).status).toBe("ORDER_STATUS_PROCESSED");

      // WHEN — Dikonfirmasi › the row's menu › back to Perlu konfirmasi, with the reason.
      const answer = await handBack(page, "confirm", slot, reason);

      await test.step("then: status changed from processed to pending", async () => {
        await expectBackToPending(page, answer, "confirm", slot, reason);
      });

      await test.step("then: note shown in order timeline", async () => {
        await expectHandBackInTimeline(page, r, slot, reason);
      });

      const seller = await sellerPage(browser);

      await test.step("then: selling team sees order pending", async () => {
        await openOrder(seller, orderId);
        await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
        // The rail is newest first: the hand-back leads it, with the reason.
        const pendings = seller.getByTestId("section-timeline").getByTestId("order-timeline-pending");
        await expect.soft(pendings).toHaveCount(2);
        await expect.soft(pendings.first()).toContainText("Handed back to pending");
        await expect.soft(pendings.first()).toContainText(reason);
        expect.soft((await orderOf(seller, orderId, ground.team)).status).toBe("ORDER_STATUS_PENDING");
      });

      await test.step("then: order can be cancelled", async () => {
        await openOrder(seller, orderId);
        const cancel = seller.getByTestId("order-action-cancel");
        await expect.soft(cancel, "Cancel Order is offered again").toBeVisible();
        if ((await cancel.count()) > 0) {
          await cancel.click();
          const [answered] = await Promise.all([
            seller.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderCancel`)),
            seller.getByTestId("confirm-action").click(),
          ]);
          expect.soft(answered.status(), await answered.text()).toBe(200);
        }
        await openOrder(seller, orderId);
        await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "cancel");
        expect.soft((await orderOf(seller, orderId, ground.team)).status).toBe("ORDER_STATUS_CANCEL");
      });

      await seller.close();
    });
  }
});

// ── warehouse:all · (status: picked · cancelled on platform · goods back on rack · note) ───────────────────────────────

test.describe(`warehouse:all wants to hand an order back to pending (${PICKED_COND})`, () => {
  for (const r of WAREHOUSE_ROLES) {
    test(`${r.label} back to pending order`, async ({ page }) => {
      const slot = `pk-${r.key}`;
      const orderId = ground.orders[slot]!;
      const reason = platformNoteOf(r.key);
      await signInAs(page, r.key, ground.warehouse);

      // GIVEN — picked, and customer service noted that the platform cancelled it (a note row, from the seller); the
      // staff have unpacked it and the goods are back on a rack.
      const before = await orderOf(page, orderId, ground.warehouse);
      expect(before.status).toBe("ORDER_STATUS_PICKED");
      expect((before.timelineLogs ?? []).filter((l) => !l.status && l.note === CS_NOTE && l.from === "ORDER_TIMELINE_FROM_SELLING")).toHaveLength(1);

      // WHEN — Sudah diambil › the row's menu › back to Perlu konfirmasi, with the reason.
      const answer = await handBack(page, "picked", slot, reason);

      await test.step("then: status changed from picked to pending", async () => {
        await expectBackToPending(page, answer, "picked", slot, reason);
      });

      await test.step("then: note shown in order timeline", async () => {
        await expectHandBackInTimeline(page, r, slot, reason);
        // Customer service's note stays a note — not a step on the Timeline.
        await expect.soft(page.getByTestId("order-detail-timeline").getByText(CS_NOTE)).toHaveCount(0);
      });
    });
  }
});

// ── regression (no then) ────────────────────────────────────────────────────────────────────────────────────────────────

test("back to pending order: refused with no note, and refused to the selling team — the order stays processed", async ({ page, browser }) => {
  const orderId = ground.orders.reg!;
  await signInAs(page, "wstf", ground.warehouse);

  const blank = await move(page, ground.warehouse, orderId, "PENDING", "   ");
  expect.soft(blank.moved, "no note, no move").toBeFalsy();
  expect.soft(blank.refusedReason ?? "").toContain("note");

  const seller = await sellerPage(browser);
  const bySeller = await move(seller, ground.team, orderId, "PENDING", "the seller tries to hand it back");
  expect.soft(bySeller.moved, "only the warehouse hands an order back").toBeFalsy();
  expect.soft(bySeller.refusedReason ?? "").toContain("warehouse");
  await seller.close();

  const after = await orderOf(page, orderId, ground.warehouse);
  expect.soft(after.status).toBe("ORDER_STATUS_PROCESSED");
  expect.soft((after.timelineLogs ?? []).filter((l) => l.status === "ORDER_STATUS_PENDING").length, "only the placement").toBe(1);
});

// Its own test per role, LAST in the file: each moves one order of the role's own shop (see the head of this file).
for (const r of WAREHOUSE_ROLES) {
  test(`${r.label} back to pending order (${PROCESSED_COND}): back to pending recorded in analytic metric`, async ({ page }) => {
    await signInAs(page, r.key, ground.warehouse);
    const shop = ground.metricShops[r.key]!;
    const [moved, kept] = [`met1-${r.key}`, `met2-${r.key}`];
    const left = ground.orders[kept]!;
    expect((await orderOf(page, ground.orders[moved]!, ground.warehouse)).status).toBe("ORDER_STATUS_PROCESSED");

    // WHEN — ONE of the shop's two processed orders handed back; the other stays processed.
    const answer = await handBack(page, "confirm", moved, missingNoteOf(`met-${r.key}`));
    expect(answer.status()).toBe(200);
    expect((await orderOf(page, ground.orders[moved]!, ground.warehouse)).status).toBe("ORDER_STATUS_PENDING");
    expect((await orderOf(page, left, ground.warehouse)).status).toBe("ORDER_STATUS_PROCESSED");

    await test.step("then: back to pending recorded in analytic metric", async () => {
      // Order status moves is offered under Order, and the shop's Back to pending reads the ONE hand-back.
      await expectMovesOffered(page);
      await expectMoveCounted(page, shop, "back_to_pending_count");
    });
  });
}

import { expect, test } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── add order note — the checks behind docs/acceptances/inventory/order.md (## edit) ─────────────────────────────────────
//
// add order note's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are
// the owner's, set by hand — never by this file. The WHEN is the same from both ends, so both givens live in this one
// file: the selling team's note on a pending order, and the warehouse's note on a processed one.
//
// Business rules:
// - a-note-is-a-timeline-row (docs/technical/frontend/order_detail_decision.md): an order's note is ONE row of the
//   order's timeline with NO status — the text, the side it came from (`selling` when the writing team is the order's
//   team, `warehouse` when it is the order's warehouse), who wrote it and when. Either end adds one from the order's
//   detail (Catatan › Add Note); a note is never edited and never deleted; any other team reads NotFound. The detail's
//   Catatan lists the note rows, newest first, each with its side, its writer and its time; the pick page lists every
//   note, read-only.
// - the-two-note-limits-stay-different: a note added later is 1 to 500 characters, trimmed — the box counts to 500 and
//   stops there.
// - docs/business/order/context.md §Table That Must Have — order_timeline_logs carries note, from and actor_id.
//
// `selling:all` → EVERY selling role (selling:owner, selling:admin, selling:cs); `warehouse:all` → EVERY warehouse role
// (warehouse:owner, warehouse:admin, warehouse:staff). Each role in its own browser session, each on an order of its
// own, so "the note" is the order's only note. A then the OTHER end sees is read by one role there on a second page of
// the same test: warehouse:staff (the crew) for the seller's note, selling:owner for the warehouse's.
//
// The WHEN — the role opens its order's page (/orders/<id>: the seller's detail, or the warehouse's when the active team
// is the warehouse), types the note into Catatan's box and presses Add Note.
//
// How each then is read:
// - `note shown in order timeline` — reloaded, the page's Catatan holds the note, once, and it is the order's only note;
//   the order's record (OrderDetail) has exactly one timeline row with that note, and it carries no status (a note moves
//   nothing: the order keeps its status).
// - `note shown as from selling team` / `note shown as from warehouse` — the note's row is marked as that side
//   (data-from, and its meta line names it: "Seller" / "Warehouse"), names the role's own person as its writer, and the
//   record's row has that `from` and that person's id as its actor.
// - `warehouse sees note` — the crew, in the warehouse, opens the same order: its detail's Catatan has the note, marked
//   as from the seller, and the pick page (/warehouse-orders/<id>, where the order is packed) shows it above the pick
//   list; the order read as the warehouse carries it.
// - `selling team sees note` — selling:owner opens the same order: Catatan has the note, marked as from the warehouse;
//   the order read as the seller carries it.
//
// Regression beside them (no then): the box is held while empty or blank and stops at 500 characters; the server refuses
// a blank note, one past 500, and a team that is neither end (NotFound) — and writes nothing.
//
// GROUND (beforeAll, as root, through the API): a selling team of its own (root owns it) with a user per selling role, a
// warehouse it returns to with a user per warehouse role, a Shopee shop (root and the CS on it), 20 units of one product
// accepted onto a rack there. One order of 1 unit per role, placed with no note: pending for each selling role, confirmed
// (processed) by the warehouse for each warehouse role; plus a pending order for the regression. Seeded in beforeAll so a
// worker restarted after a failure seeds its own.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-addnote-pass-1";
const PRODUCT = `Sabun Catatan ${SUFFIX}`;
const SKU = `ONK${SUFFIX}`;
const NOTE_MAX = 500;

const SELLING_ROLES = [
  { key: "own", role: "ROLE_SELLING_OWNER", label: "selling:owner" },
  { key: "adm", role: "ROLE_SELLING_ADMIN", label: "selling:admin" },
  { key: "cs", role: "ROLE_SELLING_CS", label: "selling:cs" },
] as const;
const WAREHOUSE_ROLES = [
  { key: "wown", role: "ROLE_WAREHOUSE_OWNER", label: "warehouse:owner" },
  { key: "wadm", role: "ROLE_WAREHOUSE_ADMIN", label: "warehouse:admin" },
  { key: "wstf", role: "ROLE_WAREHOUSE_STAFF", label: "warehouse:staff" },
] as const;
type Key = (typeof SELLING_ROLES)[number]["key"] | (typeof WAREHOUSE_ROLES)[number]["key"];

// Who reads the OTHER end's note: the crew for the seller's, the selling team's owner for the warehouse's.
const CREW: Key = "wstf";
const SELLER_READER: Key = "own";

const userOf = (key: string) => `e2eon${key}${SUFFIX}`;
const nameOf = (label: string) => `Add Note ${label} ${SUFFIX}`;
// The marketplace's Order ID — carries the run's suffix (a repeat within a team is refused).
const refOf = (slot: string) => `ON${SUFFIX}${slot.toUpperCase()}`;
// Each role's note is its own, so a note found on a page can only be the one that role wrote.
const sellerNoteOf = (key: string) => `Titip bubble wrap, barangnya pecah belah — ${key} ${SUFFIX}`;
const warehouseNoteOf = (key: string) => `Stok kosong di Rak A, diganti dari Rak B — ${key} ${SUFFIX}`;

const ground = {
  team: "",
  warehouse: "",
  shop: "",
  // role key (or "reg") → order id
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

async function move(page: Page, teamId: string, orderId: string, to: string) {
  const res = await ok<{ results: { moved?: boolean; refusedReason?: string }[] }>(page, "selling.v1.OrderService/OrderStatusChange", {
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

async function signInAs(page: Page, key: Key, teamId: string) {
  await signIn(page, userOf(key), PASSWORD);
  await useTeam(page, teamId);
}

// The other end's reader, on a page of its own (a fresh context: the form sign-in).
async function readerPage(browser: Browser, key: Key, teamId: string): Promise<Page> {
  const p = await browser.newPage();
  await signInAs(p, key, teamId);

  return p;
}

type Log = { note?: string; status?: string; from?: string; actorId?: string };
type OrderRecord = { status: string; timelineLogs?: Log[] };

// The order as the server keeps it, read in `teamId` (the seller's, or the warehouse's).
async function orderOf(page: Page, orderId: string, teamId: string): Promise<OrderRecord> {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId, orderId })).order as OrderRecord;
}

// The record's note rows — its timeline rows with no status (a-note-is-a-timeline-row).
function notesIn(order: OrderRecord): Log[] {
  return (order.timelineLogs ?? []).filter((l) => !l.status && (l.note ?? "") !== "");
}

// The order's page, drawn.
async function openOrder(page: Page, orderId: string) {
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
}

// Catatan on the seller's detail (a section of the one page) and on the warehouse's (a card on its Info tab).
const sellerNotes = (page: Page): Locator => page.getByTestId("section-notes");
const warehouseNotes = (page: Page): Locator => page.getByTestId("order-detail-notes");

// One note's row in a Catatan, by its text.
const noteRow = (box: Locator, text: string): Locator => box.getByTestId("order-note").filter({ hasText: text });

// THE WHEN — Catatan's box: the note typed, Add Note pressed. Returns the OrderNoteCreate the page sent; the box is
// emptied once it is written.
async function addNote(page: Page, box: Locator, text: string) {
  const input = box.getByTestId("notes-input");
  const add = box.getByTestId("notes-add");
  await expect(input).toBeVisible({ timeout: 15_000 });

  await input.fill(text);
  await expect(box.getByTestId("notes-count")).toHaveText(`${text.length} / ${NOTE_MAX}`);
  await expect(add).toBeEnabled();
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderNoteCreate`)),
    add.click(),
  ]);
  expect(answer.status(), await answer.text()).toBe(200);
  await expect(input).toHaveValue("");

  return JSON.parse(answer.request().postData() ?? "{}") as { teamId?: string; orderId?: string; note?: string };
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Add Note Seller ${SUFFIX}`, `ONS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Add Note WH ${SUFFIX}`, `ONW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  for (const r of SELLING_ROLES) {
    const made = await ok(page, "user.v1.UserService/CreateUser", {
      teamId: ground.team,
      username: userOf(r.key),
      password: PASSWORD,
      name: nameOf(r.label),
      role: r.role,
    });
    ground.users[r.key] = String(made.user.id);
  }
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

  ground.shop = String(
    (await ok(page, "selling.v1.ShopService/ShopCreate", { teamId: ground.team, name: `E2E Note Shop ${SUFFIX}`, shopCode: `ONP${SUFFIX}`, marketplace: "MARKETPLACE_SHOPEE" }))
      .shop.id,
  );
  // Root first — the first grant is the shop's primary CS; the CS on it too.
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shop, userId: ROOT_USER_ID });
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shop, userId: ground.users.cs });

  // 20 units of the product on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `on-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Add Note ${SUFFIX}` })).category.id;
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
      name: `E2E add note ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-ONS-${SUFFIX}`,
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

  // The orders, placed with NO note: pending for each selling role and the regression, processed (the warehouse
  // confirmed it) for each warehouse role.
  const walks: Record<string, string[]> = { reg: [] };
  for (const r of SELLING_ROLES) walks[r.key] = [];
  for (const r of WAREHOUSE_ROLES) walks[r.key] = ["PROCESSED"];

  for (const [slot, to] of Object.entries(walks)) {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-onnote-${slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId: ground.shop,
      warehouseId: ground.warehouse,
      customerName: `E2E Add Note Buyer ${slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(slot),
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
    });
    const id = String(placed.order.id);
    for (const status of to) {
      await move(page, ground.warehouse, id, status);
    }
    ground.orders[slot] = id;
  }

  await page.close();
}

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── selling:all · (status: pending · 1 order) ──────────────────────────────────────────────────────────────────────────

test.describe("selling:all wants to leave a note on an order (status: pending · 1 order)", () => {
  for (const r of SELLING_ROLES) {
    test(`${r.label} add order note`, async ({ page, browser }) => {
      const orderId = ground.orders[r.key]!;
      const note = sellerNoteOf(r.key);
      await signInAs(page, r.key, ground.team);

      // GIVEN — pending, and no note on it yet.
      const before = await orderOf(page, orderId, ground.team);
      expect(before.status).toBe("ORDER_STATUS_PENDING");
      expect(notesIn(before)).toEqual([]);

      // WHEN — Catatan › the note typed › Add Note, on the seller's detail.
      await openOrder(page, orderId);
      await expect(sellerNotes(page).getByTestId("notes-empty")).toBeVisible();
      const sent = await addNote(page, sellerNotes(page), note);
      expect.soft(sent.teamId, "written as the selling team").toBe(ground.team);
      expect.soft(sent.orderId).toBe(orderId);

      await test.step("then: note shown in order timeline", async () => {
        await openOrder(page, orderId);
        const box = sellerNotes(page);
        await expect.soft(box.getByTestId("order-note-text").filter({ hasText: note })).toHaveCount(1);
        await expect.soft(box.getByTestId("order-note"), "the order's only note").toHaveCount(1);
        await expect.soft(box.getByTestId("notes-empty")).toHaveCount(0);
        const after = await orderOf(page, orderId, ground.team);
        const rows = (after.timelineLogs ?? []).filter((l) => l.note === note);
        expect.soft(rows.length, `timeline rows noting "${note}"`).toBe(1);
        expect.soft(rows.filter((l) => l.status).length, "a note row carries no status").toBe(0);
        expect.soft(after.status, "a note moves nothing").toBe("ORDER_STATUS_PENDING");
      });

      await test.step("then: note shown as from selling team", async () => {
        const row = noteRow(sellerNotes(page), note);
        await expect.soft(row).toHaveAttribute("data-from", "selling");
        await expect.soft(row.getByTestId("order-note-meta")).toContainText("Seller");
        await expect.soft(row.getByTestId("order-note-meta")).not.toContainText("Warehouse");
        await expect.soft(row.getByTestId("order-note-by")).toContainText(nameOf(r.label));
        const log = notesIn(await orderOf(page, orderId, ground.team)).find((l) => l.note === note);
        expect.soft(log?.from).toBe("ORDER_TIMELINE_FROM_SELLING");
        expect.soft(String(log?.actorId ?? ""), "its writer").toBe(ground.users[r.key]);
      });

      await test.step("then: warehouse sees note", async () => {
        const wh = await readerPage(browser, CREW, ground.warehouse);

        // The warehouse's detail of the order: Catatan has it, marked as the seller's.
        await openOrder(wh, orderId);
        const row = noteRow(warehouseNotes(wh), note);
        await expect.soft(row).toHaveCount(1, { timeout: 15_000 });
        await expect.soft(row).toHaveAttribute("data-from", "selling");
        await expect.soft(row.getByTestId("order-note-meta")).toContainText("Seller");

        // The pick page, where the order is packed: the note above the pick list.
        await wh.goto(`/warehouse-orders/${orderId}`);
        await expect.soft(wh.getByTestId("pick-order-note-text").filter({ hasText: note })).toHaveCount(1, { timeout: 15_000 });

        // …and the order read as the warehouse carries it.
        const asWarehouse = await orderOf(wh, orderId, ground.warehouse);
        expect.soft(notesIn(asWarehouse).filter((l) => l.note === note).length).toBe(1);

        await wh.close();
      });
    });
  }
});

// ── warehouse:all · (status: processed · 1 order) ──────────────────────────────────────────────────────────────────────

test.describe("warehouse:all wants to leave a note on an order (status: processed · 1 order)", () => {
  for (const r of WAREHOUSE_ROLES) {
    test(`${r.label} add order note`, async ({ page, browser }) => {
      const orderId = ground.orders[r.key]!;
      const note = warehouseNoteOf(r.key);
      await signInAs(page, r.key, ground.warehouse);

      // GIVEN — processed (confirmed), and no note on it yet.
      const before = await orderOf(page, orderId, ground.warehouse);
      expect(before.status).toBe("ORDER_STATUS_PROCESSED");
      expect(notesIn(before)).toEqual([]);

      // WHEN — Catatan › the note typed › Add Note, on the warehouse's detail (its Info tab).
      await openOrder(page, orderId);
      await expect(warehouseNotes(page).getByTestId("notes-empty")).toBeVisible();
      const sent = await addNote(page, warehouseNotes(page), note);
      expect.soft(sent.teamId, "written as the warehouse").toBe(ground.warehouse);
      expect.soft(sent.orderId).toBe(orderId);

      await test.step("then: note shown in order timeline", async () => {
        await openOrder(page, orderId);
        const box = warehouseNotes(page);
        await expect.soft(box.getByTestId("order-note-text").filter({ hasText: note })).toHaveCount(1);
        await expect.soft(box.getByTestId("order-note"), "the order's only note").toHaveCount(1);
        await expect.soft(box.getByTestId("notes-empty")).toHaveCount(0);
        const after = await orderOf(page, orderId, ground.warehouse);
        const rows = (after.timelineLogs ?? []).filter((l) => l.note === note);
        expect.soft(rows.length, `timeline rows noting "${note}"`).toBe(1);
        expect.soft(rows.filter((l) => l.status).length, "a note row carries no status").toBe(0);
        expect.soft(after.status, "a note moves nothing").toBe("ORDER_STATUS_PROCESSED");
      });

      await test.step("then: note shown as from warehouse", async () => {
        const row = noteRow(warehouseNotes(page), note);
        await expect.soft(row).toHaveAttribute("data-from", "warehouse");
        await expect.soft(row.getByTestId("order-note-meta")).toContainText("Warehouse");
        await expect.soft(row.getByTestId("order-note-meta")).not.toContainText("Seller");
        await expect.soft(row.getByTestId("order-note-by")).toContainText(nameOf(r.label));
        const log = notesIn(await orderOf(page, orderId, ground.warehouse)).find((l) => l.note === note);
        expect.soft(log?.from).toBe("ORDER_TIMELINE_FROM_WAREHOUSE");
        expect.soft(String(log?.actorId ?? ""), "its writer").toBe(ground.users[r.key]);
      });

      await test.step("then: selling team sees note", async () => {
        const seller = await readerPage(browser, SELLER_READER, ground.team);

        // The seller's detail of the order: Catatan has it, marked as the warehouse's.
        await openOrder(seller, orderId);
        const row = noteRow(sellerNotes(seller), note);
        await expect.soft(row).toHaveCount(1, { timeout: 15_000 });
        await expect.soft(row).toHaveAttribute("data-from", "warehouse");
        await expect.soft(row.getByTestId("order-note-meta")).toContainText("Warehouse");

        // …and the order read as the seller carries it.
        const asSeller = await orderOf(seller, orderId, ground.team);
        expect.soft(notesIn(asSeller).filter((l) => l.note === note).length).toBe(1);

        await seller.close();
      });
    });
  }
});

// ── regression (no then) ───────────────────────────────────────────────────────────────────────────────────────────────

test("Add Note: the box is held while blank and stops at 500 — the server refuses a blank note, one past 500 and a team at neither end, and writes nothing", async ({
  page,
  browser,
}) => {
  const orderId = ground.orders.reg!;
  await signInAs(page, "own", ground.team);

  // The box: held while empty and while only spaces; 600 typed keep 500, and the count says so.
  await openOrder(page, orderId);
  const box = sellerNotes(page);
  const input = box.getByTestId("notes-input");
  await expect(input).toBeVisible({ timeout: 15_000 });
  await expect(box.getByTestId("notes-add")).toBeDisabled();
  await input.fill("    ");
  await expect(box.getByTestId("notes-add")).toBeDisabled();
  await input.fill("x".repeat(600));
  await expect(input).toHaveValue("x".repeat(NOTE_MAX));
  await expect(box.getByTestId("notes-count")).toHaveText(`${NOTE_MAX} / ${NOTE_MAX}`);
  await input.fill("");

  // The server: a blank note and one past 500 are invalid; a team that is neither end of the order reads NotFound (the
  // root team — root passes every scope, so only the order's two ends decide).
  const blank = await call(page, "selling.v1.OrderService/OrderNoteCreate", { teamId: ground.team, orderId, note: "   " });
  expect.soft(blank.status, JSON.stringify(blank.body)).toBe(400);
  const long = await call(page, "selling.v1.OrderService/OrderNoteCreate", { teamId: ground.team, orderId, note: "y".repeat(NOTE_MAX + 1) });
  expect.soft(long.status, JSON.stringify(long.body)).toBe(400);

  const root = await browser.newPage();
  await signIn(root, ROOT_USERNAME, ROOT_PASSWORD);
  const neither = await call(root, "selling.v1.OrderService/OrderNoteCreate", { teamId: "1", orderId, note: "from nowhere" });
  expect.soft(neither.status, JSON.stringify(neither.body)).toBe(404);
  await root.close();

  // Nothing was written.
  expect(notesIn(await orderOf(page, orderId, ground.team))).toEqual([]);
});

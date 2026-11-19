import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── find parcel — the checks behind docs/acceptances/inventory/order.md (### process: hand over) ─────────────────────
//
// find parcel's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are the
// owner's, set by hand — never by this file.
//
// Business rules:
// - scanning-is-the-crews-hands (docs/technical/frontend/warehouse_order_list_decision.md): packed parcels go straight
//   into sacks and piles; to get one out again the crew opens Find Parcel for THAT order and scans the labels in the pile
//   until one sounds a match. The dialog is opened for ONE order; every scan is compared with that order's resi, its MP
//   order id (the Order ID) and its id, on screen, with no API; a match is the fulfilled sound and a green answer,
//   anything else the wrong sound. Two sounds made by the browser — a short high "fulfilled" and a low "wrong".
// - a-label-scan-reads-the-ref-or-the-receipt (docs/business/inventory/order_decision.md): a label is read by its
//   Order ID or its receipt — so an order with no resi recorded is still found by its Order ID.
// - the-seller-edits-the-resi-until-handover (same file): the resi can change after the label was printed; the old
//   label then carries a number the order no longer has.
// - the acceptance's own risk, a-same-order-id-matches-another-parcel (docs/acceptances/inventory/order.md): an Order ID
//   may sit on two live orders of one shop (warned at create, not refused), so scanning the OTHER order's label reads
//   Match when the scan is the Order ID printed on it. A different resi tells them apart; the Order ID does not. The
//   given checks the system as it is.
//
// `warehouse:all` → EVERY warehouse role (warehouse:owner, warehouse:admin, warehouse:staff), each in its own browser
// session, each on orders of its own.
//
// The WHEN — the role opens Orders on the order's tab (Sudah diambil for picked, Sudah diserahkan for shipping), narrowed
// by its Order ID, opens the row's menu › Find Parcel, and scans a label's code into the dialog's scan field (the
// scanner types it and presses Enter).
//
// How each then is read:
// - `scan shows match with right sound` — the dialog's answer is green (data-match true): "Match — this is the parcel",
//   with the scanned code under it; and the tone it made is the RIGHT one: the browser's oscillator is recorded (headless
//   has no speaker), and the tone is higher and shorter than the wrong one, which the same dialog makes right after for a
//   code no order carries.
// - `scan shows not this parcel with wrong sound` — the answer is red (data-match false): "Not this parcel", with the
//   scanned code; and the tone is the WRONG one: lower and longer than the right one, which the same dialog makes right
//   after for the order's own label.
// - `order status unchanged` — nothing was sent to change a status while the dialog was open; after it the order's own
//   record still reads ORDER_STATUS_PICKED with no new status row on its timeline, and it still stands on Sudah diambil.
//
// Which code is scanned:
//   (its label scanned)                         the order's resi.
//   (another order's label scanned)             another order's resi, then its Order ID — both "not this parcel".
//   (no resi recorded · its Order ID scanned)   its Order ID; the dialog's "looking for" shows no resi (—).
//   (resi changed after label printed · …)      the FIRST resi (the one on the old label); the order's own label now
//                                               carries the new one, which is the right sound's reference.
//   (2 orders with same Order ID · other …)     the Order ID printed on the twin's label — the risk's case. Its resi, which
//                                               tells them apart, is scanned after the then as a regression (no then).
//
// Regression beside them (no then): the order's own id matches too (the third of the codes the dialog compares).
//
// GROUND (beforeAll, as root, through the API): a selling team of its own (root owns it), a warehouse it returns to with
// a user per warehouse role, a Shopee shop, 24 units of one product accepted onto a rack there. Per role six orders of 1
// unit, each with its own Order ID and resi unless the given says otherwise: picked (its label), shipping (another
// order's label), picked with no resi, picked whose resi the seller changed after (OrderReceiptUpdate), and two shipping
// twins sharing one Order ID; one picked order for the regression. Seeded in beforeAll so a worker restarted after a
// failure seeds its own.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-findparcel-pass-1";
const PRODUCT = `Kaos Biru Cari ${SUFFIX}`;
const SKU = `FPK${SUFFIX}`;

const WAREHOUSE_ROLES = [
  { key: "wown", role: "ROLE_WAREHOUSE_OWNER", label: "warehouse:owner" },
  { key: "wadm", role: "ROLE_WAREHOUSE_ADMIN", label: "warehouse:admin" },
  { key: "wstf", role: "ROLE_WAREHOUSE_STAFF", label: "warehouse:staff" },
] as const;
type Role = (typeof WAREHOUSE_ROLES)[number];

const COND_LABEL = "status: picked · 1 order · its label scanned";
const COND_OTHER = "status: shipping · 1 order · another order's label scanned";
const COND_NO_RESI = "status: picked · 1 order · no resi recorded · its Order ID scanned";
const COND_RESI_CHANGED = "status: picked · 1 order · resi changed after label printed · old label scanned";
const COND_SAME_REF = "status: shipping · 2 orders with same Order ID · other order's label scanned";

const userOf = (key: string) => `e2efp${key}${SUFFIX}`;
const nameOf = (label: string) => `Find Parcel ${label} ${SUFFIX}`;
// The marketplace's Order ID and the resi on the label — each carries the run's suffix. The twins share one Order ID
// (the slot "tw-<role>"), each with a resi of its own.
const refOf = (slot: string) => `FPO${SUFFIX}${slot.toUpperCase()}`;
const resiOf = (slot: string) => `FPR${SUFFIX}${slot.toUpperCase()}`;
// The number the resi-changed order carries now — its seller changed it after the label (resiOf) was printed.
const newResiOf = (slot: string) => `${resiOf(slot)}NEW`;
// A label no order carries.
const unknownOf = (key: string) => `FPX${SUFFIX}${key.toUpperCase()}NONE`;

const ground = {
  team: "",
  warehouse: "",
  shop: "",
  // slot ("pk-<role>", "sh-<role>", "nr-<role>", "rc-<role>", "twa-<role>", "twb-<role>", "reg") → order id
  orders: {} as Record<string, string>,
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

async function move(page: Page, teamId: string, orderId: string, to: string): Promise<MoveResult> {
  const res = await ok<{ results: MoveResult[] }>(page, "selling.v1.OrderService/OrderStatusChange", {
    teamId,
    orderIds: [orderId],
    to: `ORDER_STATUS_${to}`,
  });

  return res.results[0] ?? {};
}

async function signInAs(page: Page, key: string, teamId: string) {
  await signIn(page, userOf(key), PASSWORD);
  // Work in the warehouse: the active team is per tab, in sessionStorage (TeamContext).
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

type Log = { status?: string };
type OrderRecord = { status: string; receiptCode?: string; timelineLogs?: Log[] };

// The order as the server keeps it, read in the warehouse.
async function orderOf(page: Page, orderId: string): Promise<OrderRecord> {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId: ground.warehouse, orderId })).order as OrderRecord;
}

// The order's status rows on its timeline (a note row carries no status).
const statusRows = (order: OrderRecord) => (order.timelineLogs ?? []).filter((l) => Boolean(l.status)).length;

// ── the scanner's ear ───────────────────────────────────────────────────────────────────────────────────────────────────

// lib/beep.ts makes its two sounds with the browser's AudioContext (an oscillator, no audio file); headless has no
// speaker, so the page gets a stand-in that hears each tone — its pitch and how long it plays — and makes no sound.
// Installed before the app loads, so the app's lazy context is this one. (order_warehouse_wants_to_hand_over's ear.)
type Tone = { type: string; hz: number; seconds: number };

async function installEar(page: Page) {
  await page.addInitScript(() => {
    const heard: { type: string; hz: number; seconds: number }[] = [];
    (window as unknown as { __heard: typeof heard }).__heard = heard;
    class Ear {
      currentTime = 0;
      destination = {};
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
      createOscillator() {
        const osc: {
          type: string;
          frequency: { value: number };
          at: number;
          connect(): void;
          start(at: number): void;
          stop(at: number): void;
        } = {
          type: "sine",
          frequency: { value: 0 },
          at: 0,
          connect() {},
          start(at: number) {
            osc.at = at;
          },
          stop(at: number) {
            heard.push({ type: osc.type, hz: osc.frequency.value, seconds: at - osc.at });
          },
        };
        return osc;
      }
    }
    Object.defineProperty(window, "AudioContext", { value: Ear, configurable: true, writable: true });
  });
}

async function heard(page: Page): Promise<Tone[]> {
  return page.evaluate(() => (window as unknown as { __heard?: Tone[] }).__heard ?? []);
}

// Watch the page for a status change being sent.
function watchMoves(page: Page) {
  const sent = { n: 0 };
  page.on("request", (req) => {
    if (req.url().endsWith(`${RPC}/OrderStatusChange`)) sent.n += 1;
  });

  return sent;
}

// ── the WHEN ────────────────────────────────────────────────────────────────────────────────────────────────────────────

// Orders on the order's tab, narrowed by its Order ID › the row's menu › Find Parcel.
async function openFind(page: Page, step: "picked" | "handover", slot: string, refSlot = slot) {
  const orderId = ground.orders[slot]!;
  await page.goto(`/warehouse-orders?step=${step}&q=${refOf(refSlot)}`);
  await expect(page.getByTestId(`pick-tab-${step}`)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId(`pick-queue-row-${orderId}`)).toBeVisible({ timeout: 15_000 });

  await page.getByTestId(`pick-queue-actions-${orderId}`).click();
  await page.getByTestId(`pick-queue-find-${orderId}`).click();
  await expect(page.getByTestId("find-parcel-dialog")).toBeVisible();
  await expect(page.getByTestId("find-parcel-scan")).toBeVisible();
}

// One scan into the dialog — the scanner types the code and presses Enter — and the ONE tone it made.
async function scan(page: Page, code: string): Promise<Tone> {
  const before = (await heard(page)).length;
  const field = page.getByTestId("find-parcel-scan");
  await field.fill(code);
  await field.press("Enter");
  await expect.poll(async () => (await heard(page)).length, { timeout: 15_000 }).toBe(before + 1);
  await expect(page.getByTestId("find-parcel-result")).toContainText(code);
  // The field empties itself for the next parcel (scanning-is-the-crews-hands).
  await expect.soft(field, "the field empties itself for the next parcel").toHaveValue("");

  return (await heard(page))[before]!;
}

async function expectMatch(page: Page, code: string) {
  const result = page.getByTestId("find-parcel-result");
  await expect.soft(result, `${code}: the answer is a match`).toHaveAttribute("data-match", "true");
  await expect.soft(result).toContainText("Match — this is the parcel");
  await expect.soft(result).toContainText(code);
}

async function expectNoMatch(page: Page, code: string) {
  const result = page.getByTestId("find-parcel-result");
  await expect.soft(result, `${code}: the answer is not a match`).toHaveAttribute("data-match", "false");
  await expect.soft(result).toContainText("Not this parcel");
  await expect.soft(result).toContainText(code);
}

// The right sound: higher and shorter than the wrong one the same dialog makes right after, for a code no order carries.
async function expectRightSound(page: Page, tone: Tone, unknown: string) {
  const wrong = await scan(page, unknown);
  await expect(page.getByTestId("find-parcel-result"), "the reference scan is a no-match").toHaveAttribute("data-match", "false");
  expect.soft(tone, "the match's tone differs from the wrong one").not.toEqual(wrong);
  expect.soft(tone.hz, "the right sound is higher than the wrong one").toBeGreaterThan(wrong.hz);
  expect.soft(tone.seconds, "the right sound is shorter than the wrong one").toBeLessThan(wrong.seconds);
}

// The wrong sound: lower and longer than the right one the same dialog makes right after, for the order's own label.
async function expectWrongSound(page: Page, tone: Tone, ownLabel: string) {
  const good = await scan(page, ownLabel);
  await expect(page.getByTestId("find-parcel-result"), "the reference scan is a match").toHaveAttribute("data-match", "true");
  expect.soft(tone, "the no-match's tone differs from the right one").not.toEqual(good);
  expect.soft(tone.hz, "the wrong sound is lower than the right one").toBeLessThan(good.hz);
  expect.soft(tone.seconds, "the wrong sound is longer than the right one").toBeGreaterThan(good.seconds);
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Find Parcel Seller ${SUFFIX}`, `FPS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Find Parcel WH ${SUFFIX}`, `FPW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  for (const r of WAREHOUSE_ROLES) {
    await ok(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouse,
      username: userOf(r.key),
      password: PASSWORD,
      name: nameOf(r.label),
      role: r.role,
    });
  }

  ground.shop = String(
    (
      await ok(page, "selling.v1.ShopService/ShopCreate", {
        teamId: ground.team,
        name: `E2E Find Parcel Shop ${SUFFIX}`,
        shopCode: `FPP${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shop, userId: ROOT_USER_ID });

  // 24 units of the product on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `fp-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Find Parcel ${SUFFIX}` })).category.id;
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
      name: `E2E find parcel ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-OFP-${SUFFIX}`,
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
    items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, count: 24, total: 240_000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 24, placements: [{ placementId: rack, quantity: 24 }] }],
  });

  // The orders. `ref` names the slot whose Order ID it carries (the twins share one); `resi` false = none recorded.
  const PICKED = ["PROCESSED", "PICKED"];
  const SHIPPING = ["PROCESSED", "PICKED", "SHIPPING"];
  const walks: { slot: string; ref?: string; resi?: boolean; to: string[] }[] = [];
  for (const r of WAREHOUSE_ROLES) {
    walks.push({ slot: `pk-${r.key}`, to: PICKED });
    walks.push({ slot: `sh-${r.key}`, to: SHIPPING });
    walks.push({ slot: `nr-${r.key}`, resi: false, to: PICKED });
    walks.push({ slot: `rc-${r.key}`, to: PICKED });
    walks.push({ slot: `twa-${r.key}`, ref: `tw-${r.key}`, to: SHIPPING });
    walks.push({ slot: `twb-${r.key}`, ref: `tw-${r.key}`, to: SHIPPING });
  }
  walks.push({ slot: "reg", to: PICKED });

  for (const w of walks) {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-findparcel-${w.slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId: ground.shop,
      warehouseId: ground.warehouse,
      customerName: `E2E Find Parcel Buyer ${w.slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(w.ref ?? w.slot),
      receiptCode: w.resi === false ? "" : resiOf(w.slot),
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
    });
    const id = String(placed.order.id);
    for (const status of w.to) {
      const moved = await move(page, ground.warehouse, id, status);
      expect(moved.moved, `${w.slot} → ${status}: ${moved.refusedReason}`).toBe(true);
    }
    ground.orders[w.slot] = id;
  }

  // The resi-changed orders: picked with their first number on the label, then the seller changes the number
  // (the-seller-edits-the-resi-until-handover).
  for (const r of WAREHOUSE_ROLES) {
    const slot = `rc-${r.key}`;
    const changed = await ok(page, "selling.v1.OrderService/OrderReceiptUpdate", {
      teamId: ground.team,
      orderId: ground.orders[slot],
      receiptCode: newResiOf(slot),
    });
    expect(String(changed.order?.receiptCode ?? ""), `resi of ${slot} changed`).toBe(newResiOf(slot));
  }

  await page.close();
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── warehouse:all · (status: picked · 1 order · its label scanned) ──────────────────────────────────────────────────────

test.describe(`warehouse:all wants to find a parcel in a pile (${COND_LABEL})`, () => {
  for (const r of WAREHOUSE_ROLES) {
    test(`${r.label} find parcel`, async ({ page }) => {
      const slot = `pk-${r.key}`;
      const orderId = ground.orders[slot]!;
      await installEar(page);
      await signInAs(page, r.key, ground.warehouse);

      // GIVEN — picked: boxed and in the pile, its label carrying its resi.
      const before = await orderOf(page, orderId);
      expect(before.status).toBe("ORDER_STATUS_PICKED");
      const sent = watchMoves(page);

      // WHEN — Sudah diambil › the row's menu › Find Parcel, its label scanned.
      await openFind(page, "picked", slot);
      await expect.soft(page.getByTestId("find-parcel-resi"), "looking for its resi").toHaveText(resiOf(slot));
      const tone = await scan(page, resiOf(slot));

      await test.step("then: scan shows match with right sound", async () => {
        await expectMatch(page, resiOf(slot));
        await expectRightSound(page, tone, unknownOf(r.key));
      });

      await test.step("then: order status unchanged", async () => {
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("find-parcel-dialog")).toBeHidden();
        expect.soft(sent.n, "no status change sent while finding the parcel").toBe(0);

        const after = await orderOf(page, orderId);
        expect.soft(after.status).toBe("ORDER_STATUS_PICKED");
        expect.soft(statusRows(after), "no new status row on its timeline").toBe(statusRows(before));

        // Still on Sudah diambil.
        await page.goto(`/warehouse-orders?step=picked&q=${refOf(slot)}`);
        await expect(page.getByTestId("pick-tab-picked")).toHaveAttribute("aria-selected", "true");
        await expect.soft(page.getByTestId(`pick-queue-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
      });
    });
  }
});

// ── warehouse:all · (status: shipping · 1 order · another order's label scanned) ──────────────────────────────────────

test.describe(`warehouse:all wants to find a parcel in a pile (${COND_OTHER})`, () => {
  for (const r of WAREHOUSE_ROLES) {
    test(`${r.label} find parcel`, async ({ page }) => {
      const slot = `sh-${r.key}`;
      // Another order's label — the role's picked order, its resi and its Order ID.
      const other = `pk-${r.key}`;
      await installEar(page);
      await signInAs(page, r.key, ground.warehouse);

      // GIVEN — shipping: handed over, the parcel in the courier's pile.
      expect((await orderOf(page, ground.orders[slot]!)).status).toBe("ORDER_STATUS_SHIPPING");

      // WHEN — Sudah diserahkan › the row's menu › Find Parcel, another order's label scanned.
      await openFind(page, "handover", slot);
      const tone = await scan(page, resiOf(other));

      await test.step("then: scan shows not this parcel with wrong sound", async () => {
        await expectNoMatch(page, resiOf(other));
        await expectWrongSound(page, tone, resiOf(slot));

        // The other code on that label — its Order ID — is not this parcel either, with the same wrong sound.
        const byRef = await scan(page, refOf(other));
        await expectNoMatch(page, refOf(other));
        expect.soft(byRef, "the other label's Order ID makes the wrong sound too").toEqual(tone);
      });
    });
  }
});

// ── warehouse:all · (status: picked · 1 order · no resi recorded · its Order ID scanned) ──────────────────────────────

test.describe(`warehouse:all wants to find a parcel in a pile (${COND_NO_RESI})`, () => {
  for (const r of WAREHOUSE_ROLES) {
    test(`${r.label} find parcel`, async ({ page }) => {
      const slot = `nr-${r.key}`;
      const orderId = ground.orders[slot]!;
      await installEar(page);
      await signInAs(page, r.key, ground.warehouse);

      // GIVEN — picked, with no resi recorded.
      const before = await orderOf(page, orderId);
      expect(before.status).toBe("ORDER_STATUS_PICKED");
      expect(before.receiptCode ?? "").toBe("");

      // WHEN — Sudah diambil › the row's menu › Find Parcel, its Order ID scanned.
      await openFind(page, "picked", slot);
      await expect.soft(page.getByTestId("find-parcel-resi"), "no resi to look for").toHaveText("—");
      const tone = await scan(page, refOf(slot));

      await test.step("then: scan shows match with right sound", async () => {
        await expectMatch(page, refOf(slot));
        await expectRightSound(page, tone, unknownOf(r.key));
      });
    });
  }
});

// ── warehouse:all · (status: picked · 1 order · resi changed after label printed · old label scanned) ─────────────────

test.describe(`warehouse:all wants to find a parcel in a pile (${COND_RESI_CHANGED})`, () => {
  for (const r of WAREHOUSE_ROLES) {
    test(`${r.label} find parcel`, async ({ page }) => {
      const slot = `rc-${r.key}`;
      const orderId = ground.orders[slot]!;
      await installEar(page);
      await signInAs(page, r.key, ground.warehouse);

      // GIVEN — picked; the label was printed with its first resi, and the seller changed the number after.
      const before = await orderOf(page, orderId);
      expect(before.status).toBe("ORDER_STATUS_PICKED");
      expect(before.receiptCode).toBe(newResiOf(slot));

      // WHEN — Sudah diambil › the row's menu › Find Parcel, the OLD label scanned.
      await openFind(page, "picked", slot);
      await expect.soft(page.getByTestId("find-parcel-resi"), "looking for the resi it carries now").toHaveText(newResiOf(slot));
      const tone = await scan(page, resiOf(slot));

      await test.step("then: scan shows not this parcel with wrong sound", async () => {
        await expectNoMatch(page, resiOf(slot));
        await expectWrongSound(page, tone, newResiOf(slot));
      });
    });
  }
});

// ── warehouse:all · (status: shipping · 2 orders with same Order ID · other order's label scanned) ────────────────────

test.describe(`warehouse:all wants to find a parcel in a pile (${COND_SAME_REF})`, () => {
  for (const r of WAREHOUSE_ROLES) {
    test(`${r.label} find parcel`, async ({ page }) => {
      const slot = `twa-${r.key}`;
      const twin = `twb-${r.key}`;
      const ref = refOf(`tw-${r.key}`);
      await installEar(page);
      await signInAs(page, r.key, ground.warehouse);

      // GIVEN — two shipping orders of one shop carrying the same Order ID, each with its own resi.
      expect((await orderOf(page, ground.orders[slot]!)).status).toBe("ORDER_STATUS_SHIPPING");
      expect((await orderOf(page, ground.orders[twin]!)).status).toBe("ORDER_STATUS_SHIPPING");

      // WHEN — Sudah diserahkan (narrowed by the shared Order ID: both rows) › the first's menu › Find Parcel, the
      // Order ID on the twin's label scanned.
      await openFind(page, "handover", slot, `tw-${r.key}`);
      await expect.soft(page.getByTestId(`pick-queue-row-${ground.orders[twin]!}`), "the twin is on the list too").toBeVisible();
      const tone = await scan(page, ref);

      await test.step("then: scan shows match with right sound", async () => {
        await expectMatch(page, ref);
        await expectRightSound(page, tone, unknownOf(r.key));
      });

      // Regression (no then) — the risk's other half: the twin's resi tells them apart.
      await scan(page, resiOf(twin));
      await expectNoMatch(page, resiOf(twin));
    });
  }
});

// ── regression (no then) ────────────────────────────────────────────────────────────────────────────────────────────────

test("find parcel: the order's own id matches too, as its Order ID and resi do", async ({ page }) => {
  const orderId = ground.orders.reg!;
  await installEar(page);
  await signInAs(page, "wstf", ground.warehouse);

  await openFind(page, "picked", "reg");
  for (const code of [orderId, refOf("reg"), resiOf("reg")]) {
    await scan(page, code);
    await expectMatch(page, code);
  }
  expect.soft((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_PICKED");
});

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── CETAK ULANG LABEL — a label changed after its print asks the warehouse to print it again (backlog #98) ─────────────
//
// Business rules:
// - a-changed-label-asks-the-warehouse-to-reprint (docs/business/inventory/order_decision.md): the system records when an
//   order's label is printed. A resi or label change made AFTER that print puts *Cetak ulang label* (en: "Reprint label")
//   on the order's row in the warehouse's order list and on its pick page, until the label is printed again. A change
//   before any print shows nothing — the first print takes the new label anyway.
// - a-parcel-marked-for-reprint-is-not-handed-over (same file): a marked order is not handed over until its label is
//   printed again — the Serah ke Kurir scan refuses it as *Cetak ulang label dulu* with the wrong sound, and the server
//   refuses picked → shipping from every door (the scan, the bar's Hand Over, the pick page's Mark Handed Over), each
//   order with its own reason; an unmarked order in the same batch still moves.
// - the-reprint-label-prototype-is-accepted (docs/technical/frontend/warehouse_order_list_decision.md), as drawn: the
//   badge beside the status on the list, a *Perlu cetak ulang* ("Needs reprint") filter (server-side, `?reprint=1`, the
//   tab counts follow it), the badge on Daftar Ambil's order blocks, the pick page's line with Cetak Resi opening the
//   print page with that one order, the print page's mark under the label and "N to reprint" on its list line. Only the
//   print page's Print counts as a print (OrderLabels `record_print`) — viewing the label on the order page does not; a
//   reprint writes no timeline row and keeps the order's step; a change after the reprint marks it again. The seller
//   gets one line in Edit Resi when the label was already printed, and nothing on its order page.
//
// The acceptance's own then (inventory/order.md given 26, `warehouse told to reprint label`) is checked per selling role
// in order_selling_wants_to_edit_resi.spec.ts; this file is the feature's regression, read by the crew (warehouse:staff)
// and one seller (selling:owner).
//
// GROUND (beforeAll, as root, through the API): a selling team of its own with a selling:owner, a Shopee shop, a
// warehouse it returns to with a warehouse:staff user (the crew), 20 units of one product accepted onto a rack there. The
// orders, 1 unit each, every one placed with its own tracking number and a 2-page Lazada label file uploaded for real:
//   MARK   picked, its label printed the print page's way (OrderLabels record_print) — test 1 changes it
//   HOLD   picked, printed, then its label FILE replaced by the seller (the number kept, so its scan still finds it)
//   EARLY  its number changed BEFORE any print, then picked — never printed, so never marked
//   PLAIN  picked, nothing printed or changed
//   DAFTA  processed, printed, then its label file replaced — marked
//   DAFTB  processed, nothing printed or changed
//   VIEW   picked, never printed — test 4 views its label on the order page, then the seller changes it

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-reprint-pass-1";
const PRODUCT = `Sabun Cetak Ulang ${SUFFIX}`;
const SKU = `CUK${SUFFIX}`;
const SELLER_USER = `e2eculown${SUFFIX}`;
const CREW_USER = `e2eculwh${SUFFIX}`;

// The marketplace's Order ID (a repeat within a team is refused) — every one starts with the run's stem, so `?q=` narrows
// the warehouse's tabs to this file's orders.
const STEM = `CU${SUFFIX}`;
const refOf = (slot: string) => `${STEM}${slot}`;
// The tracking numbers: the one the order was placed with, and the one typed over it.
const resiOf = (slot: string) => `JC${SUFFIX}${slot}1`;
const newResiOf = (slot: string) => `JC${SUFFIX}${slot}2`;

const SAMPLES = new URL("../../examples/receipt_file_samples/", import.meta.url);
const OLD_LABEL = "lazada_lex_03.pdf";
const NEW_LABEL = "shopee_reg_01.pdf";
const oldFileOf = (slot: string) => `label-old-${slot}.pdf`;
const newFileOf = (slot: string, n = 1) => `label-new-${slot}-${n}.pdf`;

const PICKED = "ORDER_STATUS_PICKED";
const PROCESSED = "ORDER_STATUS_PROCESSED";
const SHIPPING = "ORDER_STATUS_SHIPPING";
const REFUSAL = "the label changed after it was printed — print the new label first";

const ground = {
  team: "",
  warehouse: "",
  shop: "",
  // slot → order id
  orders: {} as Record<string, string>,
};
const idOf = (slot: string) => ground.orders[slot]!;

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

async function move(page: Page, orderId: string, to: string) {
  const res = await ok<{ results: { moved?: boolean; refusedReason?: string }[] }>(page, "selling.v1.OrderService/OrderStatusChange", {
    teamId: ground.warehouse,
    orderIds: [orderId],
    to: `ORDER_STATUS_${to}`,
  });
  expect(res.results[0]?.moved, `${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

async function sellerSignIn(page: Page) {
  await signIn(page, SELLER_USER, PASSWORD);
  await useTeam(page, ground.team);
}

// The crew, on a page of its own (a fresh context: the form sign-in), working in the warehouse. window.open is recorded
// instead of opened (headless loads no popup), and the scanner's tones are heard instead of played (lib/beep.ts makes
// them with an AudioContext oscillator — order_warehouse_wants_to_hand_over.spec.ts's ear).
type Tone = { type: string; hz: number; seconds: number };
async function crewPage(browser: Browser): Promise<Page> {
  const wh = await browser.newPage();
  await wh.addInitScript(() => {
    const w = window as unknown as { __opened: string[]; __heard: unknown[]; open: (url?: string | URL) => Window | null };
    w.__opened = [];
    w.open = (url?: string | URL) => {
      w.__opened.push(String(url));
      return null;
    };
    const heard: { type: string; hz: number; seconds: number }[] = [];
    w.__heard = heard;
    class Ear {
      currentTime = 0;
      destination = {};
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
      createOscillator() {
        const osc = {
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
  await signIn(wh, CREW_USER, PASSWORD);
  await useTeam(wh, ground.warehouse);

  return wh;
}

async function heard(page: Page): Promise<Tone[]> {
  return page.evaluate(() => (window as unknown as { __heard?: Tone[] }).__heard ?? []);
}

type OrderRecord = {
  status: string;
  receiptCode?: string;
  receipt?: { documentId?: string; filename?: string };
  reprintLabel?: boolean;
  labelPrintedAtUnix?: string;
  timelineLogs?: { note?: string; status?: string }[];
};

// The order as the server keeps it, read in `teamId` (the seller's, or the warehouse's).
async function orderOf(page: Page, orderId: string, teamId: string): Promise<OrderRecord> {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId, orderId })).order as OrderRecord;
}

// The seller's real two-phase upload of one label: RequestUpload, the PUT of the bytes, ConfirmUpload — its document id.
async function uploadLabel(page: Page, sample: string, filename: string): Promise<string> {
  const content = readFileSync(new URL(sample, SAMPLES));
  const up = await ok(page, "document.v1.DocumentService/RequestUpload", {
    teamId: ground.team,
    resourceType: "DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT",
    contentType: "application/pdf",
    sizeBytes: content.length,
    filename,
  });
  const put = await page.request.fetch(up.uploadUrl, { method: up.method, headers: up.headers, data: content });
  expect(put.status(), `PUT ${filename}`).toBe(200);

  return String((await ok(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: up.uploadToken })).document.id);
}

// The seller's change through the API (the ground's): a new label file, or a new number.
async function changeLabel(page: Page, slot: string, change: { file?: string; code?: string }) {
  const body: Record<string, unknown> = { teamId: ground.team, orderId: idOf(slot) };
  if (change.file !== undefined) {
    const documentId = await uploadLabel(page, NEW_LABEL, change.file);
    body.receipt = { documentId, filename: change.file, mimeType: "application/pdf" };
  }
  if (change.code !== undefined) body.receiptCode = change.code;
  await ok(page, "selling.v1.OrderService/OrderReceiptUpdate", body);
}

// THE SELLER'S EDIT RESI on the order's page — the number typed over and/or a new label file picked, then Save. `hint`:
// whether the dialog says the warehouse already printed the label (saving asks it to print again).
async function editResi(page: Page, orderId: string, was: string, change: { code?: string; file?: string }, hint: boolean) {
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("order-reference-receipt")).toBeVisible();

  // The dialog reads the order fresh as it opens: wait for that read, so it cannot land on top of what is typed.
  const fresh = page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderDetail`), { timeout: 10_000 }).catch(() => null);
  await page.getByTestId("order-action-editReceipt").click();
  const dialog = page.getByTestId("edit-receipt-dialog");
  await expect(dialog).toBeVisible();
  await fresh;
  await expect(dialog.getByTestId("edit-receipt-code")).toHaveValue(was);
  if (hint) {
    await expect.soft(dialog.getByTestId("edit-receipt-reprint-hint")).toContainText("already printed this label");
  } else {
    await expect.soft(dialog.getByTestId("edit-receipt-reprint-hint")).toHaveCount(0);
  }

  if (change.code !== undefined) {
    await dialog.getByTestId("edit-receipt-code").fill(change.code);
  }
  if (change.file !== undefined) {
    await dialog
      .getByTestId("order-receipt-upload")
      .locator("input[type=file]")
      .setInputFiles({ name: change.file, mimeType: "application/pdf", buffer: readFileSync(new URL(NEW_LABEL, SAMPLES)) });
    await expect(dialog.getByTestId("order-receipt-attached")).toContainText(change.file, { timeout: 20_000 });
  }

  const save = dialog.getByTestId("edit-receipt-save");
  await expect(save).toBeEnabled();
  const [answer] = await Promise.all([page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderReceiptUpdate`)), save.click()]);
  expect(answer.status(), await answer.text()).toBe(200);
  await expect(dialog).toBeHidden();
}

// The crew's Orders on a tab, narrowed by `q` — the rows drawn.
async function openTab(wh: Page, step: "confirm" | "picked", q: string, extra = "") {
  await wh.goto(`/warehouse-orders?step=${step}&q=${q}${extra}`);
  await expect(wh.getByTestId(`pick-tab-${step}`)).toHaveAttribute("aria-selected", "true");
  await expect(wh.getByTestId("pick-queue-table")).toBeVisible({ timeout: 15_000 });
}

// The order's row on the crew's list carries the badge (true) or not (false).
async function expectRowMark(wh: Page, step: "confirm" | "picked", slot: string, marked: boolean) {
  await openTab(wh, step, refOf(slot));
  const row = wh.getByTestId(`pick-queue-row-${idOf(slot)}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  if (marked) {
    await expect.soft(row.getByTestId(`order-reprint-label-${idOf(slot)}`)).toHaveText("Reprint label");
  } else {
    await expect.soft(row.getByTestId(`order-reprint-label-${idOf(slot)}`)).toHaveCount(0);
  }
}

// The pick page of the order (/warehouse-orders/<id>), its step drawn.
async function openPick(wh: Page, slot: string, step = 5) {
  await wh.goto(`/warehouse-orders/${idOf(slot)}`);
  await expect(wh.getByTestId(`order-status-${step}`).first()).toBeVisible({ timeout: 15_000 });
}

// The print page's Print — ONE OrderLabels; what it asked and answered.
async function printNow(wh: Page) {
  const [answer] = await Promise.all([
    wh.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderLabels`)),
    wh.getByTestId("print-receipts-print").click(),
  ]);
  await expect(wh.getByTestId("print-receipts-result")).toBeVisible();
  expect.soft(answer.status()).toBe(200);

  return {
    asked: (answer.request().postDataJSON() ?? {}) as { orderIds?: string[]; recordPrint?: boolean },
    answer: (await answer.json()) as { url?: string; results: { orderId: string; included?: boolean }[] },
  };
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Reprint Seller ${SUFFIX}`, `CULS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Reprint WH ${SUFFIX}`, `CULW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: ground.team,
    username: SELLER_USER,
    password: PASSWORD,
    name: `Reprint seller ${SUFFIX}`,
    role: "ROLE_SELLING_OWNER",
  });
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: ground.warehouse,
    username: CREW_USER,
    password: PASSWORD,
    name: `Reprint crew ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  ground.shop = String(
    (await ok(page, "selling.v1.ShopService/ShopCreate", { teamId: ground.team, name: `E2E Reprint Shop ${SUFFIX}`, shopCode: `CULP${SUFFIX}`, marketplace: "MARKETPLACE_SHOPEE" }))
      .shop.id,
  );
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shop, userId: ROOT_USER_ID });

  // 20 units of the product on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `cu-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Reprint ${SUFFIX}` })).category.id;
  const product = (await ok(page, "product.v1.ProductService/ProductCreate", { teamId: ground.team, productCodePart: SKU, name: PRODUCT, categoryId: category }))
    .product;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E reprint ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-CULS-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: ground.team, accountId: account, operational: true });
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

  // Each order: placed with its number and its old label; `early` — its number changed before anything is printed;
  // `print` — its label printed the print page's way (record_print), as the warehouse; then walked; `after` — its label
  // file replaced by the seller after that print.
  const walks: Record<string, { to: string[]; early?: boolean; print?: boolean; after?: boolean }> = {
    MARK: { to: ["PROCESSED", "PICKED"], print: true },
    HOLD: { to: ["PROCESSED", "PICKED"], print: true, after: true },
    EARLY: { to: ["PROCESSED", "PICKED"], early: true },
    PLAIN: { to: ["PROCESSED", "PICKED"] },
    DAFTA: { to: ["PROCESSED"], print: true, after: true },
    DAFTB: { to: ["PROCESSED"] },
    VIEW: { to: ["PROCESSED", "PICKED"] },
  };
  for (const [slot, walk] of Object.entries(walks)) {
    const document = await uploadLabel(page, OLD_LABEL, oldFileOf(slot));
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-cul-${slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId: ground.shop,
      warehouseId: ground.warehouse,
      customerName: `E2E Reprint Buyer ${slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(slot),
      receiptCode: resiOf(slot),
      receipt: { documentId: document, filename: oldFileOf(slot), mimeType: "application/pdf" },
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
    });
    const id = String(placed.order.id);
    ground.orders[slot] = id;
    if (walk.early) await changeLabel(page, slot, { code: newResiOf(slot) });
    if (walk.print) {
      const printed = await ok<{ results: { orderId: string; included?: boolean; reason?: string }[] }>(page, "selling.v1.OrderService/OrderLabels", {
        teamId: ground.warehouse,
        orderIds: [id],
        recordPrint: true,
      });
      expect(printed.results[0]?.included, `print of #${id}: ${printed.results[0]?.reason}`).toBe(true);
    }
    for (const to of walk.to) await move(page, id, to);
    if (walk.after) await changeLabel(page, slot, { file: newFileOf(slot) });
  }

  await page.close();
}

test.describe.configure({ timeout: 180_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await seed(browser);
});

// ── 1 · the mark, where it shows, and the print that clears it ──────────────────────────────────────────────────────────

test("A label changed after its print is marked on the list, the pick page and the print page — Print clears it, a later change marks it again", async ({
  page,
  browser,
}) => {
  const slot = "MARK";
  const orderId = idOf(slot);
  await sellerSignIn(page);
  const wh = await crewPage(browser);
  try {
    // GIVEN — picked, its label printed on the print page's way, nothing changed since: no mark anywhere.
    const before = await orderOf(wh, orderId, ground.warehouse);
    expect(before.status).toBe(PICKED);
    expect(Number(before.labelPrintedAtUnix ?? 0), "the print was recorded").toBeGreaterThan(0);
    expect(before.reprintLabel ?? false, "a print with no change since marks nothing").toBe(false);
    await expectRowMark(wh, "picked", slot, false);

    // WHEN — the seller's Edit Resi (it says the warehouse already printed this label): a new label file, saved.
    await editResi(page, orderId, resiOf(slot), { file: newFileOf(slot) }, true);

    await test.step("the crew's row on Picked carries Reprint label", async () => {
      await expectRowMark(wh, "picked", slot, true);
      expect.soft((await orderOf(wh, orderId, ground.warehouse)).reprintLabel).toBe(true);
    });

    await test.step("nothing is drawn on the seller's own order page", async () => {
      await page.goto(`/orders/${orderId}`);
      await expect(page.getByTestId("order-detail-page")).toBeVisible();
      await expect(page.getByTestId("order-reference-receipt")).toBeVisible();
      await expect.soft(page.getByText("Reprint label")).toHaveCount(0);
    });

    await test.step("the pick page's line says why, and its Cetak Resi opens the print page with this one order", async () => {
      await openPick(wh, slot);
      const line = wh.getByTestId("pick-reprint-label-line");
      await expect.soft(line).toBeVisible();
      await expect.soft(line.getByTestId("pick-reprint-label")).toHaveText("Reprint label");
      await expect.soft(line).toContainText("changed this order's tracking number or label after it was printed");
      await line.getByTestId("pick-reprint-label-print").click();
      await expect(wh).toHaveURL(new RegExp(`/warehouse-orders/print\\?ids=${orderId}$`));
      await expect(wh.getByTestId(`print-receipts-row-${orderId}`)).toBeVisible({ timeout: 15_000 });
    });

    const logsBefore = ((await orderOf(wh, orderId, ground.warehouse)).timelineLogs ?? []).length;

    await test.step("the print page marks it under its label and counts it on the list line", async () => {
      await expect.soft(wh.getByTestId(`print-receipts-reprint-${orderId}`)).toHaveText("Reprint label");
      await expect.soft(wh.getByTestId("print-receipts-list-line")).toContainText("1 to reprint");
    });

    await test.step("Print records the print: the mark is gone everywhere, the step and the timeline unchanged", async () => {
      const printed = await printNow(wh);
      expect.soft(printed.asked.recordPrint, "the print page's Print is a recorded print").toBe(true);
      expect.soft(printed.asked.orderIds).toEqual([orderId]);
      expect.soft(printed.answer.results).toEqual([{ orderId, included: true }]);

      await expect.soft(wh.getByTestId(`print-receipts-reprint-${orderId}`)).toHaveCount(0, { timeout: 10_000 });
      await expect.soft(wh.getByTestId("print-receipts-list-line")).not.toContainText("to reprint");
      const after = await orderOf(wh, orderId, ground.warehouse);
      expect.soft(after.reprintLabel ?? false).toBe(false);
      expect.soft(after.status, "a reprint keeps the order's step").toBe(PICKED);
      expect.soft((after.timelineLogs ?? []).length, "a reprint writes no timeline row").toBe(logsBefore);
      expect.soft(Number(after.labelPrintedAtUnix ?? 0)).toBeGreaterThanOrEqual(Number(before.labelPrintedAtUnix ?? 0));

      await expectRowMark(wh, "picked", slot, false);
      await openPick(wh, slot);
      await expect.soft(wh.getByTestId("pick-reprint-label-line")).toHaveCount(0);
    });

    await test.step("a change after the reprint marks it again", async () => {
      await editResi(page, orderId, resiOf(slot), { code: newResiOf(slot) }, true);
      await expectRowMark(wh, "picked", slot, true);
      await openPick(wh, slot);
      await expect.soft(wh.getByTestId("pick-reprint-label-line")).toBeVisible();
    });
  } finally {
    await wh.close();
  }
});

// ── 2 · a marked parcel stays in the building ───────────────────────────────────────────────────────────────────────────

test("A marked parcel is not handed over — the bar, the scan and the pick page refuse it, each in its words; printed again, it goes", async ({
  browser,
}) => {
  const [hold, early, plain] = [idOf("HOLD"), idOf("EARLY"), idOf("PLAIN")];
  const wh = await crewPage(browser);
  const sent: string[][] = [];
  wh.on("request", (req) => {
    if (!req.url().endsWith(`${RPC}/OrderStatusChange`)) return;
    const body = req.postDataJSON() as { orderIds?: (string | number)[] } | null;
    sent.push((body?.orderIds ?? []).map(String));
  });
  try {
    await test.step("a change before any print marks nothing", async () => {
      const record = await orderOf(wh, early, ground.warehouse);
      expect.soft(record.receiptCode).toBe(newResiOf("EARLY"));
      expect.soft(Number(record.labelPrintedAtUnix ?? 0), "never printed").toBe(0);
      expect.soft(record.reprintLabel ?? false).toBe(false);
      await expectRowMark(wh, "picked", "EARLY", false);
      await openPick(wh, "EARLY");
      await expect.soft(wh.getByTestId("pick-reprint-label-line")).toHaveCount(0);
    });

    // GIVEN — HOLD is marked: printed, then its label file replaced.
    expect((await orderOf(wh, hold, ground.warehouse)).reprintLabel).toBe(true);

    await test.step("the bar's Hand Over moves the unmarked order and refuses the marked one, by its own reason", async () => {
      await openTab(wh, "picked", STEM);
      for (const id of [hold, plain]) {
        await expect(wh.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
        await wh.getByTestId(`pick-queue-select-${id}`).click();
      }
      await expect(wh.getByTestId("pick-queue-bulk-count")).toContainText("2 selected");
      const [answer] = await Promise.all([
        wh.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
        wh.getByTestId("pick-queue-bulk-handover").click(),
      ]);
      const results = ((await answer.json()) as { results: { orderId: string; moved?: boolean; refusedReason?: string }[] }).results;
      const of = (id: string) => results.find((r) => String(r.orderId) === id);
      expect.soft(of(plain)?.moved, "the unmarked order moves").toBe(true);
      expect.soft(of(hold)?.moved ?? false, "the marked order is refused").toBe(false);
      expect.soft(of(hold)?.refusedReason).toBe(REFUSAL);
      await expect.soft(wh.getByText("1 order not moved")).toBeVisible();
      await expect.soft(wh.getByText(`#${hold}: ${REFUSAL}`)).toBeVisible();
      expect.soft((await orderOf(wh, plain, ground.warehouse)).status).toBe(SHIPPING);
      expect.soft((await orderOf(wh, hold, ground.warehouse)).status).toBe(PICKED);
    });

    await test.step("the handover scan refuses the marked parcel — Reprint the label first, the wrong sound, nothing sent", async () => {
      await wh.goto("/warehouse-orders");
      await wh.getByTestId("warehouse-orders-handover").click();
      await expect(wh.getByTestId("handover-dialog")).toBeVisible();
      const field = wh.getByTestId("handover-scan");
      await expect(field).toBeVisible();
      const scan = async (code: string): Promise<Tone> => {
        const n = (await heard(wh)).length;
        await field.fill(code);
        await field.press("Enter");
        await expect.poll(async () => (await heard(wh)).length, { timeout: 15_000 }).toBe(n + 1);
        return (await heard(wh))[n]!;
      };

      const moves = sent.length;
      const code = resiOf("HOLD");
      const wrong = await scan(code);
      const entry = wh.getByTestId(`handover-entry-${code}`);
      await expect.soft(entry).toHaveAttribute("data-state", "reprint");
      await expect.soft(entry).toContainText("Reprint the label first");
      await expect.soft(wh.getByTestId(`handover-reprint-${code}`)).toContainText(`Order #${hold}`);
      expect.soft(sent.length, "no move asked for the marked parcel").toBe(moves);
      expect.soft((await orderOf(wh, hold, ground.warehouse)).status).toBe(PICKED);

      // The unmarked parcel scanned after it goes — and its good tone tells the two apart.
      const goodCode = newResiOf("EARLY");
      const good = await scan(goodCode);
      await expect.soft(wh.getByTestId(`handover-entry-${goodCode}`)).toHaveAttribute("data-state", "handedOver");
      expect.soft((await orderOf(wh, early, ground.warehouse)).status).toBe(SHIPPING);
      expect.soft(wrong.hz, "the wrong sound is lower than the good one").toBeLessThan(good.hz);
      expect.soft(wrong.seconds, "the wrong sound is longer than the good one").toBeGreaterThan(good.seconds);
    });

    await test.step("the pick page's Mark Handed Over is refused by the server, in its words", async () => {
      await openPick(wh, "HOLD");
      await expect.soft(wh.getByTestId("pick-reprint-label-line")).toBeVisible();
      const advance = wh.getByTestId("pick-order-advance");
      await expect(advance).toContainText("Mark Handed Over");
      const [answer] = await Promise.all([
        wh.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
        advance.click(),
      ]);
      const [result] = ((await answer.json()) as { results: { moved?: boolean; refusedReason?: string }[] }).results;
      expect.soft(result?.moved ?? false).toBe(false);
      expect.soft(result?.refusedReason).toBe(REFUSAL);
      await expect.soft(wh.getByText("Could not record that step")).toBeVisible();
      expect.soft((await orderOf(wh, hold, ground.warehouse)).status).toBe(PICKED);
    });

    await test.step("printed again from the pick page's line, the parcel is handed over", async () => {
      await openPick(wh, "HOLD");
      await wh.getByTestId("pick-reprint-label-print").click();
      await expect(wh).toHaveURL(new RegExp(`/warehouse-orders/print\\?ids=${hold}$`));
      await expect(wh.getByTestId(`print-receipts-reprint-${hold}`)).toBeVisible({ timeout: 15_000 });
      const printed = await printNow(wh);
      expect.soft(printed.answer.results).toEqual([{ orderId: hold, included: true }]);
      await expect.soft(wh.getByTestId(`print-receipts-reprint-${hold}`)).toHaveCount(0, { timeout: 10_000 });

      await openPick(wh, "HOLD");
      await expect.soft(wh.getByTestId("pick-reprint-label-line")).toHaveCount(0);
      const advance = wh.getByTestId("pick-order-advance");
      await expect(advance).toContainText("Mark Handed Over");
      const [answer] = await Promise.all([
        wh.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderStatusChange`)),
        advance.click(),
      ]);
      const [result] = ((await answer.json()) as { results: { moved?: boolean; refusedReason?: string }[] }).results;
      expect.soft(result?.moved, result?.refusedReason).toBe(true);
      await expect.soft(wh.getByTestId("order-status-6").first()).toBeVisible();
      expect.soft((await orderOf(wh, hold, ground.warehouse)).status).toBe(SHIPPING);
    });
  } finally {
    await wh.close();
  }
});

// ── 3 · Needs reprint and Daftar Ambil ──────────────────────────────────────────────────────────────────────────────────

test("Needs reprint lists only the marked orders (the tab count follows), and Daftar Ambil marks the order's block", async ({ browser }) => {
  const [marked, plain] = [idOf("DAFTA"), idOf("DAFTB")];
  const q = `${STEM}DAFT`;
  const wh = await crewPage(browser);
  try {
    // GIVEN — two confirmed orders, one marked.
    expect((await orderOf(wh, marked, ground.warehouse)).reprintLabel).toBe(true);
    expect((await orderOf(wh, plain, ground.warehouse)).reprintLabel ?? false).toBe(false);

    await test.step("on Confirmed, the badge beside the marked order's status only", async () => {
      await openTab(wh, "confirm", q);
      await expect(wh.getByTestId(`pick-queue-row-${marked}`)).toBeVisible();
      await expect(wh.getByTestId(`pick-queue-row-${plain}`)).toBeVisible();
      await expect.soft(wh.getByTestId(`order-reprint-label-${marked}`)).toHaveText("Reprint label");
      await expect.soft(wh.getByTestId(`order-reprint-label-${plain}`)).toHaveCount(0);
      await expect.soft(wh.getByTestId("pick-tab-count-confirm")).toHaveText("2");
    });

    await test.step("Needs reprint narrows the list on the server, in the address, and the count follows", async () => {
      await wh.getByTestId("warehouse-orders-reprint-filter").click();
      await expect(wh).toHaveURL(/[?&]reprint=1/);
      await expect.soft(wh.getByTestId(`pick-queue-row-${plain}`)).toHaveCount(0, { timeout: 10_000 });
      await expect.soft(wh.getByTestId(`pick-queue-row-${marked}`)).toBeVisible();
      await expect.soft(wh.getByTestId("pick-tab-count-confirm")).toHaveText("1");

      // The address alone opens it the same way.
      await openTab(wh, "confirm", q, "&reprint=1");
      await expect.soft(wh.getByTestId(`pick-queue-row-${marked}`)).toBeVisible();
      await expect.soft(wh.getByTestId(`pick-queue-row-${plain}`)).toHaveCount(0);

      await wh.getByTestId("warehouse-orders-reprint-filter").click();
      await expect.soft(wh.getByTestId(`pick-queue-row-${plain}`)).toBeVisible({ timeout: 10_000 });
      await expect.soft(wh.getByTestId("pick-tab-count-confirm")).toHaveText("2");
    });

    await test.step("Daftar Ambil, per order: the marked order's block carries the badge, the other none", async () => {
      await openTab(wh, "confirm", q);
      for (const id of [marked, plain]) {
        await expect(wh.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
        await wh.getByTestId(`pick-queue-select-${id}`).click();
      }
      await expect(wh.getByTestId("pick-queue-bulk-count")).toContainText("2 selected");
      await wh.getByTestId("pick-queue-bulk-pick-list").click();
      await expect(wh).toHaveURL(/\/warehouse-orders\/bulk-pick\?/);
      await expect(wh.getByTestId("bulk-pick-page")).toBeVisible();
      await wh.getByTestId("bulk-pick-view-order").click();
      await expect(wh.getByTestId("bulk-pick-view-order")).toHaveAttribute("aria-selected", "true");
      await expect(wh.getByTestId("bulk-pick-by-order")).toBeVisible();
      await expect.soft(wh.getByTestId(`bulk-pick-reprint-label-${marked}`)).toHaveText("Reprint label");
      await expect.soft(wh.getByTestId(`bulk-pick-reprint-label-${plain}`)).toHaveCount(0);
    });
  } finally {
    await wh.close();
  }
});

// ── 4 · viewing is no print ─────────────────────────────────────────────────────────────────────────────────────────────

test("Viewing the label on the order page is no print — a change after it marks nothing", async ({ page, browser }) => {
  const slot = "VIEW";
  const orderId = idOf(slot);
  const wh = await crewPage(browser);
  try {
    await test.step("the order page's label viewer asks for the label without recording a print", async () => {
      await wh.goto(`/orders/${orderId}`);
      await expect(wh.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
      await expect(wh.getByTestId("order-detail-receipt")).toContainText(oldFileOf(slot));
      const [answer] = await Promise.all([
        wh.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderLabels`)),
        wh.getByTestId("order-receipt-open").click(),
      ]);
      expect.soft(answer.status()).toBe(200);
      const asked = (answer.request().postDataJSON() ?? {}) as { recordPrint?: boolean };
      expect.soft(asked.recordPrint ?? false, "the viewer records nothing").toBe(false);
      expect.soft(Number((await orderOf(wh, orderId, ground.warehouse)).labelPrintedAtUnix ?? 0), "no print recorded").toBe(0);
    });

    await test.step("the seller's change after that view asks nothing of the warehouse", async () => {
      await sellerSignIn(page);
      // The dialog says nothing about a print — there was none.
      await editResi(page, orderId, resiOf(slot), { file: newFileOf(slot) }, false);
      expect.soft((await orderOf(wh, orderId, ground.warehouse)).reprintLabel ?? false).toBe(false);
      await expectRowMark(wh, "picked", slot, false);
    });
  } finally {
    await wh.close();
  }
});

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ── edit resi order — the checks behind docs/acceptances/inventory/order.md (## edit) ───────────────────────────────────
//
// edit resi order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are
// the owner's, set by hand — never by this file.
//
// Business rules:
// - the-seller-edits-the-resi-until-handover (docs/technical/frontend/order_list_decision.md): Edit Resi is the SELLING
//   team's action while the parcel is still in the building — pending, processed, picked. It changes the tracking number
//   (receipt_code), the label file (receipt), or both, EACH ON ITS OWN, and nothing else; each edit writes a note row (no
//   status) naming the old and the new — "Resi: OLD → NEW · Label: old.pdf → new.pdf". From shipping on it is gone and
//   the server refuses it (FailedPrecondition).
// - a-label-scan-reads-the-ref-or-the-receipt (docs/business/inventory/order_decision.md): a scan of the label finds the
//   order by its marketplace ref OR its tracking number — Orders › Scan Label (scan-label-opens-the-pick-page).
// - a-warehouse-prints-the-labels-of-orders-it-ships (docs/technical/frontend/warehouse_order_list_decision.md): the
//   print page's Print makes ONE OrderLabels and opens the merged PDF of the orders' label files.
//
// `selling:all` → EVERY selling role (selling:owner, selling:admin, selling:cs), each in its own browser session, each on
// orders of its own. A then the WAREHOUSE sees is read by one warehouse role (warehouse:staff, the crew) on a second
// page of the same test.
//
// The WHEN — the role opens its order's page (/orders/<id>), presses Edit Resi, changes what the given says (the
// number typed over; the label replaced by picking a file in the dialog — the real two-phase upload) and saves.
//
// How each then is read:
// - `resi changed` / `label changed` / `resi and label changed` — reloaded, the order's page reads the new number in
//   order-reference-receipt and/or the new file's name in order-detail-receipt; the order's own record (OrderDetail)
//   carries them, and what the given did not change is unchanged (the two are edited on their own).
// - `old and new resi shown in order timeline` / `label change shown in order timeline` — the order's notes (Catatan,
//   a-note-is-a-timeline-row) hold ONE "Resi: OLD → NEW" / "Label: old → new", and the record's timeline has that note
//   with no status (the edit moved nothing).
// - `warehouse sees new resi` — the crew's Orders, narrowed by the order's ref, draws the order's row with the NEW
//   tracking number; the order read as the warehouse carries it too.
// - `receipt scan finds order by new resi` — Orders › Scan Label: the OLD number finds nothing any more ("none"), the
//   NEW one opens the order's own page (/warehouse-orders/<id>).
// - `warehouse prints new label` — the crew's print page for the order, Print: ONE OrderLabels, the order included, ONE
//   PDF opened — and that PDF is the NEW label: its page count is the new file's (a 1-page Shopee label), not the old
//   one's (a 2-page Lazada label).
// - `warehouse told to reprint label` — built by #98 (a-changed-label-asks-the-warehouse-to-reprint): after the seller
//   replaced the wrong label of a picked order whose label the warehouse already printed, the crew's row on the Picked
//   tab carries *Reprint label* (order-reprint-label-<id>) and the order's pick page its line (pick-reprint-label-line);
//   the order read as the warehouse says reprint_label. Read in each role's own test, on the order that role changed.
//   (Until #98 it was a 🚧 test.fail of its own; the whole flow — print clears it, handover refused — is
//   the_changed_label_is_reprinted.spec.ts.)
//
// GROUND (beforeAll, as root, through the API): a selling team of its own (root owns it) with a user per selling role, a
// Shopee shop (root and the CS on it), a warehouse it returns to with a warehouse:staff user, 20 units of one product
// accepted onto a rack there. Per role, four orders of 1 unit, each with an OLD tracking number and an OLD label file (a
// 2-page Lazada label, uploaded for real): `pending`; `processed` (the warehouse confirmed it); `picked` (confirmed and
// picked); `printed` (its label printed once — OrderLabels as the warehouse, `recordPrint` as the print page's Print
// sends it, so the print is recorded — then confirmed and picked). Plus a `shipping` order for the regression. Seeded in
// beforeAll so a worker restarted after a failure seeds its own.

const RPC = "/warehouse.selling.v1.OrderService";
const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-editresi-pass-1";
const PRODUCT = `Sabun Resi ${SUFFIX}`;
const SKU = `EZK${SUFFIX}`;

const ROLES = [
  { key: "own", role: "ROLE_SELLING_OWNER", label: "selling:owner" },
  { key: "adm", role: "ROLE_SELLING_ADMIN", label: "selling:admin" },
  { key: "cs", role: "ROLE_SELLING_CS", label: "selling:cs" },
] as const;
type Key = (typeof ROLES)[number]["key"];

// The givens' orders, by kind.
type Kind = "pending" | "processed" | "picked" | "printed";
const KINDS: Kind[] = ["pending", "processed", "picked", "printed"];
const CODE: Record<Kind | "shipping", string> = {
  pending: "PN",
  processed: "PR",
  picked: "PK",
  printed: "PP",
  shipping: "SH",
};

const userOf = (key: Key) => `e2eez${key}${SUFFIX}`;
const WH_USER = `e2eezwh${SUFFIX}`;
// The marketplace's Order ID — carries the run's suffix (a repeat within a team is refused).
const refOf = (slot: string) => `EZ${SUFFIX}${slot.toUpperCase()}`;
// The tracking numbers: the one the order was placed with, and the one the seller types over it. Neither is a substring
// of the other, so Scan Label's exact match cannot mistake one for the other.
const oldResiOf = (slot: string) => `JZ${SUFFIX}${slot.toUpperCase()}1`;
const newResiOf = (slot: string) => `JZ${SUFFIX}${slot.toUpperCase()}2`;

// The label files: the OLD (wrong) one is a 2-page Lazada label, the NEW one a 1-page Shopee label — so the printed PDF
// says by its page count which of the two it is. Each upload is named for its order, so every note is its own.
const SAMPLES = new URL("../../examples/receipt_file_samples/", import.meta.url);
const OLD_LABEL = { sample: "lazada_lex_03.pdf", pages: 2 };
const NEW_LABEL = { sample: "shopee_reg_01.pdf", pages: 1 };
const oldFileOf = (slot: string) => `label-old-${slot}.pdf`;
const newFileOf = (slot: string) => `label-new-${slot}.pdf`;

// A role's order of a kind: "<kind code><role key>", e.g. PNown.
const slotOf = (kind: Kind, key: Key) => `${CODE[kind]}${key}`;

const ground = {
  team: "",
  warehouse: "",
  shop: "",
  // slot → order id
  orders: {} as Record<string, string>,
  // slot → the old label's document id
  oldDocs: {} as Record<string, string>,
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

async function signInAs(page: Page, key: Key) {
  await signIn(page, userOf(key), PASSWORD);
  await useTeam(page, ground.team);
}

// The crew, on a page of its own (a fresh context: the form sign-in), working in the warehouse — the print page's
// window.open recorded instead of opened (headless loads no popup).
async function crewPage(browser: Browser): Promise<Page> {
  const wh = await browser.newPage();
  await wh.addInitScript(() => {
    const w = window as unknown as { __opened: string[]; open: (url?: string | URL) => Window | null };
    w.__opened = [];
    w.open = (url?: string | URL) => {
      w.__opened.push(String(url));
      return null;
    };
  });
  await signIn(wh, WH_USER, PASSWORD);
  await useTeam(wh, ground.warehouse);

  return wh;
}

type OrderRecord = {
  status: string;
  receiptCode?: string;
  receipt?: { documentId?: string; filename?: string; mimeType?: string };
  timelineLogs?: { note?: string; status?: string }[];
  // Cetak ulang label — printed, then changed after the print, still in the building (a-changed-label-asks-the-warehouse-to-reprint).
  reprintLabel?: boolean;
};

// The order as the server keeps it, read in `teamId` (the seller's, or the warehouse's).
async function orderOf(page: Page, orderId: string, teamId = ground.team): Promise<OrderRecord> {
  return (await ok(page, "selling.v1.OrderService/OrderDetail", { teamId, orderId })).order as OrderRecord;
}

// The order's page, its references drawn.
async function openOrder(page: Page, orderId: string) {
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("order-reference-receipt")).toBeVisible();
}

// THE WHEN — Edit Resi on the order's page: the number typed over and/or a new label file picked, then Save. Returns the
// OrderReceiptUpdate the dialog sent.
async function editResi(page: Page, orderId: string, was: string, change: { code?: string; file?: string }) {
  await openOrder(page, orderId);

  // The dialog reads the order fresh as it opens: wait for that read, so it cannot land on top of what is typed.
  const fresh = page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderDetail`), { timeout: 10_000 }).catch(() => null);
  await page.getByTestId("order-action-editReceipt").click();
  const dialog = page.getByTestId("edit-receipt-dialog");
  await expect(dialog).toBeVisible();
  await fresh;
  await expect(dialog.getByTestId("edit-receipt-code")).toHaveValue(was);

  if (change.code !== undefined) {
    await dialog.getByTestId("edit-receipt-code").fill(change.code);
  }
  if (change.file !== undefined) {
    // The hidden input of the dialog's file picker — the visible trigger only opens the OS dialog.
    await dialog
      .getByTestId("order-receipt-upload")
      .locator("input[type=file]")
      .setInputFiles({ name: change.file, mimeType: "application/pdf", buffer: readFileSync(new URL(NEW_LABEL.sample, SAMPLES)) });
    // Uploaded (RequestUpload → PUT → ConfirmUpload) by the time the new name is the attached one.
    await expect(dialog.getByTestId("order-receipt-attached")).toContainText(change.file, { timeout: 20_000 });
  }

  const save = dialog.getByTestId("edit-receipt-save");
  await expect(save).toBeEnabled();
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderReceiptUpdate`)),
    save.click(),
  ]);
  expect(answer.status(), await answer.text()).toBe(200);
  // Saved, it closes; refused, it stays open on edit-receipt-error.
  await expect(dialog).toBeHidden();

  return JSON.parse(answer.request().postData() ?? "{}") as { receiptCode?: string; receipt?: { filename?: string } };
}

// The notes of the order's page (Catatan) that read `text` exactly, and the record's timeline rows with that note.
async function expectOneNote(page: Page, orderId: string, text: string) {
  await openOrder(page, orderId);
  const notes = page.getByTestId("section-notes").getByTestId("order-note-text");
  await expect.soft(notes.filter({ hasText: text })).toHaveCount(1);
  const logs = (await orderOf(page, orderId)).timelineLogs ?? [];
  expect.soft(logs.filter((l) => l.note === text).length, `timeline rows noting "${text}"`).toBe(1);
  expect.soft(logs.filter((l) => l.note === text && l.status).length, "the edit's row carries no status").toBe(0);
}

// `label changed`: reloaded, the page names the new file; the record carries it (a new document), the number untouched.
async function expectLabelChanged(page: Page, orderId: string, slot: string, code: string) {
  await openOrder(page, orderId);
  await expect.soft(page.getByTestId("order-detail-receipt")).toContainText(newFileOf(slot));
  await expect.soft(page.getByTestId("order-detail-receipt")).not.toContainText(oldFileOf(slot));
  await expect.soft(page.getByTestId("order-reference-receipt")).toContainText(code);
  const after = await orderOf(page, orderId);
  expect.soft(after.receipt?.filename).toBe(newFileOf(slot));
  expect.soft(after.receipt?.documentId ?? "", "a new document").not.toBe(ground.oldDocs[slot]);
  expect.soft(after.receipt?.documentId ?? "", "a document at all").not.toBe("");
  expect.soft(after.receiptCode).toBe(code);
}

// A page dictionary's type entry — /Type /Page, never /Pages. The merged PDF is written without object streams
// (san_pdf_merge), so its pages can be counted as text (order_warehouse_wants_to_print_receipt.spec.ts does the same).
function pagesOf(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^a-zA-Z]/g) ?? []).length;
}

// The seller's real two-phase upload of one label: RequestUpload, the PUT of the bytes, ConfirmUpload — its document id.
async function uploadLabel(page: Page, teamId: string, sample: string, filename: string): Promise<string> {
  const content = readFileSync(new URL(sample, SAMPLES));
  const up = await ok(page, "document.v1.DocumentService/RequestUpload", {
    teamId,
    resourceType: "DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT",
    contentType: "application/pdf",
    sizeBytes: content.length,
    filename,
  });
  const put = await page.request.fetch(up.uploadUrl, { method: up.method, headers: up.headers, data: content });
  expect(put.status(), `PUT ${filename}`).toBe(200);

  return String((await ok(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: up.uploadToken })).document.id);
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seed(browser: Browser) {
  const page = await browser.newPage();
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
  ground.team = await team(`E2E Edit Resi Seller ${SUFFIX}`, `EZS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Edit Resi WH ${SUFFIX}`, `EZW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: ground.team,
    warehouseId: ground.warehouse,
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 1, minFee: 0 });

  const users: Record<string, string> = {};
  for (const r of ROLES) {
    const made = await ok(page, "user.v1.UserService/CreateUser", {
      teamId: ground.team,
      username: userOf(r.key),
      password: PASSWORD,
      name: `Edit Resi ${r.label} ${SUFFIX}`,
      role: r.role,
    });
    users[r.key] = String(made.user.id);
  }
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: ground.warehouse,
    username: WH_USER,
    password: PASSWORD,
    name: `Edit Resi crew ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  ground.shop = String(
    (await ok(page, "selling.v1.ShopService/ShopCreate", { teamId: ground.team, name: `E2E Resi Shop ${SUFFIX}`, shopCode: `EZP${SUFFIX}`, marketplace: "MARKETPLACE_SHOPEE" }))
      .shop.id,
  );
  // Root first — the first grant is the shop's primary CS; the CS on it too.
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shop, userId: ROOT_USER_ID });
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: ground.shop, userId: users.cs });

  // 20 units of the product on the warehouse's rack, paid from the seller's operational account.
  const rack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `ez-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Edit Resi ${SUFFIX}` })).category.id;
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
      name: `E2E edit resi ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-EZS-${SUFFIX}`,
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

  // The orders: each placed with its OLD number and its OLD (wrong) label, then walked as its kind says. `print` — its
  // label printed once by the warehouse before it was confirmed (the print page's way: the PDF, then the move).
  const walks: Record<string, { to: string[]; print?: boolean }> = {};
  for (const r of ROLES) {
    walks[slotOf("pending", r.key)] = { to: [] };
    walks[slotOf("processed", r.key)] = { to: ["PROCESSED"] };
    walks[slotOf("picked", r.key)] = { to: ["PROCESSED", "PICKED"] };
    walks[slotOf("printed", r.key)] = { to: ["PROCESSED", "PICKED"], print: true };
  }
  walks[CODE.shipping] = { to: ["PROCESSED", "PICKED", "SHIPPING"] };

  for (const [slot, walk] of Object.entries(walks)) {
    const document = await uploadLabel(page, ground.team, OLD_LABEL.sample, oldFileOf(slot));
    ground.oldDocs[slot] = document;
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-ezresi-${slot}-${SUFFIX}`,
      shipmentChannelId: "1",
      teamId: ground.team,
      shopId: ground.shop,
      warehouseId: ground.warehouse,
      customerName: `E2E Edit Resi Buyer ${slot} ${SUFFIX}`,
      platformTotal: 100_000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: refOf(slot),
      receiptCode: oldResiOf(slot),
      receipt: { documentId: document, filename: oldFileOf(slot), mimeType: "application/pdf" },
      items: [{ productId: product.id, productCode: product.productCode, name: PRODUCT, quantity: 1 }],
    });
    const id = String(placed.order.id);
    if (walk.print) {
      const printed = await ok<{ results: { orderId: string; included?: boolean; reason?: string }[] }>(
        page,
        "selling.v1.OrderService/OrderLabels",
        // A RECORDED print, as the print page's Print makes it — the label printed (a-changed-label-asks-the-warehouse-to-reprint).
        { teamId: ground.warehouse, orderIds: [id], recordPrint: true },
      );
      expect(printed.results[0]?.included, `first print of #${id}: ${printed.results[0]?.reason}`).toBe(true);
    }
    for (const to of walk.to) {
      await move(page, ground.warehouse, id, to);
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

// ── (status: pending · new resi) ────────────────────────────────────────────────────────────────────────────────────────

test.describe("selling:all wants to fix an order's resi (status: pending · new resi)", () => {
  for (const r of ROLES) {
    test(`${r.label} edit resi order`, async ({ page, browser }) => {
      const slot = slotOf("pending", r.key);
      const orderId = ground.orders[slot]!;
      const [was, now] = [oldResiOf(slot), newResiOf(slot)];
      await signInAs(page, r.key);

      // GIVEN — pending, with the old number.
      const before = await orderOf(page, orderId);
      expect(before.status).toBe("ORDER_STATUS_PENDING");
      expect(before.receiptCode).toBe(was);

      // WHEN — Edit Resi: the new number typed over the old one.
      const sent = await editResi(page, orderId, was, { code: now });
      expect.soft(sent.receiptCode).toBe(now);
      expect.soft(sent.receipt, "the label is not sent — it did not change").toBeUndefined();

      await test.step("then: resi changed", async () => {
        await openOrder(page, orderId);
        await expect.soft(page.getByTestId("order-reference-receipt")).toContainText(now);
        await expect.soft(page.getByTestId("order-reference-receipt")).not.toContainText(was);
        // The label stays as it was.
        await expect.soft(page.getByTestId("order-detail-receipt")).toContainText(oldFileOf(slot));
        const after = await orderOf(page, orderId);
        expect.soft(after.receiptCode).toBe(now);
        expect.soft(after.receipt?.documentId).toBe(ground.oldDocs[slot]);
        expect.soft(after.status).toBe("ORDER_STATUS_PENDING");
      });

      await test.step("then: old and new resi shown in order timeline", async () => {
        await expectOneNote(page, orderId, `Resi: ${was} → ${now}`);
      });

      const wh = await crewPage(browser);
      try {
        await test.step("then: warehouse sees new resi", async () => {
          await wh.goto(`/warehouse-orders?q=${refOf(slot)}`);
          await expect(wh.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
          const row = wh.getByTestId(`pick-queue-row-${orderId}`);
          await expect.soft(row).toBeVisible({ timeout: 15_000 });
          await expect.soft(row.getByTestId("order-receipt")).toHaveText(now);
          expect.soft((await orderOf(wh, orderId, ground.warehouse)).receiptCode, "the order as the warehouse reads it").toBe(now);
        });

        await test.step("then: receipt scan finds order by new resi", async () => {
          await wh.goto("/warehouse-orders");
          await wh.getByTestId("warehouse-orders-scan-label").click();
          const label = wh.getByTestId("scan-label-input");
          await expect(label).toBeVisible();

          // The old number is no label of this order any more.
          await label.fill(was);
          await label.press("Enter");
          await expect.soft(wh.getByTestId("scan-label-result")).toHaveAttribute("data-state", "none");
          await expect.soft(wh).toHaveURL(/\/warehouse-orders$/);

          // The new one opens it.
          await label.fill(now);
          await label.press("Enter");
          await expect(wh).toHaveURL(new RegExp(`/warehouse-orders/${orderId}$`), { timeout: 15_000 });
          await expect.soft(wh.getByTestId("order-status-1").first()).toBeVisible();
        });
      } finally {
        await wh.close();
      }
    });
  }
});

// ── (status: processed · new label file) ────────────────────────────────────────────────────────────────────────────────

test.describe("selling:all wants to fix an order's resi (status: processed · new label file)", () => {
  for (const r of ROLES) {
    test(`${r.label} edit resi order`, async ({ page, browser }) => {
      const slot = slotOf("processed", r.key);
      const orderId = ground.orders[slot]!;
      const code = oldResiOf(slot);
      await signInAs(page, r.key);

      // GIVEN — processed, with the old label.
      const before = await orderOf(page, orderId);
      expect(before.status).toBe("ORDER_STATUS_PROCESSED");
      expect(before.receipt?.filename).toBe(oldFileOf(slot));

      // WHEN — Edit Resi: a new label file picked, the number left alone.
      const sent = await editResi(page, orderId, code, { file: newFileOf(slot) });
      expect.soft(sent.receipt?.filename).toBe(newFileOf(slot));
      expect.soft(sent.receiptCode, "the number is not sent — it did not change").toBeUndefined();

      await test.step("then: label changed", async () => {
        await expectLabelChanged(page, orderId, slot, code);
        expect.soft((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_PROCESSED");
      });

      await test.step("then: label change shown in order timeline", async () => {
        await expectOneNote(page, orderId, `Label: ${oldFileOf(slot)} → ${newFileOf(slot)}`);
      });

      const wh = await crewPage(browser);
      try {
        await test.step("then: warehouse prints new label", async () => {
          const asked: string[] = [];
          wh.on("request", (req) => {
            if (req.url().endsWith(`${RPC}/OrderLabels`)) asked.push(req.postData() ?? "");
          });
          await wh.goto(`/warehouse-orders/print?ids=${orderId}`);
          await expect(wh.getByTestId(`print-receipts-row-${orderId}`)).toBeVisible({ timeout: 15_000 });

          const [answer] = await Promise.all([
            wh.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderLabels`)),
            wh.getByTestId("print-receipts-print").click(),
          ]);
          await expect(wh.getByTestId("print-receipts-result")).toBeVisible();
          expect.soft(answer.status()).toBe(200);
          const labels = (await answer.json()) as { url?: string; results: { orderId: string; included?: boolean }[] };
          expect.soft(asked, "OrderLabels calls").toHaveLength(1);
          expect.soft(labels.results).toEqual([{ orderId, included: true }]);
          await expect.soft(wh.getByTestId("print-receipts-result-title")).toHaveText("1 of 1 labels in the PDF");
          const opened = await wh.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
          expect.soft(opened, "PDFs opened").toEqual([labels.url]);

          // The PDF is the NEW label: the 1-page Shopee file, not the 2-page Lazada one it replaced.
          expect(labels.url, "the PDF's link").toBeTruthy();
          const file = await wh.request.get(labels.url!);
          expect.soft(file.status(), "the PDF's link").toBe(200);
          const pdf = await file.body();
          expect.soft(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
          expect.soft(pagesOf(pdf), "pages in the printed PDF — the new label's").toBe(NEW_LABEL.pages);
          expect.soft(pagesOf(pdf), "…not the old label's").not.toBe(OLD_LABEL.pages);
        });
      } finally {
        await wh.close();
      }
    });
  }
});

// ── (status: picked · new resi · new label file) ────────────────────────────────────────────────────────────────────────

test.describe("selling:all wants to fix an order's resi (status: picked · new resi · new label file)", () => {
  for (const r of ROLES) {
    test(`${r.label} edit resi order`, async ({ page }) => {
      const slot = slotOf("picked", r.key);
      const orderId = ground.orders[slot]!;
      const [was, now] = [oldResiOf(slot), newResiOf(slot)];
      await signInAs(page, r.key);

      // GIVEN — picked, with the old number and the old label.
      const before = await orderOf(page, orderId);
      expect(before.status).toBe("ORDER_STATUS_PICKED");
      expect(before.receiptCode).toBe(was);
      expect(before.receipt?.filename).toBe(oldFileOf(slot));

      // WHEN — Edit Resi: both, in one save.
      const sent = await editResi(page, orderId, was, { code: now, file: newFileOf(slot) });
      expect.soft(sent.receiptCode).toBe(now);
      expect.soft(sent.receipt?.filename).toBe(newFileOf(slot));

      await test.step("then: resi and label changed", async () => {
        await openOrder(page, orderId);
        await expect.soft(page.getByTestId("order-reference-receipt")).toContainText(now);
        await expect.soft(page.getByTestId("order-reference-receipt")).not.toContainText(was);
        await expect.soft(page.getByTestId("order-detail-receipt")).toContainText(newFileOf(slot));
        const after = await orderOf(page, orderId);
        expect.soft(after.receiptCode).toBe(now);
        expect.soft(after.receipt?.filename).toBe(newFileOf(slot));
        expect.soft(after.receipt?.documentId ?? "", "a new document").not.toBe(ground.oldDocs[slot]);
        expect.soft(after.status).toBe("ORDER_STATUS_PICKED");
        // One edit, one note naming both.
        const note = `Resi: ${was} → ${now} · Label: ${oldFileOf(slot)} → ${newFileOf(slot)}`;
        expect.soft((after.timelineLogs ?? []).filter((l) => l.note === note).length, `a timeline row "${note}"`).toBe(1);
      });
    });
  }
});

// ── regression ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// FROM HANDOVER ON THE RESI IS FROZEN (the-seller-edits-the-resi-until-handover): the courier has scanned the number, so a
// shipping order's page offers no Edit Resi and the server refuses the edit by name — the order keeps its number.
test("From handover on the resi is not edited — no Edit Resi, FailedPrecondition", async ({ page }) => {
  const orderId = ground.orders[CODE.shipping]!;
  await signInAs(page, "own");

  await openOrder(page, orderId);
  await expect(page.getByTestId("order-action-bar")).toBeVisible();
  await expect(page.getByTestId("order-action-editReceipt")).toHaveCount(0);

  const refused = await call(page, "selling.v1.OrderService/OrderReceiptUpdate", {
    teamId: ground.team,
    orderId,
    receiptCode: newResiOf(CODE.shipping),
  });
  expect(refused.body.code, JSON.stringify(refused.body)).toBe("failed_precondition");
  expect(refused.body.message).toContain("handed to the courier");
  const after = await orderOf(page, orderId);
  expect(after.status).toBe("ORDER_STATUS_SHIPPING");
  expect(after.receiptCode).toBe(oldResiOf(CODE.shipping));
});

// ── (status: picked · label printed · wrong label uploaded · new label file) ───────────────────────────────────────────

test.describe("selling:all wants to fix an order's resi (status: picked · label printed · wrong label uploaded · new label file)", () => {
  for (const r of ROLES) {
    test(`${r.label} edit resi order`, async ({ page, browser }) => {
      const slot = slotOf("printed", r.key);
      const orderId = ground.orders[slot]!;
      const code = oldResiOf(slot);
      await signInAs(page, r.key);

      // GIVEN — picked, its (wrong) label already printed by the warehouse (a recorded print), so nothing is marked yet.
      const before = await orderOf(page, orderId);
      expect(before.status).toBe("ORDER_STATUS_PICKED");
      expect(before.receipt?.filename).toBe(oldFileOf(slot));
      expect(before.reprintLabel ?? false, "printed, nothing changed since").toBe(false);

      // WHEN — Edit Resi: the right label file picked.
      await editResi(page, orderId, code, { file: newFileOf(slot) });

      await test.step("then: label changed", async () => {
        await expectLabelChanged(page, orderId, slot, code);
        expect.soft((await orderOf(page, orderId)).status).toBe("ORDER_STATUS_PICKED");
      });

      const wh = await crewPage(browser);
      try {
        await test.step("then: warehouse told to reprint label", async () => {
          // The crew's row on Picked carries Reprint label, beside the status.
          await wh.goto(`/warehouse-orders?step=picked&q=${refOf(slot)}`);
          await expect(wh.getByTestId("pick-tab-picked")).toHaveAttribute("aria-selected", "true");
          const row = wh.getByTestId(`pick-queue-row-${orderId}`);
          await expect(row).toBeVisible({ timeout: 15_000 });
          await expect.soft(row.getByTestId(`order-reprint-label-${orderId}`)).toHaveText("Reprint label");

          // The order's pick page says why, with the way to print it again.
          await wh.goto(`/warehouse-orders/${orderId}`);
          await expect(wh.getByTestId("order-status-5").first()).toBeVisible({ timeout: 15_000 });
          await expect.soft(wh.getByTestId("pick-reprint-label-line")).toContainText("Print the new label before packing");
          await expect.soft(wh.getByTestId("pick-reprint-label-print")).toBeVisible();

          expect.soft((await orderOf(wh, orderId, ground.warehouse)).reprintLabel, "the order as the warehouse reads it").toBe(true);
        });
      } finally {
        await wh.close();
      }
    });
  }
});

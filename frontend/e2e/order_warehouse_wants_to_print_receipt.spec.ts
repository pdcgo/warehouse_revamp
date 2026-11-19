import { readFileSync } from "node:fs";
import { constants as zlib, inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── warehouse:all wants to print receipts — print receipt order's givens of docs/acceptances/inventory/order.md ───────
//
// print receipt order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the
// checks for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows'
// statuses are the owner's, set by hand — never by this file.
//
// Business rules:
// - docs/business/inventory/order.md, How Warehouse Process The Order — the warehouse's first step: staff open the web,
//   print the order's `receipt_file`, and the order is set Processed.
// - docs/technical/frontend/warehouse_order_list_decision.md:
//   · a-warehouse-prints-the-labels-of-orders-it-ships — ONE OrderLabels for the chosen orders, merged into ONE PDF in
//     the order sent (the list's order), a result per order (included, or left out and why);
//   · the-print-page-and-the-courier-count-prototype-is-accepted — the list's Cetak Resi opens the print page
//     (/warehouse-orders/print) with the ticked orders; each chosen order is listed and one with no label is named
//     BEFORE printing; "Konfirmasi setelah dicetak" is ON each time the page opens, and after the merged PDF the
//     Perlu konfirmasi (pending) orders in it move to Dikonfirmasi (processed) in one status change; a reprint keeps its
//     step, an order left out (no label) keeps its step;
//   · the-unboxing-warning-is-one-sentence-on-each-label — the unboxing switch on stamps ONE fixed sentence, "Wajib video
//     unboxing saat membuka paket", on EVERY label page; off, the labels print as they are; the switch is remembered on
//     the device;
//   · a-rows-print-label-opens-the-print-page — a row's ⋯ Print Label opens the same page with that one order.
// - one-status-change-for-every-plain-move (the same decision file) — one OrderStatusChange carries the whole list.
//
// Run as EVERY warehouse role (warehouse:owner, warehouse:admin, warehouse:staff), each in its own browser session (a
// fresh device: nothing remembered).
//
// The ground (beforeAll, root): one warehouse with a rack; one seller (its return warehouse = that warehouse) with a shop
// and a product restocked onto the rack. Per role and per given, orders of 1 unit placed by root, each carrying its own
// uploaded marketplace label (a 2-page Lazada or a 1-page Shopee — distinct files, since two orders naming one file print
// it once), except the one the 1-order-without-label given leaves bare. The reprint given's order was printed once (root,
// OrderLabels) and confirmed (processed). Each order's Order ID starts with a term of its role and given, so the list is
// narrowed to it (`?q=`).
//
// The WHEN — the role prints the receipts:
//   (status: pending · multi orders · …)   Orders › To Confirm, its orders ticked, the bulk bar's Cetak Resi; on the
//                                          print page the switches as the given says, then Print.
//   (status: processed · 1 order · reprint) Orders › Confirmed, the row's ⋯ Print Label; Print.
//   The PDF opens with window.open — stubbed with a recorder (headless loads no popup), so what opened is counted.
//
// How each then is read:
// - `print page shows chosen orders` — opened at /warehouse-orders/print?ids=<the ticked, in the list's order>, the page
//   lists exactly them in that order (a row each, with its label attached and its step To Confirm), and not the order
//   left unticked. Read before Print, so it is the page as it opened.
// - `labels printed in one session` / `labels printed` / `label printed` — ONE OrderLabels for the warehouse carrying
//   every chosen id in that order, every one included; ONE PDF opened, its link the answer's; the file is a PDF whose
//   page count is the labels' pages (Lazada 2 + Shopee 1 …); the result says n of n labels are in it.
// - `unboxing video warning printed` — the request asked for it (unboxing_warning on), the result says every label page
//   carries it, and in the PDF EVERY page draws the sentence (its page content draws a form whose text is the sentence —
//   the merged file has no object streams, so its objects are read here as text, the streams inflated). The switch is
//   remembered on the device.
// - `labels printed without unboxing warning` — the request did not ask, the result says nothing of it, and no page and
//   no stream of the PDF holds the sentence.
// - `message names order without label` — before Print the order's row says No label and the page counts 1 without a
//   label; after it, OrderLabels answered NO_LABEL for it and the result names it: "Order #<id> has no label attached
//   yet — ask the seller to attach it".
// - `status of every order changed from pending to processed` — ONE OrderStatusChange carried exactly the chosen orders
//   to processed and each came back moved; the page says they moved; each order's own record says
//   ORDER_STATUS_PROCESSED; on Orders they left To Confirm and stand on Confirmed.
// - `orders stay pending` / `status unchanged` — after the print finished no OrderStatusChange was sent, the result says
//   every order keeps its step, each order's own record still has its old status, and on Orders it is still on its tab.

const RPC = "/warehouse.selling.v1.OrderService";
const PASSWORD = "e2e-acceptance-pass-1";
const ROLES = [
  { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
  { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
  { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
] as const;
type Role = (typeof ROLES)[number];

const SAMPLES = new URL("../../examples/receipt_file_samples/", import.meta.url);
type Label = { name: string; pages: number };
const LAZADA: Label = { name: "lazada_lex_03.pdf", pages: 2 };
const SHOPEE: Label = { name: "shopee_reg_01.pdf", pages: 1 };

// The server's one sentence (order_labels.go, unboxingWarning).
const UNBOXING = "Wajib video unboxing saat membuka paket";
const UNBOXING_KEY = "print-receipts.unboxing.v1";

const PENDING = "ORDER_STATUS_PENDING";
const PROCESSED = "ORDER_STATUS_PROCESSED";
// OrderStatus as the page's step cell carries it (data-status).
const STEP = { [PENDING]: "1", [PROCESSED]: "2" } as const;

// Per given: its condition and its orders' labels, in the order they are placed (null — no label).
const GIVENS = {
  on: { code: "ON", cond: "status: pending · multi orders · unboxing warning on", labels: [LAZADA, SHOPEE, SHOPEE] },
  off: { code: "OF", cond: "status: pending · multi orders · unboxing warning off", labels: [LAZADA, SHOPEE] },
  noLabel: { code: "NL", cond: "status: pending · multi orders · 1 order without label", labels: [SHOPEE, null, SHOPEE] },
  noMove: { code: "SC", cond: "status: pending · multi orders · status change off", labels: [SHOPEE, SHOPEE] },
  reprint: { code: "RP", cond: "status: processed · 1 order · reprint", labels: [SHOPEE] },
} as const;
type Given = keyof typeof GIVENS;

const username = (key: string) => `e2eprt${key}${SUFFIX}`;
// The Order ID's start for a role's orders of a given — the list is searched by it.
const termOf = (g: Given, r: Role) => `PR${SUFFIX}${GIVENS[g].code}${r.key.toUpperCase()}`;
const SKU = `PRK${SUFFIX}`;

const ground = {
  warehouse: "",
  // `${given}:${role key}` → the orders, in the order they were placed.
  orders: {} as Record<string, string[]>,
};
const ordersOf = (g: Given, r: Role) => ground.orders[`${g}:${r.key}`]!;

type LabelsAnswer = { url?: string; expiresAtUnix?: string; results: { orderId: string; included?: boolean; reason?: string }[] };
type Asked = { teamId?: string; orderIds?: string[]; unboxingWarning?: boolean };

// The seller's real two-phase upload of one label: RequestUpload, the PUT of the bytes, ConfirmUpload.
async function uploadLabel(page: Page, teamId: string, name: string): Promise<string> {
  const content = readFileSync(new URL(name, SAMPLES));
  const up = await api(page, "document.v1.DocumentService/RequestUpload", {
    teamId,
    resourceType: "DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT",
    contentType: "application/pdf",
    sizeBytes: content.length,
    filename: name,
  });
  const put = await page.request.fetch(up.uploadUrl, { method: up.method, headers: up.headers, data: content });
  expect(put.status(), `PUT ${name}`).toBe(200);

  return String((await api(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: up.uploadToken })).document.id);
}

test.describe.configure({ timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  const seller = await team(`E2E Prt Seller ${SUFFIX}`, `PRTS${SUFFIX}`, "TEAM_TYPE_SELLING");
  ground.warehouse = await team(`E2E Prt Warehouse ${SUFFIX}`, `PRTW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const rack = String(
    (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `prt-${SUFFIX}`, name: "E2E prt shelf" }))
      .rack.id,
  );
  await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 10, minFee: 0 });
  await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: seller,
    warehouseId: ground.warehouse,
  });

  // A user per warehouse role.
  for (const r of ROLES) {
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouse,
      username: username(r.key),
      password: PASSWORD,
      name: `Prt ${r.given} ${SUFFIX}`,
      role: r.role,
    });
  }

  // The seller's product, restocked from its supplier and accepted onto the warehouse's rack — a unit per order.
  const perRole = Object.values(GIVENS).reduce((n, g) => n + g.labels.length, 0);
  const stock = ROLES.length * perRole + 2;
  const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Prt Cat ${SUFFIX}` });
  const product = String(
    (
      await api(page, "product.v1.ProductService/ProductCreate", {
        teamId: seller,
        productCodePart: SKU,
        name: `E2E ${SKU}`,
        categoryId: category.category.id,
      })
    ).product.id,
  );
  const supplier = String(
    (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: seller, name: `E2E Prt Supplier ${SUFFIX}` })).supplier.id,
  );
  const account = String(
    (
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: seller,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E Prt BCA ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-PRT-${SUFFIX}`,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: seller,
    accountId: account,
    operational: true,
  });
  const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: seller,
    warehouseId: ground.warehouse,
    financeAccountId: account,
    items: [{ productId: product, productCode: SKU, name: `E2E ${SKU}`, count: stock, total: 10_000 * stock, supplierId: supplier }],
  });
  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouse,
    requestId: raised.request.id,
    lines: (raised.request.items as { id: string }[]).map((item) => ({
      itemId: item.id,
      receivedCount: stock,
      placements: [{ placementId: rack, quantity: stock }],
    })),
  });

  const shop = String(
    (
      await api(page, "selling.v1.ShopService/ShopCreate", {
        teamId: seller,
        name: `E2E Prt Shop ${SUFFIX}`,
        shopCode: `PRT${SUFFIX}`,
        marketplace: "MARKETPLACE_SHOPEE",
      })
    ).shop.id,
  );
  await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: seller, shopId: shop, userId: ROOT_USER_ID });

  // GIVEN — per role and given, the orders, pending, each with its own label (or none, as the given says).
  const reprints: string[] = [];
  for (const r of ROLES) {
    for (const g of Object.keys(GIVENS) as Given[]) {
      const placed: string[] = [];
      let n = 0;
      for (const label of GIVENS[g].labels) {
        n += 1;
        const document = label ? await uploadLabel(page, seller, label.name) : "";
        const made = await api(page, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-prt-${SUFFIX}-${g}-${r.key}-${n}`,
          shipmentChannelId: "1",
          teamId: seller,
          shopId: shop,
          warehouseId: ground.warehouse,
          customerName: `E2E Prt Buyer ${n}`,
          platformTotal: 100_000,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: `${termOf(g, r)}${n}`,
          items: [{ productId: product, productCode: SKU, name: `E2E ${SKU}`, quantity: 1 }],
          ...(label ? { receipt: { documentId: document, filename: label.name, mimeType: "application/pdf" } } : {}),
        });
        placed.push(String(made.order.id));
      }
      ground.orders[`${g}:${r.key}`] = placed;
      if (g === "reprint") reprints.push(...placed);
    }
  }

  // The reprint given's order: printed once already, and confirmed.
  const first = (await api(page, "selling.v1.OrderService/OrderLabels", { teamId: ground.warehouse, orderIds: reprints })) as LabelsAnswer;
  for (const x of first.results) if (!x.included) throw new Error(`first print #${x.orderId}: ${x.reason}`);
  const confirmed = await api(page, "selling.v1.OrderService/OrderStatusChange", {
    teamId: ground.warehouse,
    orderIds: reprints,
    to: PROCESSED,
  });
  for (const x of confirmed.results as { orderId: string; moved?: boolean; refusedReason?: string }[]) {
    if (!x.moved) throw new Error(`confirm #${x.orderId}: ${x.refusedReason}`);
  }

  await page.close();
});

// ── The role's session ──────────────────────────────────────────────────────────────────────────────────────────────

// The role signed in on a fresh device, working in the warehouse — the PDF's window.open recorded instead of opened, and
// every OrderLabels / OrderStatusChange the page sends counted.
async function enter(page: Page, r: Role) {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[]; open: (url?: string | URL) => Window | null };
    w.__opened = [];
    w.open = (url?: string | URL) => {
      w.__opened.push(String(url));
      return null;
    };
  });
  const sent = { labels: [] as Request[], moves: [] as Request[] };
  page.on("request", (req) => {
    if (req.url().endsWith(`${RPC}/OrderLabels`)) sent.labels.push(req);
    if (req.url().endsWith(`${RPC}/OrderStatusChange`)) sent.moves.push(req);
  });

  await login(page, username(r.key), PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.warehouse);

  return sent;
}

// The order's own record, read with the role's token — its status, as the server keeps it.
async function statusOf(page: Page, orderId: string): Promise<string> {
  const res = await api(page, "selling.v1.OrderService/OrderDetail", { teamId: ground.warehouse, orderId });
  return String(res.order?.status ?? "");
}

const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

// The ids behind the rows of a list, top to bottom.
const rowIds = (page: Page, prefix: string) =>
  page
    .locator(`[data-testid^="${prefix}"]`)
    .evaluateAll((rows, p) => rows.map((row) => row.getAttribute("data-testid")!.slice(p.length)).filter((id) => /^\d+$/.test(id)), prefix);

// WHEN, the list's door — the role's orders on To Confirm (narrowed by their Order ID), `ticked` ticked, the bulk bar's
// Cetak Resi. The print page opens with them in the list's order, which is returned.
async function openFromBulkBar(page: Page, term: string, ticked: string[]): Promise<string[]> {
  await page.goto(`/warehouse-orders?q=${term}`);
  await expect(page.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
  for (const id of ticked) {
    await expect(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
    await page.getByTestId(`pick-queue-select-${id}`).click();
  }
  await expect(page.getByTestId("pick-queue-bulk-count")).toContainText(String(ticked.length));
  const inListOrder = (await rowIds(page, "pick-queue-row-")).filter((id) => ticked.includes(id));
  expect(inListOrder).toHaveLength(ticked.length);

  await page.getByTestId("pick-queue-bulk-print").click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/print\\?ids=${inListOrder.join("(,|%2C)")}$`));
  await expect(page.getByTestId("print-receipts-table")).toBeVisible();
  for (const id of inListOrder) await expect(page.getByTestId(`print-receipts-step-${id}`)).toBeVisible();

  return inListOrder;
}

// Print pressed — the OrderLabels it sent and its answer, once the page says what the print did (after the move, when
// there is one).
async function print(page: Page) {
  const [answer] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith(`${RPC}/OrderLabels`)),
    page.getByTestId("print-receipts-print").click(),
  ]);
  await expect(page.getByTestId("print-receipts-result")).toBeVisible();

  return {
    status: answer.status(),
    asked: JSON.parse(answer.request().postData() ?? "{}") as Asked,
    answer: (await answer.json()) as LabelsAnswer,
  };
}

// The file behind the link.
async function pdfOf(page: Page, url: string | undefined): Promise<Buffer | null> {
  if (!url) return null;
  const file = await page.request.get(url);
  expect.soft(file.status(), "the PDF's link").toBe(200);
  const pdf = await file.body();
  expect.soft(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  return pdf;
}

// `labels printed in one session` — ONE OrderLabels for the warehouse with every chosen id in order, every one in; ONE PDF
// opened, the answer's; `pages` pages in it. The PDF is returned for the next then.
async function expectOneSession(
  page: Page,
  sent: { labels: Request[] },
  printed: Awaited<ReturnType<typeof print>>,
  chosen: string[],
  pages: number,
): Promise<Buffer | null> {
  expect.soft(printed.status).toBe(200);
  expect.soft(sent.labels, "OrderLabels calls").toHaveLength(1);
  expect.soft(printed.asked.teamId).toBe(ground.warehouse);
  expect.soft(printed.asked.orderIds).toEqual(chosen);
  expect.soft(printed.answer.results).toEqual(chosen.map((orderId) => ({ orderId, included: true })));
  expect.soft(await opened(page), "PDFs opened").toEqual([printed.answer.url]);
  await expect
    .soft(page.getByTestId("print-receipts-result-title"))
    .toHaveText(`${chosen.length} of ${chosen.length} labels in the PDF`);

  const pdf = await pdfOf(page, printed.answer.url);
  if (pdf) expect.soft(pagesOf(pdf), "pages in the PDF").toBe(pages);

  return pdf;
}

// On Orders (narrowed by the term): the orders are not on the `away` tab and stand on `here`.
async function expectOnTab(page: Page, term: string, ids: string[], here: "toConfirm" | "confirm") {
  const away = here === "toConfirm" ? "confirm" : "toConfirm";
  await page.goto(`/warehouse-orders?step=${away}&q=${term}`);
  await expect(page.getByTestId(`pick-tab-${away}`)).toHaveAttribute("aria-selected", "true");
  // An empty tab draws its table's header and the empty hint below it — either says the list has loaded.
  await expect(page.getByTestId("pick-queue-table").or(page.getByTestId("pick-queue-empty")).first()).toBeVisible();
  for (const id of ids) await expect.soft(page.getByTestId(`pick-queue-row-${id}`)).toHaveCount(0);
  await page.getByTestId(`pick-tab-${here}`).click();
  await expect(page.getByTestId(`pick-tab-${here}`)).toHaveAttribute("aria-selected", "true");
  for (const id of ids) await expect.soft(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
}

// A Chakra switch on the page: its label pressed, its hidden checkbox read.
async function setSwitch(page: Page, testId: string, label: string, on: boolean) {
  const box = page.getByTestId(testId).locator('input[type="checkbox"]');
  if ((await box.isChecked()) !== on) await page.getByTestId(testId).getByText(label).click();
  if (on) {
    await expect(box).toBeChecked();
  } else {
    await expect(box).not.toBeChecked();
  }
}

// ── Reading the PDF ─────────────────────────────────────────────────────────────────────────────────────────────────

// A page dictionary's type entry — /Type /Page, never /Pages. The merged PDF is written without object streams
// (san_pdf_merge), so every page dictionary is readable text and the pages can be counted without a PDF library.
function pagesOf(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^a-zA-Z]/g) ?? []).length;
}

// One object of the PDF: its dictionary's text and, for a stream, its bytes decoded (Flate inflated) as latin1 text.
interface PdfObject {
  dict: string;
  data?: string;
}

// Every `N 0 obj … endobj` of a PDF with no object streams, a stream's bytes skipped by its /Length.
function pdfObjects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const header = /(\d+)\s+\d+\s+obj\b/g;

  for (let m = header.exec(text); m; m = header.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endobj", start);
    if (end < 0) break;
    const at = text.indexOf("stream", start);

    if (at < 0 || at > end) {
      objects.set(Number(m[1]), { dict: text.slice(start, end) });
      header.lastIndex = end + "endobj".length;
      continue;
    }

    const dict = text.slice(start, at);
    let from = at + "stream".length;
    if (text[from] === "\r") from += 1;
    if (text[from] === "\n") from += 1;
    const length = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
    let to = length ? from + Number(length[1]) : -1;
    if (to < 0 || to > text.length) {
      to = text.indexOf("endstream", from);
      while (to > from && (text[to - 1] === "\n" || text[to - 1] === "\r")) to -= 1;
    }
    const raw = pdf.subarray(from, to);

    let data: string | undefined;
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = inflateSync(raw, { finishFlush: zlib.Z_SYNC_FLUSH }).toString("latin1");
      } catch {
        data = undefined;
      }
    } else if (!/\/Filter/.test(dict)) {
      data = raw.toString("latin1");
    }
    objects.set(Number(m[1]), { dict, data });

    const close = text.indexOf("endstream", to);
    header.lastIndex = close < 0 ? text.length : close + "endstream".length;
  }

  return objects;
}

// The text of `/key`'s value in a dictionary — an inline << … >> or [ … ] as written, or a reference `N 0 R`.
function rawValue(dict: string, key: string): string {
  const m = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`).exec(dict);
  if (!m) return "";
  const at = m.index + m[0].length;

  if (dict.startsWith("<<", at)) {
    let depth = 0;
    for (let i = at; i < dict.length; ) {
      if (dict.startsWith("<<", i)) {
        depth += 1;
        i += 2;
      } else if (dict.startsWith(">>", i)) {
        depth -= 1;
        i += 2;
        if (depth === 0) return dict.slice(at, i);
      } else {
        i += 1;
      }
    }
    return dict.slice(at);
  }
  if (dict[at] === "[") {
    const close = dict.indexOf("]", at);
    return dict.slice(at, close < 0 ? undefined : close + 1);
  }

  return /^\d+\s+\d+\s+R/.exec(dict.slice(at))?.[0] ?? "";
}

const refsIn = (text: string) => [...text.matchAll(/(\d+)\s+\d+\s+R\b/g)].map((m) => Number(m[1]));

// A dictionary value, a reference followed to its object's own dictionary.
function dictValue(objects: Map<number, PdfObject>, dict: string, key: string): string {
  const value = rawValue(dict, key);
  return /^\d+\s+\d+\s+R$/.test(value) ? (objects.get(refsIn(value)[0]!)?.dict ?? "") : value;
}

// THE SENTENCE ON THE PAGES: pdfcpu's stamp is a form XObject whose content shows the line (`(<sentence>) Tj`), named in
// the page's /Resources /XObject and drawn by the page's content (`/<name> Do`) — the check the merge's own Go test makes
// (stampedPages, san_pdf_merge/stamp_test.go). `pages` counts the page dictionaries, `stamped` those that draw such a
// form, `forms` the streams holding the sentence.
function unboxingOnPages(pdf: Buffer): { pages: number; stamped: number; forms: number } {
  const objects = pdfObjects(pdf);
  const shown = `(${UNBOXING}) Tj`;
  const forms = new Set([...objects].filter(([, o]) => o.data?.includes(shown)).map(([n]) => n));
  let pages = 0;
  let stamped = 0;

  for (const o of objects.values()) {
    if (o.data !== undefined || !/\/Type\s*\/Page(?![A-Za-z])/.test(o.dict)) continue;
    pages += 1;

    const xobjects = dictValue(objects, dictValue(objects, o.dict, "Resources"), "XObject");
    const names = [...xobjects.matchAll(/\/([^\s/<>[\]()]+)\s*(\d+)\s+\d+\s+R\b/g)]
      .filter((m) => forms.has(Number(m[2])))
      .map((m) => m[1]!);

    let contents = refsIn(rawValue(o.dict, "Contents"));
    // Contents naming an array object rather than a stream.
    if (contents.length === 1 && objects.get(contents[0]!)?.data === undefined) contents = refsIn(objects.get(contents[0]!)?.dict ?? "");
    const drawn = contents.map((n) => objects.get(n)?.data ?? "").join("\n");

    if (names.some((name) => drawn.includes(`/${name} Do`))) stamped += 1;
  }

  return { pages, stamped, forms: forms.size };
}

// ── The givens ──────────────────────────────────────────────────────────────────────────────────────────────────────

test.describe(`warehouse:all wants to print receipts (${GIVENS.on.cond})`, () => {
  for (const r of ROLES) {
    test(`${r.given} print receipt order`, async ({ page }) => {
      const sent = await enter(page, r);
      const term = termOf("on", r);
      // Two of the role's three ticked — a Lazada (2 pages) and a Shopee (1); the third is not chosen.
      const [lazada, shopee, notChosen] = ordersOf("on", r) as [string, string, string];
      for (const id of [lazada, shopee, notChosen]) expect(await statusOf(page, id)).toBe(PENDING);

      // WHEN — ticked on To Confirm, Cetak Resi; on the print page the unboxing switch on, then Print.
      const chosen = await openFromBulkBar(page, term, [lazada, shopee]);

      // Read as the page opened, before Print moves anything.
      await test.step("then: print page shows chosen orders", async () => {
        await expect.soft(page.getByTestId("print-receipts-heading")).toHaveText(`Print Labels · ${chosen.length} Orders`);
        expect.soft(await rowIds(page, "print-receipts-row-")).toEqual(chosen);
        for (const id of chosen) {
          await expect.soft(page.getByTestId(`print-receipts-step-${id}`)).toHaveAttribute("data-status", STEP[PENDING]);
          await expect.soft(page.getByTestId(`print-receipts-label-${id}`)).toHaveAttribute("data-label", "attached");
        }
        await expect.soft(page.getByTestId(`print-receipts-row-${notChosen}`)).toHaveCount(0);
        await expect.soft(page.getByTestId("print-receipts-list-line")).toHaveText(`${chosen.length} orders · ${chosen.length} to confirm`);
      });

      // "Konfirmasi setelah dicetak" is ON as the page opens; the unboxing switch, never touched on this device, is off.
      await expect(page.getByTestId("print-receipts-status-change").locator('input[type="checkbox"]')).toBeChecked();
      await setSwitch(page, "print-receipts-unboxing", "Unboxing video warning", true);
      await expect(page.getByTestId("print-receipts-unboxing-hint")).toContainText("Every label page carries the unboxing-video sentence");
      const printed = await print(page);

      let pdf: Buffer | null = null;
      await test.step("then: labels printed in one session", async () => {
        pdf = await expectOneSession(page, sent, printed, chosen, LAZADA.pages + SHOPEE.pages);
        // One merged file, the warehouse's own — not either label's.
        expect.soft(printed.answer.url ?? "").toMatch(/labels-\d{4}-\d{2}-\d{2}-\d{6}\.pdf/);
      });

      await test.step("then: unboxing video warning printed", async () => {
        expect.soft(printed.asked.unboxingWarning, "the print asked for the warning").toBe(true);
        await expect.soft(page.getByTestId("print-receipts-result-unboxing")).toHaveText("Every label page carries the unboxing-video warning.");
        expect.soft(pdf, "the PDF was read").not.toBeNull();
        if (pdf) {
          const stamp = unboxingOnPages(pdf);
          expect.soft(stamp.pages, "pages in the PDF").toBe(LAZADA.pages + SHOPEE.pages);
          expect.soft(stamp.stamped, "pages drawing the sentence").toBe(stamp.pages);
          if (stamp.stamped !== stamp.pages) await test.info().attach(`labels-${r.key}.pdf`, { body: pdf, contentType: "application/pdf" });
        }
        // Remembered on this device.
        expect.soft(await page.evaluate((k) => window.localStorage.getItem(k), UNBOXING_KEY)).toBe("on");
      });

      await test.step("then: status of every order changed from pending to processed", async () => {
        // ONE OrderStatusChange, after the PDF, carrying exactly the chosen orders to processed — each moved.
        expect.soft(sent.moves, "OrderStatusChange calls").toHaveLength(1);
        const move = sent.moves[0];
        if (move) {
          const body = JSON.parse(move.postData() ?? "{}") as { orderIds?: string[]; to?: string };
          expect.soft([...(body.orderIds ?? [])].sort()).toEqual([...chosen].sort());
          expect.soft(body.to).toBe(PROCESSED);
          const results = ((await (await move.response())?.json()) as { results?: { orderId: string; moved?: boolean }[] })?.results ?? [];
          for (const id of chosen) expect.soft(results.find((x) => x.orderId === id)?.moved, `#${id} moved`).toBe(true);
        }
        await expect.soft(page.getByTestId("print-receipts-result-moves")).toHaveText(`${chosen.length} orders moved to Confirmed`);
        for (const id of chosen) {
          await expect.soft(page.getByTestId(`print-receipts-moved-${id}`)).toBeVisible();
          expect.soft(await statusOf(page, id)).toBe(PROCESSED);
        }
        await expectOnTab(page, term, chosen, "confirm");
      });

      // Not a then of this given — the order not chosen was not touched.
      expect.soft(await statusOf(page, notChosen)).toBe(PENDING);
    });
  }
});

test.describe(`warehouse:all wants to print receipts (${GIVENS.off.cond})`, () => {
  for (const r of ROLES) {
    test(`${r.given} print receipt order`, async ({ page }) => {
      const sent = await enter(page, r);
      const ids = ordersOf("off", r);

      // WHEN — both ticked, Cetak Resi; the unboxing switch off (this device never turned it on), Print.
      const chosen = await openFromBulkBar(page, termOf("off", r), ids);
      await setSwitch(page, "print-receipts-unboxing", "Unboxing video warning", false);
      await expect(page.getByTestId("print-receipts-unboxing-hint")).toContainText("The labels print as they are.");
      const printed = await print(page);

      await test.step("then: labels printed without unboxing warning", async () => {
        const pdf = await expectOneSession(page, sent, printed, chosen, LAZADA.pages + SHOPEE.pages);
        expect.soft(printed.asked.unboxingWarning ?? false, "the print asked for no warning").toBe(false);
        await expect.soft(page.getByTestId("print-receipts-result-unboxing")).toHaveCount(0);
        expect.soft(pdf, "the PDF was read").not.toBeNull();
        if (pdf) {
          const stamp = unboxingOnPages(pdf);
          expect.soft(stamp.stamped, "pages drawing the sentence").toBe(0);
          expect.soft(stamp.forms, "streams holding the sentence").toBe(0);
          expect.soft(pdf.toString("latin1").includes(UNBOXING), "the sentence anywhere in the file").toBe(false);
        }
      });
    });
  }
});

test.describe(`warehouse:all wants to print receipts (${GIVENS.noLabel.cond})`, () => {
  for (const r of ROLES) {
    test(`${r.given} print receipt order`, async ({ page }) => {
      const sent = await enter(page, r);
      const ids = ordersOf("noLabel", r);
      const bare = ids[1]!;
      const labelled = [ids[0]!, ids[2]!];

      // WHEN — all three ticked, Cetak Resi, Print.
      const chosen = await openFromBulkBar(page, termOf("noLabel", r), ids);
      // Before the print: the page names the order with no label.
      const before = {
        label: await page.getByTestId(`print-receipts-label-${bare}`).getAttribute("data-label"),
        labelText: (await page.getByTestId(`print-receipts-label-${bare}`).textContent()) ?? "",
        line: (await page.getByTestId("print-receipts-list-line").textContent()) ?? "",
      };
      const printed = await print(page);

      await test.step("then: message names order without label", async () => {
        expect.soft(before.label, "its row before the print").toBe("missing");
        expect.soft(before.labelText).toContain("No label");
        expect.soft(before.line).toContain("1 without a label");

        expect.soft(sent.labels, "OrderLabels calls").toHaveLength(1);
        expect.soft(printed.asked.orderIds).toEqual(chosen);
        expect
          .soft(printed.answer.results)
          .toEqual(chosen.map((orderId) => (orderId === bare ? { orderId, reason: "ORDER_LABEL_REASON_NO_LABEL" } : { orderId, included: true })));
        await expect
          .soft(page.getByTestId(`print-receipts-result-left-out-${bare}`))
          .toHaveText(`Order #${bare} has no label attached yet — ask the seller to attach it`);
        await expect.soft(page.getByTestId("print-receipts-result-title")).toHaveText(`2 of 3 labels in the PDF`);
        await expect.soft(page.getByTestId(`print-receipts-label-${bare}`)).toHaveAttribute("data-label", "leftOut");
      });

      // Not a then of this given — the PDF holds the two labels, and the order left out keeps its step while the two
      // printed move (the-print-page-and-the-courier-count-prototype-is-accepted: "an order left out (no label) keeps its
      // step").
      const pdf = await pdfOf(page, printed.answer.url);
      if (pdf) expect.soft(pagesOf(pdf)).toBe(SHOPEE.pages * 2);
      const move = sent.moves[0];
      expect.soft([...((JSON.parse(move?.postData() ?? "{}") as { orderIds?: string[] }).orderIds ?? [])].sort()).toEqual([...labelled].sort());
      expect.soft(await statusOf(page, bare)).toBe(PENDING);
    });
  }
});

test.describe(`warehouse:all wants to print receipts (${GIVENS.noMove.cond})`, () => {
  for (const r of ROLES) {
    test(`${r.given} print receipt order`, async ({ page }) => {
      const sent = await enter(page, r);
      const term = termOf("noMove", r);
      const ids = ordersOf("noMove", r);

      // WHEN — both ticked, Cetak Resi; "Konfirmasi setelah dicetak" turned off, Print.
      const chosen = await openFromBulkBar(page, term, ids);
      await setSwitch(page, "print-receipts-status-change", "Confirm after printing", false);
      await expect(page.getByTestId("print-receipts-status-change-hint")).toHaveText("The labels print and every order keeps its step.");
      const printed = await print(page);

      await test.step("then: labels printed", async () => {
        await expectOneSession(page, sent, printed, chosen, SHOPEE.pages * 2);
      });

      await test.step("then: orders stay pending", async () => {
        expect.soft(sent.moves, "OrderStatusChange calls").toHaveLength(0);
        await expect.soft(page.getByTestId("print-receipts-result-moves")).toHaveText("Confirm after printing was off — every order keeps its step.");
        for (const id of chosen) {
          await expect.soft(page.getByTestId(`print-receipts-step-${id}`)).toHaveAttribute("data-status", STEP[PENDING]);
          expect.soft(await statusOf(page, id)).toBe(PENDING);
        }
        await expectOnTab(page, term, chosen, "toConfirm");
      });
    });
  }
});

test.describe(`warehouse:all wants to print receipts (${GIVENS.reprint.cond})`, () => {
  for (const r of ROLES) {
    test(`${r.given} print receipt order`, async ({ page }) => {
      const sent = await enter(page, r);
      const term = termOf("reprint", r);
      const [id] = ordersOf("reprint", r) as [string];
      expect(await statusOf(page, id)).toBe(PROCESSED);

      // WHEN — on Confirmed, the row's ⋯ Print Label: the print page with that one order; Print.
      await page.goto(`/warehouse-orders?step=confirm&q=${term}`);
      await expect(page.getByTestId("pick-tab-confirm")).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
      await page.getByTestId(`pick-queue-actions-${id}`).click();
      await page.getByTestId(`pick-queue-print-${id}`).click();
      await expect(page).toHaveURL(new RegExp(`/warehouse-orders/print\\?ids=${id}$`));
      await expect(page.getByTestId(`print-receipts-step-${id}`)).toHaveAttribute("data-status", STEP[PROCESSED]);
      await expect(page.getByTestId("print-receipts-status-change").locator('input[type="checkbox"]')).toBeChecked();
      const printed = await print(page);

      await test.step("then: label printed", async () => {
        await expectOneSession(page, sent, printed, [id], SHOPEE.pages);
      });

      await test.step("then: status unchanged", async () => {
        expect.soft(sent.moves, "OrderStatusChange calls").toHaveLength(0);
        await expect.soft(page.getByTestId("print-receipts-result-moves")).toHaveText("No order was waiting to be confirmed — every step stays.");
        await expect.soft(page.getByTestId(`print-receipts-step-${id}`)).toHaveAttribute("data-status", STEP[PROCESSED]);
        expect.soft(await statusOf(page, id)).toBe(PROCESSED);
        await expectOnTab(page, term, [id], "confirm");
      });
    });
  }
});

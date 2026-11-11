import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// SEVERAL LABELS PRINT AS ONE PDF (docs/technical/frontend/warehouse_order_list_decision.md
// #a-warehouse-prints-the-labels-of-orders-it-ships), END TO END on the real server:
//
//   · the SELLER uploads two real marketplace labels (a 2-page Lazada and a 1-page Shopee) and places three orders
//     from one warehouse — two with a label, one without;
//   · the WAREHOUSE's staff asks OrderLabels for all three at once: ONE link, to ONE merged PDF of 3 pages (2 + 1, in
//     the order asked), and a result per order — the one with no label reported as NO_LABEL;
//   · the merged file is the warehouse's own document (it reads it back), and the seller's labels were never shared;
//   · ANOTHER warehouse asking for the same orders gets none of them: NOT_SHIPPED_HERE each, and no link.
//
// The staff print the way the crew does, from the LIVE warehouse list (/warehouse-orders): tick the three rows, press the
// bulk bar's Print Labels — one OrderLabels with the ticked ids, in the list's order — and read the answer that minted
// the link (headless Chromium's popup never loads, so the response is what is asserted).
//
// A SELLING TEAM AND TWO WAREHOUSES OF ITS OWN, named to sort after orders.spec.ts and statement.spec.ts (they assert an
// empty start on the one shared database); the restock is paid from this team's own account, so root's team — whose
// totals financial_accounts.spec checks — is never touched.

const SUFFIX = Date.now().toString().slice(-6);
const SAMPLES = new URL("../../examples/receipt_file_samples/", import.meta.url);
const LAZADA = { name: "lazada_lex_03.pdf", pages: 2 };
const SHOPEE = { name: "shopee_reg_01.pdf", pages: 1 };
const STAFF = `e2elblstaff${SUFFIX}`;
const STAFF_PASSWORD = "e2e-labels-pass-1";

// Made in the setup, read by the tests after it — the file runs serially, in one worker.
const state = {
  seller: "",
  warehouse: "",
  otherWarehouse: "",
  // In the order the warehouse prints them: Lazada's label, the order with none, Shopee's label.
  withLazada: "",
  withoutLabel: "",
  withShopee: "",
};

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
}

// An RPC as the signed-in person — the status and the JSON body.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body] as const,
  );
}

// A seed call that must succeed — its JSON body.
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// The seller's real two-phase upload of one label: RequestUpload, the PUT of the bytes, ConfirmUpload.
async function uploadLabel(page: Page, teamId: string, name: string): Promise<string> {
  const content = readFileSync(new URL(name, SAMPLES));

  const up = await ok(page, "document.v1.DocumentService/RequestUpload", {
    teamId,
    resourceType: "DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT",
    contentType: "application/pdf",
    sizeBytes: content.length,
    filename: name,
  });

  const put = await page.request.fetch(up.uploadUrl, { method: up.method, headers: up.headers, data: content });
  expect(put.status(), `PUT ${name}`).toBe(200);

  const confirmed = await ok(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: up.uploadToken });

  return confirmed.document.id;
}

// A page dictionary's type entry — /Type /Page, never /Pages. The merged PDF is written without object streams
// (san_pdf_merge), so every page dictionary is readable text and the pages can be counted without a PDF library.
function pagesOf(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^a-zA-Z]/g) ?? []).length;
}

test.describe.configure({ mode: "serial" });

test("setup: a seller, its warehouse with stock, two uploaded labels, three orders", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  state.seller = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Label Seller ${SUFFIX}`,
      teamCode: `LS${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  const shop = (
    await ok(page, "selling.v1.ShopService/ShopCreate", {
      teamId: state.seller,
      name: `E2E Label Shop ${SUFFIX}`,
      shopCode: `LSS${SUFFIX}`,
      marketplace: "MARKETPLACE_SHOPEE",
    })
  ).shop.id;
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: state.seller, shopId: shop, userId: ROOT_USER_ID });

  for (const [key, code] of [
    ["warehouse", `LW${SUFFIX}`],
    ["otherWarehouse", `LO${SUFFIX}`],
  ] as const) {
    state[key] = (
      await ok(page, "team.v1.TeamService/TeamCreate", {
        name: `E2E Label WH ${code}`,
        teamCode: code,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id;
  }

  // STOCK FOR THREE ORDERS in the warehouse: a rack, a product, a restock accepted onto the rack (paid from an
  // OPERATIONAL account of the seller's own), and the warehouse's rate.
  const rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: `lbl-a-${SUFFIX}` }))
    .rack.id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Label ${SUFFIX}` })).category
    .id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `LB${SUFFIX}`,
      name: "Kaos Label",
      categoryId: category,
    })
  ).product;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E label restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-LBL-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account,
    operational: true,
  });
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: state.seller,
    warehouseId: state.warehouse,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Label", count: 3, total: 30000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 3, placements: [{ placementId: rack, quantity: 3 }] }],
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: state.warehouse, feePercent: 1, minFee: 0 });
  // The seller's return warehouse — order create refuses a team that has none (create-refuses-a-team-with-no-return-warehouse).
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: state.seller,
    warehouseId: state.warehouse,
  });

  // The person who prints: a STAFF member of the warehouse, with that one role.
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.warehouse,
    username: STAFF,
    password: STAFF_PASSWORD,
    name: STAFF,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  // THE SELLER'S LABELS, uploaded under the seller's team — and three orders, two of them carrying one.
  const lazada = await uploadLabel(page, state.seller, LAZADA.name);
  const shopee = await uploadLabel(page, state.seller, SHOPEE.name);

  for (const [key, label] of [
    ["withLazada", { documentId: lazada, filename: LAZADA.name }],
    ["withoutLabel", undefined],
    ["withShopee", { documentId: shopee, filename: SHOPEE.name }],
  ] as const) {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-labels-${key}-${SUFFIX}`,
      // Every order names its courier (no-order-without-a-courier).
      shipmentChannelId: "1",
      teamId: state.seller,
      shopId: shop,
      warehouseId: state.warehouse,
      customerName: `E2E Label Buyer ${key}`,
      platformTotal: 15000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `LBL${key}${SUFFIX}`,
      items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Label", quantity: 1 }],
      ...(label ? { receipt: { ...label, mimeType: "application/pdf" } } : {}),
    });
    state[key] = placed.order.id;
  }
});

test("Print: the warehouse's staff prints the three together — one PDF of 3 pages, the order with no label reported", async ({
  page,
}) => {
  await login(page, STAFF, STAFF_PASSWORD);

  // The staff's one team is the warehouse; the list's All tab holds the three orders, newest first.
  await page.goto("/warehouse-orders?step=all");
  const ticked = [state.withShopee, state.withoutLabel, state.withLazada];
  for (const id of ticked) {
    await expect(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
    await page.getByTestId(`pick-queue-select-${id}`).click();
  }
  await expect(page.getByTestId("pick-queue-bulk-count")).toHaveText("3 selected");

  const answered = page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderLabels"));
  await page.getByTestId("pick-queue-bulk-print").click();
  const response = await answered;
  expect(response.status()).toBe(200);

  const asked = JSON.parse(response.request().postData() ?? "{}") as { teamId: string; orderIds: string[] };
  const labels = (await response.json()) as {
    url: string;
    expiresAtUnix: string;
    results: { orderId: string; included?: boolean; reason?: string }[];
  };

  // ONE call for the three, as the warehouse, in the list's order.
  expect(asked).toEqual({ teamId: state.warehouse, orderIds: ticked });

  // A result per order, in the asked order: two in, the one with no label said so — and the screen says it too.
  expect(labels.results).toEqual([
    { orderId: state.withShopee, included: true },
    { orderId: state.withoutLabel, reason: "ORDER_LABEL_REASON_NO_LABEL" },
    { orderId: state.withLazada, included: true },
  ]);
  await expect(page.getByText("1 label is not in the PDF").first()).toBeVisible();

  // ONE link, expiring, to the merged file — its own name, not either label's.
  expect(labels.url).toMatch(/labels-\d{4}-\d{2}-\d{2}-\d{6}\.pdf/);
  expect(Number(labels.expiresAtUnix)).toBeGreaterThan(Date.now() / 1000);

  const file = await page.request.get(labels.url);
  expect(file.status()).toBe(200);
  const pdf = await file.body();
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // THE PAGE COUNT IS THE SUM OF THE LABELS' PAGES: Lazada's 2 and Shopee's 1.
  expect(pagesOf(pdf)).toBe(LAZADA.pages + SHOPEE.pages);

  // The merged file is the WAREHOUSE's own document — it reads it back through the ordinary door…
  const merged = labels.url.match(/\/teams\/(\d+)\/([0-9a-f]+)\.pdf/);
  expect(merged?.[1]).toBe(state.warehouse);
  const own = await call(page, "document.v1.DocumentService/GetDownloadUrl", { teamId: state.warehouse, documentId: merged![2] });
  expect(own.status).toBe(200);

  // …while the labels are still the seller's: as their "owner" the warehouse reads NotFound — the print shared nothing.
  const detail = await ok(page, "selling.v1.OrderService/OrderDetail", { teamId: state.warehouse, orderId: state.withLazada });
  const asOwner = await call(page, "document.v1.DocumentService/GetDownloadUrl", {
    teamId: state.warehouse,
    documentId: detail.order.receipt.documentId,
  });
  expect(asOwner.status).toBe(404);
});

test("Print: another warehouse asking for the same orders gets none of them", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const asked = [state.withLazada, state.withoutLabel, state.withShopee];
  const labels = await ok<{ url?: string; results: { orderId: string; included?: boolean; reason?: string }[] }>(
    page,
    "selling.v1.OrderService/OrderLabels",
    { teamId: state.otherWarehouse, orderIds: asked },
  );

  expect(labels.url ?? "").toBe("");
  expect(labels.results).toEqual(asked.map((orderId) => ({ orderId, reason: "ORDER_LABEL_REASON_NOT_SHIPPED_HERE" })));
});

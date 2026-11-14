import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { openShops } from "./pickers";

// A SHOP IS CLOSED, NEVER DELETED — end to end, on the real server (docs/business/shop/context_decision.md):
//
//   a-shop-is-closed-never-deleted          Close on /shops confirms; the shop leaves the open list; Reopen gives it back
//   a-closed-shop-refuses-only-new-selling  closed, the order form never offers it and an order sent to the API is
//                                           refused "the shop is closed" — while its statement still imports
//   the-close-shop-prototype-is-accepted    the import dialog offers the closed shop after the open ones, badged
//   report-filters-offer-closed-shops       the Orders shop filter still offers the closed shop, after the open one,
//                                           badged — and picking it shows the orders it took while open
//
// A SELLING TEAM OF ITS OWN (Root as its owner) with two Shopee shops, and a warehouse of its own holding the stock for
// one order on each shop, placed in the setup — named to sort after orders.spec.ts and statement.spec.ts, which assert
// an empty start on one shared database. The statement it imports is settlement_imports.spec's synthetic fixture,
// posted to this team's own shop, and the restock is paid from this team's own account, so root's team — whose totals
// financial_accounts.spec checks — is never touched.

const SUFFIX = Date.now().toString().slice(-6);
const TEAM_NAME = `E2E Close Team ${SUFFIX}`;
const TEAM_CODE = `CT${SUFFIX}`.slice(0, 10);
const SHOP_OPEN = `E2E Open Shop ${SUFFIX}`;
const SHOP_CLOSING = `E2E Closing Shop ${SUFFIX}`;
const CODE_OPEN = `CO${SUFFIX}`;
const CODE_CLOSING = `CC${SUFFIX}`;
const STATEMENT = readFileSync(new URL("./fixtures/shopee_statement.xlsx", import.meta.url));

// Made in the setup, read by the tests after it — the file runs serially, in one worker.
let teamId = "";
let shopOpen = "";
let shopClosing = "";
// One order on each shop, placed while both were open.
let orderOnOpen = "";
let orderOnClosing = "";

async function login(page: Page) {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
}

// An RPC as the signed-in person — the status and the JSON body, so a refusal can be asserted as well as a success.
async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: res.status, body: await res.json() };
    },
    [method, body, API_URL] as const,
  );
}

// A seed call that must succeed — its JSON body.
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// Root is in many teams — pick this spec's.
async function useTeam(page: Page) {
  await page.getByTestId("team-switcher").click();
  await page.getByTestId("team-search-mine").click();
  await page.getByTestId("team-search").fill(TEAM_NAME);
  await page.getByTestId(/^team-option-/).first().click();
  await expect(page.getByTestId("team-switcher")).toContainText(TEAM_NAME);
}

// The order form's shop picker, opened: which of this team's two shops it offers.
async function orderFormOffers(page: Page) {
  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await openShops(page);
  await expect(page.getByTestId(`shop-select-option-${shopOpen}`)).toBeVisible();

  return {
    open: await page.getByTestId(`shop-select-option-${shopOpen}`).count(),
    closing: await page.getByTestId(`shop-select-option-${shopClosing}`).count(),
  };
}

test.describe.configure({ mode: "serial" });

test("setup: a selling team of its own, two Shopee shops, Root granted the one to close", async ({ page }) => {
  await login(page);

  const team = await call(page, "team.v1.TeamService/TeamCreate", {
    name: TEAM_NAME,
    teamCode: TEAM_CODE,
    type: "TEAM_TYPE_SELLING",
    ownerUserId: ROOT_USER_ID,
  });
  expect(team.status).toBe(200);
  teamId = team.body.team.id;

  for (const [name, code] of [
    [SHOP_OPEN, CODE_OPEN],
    [SHOP_CLOSING, CODE_CLOSING],
  ] as const) {
    const shop = await call(page, "selling.v1.ShopService/ShopCreate", {
      teamId,
      name,
      shopCode: code,
      marketplace: "MARKETPLACE_SHOPEE",
    });
    expect(shop.status).toBe(200);
    expect(shop.body.shop.status).toBe("SHOP_STATUS_OPEN");
    if (name === SHOP_OPEN) shopOpen = shop.body.shop.id;
    else shopClosing = shop.body.shop.id;
  }

  // The first grant becomes the primary CS — a statement imports only for a shop with one.
  const granted = await call(page, "selling.v1.ShopService/ShopUserAdd", {
    teamId,
    shopId: shopClosing,
    userId: ROOT_USER_ID,
  });
  expect(granted.status).toBe(200);

  // STOCK FOR TWO ORDERS, in a warehouse of its own: a rack, a product, a restock accepted onto the rack (paid from an
  // OPERATIONAL account of this team — a-restock-names-its-paying-account), and the warehouse's rate
  // (a-warehouse-with-no-rate-takes-no-orders).
  const wh = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Close WH ${SUFFIX}`,
      teamCode: `CW${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  const rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: wh, code: `ccl-a-${SUFFIX}` })).rack.id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Close Sale ${SUFFIX}` }))
    .category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId,
      productCodePart: `CL${SUFFIX}`,
      name: "Kaos Tutup",
      categoryId: category,
    })
  ).product;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E close restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-CLS-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId,
    accountId: account,
    operational: true,
  });
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId,
    warehouseId: wh,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Tutup", count: 2, total: 20000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: wh,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 2, placements: [{ placementId: rack, quantity: 2 }] }],
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wh, feePercent: 1, minFee: 0 });
  // The seller's return warehouse — order create refuses a team that has none (create-refuses-a-team-with-no-return-warehouse).
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", { teamId, warehouseId: wh });

  // ONE ORDER ON EACH SHOP, while both are open.
  for (const [shopId, ref] of [
    [shopOpen, "OPEN"],
    [shopClosing, "SHUT"],
  ] as const) {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-close-${ref}-${SUFFIX}`,
      // Every order names its courier (no-order-without-a-courier) — a shipment channel id, opaque to the order.
      shipmentChannelId: "1",
      teamId,
      shopId,
      warehouseId: wh,
      customerName: `E2E Close Buyer ${ref}`,
      platformTotal: 15000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `CL${ref}${SUFFIX}`,
      items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Tutup", quantity: 1 }],
    });
    if (shopId === shopOpen) orderOnOpen = placed.order.id;
    else orderOnClosing = placed.order.id;
  }
});

test("Open, the order form offers both shops", async ({ page }) => {
  await login(page);
  await useTeam(page);

  expect(await orderFormOffers(page)).toEqual({ open: 1, closing: 1 });
});

test("Close on /shops: it confirms, the shop leaves the open list and the order form", async ({ page }) => {
  await login(page);
  await useTeam(page);

  await page.goto("/shops");
  await expect(page.getByTestId(`shop-row-${CODE_CLOSING}`)).toBeVisible();
  await page.getByTestId(`close-${CODE_CLOSING}`).click();
  await expect(page.getByTestId("close-shop-explained")).toBeVisible();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId(`shop-row-${CODE_CLOSING}`)).toBeHidden();
  await expect(page.getByTestId(`shop-row-${CODE_OPEN}`)).toBeVisible();

  expect(await orderFormOffers(page)).toEqual({ open: 1, closing: 0 });

  // Sent straight to the API, an order on it is refused — even from the team's owner.
  const refused = await call(page, "selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-closed-${SUFFIX}`,
    // Every order names its courier (no-order-without-a-courier) — a shipment channel id, opaque to the order.
    shipmentChannelId: "1",
    teamId,
    shopId: shopClosing,
    warehouseId: "999999",
    customerName: "E2E Closed Buyer",
    platformTotal: 15000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `CLOSED${SUFFIX}`,
    items: [{ productId: "999999", productCode: "CLOSED-1", name: "Closed", quantity: 1 }],
  });
  expect(refused.body.code).toBe("failed_precondition");
  expect(refused.body.message).toContain("the shop is closed");

  // An edit is refused too — a closed shop is locked but for its grants (a-closed-shop-locks-all-but-its-grants).
  const edit = await call(page, "selling.v1.ShopService/ShopUpdate", { teamId, shopId: shopClosing, name: "Renamed" });
  expect(edit.body.code).toBe("failed_precondition");
  expect(edit.body.message).toContain("reopen the shop first");
});

test("Closed, the Orders filter still offers it after the open shop, badged — and shows its orders", async ({ page }) => {
  await login(page);
  await useTeam(page);

  await page.goto("/orders");
  await expect(page.getByTestId(`order-row-${orderOnOpen}`)).toBeVisible();
  await expect(page.getByTestId(`order-row-${orderOnClosing}`)).toBeVisible();

  const filter = page.getByTestId("orders-shop-filter");
  await openShops(filter);
  const closed = filter.getByTestId(`shop-select-option-${shopClosing}`);
  await expect(closed).toBeVisible();
  await expect(closed).toContainText(SHOP_CLOSING);
  await expect(closed.getByTestId(`shop-select-closed-${shopClosing}`)).toBeVisible();
  const listed = await filter.getByRole("option").evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  expect(listed).toContain(`shop-select-option-${shopOpen}`);
  expect(listed.indexOf(`shop-select-option-${shopClosing}`)).toBeGreaterThan(listed.indexOf(`shop-select-option-${shopOpen}`));
  await closed.click();

  // Narrowed server-side to the closed shop's order — and the field says the shop is closed.
  await expect(page).toHaveURL(new RegExp(`[?&]shop=${shopClosing}(&|$)`));
  await expect(page.getByTestId(`order-row-${orderOnOpen}`)).toHaveCount(0);
  await expect(page.getByTestId(`order-row-${orderOnClosing}`)).toBeVisible();
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(1);
  await expect(filter.getByTestId("shop-select")).toHaveValue(SHOP_CLOSING);
  await expect(filter.getByTestId("shop-select-value-closed")).toBeVisible();
});

test("Closed, its statement still imports — the dialog offers it after the open shop, badged", async ({ page }) => {
  await login(page);
  await useTeam(page);

  await page.goto("/settlement/imports");
  await page.getByTestId("open-import-file").click();
  const dialog = page.getByTestId("import-dialog");
  await expect(dialog).toBeVisible();

  await openShops(dialog);
  const closed = dialog.getByTestId(`shop-select-option-${shopClosing}`);
  await expect(closed).toBeVisible();
  await expect(closed.getByTestId(`shop-select-closed-${shopClosing}`)).toBeVisible();
  const order = await dialog.getByRole("option").evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  expect(order.indexOf(`shop-select-option-${shopClosing}`)).toBeGreaterThan(order.indexOf(`shop-select-option-${shopOpen}`));
  await closed.click();
  await expect(dialog.getByTestId("import-closed-shop")).toBeVisible();

  await dialog.getByTestId("import-file-input").setInputFiles({
    name: "statement.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: STATEMENT,
  });
  await expect(dialog.getByTestId("import-file-name")).toContainText("statement.xlsx");
  await dialog.getByTestId("start-import").click();

  // The importer took the closed shop: the file was stored and read to its end.
  await expect(dialog.getByTestId("import-progress-text")).toHaveText("5 of 5 rows", { timeout: 30_000 });
  await expect(dialog.getByTestId("import-failed-reason")).toHaveCount(0);
  await dialog.getByTestId("open-imported-file").click();
  await expect(page.getByTestId("import-detail-shop")).toContainText(SHOP_CLOSING);
});

test("Reopen from Closed: the shop is open again and the order form offers it", async ({ page }) => {
  await login(page);
  await useTeam(page);

  await page.goto("/shops?status=closed");
  await expect(page.getByTestId(`shop-closed-${CODE_CLOSING}`)).toBeVisible();
  await expect(page.getByTestId(`shop-row-${CODE_OPEN}`)).toHaveCount(0);
  await page.getByTestId(`reopen-${CODE_CLOSING}`).click();
  await expect(page.getByTestId("shops-none-closed")).toBeVisible();

  expect(await orderFormOffers(page)).toEqual({ open: 1, closing: 1 });
});

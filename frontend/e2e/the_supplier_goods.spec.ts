import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// A SUPPLIER'S FIGURES ARE REAL (InventoryService.SupplierGoods), END TO END — the supplier list's Terjual and Siap
// (`sales-are-all-time-with-their-last-dates`), a store's on the Toko tab (`the-detail-tabs-show-sold-and-ready`) and
// Gudang terkait's summary (`the-summary-is-sold-and-ready-with-their-counts`). A selling team of its own restocks 5
// units from its supplier's store; the figures read 0 sold · 5 ready; an order takes 2 and they read 2 · 3, with the
// order's day under Terjual; the order is cancelled and inventory's listener puts the 2 back, so they read 0 · 5 again.
//
// PENJUALAN (`penjualan-is-the-selling-value-on-the-order-day`) rides the same order: supplier_service's sales fold reads
// OrderPlaced, so the Statistik tab and the Supplier Report read 2 units for the order's Rp 100.000 on today's row, and
// after the cancel (same day) today nets back to 0. THE RANGE PILLS (`the-range-pills-are-a-fixed-set`) narrow the list
// on the server: 2 sold is in Terjual < 500, out of 500–1.000.
//
// ⚠ NAMED TO SORT AFTER orders.spec.ts AND statement.spec.ts: the suite shares one database, orders.spec counts the
// orders root can read, and this places one. Its money moves in its OWN team, so root's team totals are untouched.

const SUFFIX = Date.now().toString().slice(-6);
const UNIT_COST = 10_000;

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

// The real contract under the signed-in token; a refusal fails here, by name.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body] as const,
  ) as Promise<T>;
}

async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

const state = {
  seller: "",
  warehouse: "",
  whCode: `SGW${SUFFIX}`.slice(0, 10),
  whName: `E2E Goods Warehouse ${SUFFIX}`,
  shopName: `E2E Goods Shop ${SUFFIX}`,
  supplier: "",
  store: "",
  productCode: "",
  order: "",
};

// The supplier's row on the list: its Terjual and Siap cells.
async function expectListFigures(page: Page, sold: RegExp, ready: RegExp) {
  await page.goto("/inventories/suppliers");
  await expect(page.getByTestId(`supplier-sold-${state.supplier}`)).toHaveText(sold);
  await expect(page.getByTestId(`supplier-ready-${state.supplier}`)).toHaveText(ready);
}

test.describe.configure({ mode: "serial" });

test("Supplier goods: a seller restocks 5 units from its supplier's store", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (code: string, name: string, type: string) =>
    (await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: ROOT_USER_ID }))
      .team.id;
  state.warehouse = await team(state.whCode, state.whName, "TEAM_TYPE_WAREHOUSE");
  state.seller = await team(`SGS${SUFFIX}`.slice(0, 10), `E2E Goods Seller ${SUFFIX}`, "TEAM_TYPE_SELLING");

  const rack = await rpc<{ rack: { id: string } }>(page, "inventory.v1.RackService/RackCreate", {
    teamId: state.warehouse,
    code: "e2e-goods",
    name: "e2e-goods",
  });
  const category = await rpc<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", {
    name: `E2E Goods ${SUFFIX}`,
  });
  const product = await rpc<{ product: { id: string; productCode: string } }>(page, "product.v1.ProductService/ProductCreate", {
    teamId: state.seller,
    productCodePart: `SGP${SUFFIX}`,
    name: "Kain Katun",
    categoryId: category.category.id,
  });
  state.productCode = product.product.productCode;

  const supplier = await rpc<{ supplier: { id: string } }>(page, "supplier.v1.SupplierService/SupplierCreate", {
    teamId: state.seller,
    name: `E2E Sumber Goods ${SUFFIX}`,
  });
  state.supplier = supplier.supplier.id;
  const store = await rpc<{ channel: { id: string } }>(page, "supplier.v1.SupplierChannelService/SupplierChannelCreate", {
    teamId: state.seller,
    supplierId: state.supplier,
    channelType: "MARKETPLACE_SHOPEE",
    name: `Sumber Goods Official ${SUFFIX}`,
  });
  state.store = store.channel.id;

  // Restocks name an OPERATIONAL paying account (a-restock-names-its-paying-account), opened at the restock's price.
  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: state.seller,
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E goods ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-SG-${SUFFIX}`,
    openingBalance: 5 * UNIT_COST,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account.account.id,
    operational: true,
  });

  // The line names the supplier AND its store, so the batch keeps both (a-batch-keeps-its-supplier).
  const restock = await rpc<{ request: { id: string; items: { id: string; count: string }[] } }>(
    page,
    "inventory.v1.RestockRequestService/RestockRequestCreate",
    {
      teamId: state.seller,
      warehouseId: state.warehouse,
      financeAccountId: account.account.id,
      items: [
        {
          productId: product.product.id,
          productCode: product.product.productCode,
          name: "Kain Katun",
          count: 5,
          total: 5 * UNIT_COST,
          supplierId: state.supplier,
          supplierChannelId: state.store,
        },
      ],
    },
  );
  await rpc(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: restock.request.items.map((item) => ({
      itemId: item.id,
      receivedCount: item.count,
      placements: [{ placementId: rack.rack.id, quantity: item.count }],
    })),
  });

  await rpc(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: state.warehouse, feePercent: 2.5, minFee: 0 });
  // The seller's return warehouse — order create refuses a team that has none (create-refuses-a-team-with-no-return-warehouse).
  await rpc(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: state.seller,
    warehouseId: state.warehouse,
  });
  const shop = await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
    teamId: state.seller,
    name: state.shopName,
    shopCode: `SGH${SUFFIX}`,
    marketplace: "MARKETPLACE_SHOPEE",
  });
  await rpc(page, "selling.v1.ShopService/ShopUserAdd", { teamId: state.seller, shopId: shop.shop.id, userId: ROOT_USER_ID });
});

test("Supplier goods: before any order the list reads 0 sold and 5 ready, restocked today", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  await expectListFigures(page, /^0$/, /^5restocked \w+ \d+, \d{4}$/);
});

test("Supplier goods: an order takes 2 — the list, the store and Gudang terkait read 2 sold and 3 ready", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await page.getByTestId("order-create-customer-name").fill(`E2E Goods ${SUFFIX}`);
  await page.getByTestId("shop-select").click();
  await page.getByRole("option").filter({ hasText: state.shopName }).click();
  await page.getByTestId("order-warehouse").locator("input").fill(state.whCode);
  await page.getByTestId(`team-select-option-${state.whCode}`).click();

  await page.getByTestId("order-create-add-line").click();
  await page.getByTestId("product-picker-search").fill(state.productCode);
  const row = page
    .getByTestId("product-picker-list")
    .locator('[data-testid^="product-picker-option-"]')
    .filter({ hasText: state.productCode });
  await expect(row).toHaveCount(1);
  await row.locator('[data-part="control"]').click();
  await page.getByTestId("product-picker-confirm").click();
  await page.getByTestId("order-line-qty-0").fill("2");

  await page.getByTestId("order-marketplace-total").fill("100000");
  await page.getByTestId("order-external-ref-id").fill(`SG-${SUFFIX}`);
  await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
  await page.getByTestId("shipment-channel-option-jne").click();

  await page.getByTestId("order-create-order-date").click();
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await page
    .getByTestId("order-create-order-date-content")
    .locator(`[data-part="table-cell-trigger"][data-value="${today}"]`)
    .click();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("order-create-save")).toBeEnabled();
  await page.getByTestId("order-create-save").click();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  state.order = /\/orders\/(\d+)$/.exec(page.url())![1]!;

  // The take is in the order's own placement, so the figures move at once.
  await expectListFigures(page, /^2ordered \w+ \d+, \d{4}$/, /^3restocked \w+ \d+, \d{4}$/);

  await page.getByTestId(`supplier-row-${state.supplier}`).click();
  await expect(page.getByTestId(`channel-sold-${state.store}`)).toHaveText(/^2ordered /);
  await expect(page.getByTestId(`channel-ready-${state.store}`)).toHaveText(/^3restocked /);

  const warehouses = page.getByTestId("supplier-warehouses");
  await expect(warehouses.getByTestId("supplier-warehouses-chips")).toContainText(state.whName);
  await expect(warehouses.getByTestId("supplier-warehouse-summary-sold")).toContainText("2 units");
  await expect(warehouses.getByTestId("supplier-warehouse-summary-sold")).toContainText(/from 1 order/);
  await expect(warehouses.getByTestId("supplier-warehouse-summary-ready")).toContainText("3 units");
  await expect(warehouses.getByTestId("supplier-warehouse-summary-ready")).toContainText(/1 restock/);
});

// The supplier page's Statistik tab: the window's Penjualan card.
async function expectStatisticsSales(page: Page, value: RegExp, units: RegExp) {
  await page.goto(`/inventories/suppliers/${state.supplier}`);
  await page.getByTestId("supplier-tab-statistics").click();
  await expect(page.getByTestId("statistics-summary-sales-value")).toHaveText(value, { timeout: 3000 });
  await expect(page.getByTestId("statistics-summary-sales-units")).toHaveText(units, { timeout: 3000 });
}

test("Supplier goods: Penjualan reads the order's selling value on its day — the Statistik tab and the Supplier Report", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  // Folded from OrderPlaced by supplier_service — so polled. The order's one line sold 2 for its Rp 100.000.
  await expect(async () => {
    await expectStatisticsSales(page, /^Rp\s?100\.000$/, /^2 units$/);
  }).toPass({ timeout: 45_000 });

  // Right after Direstok, as a column too: today's row reads 2 over Rp 100.000.
  const headers = await page.getByTestId("statistics-series").getByRole("columnheader").allTextContents();
  expect(headers[headers.indexOf("Restocked") + 1]).toBe("Sales");

  // The Supplier Report, searched to this supplier: its row and the headline read the same sale.
  await page.goto(`/inventories/suppliers/report?q=${encodeURIComponent(`E2E Sumber Goods ${SUFFIX}`)}`);
  const row = page.getByTestId(`supplier-report-row-${state.supplier}`);
  await expect(row.getByTestId("figure-sales")).toHaveText(/^2Rp\s?100\.000$/);
  await expect(page.getByTestId("supplier-report-summary-sales-value")).toHaveText(/^Rp\s?100\.000$/);
});

test("Supplier goods: the Terjual band narrows the list on the server", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  // 2 sold: inside < 500 (lower-inclusive from 0), outside 500–1.000.
  await page.goto("/inventories/suppliers?sold=0-500");
  await expect(page.getByTestId(`supplier-row-${state.supplier}`)).toBeVisible();
  await expect(page.getByTestId("supplier-range-sold-trigger")).toHaveText(/Sold: < 500/);

  await page.goto("/inventories/suppliers?sold=500-1000");
  await expect(page.getByTestId("suppliers-none-match")).toBeVisible();
  await expect(page.getByTestId(`supplier-row-${state.supplier}`)).toHaveCount(0);

  // Siap 3 is in < 50.
  await page.goto("/inventories/suppliers?ready=0-50");
  await expect(page.getByTestId(`supplier-row-${state.supplier}`)).toBeVisible();
});

test("Supplier goods: the order cancelled, its 2 units are counted back", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  await rpc(page, "selling.v1.OrderService/OrderCancel", { teamId: state.seller, orderId: state.order });

  // Inventory's OrderCancelled listener releases the take — so polled.
  await expect(async () => {
    await page.goto("/inventories/suppliers");
    await expect(page.getByTestId(`supplier-sold-${state.supplier}`)).toHaveText(/^0$/, { timeout: 3000 });
    await expect(page.getByTestId(`supplier-ready-${state.supplier}`)).toHaveText(/^5restocked /, { timeout: 3000 });
  }).toPass({ timeout: 45_000 });

  // Penjualan takes it back on the cancel's own day — today, the same day it was placed — so the window nets to 0.
  await expect(async () => {
    await expectStatisticsSales(page, /^Rp\s?0$/, /^0 units$/);
  }).toPass({ timeout: 45_000 });
});

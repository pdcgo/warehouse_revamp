import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { openShops, pickTeam } from "./pickers";

// A SUPPLIER'S FIGURES ARE REAL (InventoryService.SupplierGoods), END TO END — the supplier list's Terjual and Siap
// (`sales-are-all-time-with-their-last-dates`), a store's on the Toko tab (`the-detail-tabs-show-sold-and-ready`) and
// Gudang terkait's summary (`the-summary-is-sold-and-ready-with-their-counts`). A selling team of its own restocks 5
// units from its supplier's store; the figures read 0 sold · 5 ready; an order takes 2 and they read 2 · 3, with the
// order's day under Terjual; the order is cancelled and inventory's listener puts the 2 back, so they read 0 · 5 again.
//
// PENJUALAN (`penjualan-is-the-selling-value-on-the-order-day`) rides the same order: supplier_service's sales fold reads
// OrderPlaced, so the Statistik tab and the Supplier Report read 2 units for the order's Rp 100.000 on today's row, and
// after the cancel (same day) today nets back to 0. THE RANGE PILLS (`the-range-pills-are-a-fixed-set`) narrow the list
// on the server: 2 sold is in Terjual < 500, out of 500–1.000. THE GUDANG FILTER (`the-warehouse-filters-before-the-team`)
// keeps the supplier under the warehouse its restock was received at, and not under a second, empty warehouse — on the
// supplier list and on Discover — with its figures whole (`the-warehouse-filter-narrows-only-the-rows`).
//
// THE PRODUK TAB (`a-supplier-product-row-says-whose-where-and-when`, `the-detail-tabs-show-sold-and-ready`): the accepted
// restock linked the product to the store it was bought at (`restock-accepted-links-the-product-to-its-channel`), so the
// supplier's Produk tab lists it — its team, that store, 2 sold with the order's day and 3 ready after the order; 5 ready
// again after the cancel.
//
// THE GUDANG TERKAIT CHIP (`a-supplier-page-is-scoped-by-its-warehouses`), last: a second product, bought at a second
// store, is restocked into warehouse B — the supplier page under B's chip (`?warehouse=`) lists only that store and that
// product, hiding what was received at A; A's chip the reverse; All both. STATISTIK follows the chip too
// (`the-supplier-reports-carry-the-warehouse`): under B's chip it reads B's restock alone — 4 Benang for Rp 40.000 — and
// leaves out the 5 Kain received at A; A's chip the reverse; All the sum, Rp 90.000.
//
// ⚠ NAMED TO SORT AFTER orders.spec.ts AND statement.spec.ts: the suite shares one database, orders.spec counts the
// orders root can read, and this places one. Its money moves in its OWN team, so root's team totals are untouched.

const SUFFIX = Date.now().toString().slice(-6);
const UNIT_COST = 10_000;

async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);
}

// The real contract under the signed-in token; a refusal fails here, by name.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
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
  // A second warehouse, not restocked into until the last test — the Gudang filter's "not here", then the chip's B.
  warehouseB: "",
  whBCode: `SGB${SUFFIX}`.slice(0, 10),
  whBName: `E2E Goods Other Warehouse ${SUFFIX}`,
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
  state.warehouseB = await team(state.whBCode, state.whBName, "TEAM_TYPE_WAREHOUSE");
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
  await openShops(page);
  await page.getByRole("option").filter({ hasText: state.shopName }).click();
  await pickTeam(page, page.getByTestId("order-warehouse"), state.whCode);

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

// The supplier's Produk tab: its one product — the link the accepted restock's fold wrote, so polled.
async function expectProductFigures(page: Page, sold: RegExp, ready: RegExp) {
  const row = page.getByTestId("products-table").locator("tbody tr");

  await expect(async () => {
    await page.goto(`/inventories/suppliers/${state.supplier}`);
    await page.getByTestId("supplier-tab-products").click();
    await expect(row).toHaveCount(1, { timeout: 3000 });
  }).toPass({ timeout: 45_000 });

  const id = (await row.getAttribute("data-testid"))!.replace("product-row-", "");
  await expect(row).toContainText("Kain Katun");
  await expect(row).toContainText(state.productCode);
  await expect(row).toContainText(`E2E Goods Seller ${SUFFIX}`);
  await expect(page.getByTestId(`product-row-${id}-store`)).toContainText(`Sumber Goods Official ${SUFFIX}`);
  await expect(page.getByTestId(`product-row-${id}-store`)).toContainText("Shopee");
  await expect(page.getByTestId(`product-sold-${id}`)).toHaveText(sold);
  await expect(page.getByTestId(`product-ready-${id}`)).toHaveText(ready);
}

test("Supplier goods: the Produk tab lists the restocked product at its store — 2 sold, 3 ready", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  await expectProductFigures(page, /^2ordered \w+ \d+, \d{4}$/, /^3$/);
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

test("Supplier goods: the Gudang filter keeps the supplier under the warehouse it was received at, not another", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  // Picked on the list: the restock went into warehouse A, so the supplier stays — its figures whole, 2 sold · 3 ready.
  await page.goto("/inventories/suppliers");
  await expect(page.getByTestId(`supplier-row-${state.supplier}`)).toBeVisible();
  await pickTeam(page, page.getByTestId("supplier-warehouse-filter"), state.whCode);
  await expect(page).toHaveURL(new RegExp(`[?&]warehouse=${state.warehouse}(&|$)`));
  await expect(page.getByTestId(`supplier-row-${state.supplier}`)).toBeVisible();
  await expect(page.getByTestId(`supplier-sold-${state.supplier}`)).toHaveText(/^2ordered /);
  await expect(page.getByTestId(`supplier-ready-${state.supplier}`)).toHaveText(/^3restocked /);

  // Warehouse B never received its goods: nothing matches — and the URL keeps the pick.
  await page.goto(`/inventories/suppliers?warehouse=${state.warehouseB}`);
  await expect(page.getByTestId("suppliers-none-match")).toBeVisible();
  await expect(page.getByTestId(`supplier-row-${state.supplier}`)).toHaveCount(0);

  // Discover, every team's suppliers, searched to this one: under A, not under B.
  const named = encodeURIComponent(`E2E Sumber Goods ${SUFFIX}`);
  await page.goto(`/inventories/suppliers/discover?q=${named}&warehouse=${state.warehouse}`);
  await expect(page.getByTestId(`discover-supplier-row-${state.supplier}`)).toBeVisible();
  await page.goto(`/inventories/suppliers/discover?q=${named}&warehouse=${state.warehouseB}`);
  await expect(page.getByTestId("discover-suppliers-none-match")).toBeVisible();
  await expect(page.getByTestId(`discover-supplier-row-${state.supplier}`)).toHaveCount(0);
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

  // The product's row nets the order out with it: 0 sold, no order day, 5 ready.
  await expectProductFigures(page, /^0$/, /^5$/);

  // Penjualan takes it back on the cancel's own day — today, the same day it was placed — so the window nets to 0.
  await expect(async () => {
    await expectStatisticsSales(page, /^Rp\s?0$/, /^0 units$/);
  }).toPass({ timeout: 45_000 });
});

// The supplier page under a warehouse chip: the Toko tab's store rows and the Produk tab's product names.
async function expectUnderChip(page: Page, warehouse: string, stores: { shown: string; hidden: string }, product: { shown: string; hidden: string }) {
  await expect(page).toHaveURL(new RegExp(`[?&]warehouse=${warehouse}(&|$)`));
  await expect(page.getByTestId(`channel-row-${stores.shown}`)).toBeVisible();
  await expect(page.getByTestId(`channel-row-${stores.hidden}`)).toHaveCount(0);

  await page.getByTestId("supplier-tab-products").click();
  const rows = page.getByTestId("products-table").locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(product.shown);
  await expect(rows).not.toContainText(product.hidden);
  await page.getByTestId("supplier-tab-channels").click();
}

test("Supplier goods: the warehouse chip narrows the Toko and Produk tabs — B's chip hides what was received at A", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // A second store and a second product of the seller's, restocked into warehouse B onto its own rack.
  const rack = await rpc<{ rack: { id: string } }>(page, "inventory.v1.RackService/RackCreate", {
    teamId: state.warehouseB,
    code: "e2e-goods-b",
    name: "e2e-goods-b",
  });
  const category = await rpc<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", {
    name: `E2E Goods B ${SUFFIX}`,
  });
  const product = await rpc<{ product: { id: string; productCode: string } }>(page, "product.v1.ProductService/ProductCreate", {
    teamId: state.seller,
    productCodePart: `SGQ${SUFFIX}`,
    name: "Benang Katun",
    categoryId: category.category.id,
  });
  const storeB = await rpc<{ channel: { id: string } }>(page, "supplier.v1.SupplierChannelService/SupplierChannelCreate", {
    teamId: state.seller,
    supplierId: state.supplier,
    channelType: "MARKETPLACE_TOKOPEDIA",
    name: `Sumber Goods Tokopedia ${SUFFIX}`,
  });
  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: state.seller,
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E goods B ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-SGB-${SUFFIX}`,
    openingBalance: 4 * UNIT_COST,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account.account.id,
    operational: true,
  });

  const restock = await rpc<{ request: { id: string; items: { id: string; count: string }[] } }>(
    page,
    "inventory.v1.RestockRequestService/RestockRequestCreate",
    {
      teamId: state.seller,
      warehouseId: state.warehouseB,
      financeAccountId: account.account.id,
      items: [
        {
          productId: product.product.id,
          productCode: product.product.productCode,
          name: "Benang Katun",
          count: 4,
          total: 4 * UNIT_COST,
          supplierId: state.supplier,
          supplierChannelId: storeB.channel.id,
        },
      ],
    },
  );
  await rpc(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouseB,
    requestId: restock.request.id,
    lines: restock.request.items.map((item) => ({
      itemId: item.id,
      receivedCount: item.count,
      placements: [{ placementId: rack.rack.id, quantity: item.count }],
    })),
  });

  await useTeam(page, state.seller);

  // Opened under B's chip: B pressed, the Tokopedia store alone on the Toko tab with B's figures, and on the Produk tab
  // Benang alone — the link is the accept's fold, so polled.
  const chips = page.getByTestId("supplier-warehouses-chips");
  await expect(async () => {
    await page.goto(`/inventories/suppliers/${state.supplier}?warehouse=${state.warehouseB}`);
    await expect(chips.getByRole("button", { name: state.whBName })).toHaveAttribute("aria-pressed", "true", { timeout: 3000 });
    await page.getByTestId("supplier-tab-products").click();
    await expect(page.getByTestId("products-table").locator("tbody tr")).toHaveCount(1, { timeout: 3000 });
  }).toPass({ timeout: 45_000 });

  await page.getByTestId("supplier-tab-channels").click();
  await expect(page.getByTestId(`channel-ready-${storeB.channel.id}`)).toHaveText(/^4restocked /);
  await expectUnderChip(page, state.warehouseB, { shown: storeB.channel.id, hidden: state.store }, { shown: "Benang Katun", hidden: "Kain Katun" });

  // A's chip: the Shopee store and Kain Katun — what was received at A — and the URL follows the pick.
  await chips.getByRole("button", { name: state.whName }).click();
  await expectUnderChip(page, state.warehouse, { shown: state.store, hidden: storeB.channel.id }, { shown: "Kain Katun", hidden: "Benang Katun" });

  // All: both stores and both products, and no warehouse in the URL.
  await chips.getByRole("button", { name: "All" }).click();
  await expect(page).not.toHaveURL(/[?&]warehouse=/);
  await expect(page.getByTestId(`channel-row-${state.store}`)).toBeVisible();
  await expect(page.getByTestId(`channel-row-${storeB.channel.id}`)).toBeVisible();
  await page.getByTestId("supplier-tab-products").click();
  await expect(page.getByTestId("products-table").locator("tbody tr")).toHaveCount(2);
});

// Statistik's headline under a chip — restocked value and units — and its Per Produk rows' product names.
async function expectStatisticsUnderChip(page: Page, warehouse: string, value: RegExp, units: RegExp, products: string[]) {
  await page.goto(`/inventories/suppliers/${state.supplier}${warehouse === "" ? "" : `?warehouse=${warehouse}`}`);
  await page.getByTestId("supplier-tab-statistics").click();
  await expect(page.getByTestId("statistics-summary-restocked-value")).toHaveText(value, { timeout: 3000 });
  await expect(page.getByTestId("statistics-summary-restocked-units")).toHaveText(units, { timeout: 3000 });

  await page.getByTestId("statistics-view-product").click();
  const rows = page.getByTestId("statistics-products").locator("tbody tr");
  await expect(rows).toHaveCount(products.length, { timeout: 3000 });
  for (const name of products) await expect(rows.filter({ hasText: name })).toHaveCount(1);
}

test("Supplier goods: Statistik under B's chip reads B's restock and leaves out what was received at A", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  // B's accept is folded by supplier_service from RestockAccepted — so polled. B: 4 Benang Katun for Rp 40.000; A's 5 Kain
  // Katun (Rp 50.000) is not B's.
  await expect(async () => {
    await expectStatisticsUnderChip(page, state.warehouseB, /^Rp\s?40\.000$/, /^4 units$/, ["Benang Katun"]);
  }).toPass({ timeout: 45_000 });
  await expect(page.getByTestId("statistics-products")).not.toContainText("Kain Katun");

  // A's chip the reverse — and the URL keeps it.
  await expectStatisticsUnderChip(page, state.warehouse, /^Rp\s?50\.000$/, /^5 units$/, ["Kain Katun"]);
  await expect(page).toHaveURL(new RegExp(`[?&]warehouse=${state.warehouse}(&|$)`));
  await expect(page.getByTestId("statistics-products")).not.toContainText("Benang Katun");

  // No chip: the sum over every warehouse — what the tab read before the reports carried the warehouse.
  await expectStatisticsUnderChip(page, "", /^Rp\s?90\.000$/, /^9 units$/, ["Kain Katun", "Benang Katun"]);
});

// STATISTIK READS A YEAR AT MOST (`a-metric-reads-at-most-a-year`, docs/business/analytic/rpc_provide_decision.md;
// backlog #131, as #130's report pages): a range over 366 days — picked on the calendar, or typed into the address as
// `stat.range` — is never sent (supplier_service refuses it). The line under the picker says why, the last window's
// figures go (every tile `—`, no period or product row), Export is disabled, and the range is kept as picked, never
// trimmed. 366 days still reads. The supplier page's tab and its Discover detail's are one component — both are read.
const jakartaToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const yearLine = (days: number) => `That range covers ${days} days. A report reads at most 366 — pick a year at most.`;
const STAT_TILES = ["total", "restocked", "sales", "lost", "broken"];

// Picks a range on the tab's calendar: `to`, then `from` (paging back or forth until the day is drawn), Apply.
async function pickStatisticsRange(page: Page, from: string, to: string) {
  await page.getByTestId("statistics-range").click();
  await expect(page.getByTestId("statistics-range-panel")).toBeVisible();
  for (const day of [to, from]) {
    const cell = page.getByTestId(`statistics-range-day-${day}`);
    for (const step of ["prev", "next"] as const) {
      for (let i = 0; i < 24 && (await cell.count()) === 0; i++) {
        await page.getByTestId(`statistics-range-${step}`).click();
      }
    }
    await cell.click();
  }
  await page.getByTestId("statistics-range-apply").click();
  await expect(page.getByTestId("statistics-range-panel")).toBeHidden();
}

// The refused state: the line, nothing asked of supplier_service since `reads` was emptied, no figure kept on screen.
async function expectYearRefused(page: Page, days: number, reads: string[]) {
  await expect(page.getByTestId("statistics-range-invalid")).toHaveText(yearLine(days));
  await page.waitForLoadState("networkidle");
  expect(reads, "no Supplier analytic read for a range over a year").toEqual([]);
  // Soft, so a run names every part still drawn.
  for (const tile of STAT_TILES) {
    await expect.soft(page.getByTestId(`statistics-summary-${tile}-value`)).toHaveText("—", { timeout: 3_000 });
  }
  await expect.soft(page.getByTestId("statistics-summary-restocked-units")).toHaveCount(0);
  await expect.soft(page.locator('[data-testid^="statistics-series-row-"]')).toHaveCount(0);
  await expect(page.getByTestId("statistics-export")).toBeDisabled();
}

test("Supplier goods: Statistik reads a year at most — over a year sends nothing, clears the figures, disables Export", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);
  const day = jakartaToday();

  // Every Supplier analytic read the page sends (MetricSearch ranks, MetricData fills).
  const reads: string[] = [];
  page.on("request", (req) => {
    if (/SupplierAnalyticService\/Metric(Search|Data)$/.test(req.url())) reads.push(req.url());
  });

  await test.step("a loaded window first — the default last month: 9 units restocked for Rp 90.000", async () => {
    await page.goto(`/inventories/suppliers/${state.supplier}`);
    await page.getByTestId("supplier-tab-statistics").click();
    await expect(page.getByTestId("statistics-summary-restocked-value")).toHaveText(/^Rp\s?90\.000$/, { timeout: 10_000 });
    await expect(page.locator('[data-testid^="statistics-series-row-"]').first()).toBeVisible();
    await expect(page.getByTestId("statistics-range-invalid")).toHaveCount(0);
    await expect(page.getByTestId("statistics-export")).toBeEnabled();
  });

  await test.step("on the calendar: today and the 400 days before — 401 days, refused and kept as picked", async () => {
    await page.waitForLoadState("networkidle");
    reads.length = 0;
    const from = addDays(day, -400);
    await pickStatisticsRange(page, from, day);
    await expect(page).toHaveURL(new RegExp(`[?&]stat\\.range=${from}\\.\\.${day}(&|$)`));
    await expectYearRefused(page, 401, reads);

    // Per Produk under the same range: no product row, still nothing sent.
    await page.getByTestId("statistics-view-product").click();
    await expect(page.getByTestId("statistics-range-invalid")).toHaveText(yearLine(401));
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid^="statistics-product-row-"]')).toHaveCount(0);
    expect(reads).toEqual([]);
  });

  await test.step("in the address: 366 days reads — the year itself is allowed", async () => {
    await page.goto(`/inventories/suppliers/${state.supplier}?stat.range=${addDays(day, -365)}..${day}`);
    await page.getByTestId("supplier-tab-statistics").click();
    await expect(page.getByTestId("statistics-summary-restocked-value")).toHaveText(/^Rp\s?90\.000$/, { timeout: 10_000 });
    await expect(page.getByTestId("statistics-range-invalid")).toHaveCount(0);
    await expect(page.getByTestId("statistics-export")).toBeEnabled();
  });

  await test.step("in the address: 367 days, and two whole years, are refused and kept as typed", async () => {
    await page.waitForLoadState("networkidle");
    reads.length = 0;
    const from = addDays(day, -366);
    await page.goto(`/inventories/suppliers/${state.supplier}?stat.range=${from}..${day}`);
    await page.getByTestId("supplier-tab-statistics").click();
    await expectYearRefused(page, 367, reads);

    await page.goto(`/inventories/suppliers/${state.supplier}?stat.range=2024-01-01..2025-12-31`);
    await page.getByTestId("supplier-tab-statistics").click();
    await expectYearRefused(page, 731, reads);
    await expect(page).toHaveURL(/[?&]stat\.range=2024-01-01\.\.2025-12-31(&|$)/);
  });

  await test.step("the Discover detail's Statistik refuses the same address", async () => {
    reads.length = 0;
    await page.goto(`/inventories/suppliers/discover/${state.supplier}?stat.range=2024-01-01..2025-12-31`);
    await expect(page.getByTestId("discover-detail-page")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("supplier-tab-statistics").click();
    await expectYearRefused(page, 731, reads);
    await expect(page).toHaveURL(/[?&]stat\.range=2024-01-01\.\.2025-12-31(&|$)/);
  });
});

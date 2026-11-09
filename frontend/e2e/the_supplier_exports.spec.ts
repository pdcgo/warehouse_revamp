import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { readXlsx } from "./xlsx";

// EACH SUPPLIER TAB EXPORTS ITS OWN TABLE (`each-supplier-tab-exports-its-own-table`), END TO END — on the order list's
// pattern (`one-export-is-the-list-as-a-file`): the stream, the file stored in document_service as the person exporting
// (a private `table_export`), and the expiring link the browser downloads under the file's own name
// (`a-download-keeps-its-files-name`). The downloaded .xlsx is opened and read: the Toko tab's file holds exactly its two
// stores, in the tab's columns, the restocked store's Siap 5 beside today's Jakarta day; the Statistik tab's Per Produk
// holds the one product restocked, 5 units for exactly Rp 50.000.
//
// THE TWO REPORTS AS FILES (`a-report-export-is-the-whole-view-as-a-file`), on the same seller: the Supplier Report's
// file is the whole ranking as narrowed (one team picked — its one supplier, its figures); the account report's
// Periode file is every day of the window, the quiet ones included, and its Rincian file one sheet per breakdown
// (Per Akun · Per Penyedia · Per Jenis), the restock's payment in each, exact to the rupiah.
//
// Its OWN selling team and warehouse; no order is placed, and its money moves in its own team only (the restock's
// paying account), so root's totals and orders.spec's counts are untouched wherever it sorts.

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

/** Clicks an Export and reads the file it downloads. */
async function exportFile(page: Page, testId: string, name: RegExp) {
  const downloading = page.waitForEvent("download");
  await page.getByTestId(testId).click();
  const download = await downloading;

  // The file's OWN name, not its storage key (a-download-keeps-its-files-name).
  expect(download.suggestedFilename()).toMatch(name);
  await expect(page.getByText("Export ready — the file is downloading").first()).toBeVisible();

  return readXlsx(await download.path());
}

const state = {
  seller: "",
  sellerName: `E2E Export Seller ${SUFFIX}`,
  supplier: "",
  official: `Sumber Ekspor Official ${SUFFIX}`,
  chat: `Sumber Ekspor WA ${SUFFIX}`,
  productCode: "",
};

test.describe.configure({ mode: "serial" });

test("Supplier exports: a seller restocks 5 units from one of its supplier's two stores", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (code: string, name: string, type: string) =>
    (await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: ROOT_USER_ID }))
      .team.id;
  const warehouse = await team(`SXW${SUFFIX}`.slice(0, 10), `E2E Export Warehouse ${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  state.seller = await team(`SXS${SUFFIX}`.slice(0, 10), state.sellerName, "TEAM_TYPE_SELLING");

  const rack = await rpc<{ rack: { id: string } }>(page, "inventory.v1.RackService/RackCreate", {
    teamId: warehouse,
    code: "e2e-export",
    name: "e2e-export",
  });
  const category = await rpc<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", {
    name: `E2E Export ${SUFFIX}`,
  });
  const product = await rpc<{ product: { id: string; productCode: string } }>(page, "product.v1.ProductService/ProductCreate", {
    teamId: state.seller,
    productCodePart: `SXP${SUFFIX}`,
    name: "Kain Katun",
    categoryId: category.category.id,
  });
  state.productCode = product.product.productCode;

  const supplier = await rpc<{ supplier: { id: string } }>(page, "supplier.v1.SupplierService/SupplierCreate", {
    teamId: state.seller,
    name: `E2E Sumber Ekspor ${SUFFIX}`,
  });
  state.supplier = supplier.supplier.id;

  const store = await rpc<{ channel: { id: string } }>(page, "supplier.v1.SupplierChannelService/SupplierChannelCreate", {
    teamId: state.seller,
    supplierId: state.supplier,
    channelType: "MARKETPLACE_SHOPEE",
    name: state.official,
    uri: "https://shopee.example/sumber-ekspor",
  });
  await rpc(page, "supplier.v1.SupplierChannelService/SupplierChannelCreate", {
    teamId: state.seller,
    supplierId: state.supplier,
    channelType: "MARKETPLACE_OTHER",
    name: state.chat,
    description: "0812 pesan lewat WA",
  });

  // Restocks name an OPERATIONAL paying account (a-restock-names-its-paying-account), opened at the restock's price.
  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: state.seller,
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E export ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-SX-${SUFFIX}`,
    openingBalance: 5 * UNIT_COST,
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
      warehouseId: warehouse,
      financeAccountId: account.account.id,
      items: [
        {
          productId: product.product.id,
          productCode: product.product.productCode,
          name: "Kain Katun",
          count: 5,
          total: 5 * UNIT_COST,
          supplierId: state.supplier,
          supplierChannelId: store.channel.id,
        },
      ],
    },
  );
  await rpc(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: warehouse,
    requestId: restock.request.id,
    lines: restock.request.items.map((item) => ({
      itemId: item.id,
      receivedCount: item.count,
      placements: [{ placementId: rack.rack.id, quantity: item.count }],
    })),
  });
});

test("Supplier exports: the Toko tab's file is its two stores in the tab's columns", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  await page.goto(`/inventories/suppliers/${state.supplier}`);
  await expect(page.getByTestId("channels-table").locator('[data-testid^="channel-row-"]')).toHaveCount(2);

  const file = await exportFile(page, "channels-export", /^toko-pemasok-.*\.xlsx$/);
  const rows = file.get("Toko")!;

  expect(rows[0]).toEqual(["Toko pemasok", "Jenis toko", "Tautan", "Deskripsi", "Terjual", "Pesanan terakhir", "Siap", "Restok terakhir"]);
  // Exactly the tab's rows, newest first.
  expect(rows.slice(1).map((r) => r[0])).toEqual([state.chat, state.official]);

  // The restocked store: nothing sold, 5 ready since today (a Jakarta day); the other store's figures are empty, as the
  // tab's dash.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
  expect(rows[2]).toEqual([state.official, "Shopee", "https://shopee.example/sumber-ekspor", "", "0", "", "5", today]);
  expect(rows[1]).toEqual([state.chat, "Other", "", "0812 pesan lewat WA"]);
});

test("Supplier exports: the Statistik tab's Per Produk file is its one product, exact to the rupiah", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  // The figures are supplier_service's fold of Restock Accepted — poll until the accept has been delivered.
  await expect(async () => {
    await page.goto(`/inventories/suppliers/${state.supplier}`);
    await page.getByTestId("supplier-tab-statistics").click();
    await page.getByTestId("statistics-view-product").click();
    await expect(page.getByTestId("statistics-products")).toContainText("Kain Katun", { timeout: 3000 });
  }).toPass({ timeout: 45_000 });

  const file = await exportFile(page, "statistics-export", /^statistik-pemasok-per-produk-.*\.xlsx$/);
  const rows = file.get("Per Produk")!;

  expect(rows[0]).toEqual([
    "Produk",
    "SKU",
    "Tim",
    "Direstok (unit)",
    "Direstok (Rp)",
    "Penjualan (unit)",
    "Penjualan (Rp)",
    "Hilang di pengiriman (unit)",
    "Hilang di pengiriman (Rp)",
    "Tingkat hilang",
    "Rusak di pengiriman (unit)",
    "Rusak di pengiriman (Rp)",
    "Tingkat rusak",
  ]);
  expect(rows).toHaveLength(2);
  expect(rows[1]!.slice(0, 5)).toEqual(["Kain Katun", state.productCode, state.sellerName, "5", "50000"]);
  // Nothing short or broken: a 0% rate, written as the share itself.
  expect(rows[1]![9]).toBe("0");
});

test("Report exports: the Supplier Report's file is the whole ranking as narrowed", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  // Narrowed to the seller's own restocks (the-team-filter-picks-any-selling-team) — its one supplier ranks. The
  // figures are a fold: poll until the accept has been delivered.
  await expect(async () => {
    await page.goto(`/inventories/suppliers/report?team=${state.seller}`);
    await expect(page.getByTestId(`supplier-report-row-${state.supplier}`)).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 45_000 });
  const onScreen = await page.getByTestId("supplier-report-table").locator('[data-testid^="supplier-report-row-"]').count();

  const file = await exportFile(page, "supplier-report-export", /^laporan-pemasok-.*\.xlsx$/);
  const rows = file.get("Peringkat")!;

  expect(rows[0]).toEqual([
    "Peringkat",
    "Pemasok",
    "Status",
    "Dikelola oleh",
    "Direstok (unit)",
    "Direstok (Rp)",
    "Penjualan (unit)",
    "Penjualan (Rp)",
    "Hilang di pengiriman (unit)",
    "Hilang di pengiriman (Rp)",
    "Tingkat hilang",
    "Rusak di pengiriman (unit)",
    "Rusak di pengiriman (Rp)",
    "Tingkat rusak",
  ]);
  // Exactly the ranking's rows: the one supplier, ranked 1st, kept by the seller, 5 units for exactly Rp 50.000, nothing
  // sold, nothing short or broken (each rate the share itself, 0).
  expect(rows).toHaveLength(onScreen + 1);
  expect(rows[1]).toEqual(["1", `E2E Sumber Ekspor ${SUFFIX}`, "", state.sellerName, "5", "50000", "0", "0", "0", "0", "0", "0", "0", "0"]);
});

test("Report exports: the account report's Periode and Rincian files", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

  // The restock's payment is posted by a listener: poll the report's own headline until it has landed.
  await page.goto("/financial-accounts/report");
  await expect(async () => {
    const res = await rpc<{ metricDatas: { changesSummary?: { restock?: number } }[] }>(
      page,
      "financial_account.v1.FinancialAccountAnalyticService/MetricData",
      {
        teamId: state.seller,
        groupBy: "GROUP_TYPE_SUMMARY",
        filters: [{ dateRangeFilter: { dateMin: today, dateMax: today } }],
        metricIds: ["metrics/financial_accounts"],
      },
    );
    expect(res.metricDatas[0]?.changesSummary?.restock).toBe(-5 * UNIT_COST);
  }).toPass({ timeout: 45_000 });

  await page.reload();
  await expect(page.getByTestId(`account-report-series-row-${today}`)).toBeVisible();

  // PERIODE — every day of the window, newest first, the quiet ones included; the columns the table's.
  const periods = (await exportFile(page, "account-report-export", /^laporan-akun-periode-.*\.xlsx$/)).get("Periode")!;
  expect(periods[0]).toEqual([
    "Periode",
    "Penarikan",
    "Modal",
    "Restok",
    "Biaya",
    "Iklan",
    "Pembayaran tim",
    "Transfer",
    "Penyesuaian",
    "Saldo awal",
    "Perubahan bersih",
    "Saldo akhir",
  ]);
  // Today: opened at Rp 50.000, the restock paid Rp 50.000 out of it — exact, the net 0, the close 0.
  expect(periods[1]).toEqual([today, "0", "0", "-50000", "0", "0", "0", "0", "0", "50000", "0", "0"]);
  // A month of days, one a row, consecutive — the quiet ones are rows too.
  expect(periods.length - 1).toBeGreaterThanOrEqual(28);
  for (let i = 2; i < periods.length; i++) {
    const newer = new Date(`${periods[i - 1]![0]}T00:00:00Z`).getTime();
    expect(new Date(`${periods[i]![0]}T00:00:00Z`).getTime()).toBe(newer - 86_400_000);
    expect(periods[i]!.slice(1)).toEqual(Array(11).fill("0"));
  }

  // RINCIAN — one sheet per breakdown, every row of each.
  await page.getByTestId("account-report-view-breakdown").click();
  await expect(page.getByTestId("account-report-breakdown")).toBeVisible();

  const breakdown = await exportFile(page, "account-report-export", /^laporan-akun-rincian-.*\.xlsx$/);
  expect([...breakdown.keys()]).toEqual(["Per Akun", "Per Penyedia", "Per Jenis"]);
  expect(breakdown.get("Per Akun")).toEqual([
    ["Akun", "Penyedia", "Status", "Saldo awal", "Perubahan bersih", "Saldo akhir"],
    [`E2E export ${SUFFIX}`, "BCA", "", "0", "0", "0"],
    ["Total", "", "", "0", "0", "0"],
  ]);
  expect(breakdown.get("Per Penyedia")).toEqual([
    ["Penyedia", "Saldo awal", "Perubahan bersih", "Saldo akhir"],
    ["BCA", "0", "0", "0"],
    ["Total", "0", "0", "0"],
  ]);
  expect(breakdown.get("Per Jenis")).toEqual([
    ["Jenis", "Arah", "Jumlah"],
    ["Saldo awal", "", "0"],
    ["Saldo awal", "Masuk", "50000"],
    ["Restok", "Keluar", "-50000"],
    ["Saldo akhir", "", "0"],
  ]);
});

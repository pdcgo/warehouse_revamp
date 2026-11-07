import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { formatRupiah } from "../src/lib/money";

// THE BACKEND NEVER ROUNDS MONEY (docs/business/order/context_decision.md#the-backend-never-rounds-money), END TO END.
//
// One unit costs Rp 12.666,99 (a restock priced at a fraction), the warehouse charges 2,5% of the goods, and the buyer
// paid Rp 15.000,5 on the storefront. What it proves:
//   · the ORDER FORM previews the exact figures — goods Rp 12.666,99, fee Rp 316,675 (316,67475 shown to 3 places),
//     total Rp 12.983,665 — and the preview is the stored order, written by the same formatter;
//   · the ORDER stores them exact: goods_cost 12.666,99, warehouse_fee 316,67475, platform_total 15.000,5;
//   · TEAM BALANCE posts the exact fee — 316,67475 owed to the warehouse, POLLED (liability's listener hears OrderPlaced).
//
// ⚠ NAMED TO SORT AFTER orders.spec.ts AND statement.spec.ts: the suite shares one database, and orders.spec counts the
// orders root can read. The paying account opens at the restock's own price, so it ends at 0 and root's team total is
// where it started.

const SUFFIX = Date.now().toString().slice(-6);
const SKU = `EXA${SUFFIX}`;
const UNIT_COST = 12_666.99;
const FEE_PERCENT = 2.5;
const PLATFORM_TOTAL = 15_000.5;

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
  warehouse: "",
  whCode: `EXW${SUFFIX}`.slice(0, 10),
  shopName: `E2E Exact Shop ${SUFFIX}`,
  productCode: "",
  order: "",
};

test.describe.configure({ mode: "serial" });

test("Exact: a warehouse holding one unit at Rp 12.666,99, a 2,5% fee, and a shop", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  state.warehouse = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Exact Warehouse ${SUFFIX}`,
      teamCode: state.whCode,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  const rack = await rpc<{ rack: { id: string } }>(page, "inventory.v1.RackService/RackCreate", {
    teamId: state.warehouse,
    code: "e2e-exact",
    name: "e2e-exact",
  });

  const category = await rpc<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", {
    name: `E2E Exact ${SUFFIX}`,
  });
  const product = await rpc<{ product: { id: string; productCode: string } }>(page, "product.v1.ProductService/ProductCreate", {
    teamId: "1",
    productCodePart: SKU,
    name: "Kaos Pecahan",
    categoryId: category.category.id,
  });
  state.productCode = product.product.productCode;

  // Opened at the restock's own price, so the restock's payment brings it back to exactly 0.
  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: "1",
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E exact ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-EXA-${SUFFIX}`,
    openingBalance: UNIT_COST,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: "1",
    accountId: account.account.id,
    operational: true,
  });

  const restock = await rpc<{ request: { id: string; items: { id: string; count: string }[] } }>(
    page,
    "inventory.v1.RestockRequestService/RestockRequestCreate",
    {
      teamId: "1",
      warehouseId: state.warehouse,
      financeAccountId: account.account.id,
      items: [{ productId: product.product.id, productCode: product.product.productCode, name: "Kaos Pecahan", count: 1, total: UNIT_COST }],
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

  await rpc(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", {
    teamId: state.warehouse,
    feePercent: FEE_PERCENT,
    minFee: 0,
  });

  const shop = await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
    teamId: "1",
    name: state.shopName,
    shopCode: `EXS${SUFFIX}`,
    marketplace: "MARKETPLACE_SHOPEE",
  });
  await rpc(page, "selling.v1.ShopService/ShopUserAdd", { teamId: "1", shopId: shop.shop.id, userId: ROOT_USER_ID });
});

test("Exact: the form previews the exact figures, and the order stores exactly those", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, "1");

  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await page.getByTestId("order-create-customer-name").fill(`E2E Exact ${SUFFIX}`);
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
  await page.getByTestId("order-line-qty-0").fill("1");

  // What the buyer paid, with its fraction — typed the Indonesian way, a comma before the fraction.
  await page.getByTestId("order-marketplace-total").fill("15000,5");
  await expect(page.getByTestId("order-marketplace-total")).toHaveValue("15.000,5");
  await page.getByTestId("order-external-ref-id").fill(`EXA-${SUFFIX}`);
  // The courier — every order names one (no-order-without-a-courier).
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

  // THE PREVIEW — exact figures, shown to up to 3 places. 2,5% of 12.666,99 is 316,67475 and reads Rp 316,675.
  const goods = page.getByTestId("order-create-products-total");
  const fee = page.getByTestId("order-create-warehouse-fee");
  const total = page.getByTestId("order-create-total");
  await expect(goods).toHaveText("Rp 12.666,99");
  await expect(fee).toHaveText("Rp 316,675");
  await expect(total).toHaveText("Rp 12.983,665");
  const preview = { goods: await goods.innerText(), fee: await fee.innerText(), total: await total.innerText() };

  await expect(page.getByTestId("order-create-save")).toBeEnabled();
  await page.getByTestId("order-create-save").click();
  // A thin margin asks first (the-margin-floor-is-35-percent-for-every-team): 15.000,5 against 12.983,665 is 13,4% — on
  // the exact figures, as the check judges them. Place it anyway.
  await expect(page.getByTestId("order-check-profitBelowFloor")).toContainText("13.4");
  await page.getByTestId("order-checks-place").click();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  state.order = /\/orders\/(\d+)$/.exec(page.url())![1]!;

  // THE STORED ORDER — exact, and the preview is it, written by the same formatter.
  const detail = await rpc<{
    order: { goodsCost: number; warehouseFee: number; totalCost: number; platformTotal: number; items: { unitCost: number }[] };
  }>(page, "selling.v1.OrderService/OrderDetail", { teamId: "1", orderId: state.order });
  expect(detail.order.goodsCost).toBe(UNIT_COST);
  expect(detail.order.items[0]!.unitCost).toBe(UNIT_COST);
  expect(detail.order.warehouseFee).toBeCloseTo((UNIT_COST * FEE_PERCENT) / 100, 9);
  expect(detail.order.totalCost).toBeCloseTo(UNIT_COST + (UNIT_COST * FEE_PERCENT) / 100, 9);
  expect(detail.order.platformTotal).toBe(PLATFORM_TOTAL);
  expect(preview).toEqual({
    goods: formatRupiah(detail.order.goodsCost),
    fee: formatRupiah(detail.order.warehouseFee),
    total: formatRupiah(detail.order.totalCost),
  });
});

test("Exact: Team Balance posts the exact fee the order froze", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Posted by liability's listener from OrderPlaced — so polled.
  await expect(async () => {
    const positions = await rpc<{ totalReceivable?: number }>(page, "liability.v1.LiabilityService/LiabilityPositionList", {
      teamId: state.warehouse,
      page: { page: 1, limit: 50 },
    });
    expect(positions.totalReceivable ?? 0).toBeCloseTo((UNIT_COST * FEE_PERCENT) / 100, 9);
  }).toPass({ timeout: 45_000 });
});

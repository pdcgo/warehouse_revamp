import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// ORDER CREATE REFUSES A TEAM WITH NO RETURN WAREHOUSE
// (docs/business/order/context_decision.md#create-refuses-a-team-with-no-return-warehouse), END TO END, on the order form.
//
// A selling team of its own — a shop, a product with one unit on a warehouse's shelf, the warehouse's fee — but NO return
// warehouse. Its order, filled in full on the form, is refused with the server's sentence naming the team; once the team
// has a return warehouse the SAME form, as typed, places it.
//
// ⚠ NAMED TO SORT AFTER orders.spec.ts AND statement.spec.ts: the suite shares one database, and orders.spec counts the
// orders root can read — this spec places one. Its money stays in its own team: the restock is at Rp 0 from an account
// opened at 0.

const SUFFIX = Date.now().toString().slice(-6);
const SELLER_NAME = `E2E Return Seller ${SUFFIX}`;

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
  whCode: `RWW${SUFFIX}`.slice(0, 10),
  shopName: `E2E Return Shop ${SUFFIX}`,
  productCode: "",
};

test.describe.configure({ mode: "serial" });

test("Return warehouse: a seller with a shop, a unit on a warehouse's shelf and its fee — and no return warehouse", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  state.seller = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: SELLER_NAME,
      teamCode: `RWS${SUFFIX}`.slice(0, 10),
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  state.warehouse = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Return Warehouse ${SUFFIX}`,
      teamCode: state.whCode,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  const rack = await rpc<{ rack: { id: string } }>(page, "inventory.v1.RackService/RackCreate", {
    teamId: state.warehouse,
    code: "e2e-rw",
    name: "e2e-rw",
  });

  const category = await rpc<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", {
    name: `E2E Return ${SUFFIX}`,
  });
  const product = await rpc<{ product: { id: string; productCode: string } }>(page, "product.v1.ProductService/ProductCreate", {
    teamId: state.seller,
    productCodePart: `RW${SUFFIX}`,
    name: "Kaos Retur",
    categoryId: category.category.id,
  });
  state.productCode = product.product.productCode;

  // The restock is paid from an operational account (a-restock-names-its-paying-account), at Rp 0 — it stays at 0.
  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: state.seller,
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E return ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-RW-${SUFFIX}`,
    openingBalance: 0,
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
      warehouseId: state.warehouse,
      financeAccountId: account.account.id,
      items: [{ productId: product.product.id, productCode: product.product.productCode, name: "Kaos Retur", count: 1, total: 0 }],
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
  await rpc(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: state.warehouse, feePercent: 1, minFee: 0 });

  const shop = await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
    teamId: state.seller,
    name: state.shopName,
    shopCode: `RWH${SUFFIX}`,
    marketplace: "MARKETPLACE_SHOPEE",
  });
  await rpc(page, "selling.v1.ShopService/ShopUserAdd", { teamId: state.seller, shopId: shop.shop.id, userId: ROOT_USER_ID });

  // No return warehouse: the read answers none.
  const configuration = await rpc<{ configuration?: unknown }>(
    page,
    "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationDetail",
    { teamId: state.seller },
  );
  expect(configuration.configuration).toBeUndefined();
});

test("Return warehouse: the order form is refused naming the team, then places the same order once one is set", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await page.getByTestId("order-create-customer-name").fill(`E2E Return ${SUFFIX}`);
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

  await page.getByTestId("order-marketplace-total").fill("15000");
  await page.getByTestId("order-external-ref-id").fill(`RW-${SUFFIX}`);
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

  // REFUSED — the server's sentence, under Create: the team named, the return warehouse not set, where to set it. The
  // form stays as typed.
  await expect(page.getByTestId("order-create-save")).toBeEnabled();
  await page.getByTestId("order-create-save").click();
  await expect(page.getByTestId("order-create-error")).toHaveText(
    `${SELLER_NAME} has no return warehouse set — set it on Settings › Return Warehouse before creating an order`,
  );
  await expect(page).toHaveURL(/\/orders\/new$/);
  await expect(page.getByTestId("order-create-customer-name")).toHaveValue(`E2E Return ${SUFFIX}`);

  // The team sets one — any warehouse will do (a-team-may-pick-any-return-warehouse) — and the same form places it.
  await rpc(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: state.seller,
    warehouseId: state.warehouse,
  });

  await page.getByTestId("order-create-save").click();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  const order = /\/orders\/(\d+)$/.exec(page.url())![1]!;

  const detail = await rpc<{ order: { teamId: string; warehouseId: string } }>(page, "selling.v1.OrderService/OrderDetail", {
    teamId: state.seller,
    orderId: order,
  });
  expect(detail.order.teamId).toBe(state.seller);
  expect(detail.order.warehouseId).toBe(state.warehouse);
});

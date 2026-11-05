import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

const SUFFIX = Date.now().toString().slice(-6);

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

// rpc calls the API with the page's own token, so a seed runs as the person the UI is signed in as.
async function rpc<T = Record<string, unknown>>(page: Page, method: string, body: unknown): Promise<T> {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });

      if (!res.ok) throw new Error(`${m}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body] as const,
  ) as Promise<T>;
}

// rpcError is the error text of a call that must be refused.
async function rpcError(page: Page, method: string, body: unknown): Promise<string> {
  try {
    await rpc(page, method, body);
  } catch (err) {
    return String(err);
  }

  return "";
}

test.describe.configure({ mode: "serial" });

// A CANCEL MEETS THE COUNT FIRST — its own file, sorted (by name) AFTER orders.spec.ts and statement.spec.ts: the suite shares one database, and
// orders.spec asserts the orders screen starts empty and counts its stages, while root reads every team's orders.
// Self-contained: its own warehouse, rack, selling team, product and shop.
//
// A CANCEL MEETS THE COUNT FIRST (a-cancel-still-meets-the-count-first, a-lock-stops-sales-and-cancels-too): a seller's
// order was taken off a shelf, then a count of that product began. Cancelling the order is refused BEFORE anything
// changes, naming the count, and the order stays pending; once the count is called off the cancel goes through, and the
// units come back onto the shelf a moment later — inventory releases them on OrderCancelled
// (inventory-returns-stock-on-order-cancelled).

test("Count: a cancel is refused naming the count, and goes through once the count ends", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const wh = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Cancel WH ${SUFFIX}`,
      teamCode: `XW${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: "1",
    })
  ).team.id;
  const rakA = (
    await rpc<{ rack: { id: string } }>(page, "inventory.v1.RackService/RackCreate", { teamId: wh, code: `xcl-a-${SUFFIX}` })
  ).rack.id;


  const seller = (
    await rpc<{ team: { id: string } }>(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Count Seller ${SUFFIX}`,
      teamCode: `CS${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: "1",
    })
  ).team.id;

  const category = await rpc<{ category: { id: string } }>(page, "category.v1.CategoryService/CategoryCreate", {
    name: `E2E Count Sale ${SUFFIX}`,
  });
  const product = (
    await rpc<{ product: { id: string; productCode: string } }>(page, "product.v1.ProductService/ProductCreate", {
      teamId: seller,
      productCodePart: `CD${SUFFIX}`,
      name: "Kaos D",
      categoryId: category.category.id,
    })
  ).product;

  const account = await rpc<{ account: { id: string } }>(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: seller,
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E count sale ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-CNS-${SUFFIX}`,
    openingBalance: 0,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  // The restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account) — the server refuses any other.
  await rpc(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: seller,
    accountId: account.account.id,
    operational: true,
  });
  const restock = await rpc<{ request: { id: string; items: { id: string }[] } }>(
    page,
    "inventory.v1.RestockRequestService/RestockRequestCreate",
    {
      teamId: seller,
      warehouseId: wh,
      financeAccountId: account.account.id,
      items: [{ productId: product.id, productCode: product.productCode, name: "Kaos D", count: 3, total: 30000 }],
    },
  );
  await rpc(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: wh,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 3, placements: [{ placementId: rakA, quantity: 3 }] }],
  });

  // The warehouse takes orders only with a rate (a-warehouse-with-no-rate-takes-no-orders).
  await rpc(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wh, feePercent: 1, minFee: 0 });

  const shop = await rpc<{ shop: { id: string } }>(page, "selling.v1.ShopService/ShopCreate", {
    teamId: seller,
    name: `E2E Count Shop ${SUFFIX}`,
    shopCode: `CNS${SUFFIX}`,
    marketplace: "MARKETPLACE_SHOPEE",
  });

  const onRakA = async () => {
    const res = await rpc<{ items: { rackStock?: { mapData: Record<string, { productId: string; onHand: string }> } }[] }>(
      page,
      "inventory.v1.RackService/RackStock",
      { teamId: wh, filter: { rackId: rakA }, page: { page: 1, limit: 50 } },
    );
    for (const item of res.items) {
      for (const l of Object.values(item.rackStock?.mapData ?? {})) if (l.productId === product.id) return Number(l.onHand);
    }
    return 0;
  };

  const placed = await rpc<{ order: { id: string } }>(page, "selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-count-cancel-${SUFFIX}`,
    teamId: seller,
    shopId: shop.shop.id,
    warehouseId: wh,
    customerName: "E2E Count Buyer",
    platformTotal: 15000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `CNT${SUFFIX}`,
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos D", quantity: 1 }],
  });
  const order = placed.order.id;
  expect(await onRakA()).toBe(2);

  const planned = await rpc<{ session: { id: string } }>(page, "inventory.v1.OpnameService/OpnameSessionCreate", {
    teamId: wh,
    plan: "OPNAME_PLAN_PRODUCT",
    filterProductId: product.id,
  });

  // REFUSED, NAMING THE COUNT — and nothing changed: the order is still pending.
  const refused = await rpcError(page, "selling.v1.OrderService/OrderCancel", { teamId: seller, orderId: order });
  expect(refused).toContain("being counted");
  expect(refused).toContain(`count #${planned.session.id}`);

  const still = await rpc<{ order: { status: string } }>(page, "selling.v1.OrderService/OrderDetail", {
    teamId: seller,
    orderId: order,
  });
  expect(still.order.status).toBe("ORDER_STATUS_PENDING");

  // The count is called off: the cancel goes through, and the unit comes back onto the shelf on the event.
  await rpc(page, "inventory.v1.OpnameService/OpnameSessionCancel", { teamId: wh, sessionId: planned.session.id });
  await rpc(page, "selling.v1.OrderService/OrderCancel", { teamId: seller, orderId: order });

  await expect(async () => {
    expect(await onRakA()).toBe(3);
  }).toPass({ timeout: 45_000 });
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

// A RETURN GOES BACK ON THE SHELF (docs/business/inventory/return_decision.md), END TO END on the real server:
//
//   · a SELLER places an order of 4 from its shipping warehouse; the warehouse walks it to the courier; the seller
//     claims it back — `return`;
//   · the SHIPPING warehouse is not the seller's return warehouse: its accept page says where the parcel goes and has
//     no Accept, and the RPC refuses it naming that warehouse (only-the-return-warehouse-accepts-a-return);
//   · the RETURN warehouse's crew accepts it on the page: 1 broken (with a note), 1 missing, the 2 sound onto its rack
//     — and the rack holds the 2 (a-return-mints-one-batch-per-batch-the-order-took), the order names its return
//     transaction, and the warehouse's note on the order names the missing and the broken unit with the crew's note
//     (a-short-return-is-missing-at-the-door, a-broken-returned-unit-is-thrown-away-at-the-door,
//     a-return-door-row-carries-an-optional-note).
//
// A SELLING TEAM AND TWO WAREHOUSES OF ITS OWN, named to sort after orders.spec.ts and statement.spec.ts (they assert an
// empty start on the one shared database); the restock is paid from this team's own account, so root's team — whose
// totals financial_accounts.spec checks — is never touched.

const SUFFIX = Date.now().toString().slice(-6);
const RETURN_WAREHOUSE_NAME = `E2E Return WH ${SUFFIX}`;
const NOTE = "sobek di jahitan";

// Made in the setup, read by the tests after it — the file runs serially, in one worker.
const state = {
  seller: "",
  shipWarehouse: "",
  returnWarehouse: "",
  returnRack: "",
  product: "",
  order: "",
  item: "",
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

async function move(page: Page, teamId: string, orderId: string, to: string) {
  const res = await ok<{ results: { moved?: boolean; refusedReason?: string }[] }>(
    page,
    "selling.v1.OrderService/OrderStatusChange",
    { teamId, orderIds: [orderId], to },
  );
  expect(res.results[0]?.moved, `${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

test.describe.configure({ mode: "serial" });

test("setup: a seller returning to its own return warehouse, an order of 4 shipped and claimed back", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  state.seller = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Return Seller ${SUFFIX}`,
      teamCode: `RS${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  const shop = (
    await ok(page, "selling.v1.ShopService/ShopCreate", {
      teamId: state.seller,
      name: `E2E Return Shop ${SUFFIX}`,
      shopCode: `RSS${SUFFIX}`,
      marketplace: "MARKETPLACE_SHOPEE",
    })
  ).shop.id;
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: state.seller, shopId: shop, userId: ROOT_USER_ID });

  for (const [key, name, code] of [
    ["shipWarehouse", `E2E Ship WH ${SUFFIX}`, `RW${SUFFIX}`],
    ["returnWarehouse", RETURN_WAREHOUSE_NAME, `RR${SUFFIX}`],
  ] as const) {
    state[key] = (
      await ok(page, "team.v1.TeamService/TeamCreate", {
        name,
        teamCode: code,
        type: "TEAM_TYPE_WAREHOUSE",
        ownerUserId: ROOT_USER_ID,
      })
    ).team.id;
  }

  // The seller's returns go to the OTHER building (a-team-may-pick-any-return-warehouse).
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: state.seller,
    warehouseId: state.returnWarehouse,
  });

  // STOCK FOR THE ORDER in the shipping warehouse: a rack, a product, a restock of 4 accepted onto it (paid from an
  // OPERATIONAL account of the seller's own), and the warehouse's rate. The return warehouse has a rack of its own.
  const shipRack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.shipWarehouse, code: `ret-s-${SUFFIX}` }))
    .rack.id;
  state.returnRack = (
    await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.returnWarehouse, code: `ret-a-${SUFFIX}` })
  ).rack.id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Return ${SUFFIX}` })).category
    .id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `RT${SUFFIX}`,
      name: "Kaos Retur",
      categoryId: category,
    })
  ).product;
  state.product = product.id;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E return restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-RET-${SUFFIX}`,
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
    warehouseId: state.shipWarehouse,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Retur", count: 4, total: 40000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.shipWarehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 4, placements: [{ placementId: shipRack, quantity: 4 }] }],
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: state.shipWarehouse, feePercent: 1, minFee: 0 });

  const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
    idempotencyKey: `e2e-return-${SUFFIX}`,
    // Every order names its courier (no-order-without-a-courier).
    shipmentChannelId: "1",
    teamId: state.seller,
    shopId: shop,
    warehouseId: state.shipWarehouse,
    customerName: `E2E Return Buyer ${SUFFIX}`,
    platformTotal: 100000,
    platformCreatedAtUnix: Math.floor(Date.now() / 1000),
    orderExternalRefId: `RET${SUFFIX}`,
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Retur", quantity: 4 }],
  });
  state.order = placed.order.id;
  state.item = placed.order.items[0].id;

  // The warehouse walks it to the courier; the seller claims it back.
  for (const to of ["ORDER_STATUS_PROCESSED", "ORDER_STATUS_PICKED", "ORDER_STATUS_SHIPPING"]) {
    await move(page, state.shipWarehouse, state.order, to);
  }
  await move(page, state.seller, state.order, "ORDER_STATUS_RETURN");
});

test("Wrong warehouse: the shipping warehouse is told where the parcel goes, and its accept is refused", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.shipWarehouse);

  await page.goto(`/warehouse-orders/${state.order}/accept-return`);
  await expect(page.getByTestId("return-accept-refused-title")).toHaveText(`This return goes to ${RETURN_WAREHOUSE_NAME}`);
  await expect(page.getByTestId("return-accept-submit")).toHaveCount(0);

  // The server is the gate, not the screen.
  const refused = await call(page, "selling.v1.OrderService/OrderReturnAccept", {
    teamId: state.shipWarehouse,
    orderId: state.order,
    lines: [{ orderItemId: state.item, missing: 4, placements: [] }],
  });
  expect(refused.status).toBe(400);
  expect(refused.body.code).toBe("failed_precondition");
  expect(refused.body.message).toContain(`this return goes to ${RETURN_WAREHOUSE_NAME}`);
});

test("Accept: 1 broken with a note, 1 missing, the 2 sound back on the return warehouse's rack", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.returnWarehouse);

  await page.goto(`/warehouse-orders/${state.order}/accept-return`);
  const line = page.getByTestId(`return-accept-line-${state.item}`);
  await expect(line).toBeVisible();
  await expect(page.getByTestId(`return-accept-ordered-${state.item}`)).toHaveText("Ordered 4");

  await page.getByTestId(`return-accept-broken-${state.item}`).fill("1");
  await page.getByTestId(`return-accept-missing-${state.item}`).fill("1");
  await expect(page.getByTestId(`return-accept-sound-${state.item}`)).toHaveText("2");
  await page.getByTestId(`return-accept-note-${state.item}`).fill(NOTE);

  // The first rack row follows the sound units — only the rack is asked.
  const rackRow = page.getByTestId(`return-accept-rack-${state.item}-0`);
  await rackRow.getByTestId("rack-select").click();
  await rackRow.getByTestId(`rack-select-option-${state.returnRack}`).click();
  await expect(page.getByTestId("return-accept-ready")).toBeVisible();

  await page.getByTestId("return-accept-submit").click();
  await page.getByTestId("confirm-action").click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${state.order}$`));

  // THE SOUND UNITS ARE ON THE RACK — 2 of the 4; the broken one thrown away, the missing one never here.
  await page.goto(`/inventories/racks/${state.returnRack}`);
  // The rack page draws the product in two tables (stock and prices) — read the stock table's cell, as transfers.spec does.
  await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${state.product}`)).toHaveText("2");

  // The order is accepted back and names its one return transaction, at the warehouse it was read for.
  const detail = await ok<{ order: { status: string; returnTransactionId?: string; returnWarehouseId?: string } }>(
    page,
    "selling.v1.OrderService/OrderDetail",
    { teamId: state.seller, orderId: state.order },
  );
  expect(detail.order.status).toBe("ORDER_STATUS_RETURN_COMPLETED");
  expect(Number(detail.order.returnTransactionId ?? 0)).toBeGreaterThan(0);
  expect(detail.order.returnWarehouseId).toBe(state.returnWarehouse);

  // A second accept is refused — the parcel went back on the shelf once.
  const again = await call(page, "selling.v1.OrderService/OrderReturnAccept", {
    teamId: state.returnWarehouse,
    orderId: state.order,
    lines: [{ orderItemId: state.item, placements: [{ rackId: state.returnRack, quantity: 4 }] }],
  });
  expect(again.status).toBe(400);
  expect(again.body.message).toContain("already accepted");
});

test("Note: the order's warehouse note names the missing and the broken unit, with the crew's note", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.seller);

  await page.goto(`/orders/${state.order}`);
  const notes = page.getByTestId("section-notes");
  await expect(notes).toContainText("Missing from the returned parcel: 1 ×");
  await expect(notes).toContainText(`Broken, thrown away: 1 ×`);
  await expect(notes).toContainText(`(${NOTE})`);
});

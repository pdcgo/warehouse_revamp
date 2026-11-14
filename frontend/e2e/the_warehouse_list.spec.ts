import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE WAREHOUSE ORDER LIST, LIVE (docs/technical/frontend/warehouse_order_list_decision.md
// #the-warehouse-order-list-is-accepted), END TO END on the real server:
//
//   · Move to Picked is offered nowhere on the list — not in a row's menu, not in the bulk Change Step
//     (the-item-scans-live-on-the-page);
//   · Scan Label finds the order on the server by its tracking number and opens its pick page — the racks for the walk,
//     then the item scans: a wrong item refused, too many refused, every line exact, Set Picked
//     (scan-label-opens-the-pick-page, the-pick-page-opens-first-by-the-label);
//   · the Retur tab lists a return, counted and in the URL (the-warehouse-list-has-a-returns-tab);
//   · a monitoring team reads the list and the pick page and is offered no write (the-admin-team-monitors-read-only).
//
// Printing from the bulk bar by clicking is the_labels_print_together.spec.ts's (it carries real label files).
//
// A SELLING TEAM, A WAREHOUSE AND AN ADMIN TEAM OF ITS OWN, named to sort after orders.spec.ts and statement.spec.ts (they
// assert an empty start on the one shared database); the restock is paid from this seller's own account, so root's team
// — whose totals financial_accounts.spec checks — is never touched.

const SUFFIX = Date.now().toString().slice(-6);
const STAFF = `e2ewlstaff${SUFFIX}`;
const MONITOR = `e2ewlmon${SUFFIX}`;
const PASSWORD = "e2e-warehouse-list-1";
const RACK = `wl-a-${SUFFIX}`;

// Made in the setup, read by the tests after it — the file runs serially, in one worker.
const state = {
  seller: "",
  warehouse: "",
  productCode: "",
  // Processed, two units — scanned and Set Picked.
  pickMe: "",
  pickMeResi: `WLRESI${SUFFIX}`,
  // Processed, one unit — stays confirmed: the menu and Change Step are read on it.
  stillConfirmed: "",
  // Claimed back by the seller — on its way to the warehouse.
  returned: "",
};

async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);
}

// An RPC as the signed-in person — the status and the JSON body.
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

// One status move that must land, as `teamId`'s side of the order.
async function move(page: Page, teamId: string, orderId: string, to: string) {
  const res = await ok<{ results: { moved?: boolean; refusedReason?: string }[] }>(
    page,
    "selling.v1.OrderService/OrderStatusChange",
    { teamId, orderIds: [orderId], to },
  );
  expect(res.results[0]?.moved, `${orderId} → ${to}: ${res.results[0]?.refusedReason}`).toBe(true);
}

// A scanner: the whole code, then Enter.
async function scan(page: Page, testId: string, code: string) {
  const field = page.getByTestId(testId);
  await field.fill(code);
  await field.press("Enter");
}

test.describe.configure({ mode: "serial" });

test("setup: a seller, its warehouse with stock, the crew, a monitor, three orders", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  state.seller = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E List Seller ${SUFFIX}`,
      teamCode: `WS${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  const shop = (
    await ok(page, "selling.v1.ShopService/ShopCreate", {
      teamId: state.seller,
      name: `E2E List Shop ${SUFFIX}`,
      shopCode: `WSS${SUFFIX}`,
      marketplace: "MARKETPLACE_SHOPEE",
    })
  ).shop.id;
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: state.seller, shopId: shop, userId: ROOT_USER_ID });

  state.warehouse = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E List WH ${SUFFIX}`,
      teamCode: `WW${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  // STOCK FOR THE ORDERS: a rack, a product, a restock accepted onto the rack (paid from an OPERATIONAL account of the
  // seller's own), and the warehouse's rate.
  const rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: RACK })).rack.id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E List ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `WL${SUFFIX}`,
      name: "Kaos Daftar",
      categoryId: category,
    })
  ).product;
  state.productCode = product.productCode;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E list restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-WL-${SUFFIX}`,
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
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Daftar", count: 10, total: 100000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 10, placements: [{ placementId: rack, quantity: 10 }] }],
  });
  await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: state.warehouse, feePercent: 1, minFee: 0 });
  // The seller's return warehouse — order create refuses a team that has none (create-refuses-a-team-with-no-return-warehouse).
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: state.seller,
    warehouseId: state.warehouse,
  });

  // THE CREW: a STAFF member of the warehouse. THE MONITOR: an admin team's owner, a member of no warehouse.
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.warehouse,
    username: STAFF,
    password: PASSWORD,
    name: STAFF,
    role: "ROLE_WAREHOUSE_STAFF",
  });
  const admin = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E List Admin ${SUFFIX}`,
      teamCode: `WA${SUFFIX}`,
      type: "TEAM_TYPE_ADMIN",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: admin,
    username: MONITOR,
    password: PASSWORD,
    name: MONITOR,
    role: "ROLE_ADMIN_OWNER",
  });

  for (const [key, quantity, resi] of [
    ["pickMe", 2, state.pickMeResi],
    ["stillConfirmed", 1, `WLRESIB${SUFFIX}`],
    ["returned", 1, `WLRESIC${SUFFIX}`],
  ] as const) {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-wlist-${key}-${SUFFIX}`,
      // Every order names its courier (no-order-without-a-courier).
      shipmentChannelId: "1",
      teamId: state.seller,
      shopId: shop,
      warehouseId: state.warehouse,
      customerName: `E2E List Buyer ${key}`,
      platformTotal: 15000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `WLREF${key}${SUFFIX}`,
      receiptCode: resi,
      items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Daftar", quantity }],
    });
    state[key] = placed.order.id;
  }

  // The warehouse confirms the first two; the third walks to the courier and the seller claims it back.
  for (const id of [state.pickMe, state.stillConfirmed, state.returned]) {
    await move(page, state.warehouse, id, "ORDER_STATUS_PROCESSED");
  }
  await move(page, state.warehouse, state.returned, "ORDER_STATUS_PICKED");
  await move(page, state.warehouse, state.returned, "ORDER_STATUS_SHIPPING");
  await move(page, state.seller, state.returned, "ORDER_STATUS_RETURN");
});

test("List: Move to Picked is offered nowhere — not in a row's menu, not in Change Step", async ({ page }) => {
  await login(page, STAFF, PASSWORD);
  await page.goto("/warehouse-orders?step=confirm");

  const id = state.stillConfirmed;
  await expect(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();

  // The row's menu: back to the queue, the pick page — no picked.
  await page.getByTestId(`pick-queue-actions-${id}`).click();
  await expect(page.getByTestId(`pick-queue-move-${id}-toConfirm`)).toBeVisible();
  await expect(page.getByTestId(`pick-queue-open-${id}`)).toBeVisible();
  await expect(page.getByTestId(`pick-queue-move-${id}-picked`)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The bulk Change Step over the ticked order: the same.
  await page.getByTestId(`pick-queue-select-${id}`).click();
  await expect(page.getByTestId("pick-queue-bulk-count")).toHaveText("1 selected");
  await page.getByTestId("pick-queue-bulk-move").click();
  await expect(page.getByTestId("pick-queue-bulk-move-toConfirm")).toBeVisible();
  await expect(page.getByTestId("pick-queue-bulk-move-picked")).toHaveCount(0);
});

test("Scan Label: the label opens the pick page — a wrong item refused, every line exact, Set Picked", async ({ page }) => {
  await login(page, STAFF, PASSWORD);
  await page.goto("/warehouse-orders");

  // A label of no order here: the dialog says so and opens nothing.
  await page.getByTestId("warehouse-orders-scan-label").click();
  await scan(page, "scan-label-input", `NO-SUCH-${SUFFIX}`);
  await expect(page.getByTestId("scan-label-result")).toHaveAttribute("data-state", "none");
  await expect(page).toHaveURL(/\/warehouse-orders$/);

  // The parcel's tracking number, asked of the server: its one order's pick page opens.
  await scan(page, "scan-label-input", state.pickMeResi);
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${state.pickMe}$`));

  // THE RACKS FIRST — the walk reads the shelf the take drew from.
  await expect(page.getByTestId("pick-list-table")).toContainText(RACK);
  // No plain Mark Picked: the scan is the only way to picked.
  await expect(page.getByTestId("pick-order-advance")).toHaveCount(0);

  const setPicked = page.getByTestId("pick-order-set-picked");
  await expect(setPicked).toBeDisabled();

  // A wrong item is refused.
  await scan(page, "pick-scan-input", `NOT-${SUFFIX}`);
  await expect(page.getByTestId("pick-scan-problem")).toContainText("Not on this order");
  await expect(setPicked).toBeDisabled();

  // Both units, exact — then a third is one too many.
  await scan(page, "pick-scan-input", state.productCode);
  await expect(setPicked).toBeDisabled();
  await scan(page, "pick-scan-input", state.productCode);
  await expect(page.getByTestId("pick-scan-complete")).toBeVisible();
  await scan(page, "pick-scan-input", state.productCode);
  await expect(page.getByTestId("pick-scan-problem")).toContainText("more than ordered");

  await expect(setPicked).toBeEnabled();
  await setPicked.click();

  // Picked: the next step is the handover, and the server says so too.
  await expect(page.getByTestId("pick-order-advance")).toContainText("Mark Handed Over");
  await expect(page.getByTestId("pick-scan")).toHaveCount(0);
  const detail = await ok(page, "selling.v1.OrderService/OrderDetail", { teamId: state.warehouse, orderId: state.pickMe });
  expect(detail.order.status).toBe("ORDER_STATUS_PICKED");
});

test("Retur: the tab lists the return coming back, counted and in the URL", async ({ page }) => {
  await login(page, STAFF, PASSWORD);
  await page.goto("/warehouse-orders");

  await expect(page.getByTestId("pick-tab-count-return")).toHaveText("1");
  await page.getByTestId("pick-tab-return").click();
  await expect(page).toHaveURL(/step=return/);

  await expect(page.getByTestId(`pick-queue-row-${state.returned}`)).toBeVisible();
  await expect(page.getByTestId(`pick-queue-row-${state.pickMe}`)).toHaveCount(0);

  // Receive a Return is in the header, beside the scans.
  await expect(page.getByTestId("pick-queue-receive")).toBeVisible();
});

test("Monitor: the admin team reads the list and the pick page, and is offered no write", async ({ page }) => {
  await login(page, MONITOR, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), state.warehouse);
  await page.goto("/warehouse-orders?step=confirm");

  await expect(page.getByTestId(`pick-queue-row-${state.stillConfirmed}`)).toBeVisible();

  // What reads stays: Scan Label, Print Labels, Export.
  await expect(page.getByTestId("warehouse-orders-scan-label")).toBeVisible();
  await expect(page.getByTestId("pick-queue-bulk-print")).toBeVisible();
  await expect(page.getByTestId("pick-queue-bulk-export")).toBeVisible();

  // What writes is not there at all.
  await expect(page.getByTestId("warehouse-orders-handover")).toHaveCount(0);
  await expect(page.getByTestId("pick-queue-receive")).toHaveCount(0);
  await expect(page.getByTestId("pick-queue-bulk-move")).toHaveCount(0);
  await expect(page.getByTestId("pick-queue-bulk-handover")).toHaveCount(0);

  await page.getByTestId(`pick-queue-actions-${state.stillConfirmed}`).click();
  await expect(page.getByTestId(`pick-queue-open-${state.stillConfirmed}`)).toBeVisible();
  await expect(page.locator(`[data-testid^="pick-queue-move-${state.stillConfirmed}-"]`)).toHaveCount(0);
  await page.getByTestId(`pick-queue-open-${state.stillConfirmed}`).click();

  // The pick page: the racks, and no scan, no Set Picked, no step.
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${state.stillConfirmed}$`));
  await expect(page.getByTestId("pick-list-table")).toContainText(RACK);
  await expect(page.getByTestId("pick-scan")).toHaveCount(0);
  await expect(page.getByTestId("pick-order-set-picked")).toHaveCount(0);
  await expect(page.getByTestId("pick-order-advance")).toHaveCount(0);
});

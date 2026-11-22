import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { pickTeam } from "./pickers";

// INVENTARIS › RETUR — THE WAREHOUSE'S REAL LIST OF RETURNS (#110), END TO END on the real server. Regression only: no
// acceptance then names the Retur list (docs/acceptances/inventory/return.md), so there is no `then:` step here.
//
// Business rules (docs/business/inventory/return_decision.md):
// - the-retur-menu-is-the-warehouses-return-list — /inventories/returns lists the returns of the orders this warehouse
//   ships and of the selling teams whose return warehouse it is, from the real data; a waiting row opens the accept page.
// - the-retur-list-prototype-is-accepted (*As drawn*) — tabs Awaiting acceptance / Accepted / All, counted over the
//   filters; a row = resi + unit count, newest first, no money; a lost return leaves the list; search, Asked date,
//   seller, marketplace and courier with the tab kept in the URL; Accept only on a return addressed HERE and only for a
//   writer, opening /warehouse-orders/:id/accept-return with the list's address; *Returns to <warehouse>* and no Accept
//   otherwise; an accepted row, and every row for a monitor, opens /warehouse-orders/:id; one block per return on a
//   phone; the old /inventories/returns/:returnId lands on the list.
// - only-the-return-warehouse-accepts-a-return (docs/business/order/context_decision.md); the-admin-team-monitors-read-only.
//
// WHO WRITES (pages/returns: `canWrite`): every warehouse role — Owner, Admin, Staff — accepts and receives; only a
// MONITOR (the admin team reading a warehouse it is not in) reads without Accept or Receive a Return.
//
// GROUND (setup, as root through the API): seller T returns to warehouse R; R and S each ship T's orders.
//   A — shipped from R, 2 units, claimed back: addressed to R (R shipped it AND is the return warehouse);
//   B — shipped from S, 3 units, claimed back: addressed to R (its return warehouse), shipped from S;
//   C — shipped from R, 1 unit, claimed back and then lost: on no tab.
// R and S are this file's own warehouses, so their lists hold only these orders — and every read is still narrowed by
// the orders' shared ref (TOKEN, `return-list-search`), since the database is shared by the whole run.

const SUFFIX = Date.now().toString().slice(-6);
const TOKEN = `RZL${SUFFIX}`;
const SELLER_NAME = `E2E RetList Seller ${SUFFIX}`;
const SELLER_CODE = `RZS${SUFFIX}`;
const R_NAME = `E2E RetList Return WH ${SUFFIX}`;
const S_NAME = `E2E RetList Ship WH ${SUFFIX}`;
const STAFF = `e2erzstaff${SUFFIX}`;
const MONITOR = `e2erzmon${SUFFIX}`;
const PASSWORD = "e2e-retur-list-1";
const RESI = { A: `RZRESIA${SUFFIX}`, B: `RZRESIB${SUFFIX}`, C: `RZRESIC${SUFFIX}` };

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

// Made in the setup, read by the tests after it — the file runs serially, in one worker.
const state = {
  seller: "",
  r: "",
  s: "",
  rRack: "",
  a: "",
  aItem: "",
  b: "",
  c: "",
};

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

async function asTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

/** The Retur list, narrowed to this file's orders (and `extra` query parameters), its page landed. */
async function openList(page: Page, extra = "") {
  await page.goto(`/inventories/returns?q=${TOKEN}${extra}`);
  await expect(page.getByTestId("return-list-page")).toBeVisible();
  await expect(page.getByTestId("return-list-loading")).toHaveCount(0, { timeout: 15_000 });
}

const row = (page: Page, id: string) => page.getByTestId(`return-list-row-${id}`);

/** The rows' order ids, top to bottom. */
const rowIds = (page: Page) =>
  page
    .locator('[data-testid^="return-list-row-"]')
    .evaluateAll((els) => els.map((el) => (el.getAttribute("data-testid") ?? "").replace("return-list-row-", "")));

async function counts(page: Page, waiting: string, accepted: string, all: string) {
  await expect(page.getByTestId("return-list-tab-count-waiting")).toHaveText(waiting);
  await expect(page.getByTestId("return-list-tab-count-accepted")).toHaveText(accepted);
  await expect(page.getByTestId("return-list-tab-count-all")).toHaveText(all);
}

test.describe.configure({ mode: "serial" });

test("setup: a seller returning to warehouse R, a second warehouse S, the crew, a monitor, three returns (one lost)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  state.seller = await team(SELLER_NAME, SELLER_CODE, "TEAM_TYPE_SELLING");
  const shop = (
    await ok(page, "selling.v1.ShopService/ShopCreate", {
      teamId: state.seller,
      name: `E2E RetList Shop ${SUFFIX}`,
      shopCode: `RZP${SUFFIX}`,
      marketplace: "MARKETPLACE_SHOPEE",
    })
  ).shop.id;
  await ok(page, "selling.v1.ShopService/ShopUserAdd", { teamId: state.seller, shopId: shop, userId: ROOT_USER_ID });

  state.r = await team(R_NAME, `RZR${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  state.s = await team(S_NAME, `RZW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

  // The seller's returns come back to R, wherever they shipped from (a-team-may-pick-any-return-warehouse) — set before
  // the orders: create refuses a team with none (create-refuses-a-team-with-no-return-warehouse).
  await ok(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
    teamId: state.seller,
    warehouseId: state.r,
  });

  // STOCK FOR THE ORDERS: a rack in each warehouse, one product, a restock of 3 accepted onto each rack (paid from an
  // OPERATIONAL account of the seller's own), and each warehouse's rate. R's rack also takes the accepted return.
  state.rRack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.r, code: `rz-r-${SUFFIX}` })).rack.id);
  const sRack = String((await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.s, code: `rz-s-${SUFFIX}` })).rack.id);
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E RetList ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `RZK${SUFFIX}`,
      name: "Kaos Daftar Retur",
      categoryId: category,
    })
  ).product;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E retur list restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-RZL-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account,
    operational: true,
  });
  for (const [warehouseId, rack] of [
    [state.r, state.rRack],
    [state.s, sRack],
  ] as const) {
    const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: state.seller,
      warehouseId,
      financeAccountId: account,
      items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Daftar Retur", count: 3, total: 30000 }],
    });
    await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouseId,
      requestId: restock.request.id,
      lines: [{ itemId: restock.request.items[0].id, receivedCount: 3, placements: [{ placementId: rack, quantity: 3 }] }],
    });
    await ok(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: warehouseId, feePercent: 1, minFee: 0 });
  }

  // THE CREW: a STAFF member of R. THE MONITOR: an admin team's owner, a member of no warehouse.
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.r,
    username: STAFF,
    password: PASSWORD,
    name: STAFF,
    role: "ROLE_WAREHOUSE_STAFF",
  });
  const admin = await team(`E2E RetList Admin ${SUFFIX}`, `RZA${SUFFIX}`, "TEAM_TYPE_ADMIN");
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: admin,
    username: MONITOR,
    password: PASSWORD,
    name: MONITOR,
    role: "ROLE_ADMIN_OWNER",
  });

  // THREE ORDERS, in this order (newest first puts B above A): each walked to the courier by the warehouse that ships
  // it, then claimed back by the seller.
  for (const [key, warehouseId, quantity] of [
    ["A", state.r, 2],
    ["B", state.s, 3],
    ["C", state.r, 1],
  ] as const) {
    const placed = await ok(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-retur-list-${key}-${SUFFIX}`,
      // Every order names its courier (no-order-without-a-courier).
      shipmentChannelId: "1",
      teamId: state.seller,
      shopId: shop,
      warehouseId,
      customerName: `E2E RetList Buyer ${key} ${SUFFIX}`,
      platformTotal: 175000,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: `${TOKEN}${key}`,
      receiptCode: RESI[key],
      items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Daftar Retur", quantity }],
    });
    const id = String(placed.order.id);
    if (key === "A") state.aItem = String(placed.order.items[0].id);
    state[key === "A" ? "a" : key === "B" ? "b" : "c"] = id;

    for (const to of ["ORDER_STATUS_PROCESSED", "ORDER_STATUS_PICKED", "ORDER_STATUS_SHIPPING"]) {
      await move(page, warehouseId, id, to);
    }
    await move(page, state.seller, id, "ORDER_STATUS_RETURN");
  }

  // C never arrives: the seller marks it lost (a-return-that-never-arrives-goes-lost) — it leaves the list.
  await move(page, state.seller, state.c, "ORDER_STATUS_LOST");
});

test("R's owner: both returns addressed here wait under Awaiting acceptance — resi, unit count, newest first, no money; the lost one is on no tab", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await asTeam(page, state.r);
  await page.goto("/inventories/returns");
  await expect(page.getByTestId("return-list-page")).toBeVisible();

  // The search narrows by the orders' ref and lands in the URL.
  await page.getByTestId("return-list-search").fill(TOKEN);
  await expect(page).toHaveURL(new RegExp(`[?&]q=${TOKEN}(&|$)`));

  // Waiting is the first tab, and the tabs count over the filters.
  await expect(page.getByTestId("return-list-tab-waiting")).toHaveAttribute("aria-selected", "true");
  await counts(page, "2", "0", "2");

  // A (R shipped it) and B (R is its return warehouse) — newest first; C, lost, is not here.
  await expect.poll(() => rowIds(page)).toEqual([state.b, state.a]);
  await expect(row(page, state.c)).toHaveCount(0);

  for (const [id, resi, units] of [
    [state.a, RESI.A, "2"],
    [state.b, RESI.B, "3"],
  ] as const) {
    await expect(page.getByTestId(`return-list-order-${id}`)).toHaveText(`#${id}`);
    await expect(row(page, id).getByTestId("order-receipt")).toContainText(resi);
    await expect(page.getByTestId(`return-list-qty-${id}`)).toHaveText(units);
    await expect(page.getByTestId(`return-list-seller-${id}`)).toContainText(SELLER_NAME);
    await expect(page.getByTestId(`return-list-state-${id}`)).toContainText("Awaiting acceptance");
    // When the return was asked is filled (date_field ENTERED_RETURN), not the "—" of an empty date.
    await expect(page.getByTestId(`return-list-asked-${id}`)).toBeVisible();
    // Addressed here: no "Returns to …", and the Accept is offered.
    await expect(page.getByTestId(`return-list-goes-to-${id}`)).toHaveCount(0);
    await expect(page.getByTestId(`return-list-accept-${id}`)).toBeVisible();
    // The Accepted column is the Accepted / All tabs' only.
    await expect(page.getByTestId(`return-list-accepted-${id}`)).toHaveCount(0);
  }

  // No money anywhere on the list (a-warehouse-sees-no-seller-money): the orders' Rp 175.000 is not drawn.
  await expect(page.getByTestId("return-list-page")).not.toContainText("Rp");
  await expect(page.getByTestId("return-list-page")).not.toContainText("175.000");

  // All: the same two — the lost return is on no tab.
  await page.getByTestId("return-list-tab-all").click();
  await expect(page).toHaveURL(/[?&]state=all(&|$)/);
  await expect.poll(() => rowIds(page)).toEqual([state.b, state.a]);
  await expect(row(page, state.c)).toHaveCount(0);

  // Receive a Return (the receive dialog) is in the header.
  await page.getByTestId("return-list-receive").click();
  await expect(page.getByTestId("receive-return-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("receive-return-dialog")).toBeHidden();
});

test("R's owner: Accept opens the accept page with the list's address; accepted, the return moves to Accepted and its row opens the order", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await asTeam(page, state.r);
  await openList(page);
  await expect(row(page, state.a)).toBeVisible();

  await page.getByTestId(`return-list-accept-${state.a}`).click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${state.a}/accept-return$`));

  // A whole parcel: both units sound, onto R's rack.
  await expect(page.getByTestId(`return-accept-ordered-${state.aItem}`)).toHaveText("Ordered 2");
  const rackRow = page.getByTestId(`return-accept-rack-${state.aItem}-0`);
  await rackRow.getByTestId("rack-select").click();
  await rackRow.getByTestId(`rack-select-option-${state.rRack}`).click();
  await expect(page.getByTestId("return-accept-ready")).toBeVisible();
  await page.getByTestId("return-accept-submit").click();
  await page.getByTestId("confirm-action").click();

  // The accept comes back to the list it was opened from — the same narrowed address.
  await expect(page).toHaveURL(new RegExp(`/inventories/returns\\?q=${TOKEN}$`));
  await expect(page.getByTestId("return-list-tab-waiting")).toHaveAttribute("aria-selected", "true");

  // The counts move: one waiting (B), one accepted (A).
  await counts(page, "1", "1", "2");
  await expect.poll(() => rowIds(page)).toEqual([state.b]);

  // Accepted: A, with when it was accepted, the tab's state, no Accept.
  await page.getByTestId("return-list-tab-accepted").click();
  await expect(page).toHaveURL(/[?&]state=accepted(&|$)/);
  await expect.poll(() => rowIds(page)).toEqual([state.a]);
  await expect(page.getByTestId(`return-list-state-${state.a}`)).toContainText("Accepted");
  await expect(page.getByTestId(`return-list-accepted-${state.a}`)).toBeVisible();
  await expect(page.getByTestId(`return-list-accept-${state.a}`)).toHaveCount(0);

  // An accepted row opens the order's page (the-retur-list-prototype-is-accepted, A).
  await row(page, state.a).click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${state.a}$`));
  await expect(page.getByRole("heading", { name: `Order #${state.a}` })).toBeVisible();
});

test("S's crew: the return it shipped back to R reads Returns to R with no Accept; its row opens the accept page's refusal", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await asTeam(page, state.s);
  await openList(page);

  // Only B is S's (it shipped it); A and C never were.
  await counts(page, "1", "0", "1");
  await expect.poll(() => rowIds(page)).toEqual([state.b]);
  await expect(row(page, state.b).getByTestId("order-receipt")).toContainText(RESI.B);
  await expect(page.getByTestId(`return-list-qty-${state.b}`)).toHaveText("3");
  await expect(page.getByTestId(`return-list-goes-to-${state.b}`)).toHaveText(`Returns to ${R_NAME}`);
  await expect(page.getByTestId(`return-list-accept-${state.b}`)).toHaveCount(0);

  // The row opens the accept page, which says where the parcel goes and offers no Accept
  // (only-the-return-warehouse-accepts-a-return); its Back returns to the same list.
  await row(page, state.b).click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${state.b}/accept-return$`));
  await expect(page.getByTestId("return-accept-refused-title")).toHaveText(`This return goes to ${R_NAME}`);
  await expect(page.getByTestId("return-accept-submit")).toHaveCount(0);
  await page.getByTestId("return-accept-back").click();
  await expect(page).toHaveURL(new RegExp(`/inventories/returns\\?q=${TOKEN}$`));
  await expect(row(page, state.b)).toBeVisible();
});

test("R's staff: a writer — Accept on the return waiting here, and Receive a Return", async ({ page }) => {
  await signIn(page, STAFF, PASSWORD);
  await asTeam(page, state.r);
  await openList(page);

  await expect.poll(() => rowIds(page)).toEqual([state.b]);
  await expect(page.getByTestId(`return-list-accept-${state.b}`)).toBeVisible();
  await expect(page.getByTestId("return-list-receive")).toBeVisible();
});

test("Monitor: the admin team reads R's returns with no Accept and no Receive a Return; a waiting row opens the order's page", async ({
  page,
}) => {
  await signIn(page, MONITOR, PASSWORD);
  await asTeam(page, state.r);
  await openList(page, "&state=all");

  await expect.poll(() => rowIds(page)).toEqual([state.b, state.a]);
  await expect(page.getByTestId(`return-list-accept-${state.b}`)).toHaveCount(0);
  await expect(page.locator('[data-testid^="return-list-accept-"]')).toHaveCount(0);
  await expect(page.getByTestId("return-list-receive")).toHaveCount(0);

  // Every row opens the order's page for a monitor — the accept page is a write.
  await row(page, state.b).click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${state.b}$`));
  await expect(page.getByRole("heading", { name: `Order #${state.b}` })).toBeVisible();
});

test("A selling team has no Retur list: the page says it is a warehouse's", async ({ page }) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await asTeam(page, state.seller);
  await page.goto("/inventories/returns");

  await expect(page.getByTestId("returns-not-warehouse")).toBeVisible();
  await expect(page.getByTestId("return-list-page")).toHaveCount(0);
});

test("The tab, the search and the seller survive a reload; a marketplace of none empties it, Clear filters brings it back; an old return link lands on the list", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await asTeam(page, state.r);
  await page.goto("/inventories/returns");
  await expect(page.getByTestId("return-list-page")).toBeVisible();

  await page.getByTestId("return-list-search").fill(TOKEN);
  await page.getByTestId("return-list-tab-all").click();
  await pickTeam(page, page.getByTestId("return-list-team-filter"), SELLER_CODE);

  await expect(page).toHaveURL(new RegExp(`[?&]q=${TOKEN}(&|$)`));
  await expect(page).toHaveURL(/[?&]state=all(&|$)/);
  await expect(page).toHaveURL(new RegExp(`[?&]team=${state.seller}(&|$)`));
  await expect.poll(() => rowIds(page)).toEqual([state.b, state.a]);

  // THE RELOAD keeps all three: the box, the tab, the picked seller — and the list they narrow.
  await page.reload();
  await expect(page.getByTestId("return-list-page")).toBeVisible();
  await expect(page.getByTestId("return-list-search")).toHaveValue(TOKEN);
  await expect(page.getByTestId("return-list-tab-all")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("return-list-team-filter").getByTestId("team-select-selected")).toContainText(SELLER_NAME);
  await counts(page, "1", "1", "2");
  await expect.poll(() => rowIds(page)).toEqual([state.b, state.a]);

  // A marketplace none of them came from: the list empties, the counts with it.
  await page.getByTestId("return-list-marketplace-filter").getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Tokopedia" }).click();
  await expect(page).toHaveURL(/[?&]marketplace=/);
  await expect(page.getByTestId("return-list-empty")).toBeVisible();
  await expect(page.locator('[data-testid^="return-list-row-"]')).toHaveCount(0);
  await counts(page, "0", "0", "0");

  // Clear filters: every filter goes, the tab stays.
  await page.getByTestId("return-list-filters-clear").click();
  await expect(page).not.toHaveURL(/[?&](q|team|marketplace)=/);
  await expect(page.getByTestId("return-list-tab-all")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => rowIds(page)).toEqual([state.b, state.a]);

  // The old sample page's detail address lands on the list (its page is gone).
  await page.goto("/inventories/returns/RTN-0142");
  await expect(page).toHaveURL(/\/inventories\/returns$/);
  await expect(page.getByTestId("return-list-page")).toBeVisible();
});

test("Phone: one block per return — Accept on the waiting one, the accepted one dated; Receive a Return in the header", async ({
  page,
}) => {
  // Signed in wide (the phone shell has no `current-user`), then the phone.
  await page.setViewportSize(WIDE);
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await asTeam(page, state.r);
  await page.setViewportSize(PHONE);
  await openList(page, "&state=all");

  const blocks = page.locator('[data-testid^="return-list-block-"]');
  await expect(blocks).toHaveCount(2);
  await expect(page.getByTestId("return-list-table")).toHaveCount(0);
  await expect(page.locator('[data-testid^="return-list-row-"]')).toHaveCount(0);

  const blockB = page.getByTestId(`return-list-block-${state.b}`);
  await expect(blockB.getByTestId(`return-list-accept-${state.b}`)).toBeVisible();
  await expect(blockB.getByTestId(`return-list-qty-${state.b}`)).toContainText("3");
  await expect(blockB).toContainText(RESI.B);

  const blockA = page.getByTestId(`return-list-block-${state.a}`);
  await expect(blockA.getByTestId(`return-list-accepted-${state.a}`)).toBeVisible();
  await expect(blockA.getByTestId(`return-list-accept-${state.a}`)).toHaveCount(0);
  await expect(blockA.getByTestId(`return-list-qty-${state.a}`)).toContainText("2");
  await expect(blockA).toContainText(RESI.A);

  await expect(page.getByTestId("return-list-receive")).toBeVisible();

  // The accepted block opens the order's page.
  await blockA.getByTestId(`return-list-order-${state.a}`).click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${state.a}$`));
});

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { pickTeam } from "./pickers";
import { signIn } from "./session";
import { API_URL } from "./env";

// GOODS IN TRANSIT ON THE PRODUCT SCREENS, END TO END (docs/technical/frontend/products_decision.md —
// in-transit-is-its-own-figure-beside-siap-and-dikirim, the-in-transit-column-shows-while-any-is-in-transit; the figure
// itself: the-transfer-is-where-goods-in-transit-are) — against the real server and Postgres:
//
//   · a selling team of its own (root its owner, #50) has 10 Kaos Transit at Rp 10.000 on warehouse A's rack;
//   · with no transfer: the list has no Dalam transfer column and the tile reads 0 pcs;
//   · it moves 4 from A to B, and A processes and SHIPS it — the transfer is left on the road: the column, the tile, the
//     phone block's fact (390 px) and the product page show its 4 units, Rp 40.000, never in Siap (A's 6);
//   · under B's lens (the receiver) the list and the product page show the 4; under A's (the sender) they do not, and the
//     list has no column there;
//   · B accepts it: the figure goes to 0 and the column disappears.
//
// Every write is a real RPC as root; every figure is read on screen. Only this team's rows are asserted.

const SUFFIX = Date.now().toString().slice(-6);
const WH_A = `E2E Transit Gudang A ${SUFFIX}`;
const WH_B = `E2E Transit Gudang B ${SUFFIX}`;
const WH_A_CODE = `GTA${SUFFIX}`;
const WH_B_CODE = `GTB${SUFFIX}`;

const state = { seller: "", whA: "", whB: "", rackA: "", rackB: "", product: "", code: "", transfer: "" };

// A seed call that must succeed — its JSON body.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await page.evaluate(
    async ([m, b, apiUrl]) => {
      const bearer =
        window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");

      const r = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify(b),
      });

      return { status: r.status, body: await r.json() };
    },
    [method, body, API_URL] as const,
  );
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// Root, working in the team of its own: the active team is per tab, in sessionStorage (TeamContext).
async function inTheTeam(page: Page) {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), state.seller);
}

// The list, loaded: the product's row and the strip's in-transit tile.
async function gotoList(page: Page, query = "") {
  await page.goto(`/products${query}`);
  await expect(page.getByTestId(`product-row-${state.code}`)).toBeVisible();
}

const tile = (page: Page) => page.getByTestId("products-in-transit-stock-value");
const header = (page: Page) => page.getByTestId("products-in-transit-header");
const cell = (page: Page) => page.getByTestId(`in-transit-${state.code}`);

test.describe.configure({ mode: "serial" });

test("Setup: a selling team of its own, warehouses A and B, 10 units on A's rack", async ({ page }) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, code: string, type: string) =>
    (await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: ROOT_USER_ID })).team
      .id as string;
  state.whA = await team(WH_A, WH_A_CODE, "TEAM_TYPE_WAREHOUSE");
  state.whB = await team(WH_B, WH_B_CODE, "TEAM_TYPE_WAREHOUSE");
  state.seller = await team(`E2E Transit Seller ${SUFFIX}`, `GTS${SUFFIX}`, "TEAM_TYPE_SELLING");

  state.rackA = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.whA, code: `gt-a-${SUFFIX}` })).rack.id;
  state.rackB = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.whB, code: `gt-b-${SUFFIX}` })).rack.id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Transit ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.seller,
      productCodePart: `GT${SUFFIX}`,
      name: "Kaos Transit",
      categoryId: category,
    })
  ).product;
  state.product = product.id;
  state.code = product.productCode;

  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E transit restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-GT-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.seller,
    accountId: account,
    operational: true,
  });

  // 10 at Rp 100.000 — Rp 10.000 a unit — all onto A's rack.
  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: state.seller,
    warehouseId: state.whA,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Transit", count: 10, total: 100000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.whA,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 10, placements: [{ placementId: state.rackA, quantity: 10 }] }],
  });
});

test("No transfer: the list has no Dalam transfer column, and the tile reads 0 pcs", async ({ page }) => {
  await inTheTeam(page);
  await gotoList(page);

  await expect(tile(page)).toHaveText("0 pcs");
  await expect(page.getByTestId("products-in-transit-stock")).toContainText("Rp 0 · between warehouses, at cost");
  // The row's Siap is there, so the table has drawn — and no column beside it.
  await expect(page.getByTestId(`product-row-${state.code}`).getByRole("cell").nth(4)).toHaveText(/^10 pcs/);
  await expect(header(page)).toHaveCount(0);
  await expect(cell(page)).toHaveCount(0);
  await expect(page.getByTestId("products-table").getByRole("columnheader")).toHaveCount(8);
});

test("A transfer of 4 shipped from A to B: the column, the tile and the product page show its 4 units", async ({ page }) => {
  await inTheTeam(page);

  // Opened by the seller, processed and shipped by A — and left on the road.
  const created = await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferCreate", {
    teamId: state.seller,
    fromWarehouseId: state.whA,
    toWarehouseId: state.whB,
    lines: [{ productId: state.product, count: "4" }],
  });
  state.transfer = created.transfer.id;
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferProcess", { teamId: state.whA, transferId: state.transfer });
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferShip", {
    teamId: state.whA,
    transferId: state.transfer,
    receipt: `GTR${SUFFIX}`,
  });

  await gotoList(page);
  await expect(tile(page)).toHaveText("4 pcs");
  await expect(page.getByTestId("products-in-transit-stock")).toContainText("Rp 40.000 · between warehouses, at cost");
  await expect(header(page)).toHaveText("In transit");
  await expect(cell(page)).toHaveText("4 pcs");
  await expect(cell(page)).toHaveAttribute("title", "Rp 40.000");
  // Never in Siap: A's rack holds the 6 left.
  const cells = page.getByTestId(`product-row-${state.code}`).getByRole("cell");
  await expect(cells.nth(4)).toHaveText(/^6 pcs/);
  await expect(cells.nth(6)).toHaveText("4 pcs");

  // The product page: beside Dikirim in the highlight, and the Overview's row for every warehouse.
  await page.goto(`/products/${state.product}`);
  await expect(page.getByTestId("pd-highlight-line")).toContainText("+4 pcs in transit");
  await expect(page.getByTestId("pd-highlight-ready")).toContainText("6 pcs");
  await expect(page.getByTestId("pd-overview-row-inTransit")).toContainText("4 pcs");
  await expect(page.getByTestId("pd-overview-row-inTransit")).toContainText("Rp 40.000 · between warehouses, at cost");
});

test("On a 390 px phone the product's block carries the 4 units as a fact beside Dikirim", async ({ page }) => {
  // Sign in on the desktop shell (login waits for its current-user), then turn the page into a phone.
  await inTheTeam(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoList(page);

  await expect(page.locator("table")).toHaveCount(0);
  const block = page.getByTestId(`product-row-${state.code}`);
  await expect(block.getByTestId(`in-transit-${state.code}`)).toHaveText("4 pcs · Rp 40.000");
  await expect(block.getByText("In transit", { exact: true })).toBeVisible();
  await expect(tile(page)).toHaveText("4 pcs");
});

test("B's lens (the receiver) shows the 4; A's lens (the sender) does not, and its list has no column", async ({ page }) => {
  await inTheTeam(page);

  await gotoList(page, `?warehouse=${state.whB}`);
  await expect(tile(page)).toHaveText("4 pcs");
  await expect(page.getByTestId("products-in-transit-stock")).toContainText(`on its way to ${WH_B}, at cost`);
  await expect(header(page)).toHaveText(`In transit · ${WH_B}`);
  await expect(cell(page)).toHaveText("4 pcs");

  await gotoList(page, `?warehouse=${state.whA}`);
  await expect(page.getByTestId(`product-row-${state.code}`).getByRole("cell").nth(4)).toHaveText(/^6 pcs/);
  await expect(tile(page)).toHaveText("0 pcs");
  await expect(header(page)).toHaveCount(0);
  await expect(cell(page)).toHaveCount(0);

  // The product page's lens: the Overview's row under B, then under A.
  await page.goto(`/products/${state.product}`);
  await expect(page.getByTestId("pd-overview-row-inTransit")).toContainText("4 pcs");
  await pickTeam(page, page.getByTestId("pd-warehouse-filter"), WH_B_CODE);
  await expect(page.getByTestId("pd-overview-row-inTransit")).toContainText(`Rp 40.000 · on its way to ${WH_B}, at cost`);
  await expect(page.getByTestId("pd-overview-row-inTransit")).toContainText("4 pcs");
  await expect(page.getByTestId("pd-overview-row-ready")).toContainText("0 pcs");

  await pickTeam(page, page.getByTestId("pd-warehouse-filter"), WH_A_CODE);
  await expect(page.getByTestId("pd-overview-row-inTransit")).toContainText(`on its way to ${WH_A}, at cost`);
  await expect(page.getByTestId("pd-overview-row-inTransit")).toContainText("0 pcs");
  await expect(page.getByTestId("pd-overview-row-ready")).toContainText("6 pcs");
  // Info's total does not move with the lens.
  await expect(page.getByTestId("pd-highlight-line")).toContainText("+4 pcs in transit");
});

test("B accepts it: the figure goes to 0 and the column disappears", async ({ page }) => {
  await inTheTeam(page);

  const detail = await ok<{ transfer: { items: { id: string }[] } }>(
    page,
    "inventory.v1.WarehouseTransferService/WarehouseTransferDetail",
    { teamId: state.whB, transferId: state.transfer },
  );
  await ok(page, "inventory.v1.WarehouseTransferService/WarehouseTransferAccept", {
    teamId: state.whB,
    transferId: state.transfer,
    lines: [{ itemId: detail.transfer.items[0]!.id, arrivedCount: "4", placements: [{ placementId: state.rackB, quantity: "4" }] }],
  });

  await gotoList(page);
  // The 4 are on B's shelf now: Siap back to 10, nothing in transit, no column.
  await expect(page.getByTestId(`product-row-${state.code}`).getByRole("cell").nth(4)).toHaveText(/^10 pcs/);
  await expect(tile(page)).toHaveText("0 pcs");
  await expect(header(page)).toHaveCount(0);
  await expect(cell(page)).toHaveCount(0);
  await expect(page.getByTestId("products-table").getByRole("columnheader")).toHaveCount(8);

  await page.goto(`/products/${state.product}`);
  await expect(page.getByTestId("pd-highlight-line")).toContainText("+0 pcs in transit");
  await expect(page.getByTestId("pd-overview-row-inTransit")).toContainText("0 pcs");
});

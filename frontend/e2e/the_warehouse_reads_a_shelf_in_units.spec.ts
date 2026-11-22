import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// A WAREHOUSE READS A RACK'S VALUE AGAIN — the file keeps its old name (it is on the tester's lists), but the rule it
// pinned is gone. docs/business/analytic/rpc_provide_decision.md — a-warehouse-sees-ready-value-but-a-shelf-only-units —
// read the placement level in units only for a warehouse (2026-11-12); its 🔄 2026-11-20 line takes the owner's later word,
// his acceptance checklist (docs/acceptances/inventory/placement.md given 11: `warehouse:all` opens a rack and reads
// *each product with its units and value*), and the ✅ Built 2026-11-20 line (backlog #109) ends the shelf-in-units gate:
// RackDetail and RackStock give a warehouse the rack's value, the unknown-cost count and each line's price, cost-known and
// value, as every other reader; the rack page draws the tile's value, Unit cost · Value and a phone block's price line
// for it again. The rack LIST still shows counts only — products and units, no rupiah.
//
// So, end to end on the real server: the warehouse's Owner reads the shelf's value — on the response and on the screen;
// its staff, on a phone, reads each block's price line; Root, from OUTSIDE the warehouse (no role in it, in by the
// root-team bypass), keeps every figure as before; and the Racks list stays in counts.
//
// A warehouse of its own, owned by Wati (made first in a scratch team of root's, so root holds no role in it), with Sari
// as its staff: Kaos Rak, 10 units on one rack at Rp 12.500 — Rp 125.000. The goods are the scratch selling team's, and
// its paying account opens at 0 there, never in root's team. The file sorts after statement.spec.ts.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-rak-pass-1";
// A username is lowercase letters and digits only.
const WATI = `e2erakwati${SUFFIX}`;
const SARI = `e2eraksari${SUFFIX}`;
const RACK_CODE = `rak-u-${SUFFIX}`;

const state = { warehouse: "", rack: "", product: "" };

async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);
}

// The real contract under the signed-in token; a refusal fails here, by name.
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

// Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

interface ShelfLine {
  productId: string;
  onHand: string;
  unitCost?: number;
  costKnown?: boolean;
  value?: number;
}

// The shelf as the server answers the signed-in person — the read itself, under the real access interceptor.
async function shelfRead(page: Page): Promise<{ line: ShelfLine; summary: Record<string, unknown> }> {
  const stock = await ok<{ items: { rackStock?: { mapData: Record<string, ShelfLine> } }[] }>(
    page,
    "inventory.v1.RackService/RackStock",
    {
      teamId: state.warehouse,
      filter: { rackId: state.rack },
      dataRequest: ["RACK_STOCK_DATA_TYPE_RACK_STOCK"],
      page: { page: 1, limit: 20 },
    },
  );
  const detail = await ok<{ summary: Record<string, unknown> }>(page, "inventory.v1.RackService/RackDetail", {
    teamId: state.warehouse,
    rackId: state.rack,
  });

  return { line: stock.items[0]!.rackStock!.mapData[state.product]!, summary: detail.summary };
}

// The server gives the reader the rack's value and the line's price, cost-known and value: 10 × Rp 12.500.
function expectValued({ line, summary }: { line: ShelfLine; summary: Record<string, unknown> }) {
  expect(line.onHand).toBe("10");
  expect(line.unitCost).toBe(12500);
  expect(line.costKnown).toBe(true);
  expect(line.value).toBe(125000);
  expect(summary.totalOnHand).toBe("10");
  expect(summary.totalValue).toBe(125000);
  expect(summary.unknownCostProducts).toBe(0);
}

// The rack page, its shelf read: Kaos Rak's 10 on it.
async function openTheRack(page: Page) {
  await page.goto(`/inventories/racks/${state.rack}`);
  await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${state.product}`)).toHaveText("10");
  await expect(page.getByTestId("rack-summary-count")).toContainText("10");
}

// The tile's value, and the line's unit price and value — drawn for the reader the server sent them to.
async function theShelfIsPriced(page: Page) {
  await expect(page.getByTestId("rack-summary-value")).toHaveText("Rp 125.000");
  await expect(page.getByTestId(`rack-unit-cost-${state.product}`)).toHaveText("Rp 12.500");
  await expect(page.getByTestId(`rack-line-value-${state.product}`)).toHaveText("Rp 125.000");
  // Every product's cost is known, so the value is no floor and the tile carries no warning.
  await expect(page.getByTestId("rack-summary-unknown-cost")).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });

test("Setup: Wati's warehouse — root not in it — with Sari as staff and 10 Kaos Rak on one rack at Rp 12.500", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // TeamCreate names an EXISTING person as the Owner, so Wati's account is made first, in a scratch team of root's —
  // which is also the selling team that owns the goods.
  const scratch = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Rak Scratch ${SUFFIX}`,
      teamCode: `RX${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id as string;
  const wati = (
    await ok(page, "user.v1.UserService/CreateUser", {
      teamId: scratch,
      username: WATI,
      password: PASSWORD,
      name: `Wati Rak ${SUFFIX}`,
      role: "ROLE_SELLING_ADMIN",
    })
  ).user.id as string;
  state.warehouse = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Rak Gudang ${SUFFIX}`,
      teamCode: `RW${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: wati,
    })
  ).team.id as string;
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.warehouse,
    username: SARI,
    password: PASSWORD,
    name: `Sari Rak ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  state.rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: RACK_CODE })).rack
    .id as string;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Rak ${SUFFIX}` })).category
    .id as string;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: scratch,
      productCodePart: `RK${SUFFIX}`,
      name: "Kaos Rak",
      categoryId: category,
    })
  ).product;
  state.product = product.id;

  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: scratch,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E rak restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-RAK-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id as string;
  // A restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account).
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: scratch,
    accountId: account,
    operational: true,
  });

  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: scratch,
    warehouseId: state.warehouse,
    financeAccountId: account,
    items: [{ productId: product.id, productCode: product.productCode, name: "Kaos Rak", count: 10, total: 125000 }],
  });
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: [{ itemId: restock.request.items[0].id, receivedCount: 10, placements: [{ placementId: state.rack, quantity: 10 }] }],
  });
});

// Each person signs in on a fresh page of their own — one test each.
test("Wati, the warehouse's Owner, reads the rack's value: the read sends each line's price and value, and the page draws them", async ({
  page,
}) => {
  await login(page, WATI, PASSWORD);
  await useTeam(page, state.warehouse);

  // The server: the units AND the money, as every reader gets them.
  expectValued(await shelfRead(page));

  await openTheRack(page);
  // Five columns — the shelf priced: Unit cost and Value beside the count.
  await expect(page.getByTestId("rack-detail-stock").getByRole("columnheader")).toHaveText([
    "Product",
    "Team",
    "On this rack",
    "Unit cost",
    "Value",
  ]);
  await theShelfIsPriced(page);
});

test("Sari, staff, on a phone: the read sends the money, and each block carries its price line", async ({ page }) => {
  await login(page, SARI, PASSWORD);
  await useTeam(page, state.warehouse);
  // The phone shell after signing in — login() waits for the desktop shell's current user.
  await page.setViewportSize({ width: 390, height: 844 });

  expectValued(await shelfRead(page));

  await openTheRack(page);
  await expect(page.getByTestId(`rack-stock-row-${state.product}`)).toContainText("On this rack 10");
  await expect(page.getByTestId(`rack-line-price-${state.product}`)).toHaveText("Rp 12.500 × 10 … Rp 125.000");
  await theShelfIsPriced(page);
});

test("Root, from outside the warehouse, keeps the price and the value", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.warehouse);

  expectValued(await shelfRead(page));

  await openTheRack(page);
  await theShelfIsPriced(page);

  // …and on a phone, the block's price line.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId(`rack-line-price-${state.product}`)).toHaveText("Rp 12.500 × 10 … Rp 125.000");
});

// The rack LIST is not the rack: it stays in counts — how many products and units each rack holds, no value anywhere
// (#109 changed the rack page alone).
test("The rack list still shows counts only: Wati reads 1 product · 10 units on the rack's row, and no rupiah", async ({
  page,
}) => {
  await login(page, WATI, PASSWORD);
  await useTeam(page, state.warehouse);

  // The contract: each rack's stock total is its rack id, its unit count and its product count — nothing priced.
  const list = await ok<{ items: { stock?: { mapData: Record<string, Record<string, unknown>> } }[] }>(
    page,
    "inventory.v1.RackService/RackList",
    {
      teamId: state.warehouse,
      filter: { q: RACK_CODE },
      dataRequest: ["RACK_LIST_DATA_TYPE_RACK", "RACK_LIST_DATA_TYPE_STOCK"],
      page: { page: 1, limit: 20 },
    },
  );
  const total = list.items.find((it) => it.stock)?.stock?.mapData[state.rack];
  expect(total).toBeDefined();
  expect(total!.stockCount).toBe("10");
  expect(total!.productCount).toBe(1);
  expect(Object.keys(total!).sort()).toEqual(["productCount", "rackId", "stockCount"]);

  // The screen: the row's two counts, and no Rp on the row nor on the list's figures.
  await page.goto("/inventories/racks");
  const row = page.getByTestId(`rack-row-${RACK_CODE}`);
  await expect(row.getByTestId(`rack-products-${RACK_CODE}`)).toHaveText("1");
  await expect(row.getByTestId(`rack-stock-${RACK_CODE}`)).toHaveText("10");
  await expect(row).not.toContainText("Rp");
  await expect(page.getByTestId("racks-summary")).toBeVisible();
  await expect(page.getByTestId("racks-summary")).not.toContainText("Rp");
});

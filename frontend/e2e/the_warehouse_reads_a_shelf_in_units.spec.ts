import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// A WAREHOUSE READS A SHELF IN UNITS ONLY, end to end on the real server (docs/business/analytic/rpc_provide_decision.md
// — a-warehouse-sees-ready-value-but-a-shelf-only-units): at the placement level — a rack and what sits on it — a caller
// acting with a warehouse role is given no unit price and no value. The rack page then draws the units alone: the tile
// without its value line, the shelf without Harga/pcs and Nilai, a phone's block without its price line — no Rp anywhere
// on the shelf. Root, from OUTSIDE the warehouse (no role in it, in by the root-team bypass), keeps every figure.
//
// A warehouse of its own, owned by Wati (made first in a scratch team of root's, so root holds no role in it), with Sari
// as its staff: Kaos Rak, 10 units on one rack at Rp 12.500 — Rp 125.000. The goods are the scratch selling team's, and
// its paying account opens at 0 there, never in root's team. The file sorts after statement.spec.ts.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-rak-pass-1";
// A username is lowercase letters and digits only.
const WATI = `e2erakwati${SUFFIX}`;
const SARI = `e2eraksari${SUFFIX}`;

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

// The rack page, its shelf read: Kaos Rak's 10 on it.
async function openTheRack(page: Page) {
  await page.goto(`/inventories/racks/${state.rack}`);
  await expect(page.getByTestId("rack-detail-stock").getByTestId(`rack-stock-onhand-${state.product}`)).toHaveText("10");
  await expect(page.getByTestId("rack-summary-count")).toContainText("10");
}

// No rupiah on the shelf: the card strip, the Produk section, and none of the money test ids.
async function noRupiahOnTheShelf(page: Page) {
  await expect(page.getByTestId("rack-summary")).not.toContainText("Rp");
  await expect(page.getByTestId("rack-products-panel")).not.toContainText("Rp");
  await expect(page.getByTestId("rack-summary-value")).toHaveCount(0);
  await expect(page.getByTestId(`rack-unit-cost-${state.product}`)).toHaveCount(0);
  await expect(page.getByTestId(`rack-line-value-${state.product}`)).toHaveCount(0);
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

  state.rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: `rak-u-${SUFFIX}` }))
    .rack.id as string;
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
test("Wati, the warehouse's Owner, reads the shelf in units: the read sends no price, and the page draws none", async ({
  page,
}) => {
  await login(page, WATI, PASSWORD);
  await useTeam(page, state.warehouse);

  // The server: the units, and the money UNSET — not 0.
  const { line, summary } = await shelfRead(page);
  expect(line.onHand).toBe("10");
  expect(line).not.toHaveProperty("unitCost");
  expect(line).not.toHaveProperty("costKnown");
  expect(line).not.toHaveProperty("value");
  expect(summary.totalOnHand).toBe("10");
  expect(summary).not.toHaveProperty("totalValue");
  expect(summary).not.toHaveProperty("unknownCostProducts");

  await openTheRack(page);
  // Three columns — no empty money columns left behind.
  await expect(page.getByTestId("rack-detail-stock").getByRole("columnheader")).toHaveText([
    "Product",
    "Team",
    "On this rack",
  ]);
  await noRupiahOnTheShelf(page);
});

test("Sari, staff, on a phone: each block is the units alone, no price line", async ({ page }) => {
  await login(page, SARI, PASSWORD);
  await useTeam(page, state.warehouse);
  // The phone shell after signing in — login() waits for the desktop shell's current user.
  await page.setViewportSize({ width: 390, height: 844 });

  await openTheRack(page);
  await expect(page.getByTestId(`rack-stock-row-${state.product}`)).toContainText("On this rack 10");
  await expect(page.getByTestId(`rack-line-price-${state.product}`)).toHaveCount(0);
  await noRupiahOnTheShelf(page);
});

test("Root, from outside the warehouse, keeps the price and the value", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.warehouse);

  const { line, summary } = await shelfRead(page);
  expect(line.unitCost).toBe(12500);
  expect(line.costKnown).toBe(true);
  expect(line.value).toBe(125000);
  expect(summary.totalValue).toBe(125000);
  expect(summary.unknownCostProducts).toBe(0);

  await openTheRack(page);
  await expect(page.getByTestId("rack-summary-value")).toHaveText("Rp 125.000");
  await expect(page.getByTestId(`rack-unit-cost-${state.product}`)).toHaveText("Rp 12.500");
  await expect(page.getByTestId(`rack-line-value-${state.product}`)).toHaveText("Rp 125.000");

  // …and on a phone, the block's price line.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId(`rack-line-price-${state.product}`)).toHaveText("Rp 12.500 × 10 … Rp 125.000");
});

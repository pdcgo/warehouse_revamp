import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE RACK LIST LEADS WITH ITS FIGURES — over the WHOLE list, never the page
// (docs/technical/frontend/racks_decision.md#the-rack-list-leads-with-its-figures, built 2026-11-16): Racks is the list's
// own total; Holding stock, Empty and Stock on racks are summed on the server (RackStat) over EVERY rack the list matches,
// whatever page is open — and a search narrows them too, since they describe the list as it is shown. Holding stock = a
// rack whose stock count is above 0 (an-empty-rack-says-so), Empty = the rest, Stock on racks = their pieces.
//
// A warehouse of its own, owned by root, with 22 racks — 20 a page, so two of them live on page 2:
//
//   fg<S>-01 … -12   "Lorong Atas"    01: 5 P · 02: 3 P
//   fg<S>-13 … -22   "Lorong Bawah"   13: 6 Q · 21: 7 P + 4 Q        ← 21 is on page 2
//
//   whole list   22 racks · 4 holding stock · 18 empty · 25 pcs   (page 1's rows alone: 14 pcs)
//   "Bawah"      10 racks · 2 · 8 · 17 pcs
//   "Atas"       12 racks · 2 · 10 · 8 pcs
//   "-21"         1 rack  · 1 · 0 · 11 pcs
//
// The goods are a selling team's of its own (root-owned), paid from that team's account — root's team 1 is never
// touched. The file sorts after statement.spec.ts.

const SUFFIX = Date.now().toString().slice(-6);
const CODE = (n: number) => `fg${SUFFIX}-${String(n).padStart(2, "0")}`;

const state = { warehouse: "", racks: [] as string[] };

async function call(page: Page, method: string, body: unknown) {
  return page.evaluate(
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
}

// A seed call that must succeed — a refusal fails here, by name.
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

async function useTeam(page: Page, teamId: string) {
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
}

// RackStat as the contract answers it — int64 travels as a string, and a 0 is left out.
async function rackStat(page: Page, q = "") {
  const res = await ok<{ preview?: Record<string, string> }>(page, "inventory.v1.RackService/RackStat", {
    teamId: state.warehouse,
    filter: { q },
  });
  const p = res.preview ?? {};

  return [p.rackCount, p.filledCount, p.emptyCount, p.stockCount].map((v) => Number(v ?? 0));
}

// The four cards, as the page shows them.
async function expectFigures(page: Page, racks: string, filled: string, empty: string, stock: string) {
  await expect(page.getByTestId("racks-stat-racks-value")).toHaveText(racks);
  await expect(page.getByTestId("racks-stat-filled-value")).toHaveText(filled);
  await expect(page.getByTestId("racks-stat-empty-value")).toHaveText(empty);
  await expect(page.getByTestId("racks-stat-stock-value")).toHaveText(stock);
}

test.describe.configure({ mode: "serial" });

test("Setup: a warehouse of 22 racks, goods on four of them — one of those on page 2", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  state.warehouse = await team(`E2E Figures Gudang ${SUFFIX}`, `FW${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const seller = await team(`E2E Figures Seller ${SUFFIX}`, `FS${SUFFIX}`, "TEAM_TYPE_SELLING");

  for (let n = 1; n <= 22; n++) {
    const rack = await ok(page, "inventory.v1.RackService/RackCreate", {
      teamId: state.warehouse,
      code: CODE(n),
      name: n <= 12 ? "Lorong Atas" : "Lorong Bawah",
    });
    state.racks[n] = String(rack.rack.id);
  }

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Figures ${SUFFIX}` })).category
    .id as string;
  const product = async (code: string, name: string) =>
    (await ok(page, "product.v1.ProductService/ProductCreate", { teamId: seller, productCodePart: code, name, categoryId: category }))
      .product as { id: string; productCode: string };
  const p = await product(`FGP${SUFFIX}`, "Kaos Figur");
  const q = await product(`FGQ${SUFFIX}`, "Topi Figur");

  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E figures restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-FIG-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id as string;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: seller,
    accountId: account,
    operational: true,
  });

  const restock = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: seller,
    warehouseId: state.warehouse,
    financeAccountId: account,
    items: [
      { productId: p.id, productCode: p.productCode, name: "Kaos Figur", count: 15, total: 150_000 },
      { productId: q.id, productCode: q.productCode, name: "Topi Figur", count: 10, total: 50_000 },
    ],
  });
  const itemOf = (productId: string) =>
    (restock.request.items as { id: string; productId: string }[]).find((it) => it.productId === productId)!.id;

  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: [
      {
        itemId: itemOf(p.id),
        receivedCount: 15,
        placements: [
          { placementId: state.racks[1], quantity: 5 },
          { placementId: state.racks[2], quantity: 3 },
          { placementId: state.racks[21], quantity: 7 },
        ],
      },
      {
        itemId: itemOf(q.id),
        receivedCount: 10,
        placements: [
          { placementId: state.racks[13], quantity: 6 },
          { placementId: state.racks[21], quantity: 4 },
        ],
      },
    ],
  });
});

test("RackStat: the figures are the whole list's — every page — and a search narrows them", async ({ page }) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  // racks · holding stock · empty · pieces
  await expect.poll(() => rackStat(page)).toEqual([22, 4, 18, 25]);
  expect(await rackStat(page, "bawah")).toEqual([10, 2, 8, 17]);
  expect(await rackStat(page, "Atas")).toEqual([12, 2, 10, 8]);
  expect(await rackStat(page, `${SUFFIX}-21`)).toEqual([1, 1, 0, 11]);
  // A search that matches nothing is nothing — not the whole list.
  expect(await rackStat(page, `nothing-${SUFFIX}`)).toEqual([0, 0, 0, 0]);

  // Racks is the same number the list pages over.
  const list = await ok<{ pageInfo?: { totalItems?: string } }>(page, "inventory.v1.RackService/RackList", {
    teamId: state.warehouse,
    filter: { q: "" },
    page: { page: 1, limit: 20 },
  });
  expect(Number(list.pageInfo?.totalItems ?? 0)).toBe(22);
});

test("The page: the cards count page 2's rack too; the search narrows them; clearing it brings the whole list back", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await useTeam(page, state.warehouse);
  await page.goto("/inventories/racks");
  await expect(page.getByTestId("racks-table")).toBeVisible();

  // Page 1 holds 20 racks: rack 21 — 11 pcs on it — is on page 2, and the cards still count it.
  await expect(page.getByTestId(`rack-row-${CODE(20)}`)).toBeVisible();
  await expect(page.getByTestId(`rack-row-${CODE(21)}`)).toHaveCount(0);
  await expectFigures(page, "22", "4", "18", "25 pcs");

  // The page's own rows add up to less — the figures are not the page's.
  const onPage = await page
    .getByTestId("racks-table")
    .locator(`[data-testid^="rack-stock-${"fg" + SUFFIX}-"]`)
    .allInnerTexts();
  expect(onPage.reduce((sum, text) => sum + Number(text.replace(/\D/g, "") || 0), 0)).toBe(14);

  // No mark on the figures — they are exact now (the pageTotals mark is gone).
  await expect(page.getByTestId("not-implemented-pageTotals")).toHaveCount(0);

  // A search narrows them: the Bawah aisle — 10 racks, 13 and 21 holding 17 pcs.
  await page.getByTestId("rack-search").fill("Bawah");
  await expect(page).toHaveURL(/[?&]q=Bawah/);
  await expectFigures(page, "10", "2", "8", "17 pcs");
  await expect(page.getByTestId(`rack-row-${CODE(21)}`)).toBeVisible();
  await expect(page.getByTestId(`rack-row-${CODE(1)}`)).toHaveCount(0);

  // One rack by its code.
  await page.getByTestId("rack-search").fill(`${SUFFIX}-21`);
  await expectFigures(page, "1", "1", "0", "11 pcs");

  // Cleared, the whole list's figures again.
  await page.getByTestId("rack-search").fill("");
  await expectFigures(page, "22", "4", "18", "25 pcs");
});

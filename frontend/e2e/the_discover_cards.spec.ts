import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { pickTeam } from "./pickers";

// DISCOVER'S CARDS AND ITS KUNCI, END TO END (a-discover-card-shows-its-stock, discover-shows-the-cross-price,
// a-discover-card-says-locked-as-the-title-does, discover-filters-by-lock, a-minimum-closes-only-under-it) — against the
// real server and Postgres: the cards read inventory's DiscoverStockByIds (one call for the page), and ProductDiscover
// narrows its count and page by Kunci, asking inventory's batches for the minimums in force through the composition root.
//
// Root browses from A SELLING TEAM OF THIS SPEC'S OWN (backlog #50: a spec asserts only on its own rows) and looks at
// ANOTHER selling team of its own — the Discover page narrowed to that owner (`?team=`), so no other spec's product is on
// screen. The other team's four products, over two warehouses of the spec's own, every markup 10%:
//
//   Kaos Lain Terbuka   open            Gudang 1: 5 @ 10.000              + 7 on their way   Rp 11.000            Terbuka
//   Kaos Lain Kurang    minimum 10      Gudang 1: 5 @ 20.000, Gudang 2: 4 @ 24.000 = 9       Rp 22.000 – 26.400   Terkunci · Min 10
//   Kaos Lain Pas       minimum 10      Gudang 1: 6, Gudang 2: 4 = EXACTLY 10                                     Min 10 — open
//   Kaos Lain Dikunci   locked          Gudang 1: 2                                                               Dikunci
//
// Kaos Lain Pas is filed under a SUB-category of the spec's own category (a-picked-branch-keeps-its-whole-subtree).
//
// Then Discover's GUDANG, STOK SIAP, HARGA CROSS and KATEGORI (discovers-warehouse-keeps-ready-stock-there,
// discover-ranges-are-picked, a-cross-band-keeps-a-range-that-touches-it) narrow the same grid on the server, and the
// discover DETAIL reads another team's cross price and on-its-way from the cards' own read.
//
// No order is placed; root's own team is never touched.

const SUFFIX = Date.now().toString().slice(-6);
const VIEWER = `E2E Discover Viewer ${SUFFIX}`;

const state = {
  viewer: "",
  owner: "",
  gudang1: "",
  gudang2: "",
  ids: {} as Record<string, string>,
  codes: {} as Record<string, string>,
};

const CATEGORY = `E2E Discover ${SUFFIX}`;
const SUB_CATEGORY = `E2E Discover Sub ${SUFFIX}`;

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok<T = Record<string, any>>(page: Page, method: string, body: unknown): Promise<T> {
  const res = await call(page, method, body);
  expect(res.status, `${method}: ${JSON.stringify(res.body)}`).toBe(200);

  return res.body as T;
}

// Root, browsing Discover from the viewer team, narrowed to the other team's catalogue — and any more filters already in
// the URL (`&warehouse=…`).
async function openDiscover(page: Page, more = "") {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), state.viewer);
  await browseDiscover(page, more);
}

// The same browse again, already signed in and standing in the viewer team — no second sign-in inside one test.
async function browseDiscover(page: Page, more = "") {
  await page.goto(`/products/discover?team=${state.owner}${more}`);
  await expect(page.getByTestId("discover-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(VIEWER);
}

const card = (page: Page, name: string) => page.getByTestId(`discover-card-${state.codes[name]}`);

/** Exactly these of the four are on the grid. */
async function expectCards(page: Page, shown: string[]) {
  for (const name of Object.keys(state.codes)) {
    if (shown.includes(name)) {
      await expect(card(page, name)).toBeVisible();
    } else {
      await expect(card(page, name)).toHaveCount(0);
    }
  }
}

test.describe.configure({ mode: "serial" });

test("Setup: another selling team holds four products over two warehouses, one more on its way", async ({ page }) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, code: string, type: string) =>
    (await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: ROOT_USER_ID })).team.id;

  state.viewer = await team(VIEWER, `DV${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.owner = await team(`E2E Discover Owner ${SUFFIX}`, `DO${SUFFIX}`, "TEAM_TYPE_SELLING");
  const gudang1 = await team(`E2E Discover WH1 ${SUFFIX}`, `DW1${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  const gudang2 = await team(`E2E Discover WH2 ${SUFFIX}`, `DW2${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  state.gudang1 = gudang1;
  state.gudang2 = gudang2;

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: CATEGORY })).category.id;
  const sub = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: SUB_CATEGORY, parentId: category }))
    .category.id;

  // name → [part, locked, minimum]; Pas is filed under the sub-category.
  const catalogue: Record<string, [string, boolean, number]> = {
    "Kaos Lain Terbuka": ["OPEN", false, 0],
    "Kaos Lain Kurang": ["UNDER", false, 10],
    "Kaos Lain Pas": ["AT", false, 10],
    "Kaos Lain Dikunci": ["ALWAYS", true, 0],
  };

  for (const [name, [part, locked, minimum]] of Object.entries(catalogue)) {
    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId: state.owner,
        productCodePart: `${part}${SUFFIX}`,
        name,
        categoryId: name === "Kaos Lain Pas" ? sub : category,
        crossMarkupBps: 1000,
        crossLocked: locked,
        reservedStock: minimum,
      })
    ).product;
    state.ids[name] = product.id;
    state.codes[name] = product.productCode;
  }

  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.owner,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E discover restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-DC-${SUFFIX}`,
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    })
  ).account.id;
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.owner,
    accountId: account,
    operational: true,
  });

  // One restock per warehouse — name → [count, total] — accepted onto the warehouse's rack unless `accept` is false.
  const restock = async (warehouse: string, lines: Record<string, [number, number]>, accept = true) => {
    const created = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: state.owner,
      warehouseId: warehouse,
      financeAccountId: account,
      items: Object.entries(lines).map(([name, [count, total]]) => ({
        productId: state.ids[name],
        productCode: state.codes[name],
        name,
        count,
        total,
      })),
    });

    if (!accept) return;

    const rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `dc-${SUFFIX}` })).rack.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = created.request.items as any[];
    await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: created.request.id,
      lines: items.map((item) => ({
        itemId: item.id,
        receivedCount: Number(item.count),
        placements: [{ placementId: rack, quantity: Number(item.count) }],
      })),
    });
  };

  await restock(gudang1, {
    "Kaos Lain Terbuka": [5, 50_000],
    "Kaos Lain Kurang": [5, 100_000],
    "Kaos Lain Pas": [6, 60_000],
    "Kaos Lain Dikunci": [2, 20_000],
  });
  await restock(gudang2, {
    "Kaos Lain Kurang": [4, 96_000],
    "Kaos Lain Pas": [4, 40_000],
  });
  // Raised, not accepted: on its way.
  await restock(gudang1, { "Kaos Lain Terbuka": [7, 70_000] }, false);
});

test("Cards: another team's product shows its real stock and its cross price — never its cost — from one read", async ({
  page,
}) => {
  const read = page.waitForRequest((r) => r.url().includes("InventoryService/DiscoverStockByIds"));
  await openDiscover(page);
  await expectCards(page, Object.keys(state.codes));

  // ONE read for the whole page, every card on it, every warehouse.
  const body = JSON.parse((await read).postData() ?? "{}");
  expect([...body.productIds].sort()).toEqual(Object.values(state.ids).sort());
  expect(body.warehouseId ?? "0").toBe("0");

  const open = state.ids["Kaos Lain Terbuka"];
  await expect(page.getByTestId(`discover-stock-ready-${open}`)).toContainText("5 pcs");
  await expect(page.getByTestId(`discover-stock-ongoing-${open}`)).toContainText("7 pcs");
  // 10.000 with 10% on top.
  await expect(page.getByTestId(`discover-price-cross-${open}`)).toHaveText(/^Rp\s?11\.000$/);

  // Two warehouses summed, a range over both batches' costs, each with its markup.
  const under = state.ids["Kaos Lain Kurang"];
  await expect(page.getByTestId(`discover-stock-ready-${under}`)).toContainText("9 pcs");
  await expect(page.getByTestId(`discover-price-cross-${under}`)).toHaveText(/^Rp\s?22\.000 – Rp\s?26\.400$/);

  // Another team's card never says a cost.
  for (const id of Object.values(state.ids)) {
    await expect(page.getByTestId(`discover-price-cost-${id}`)).toHaveCount(0);
  }
  await expect(page.getByTestId("not-implemented-crossPrice")).toHaveCount(0);
  await expect(page.getByTestId("not-implemented-cardStock")).toHaveCount(0);
});

test("Cards: the lock badge reads every warehouse — Dikunci, Terkunci under the minimum, Min N at exactly it", async ({
  page,
}) => {
  await openDiscover(page);

  const badge = (name: string) => page.getByTestId(`discover-lock-${state.ids[name]}`);

  await expect(badge("Kaos Lain Dikunci")).toHaveAttribute("data-mode", "always");
  // 9 across both warehouses is under 10.
  await expect(badge("Kaos Lain Kurang")).toHaveAttribute("data-now", "true");
  await expect(badge("Kaos Lain Kurang")).toContainText("Min 10 pcs");
  // 6 + 4 is exactly 10 — open, though Gudang 1 alone is under it.
  await expect(badge("Kaos Lain Pas")).toContainText("Min 10 pcs");
  await expect(badge("Kaos Lain Pas")).not.toHaveAttribute("data-now", "true");
  await expect(badge("Kaos Lain Terbuka")).toHaveCount(0);
});

test("Kunci: Terkunci keeps the locked one and the minimum it is UNDER; Terbuka the rest — exactly at it is open", async ({
  page,
}) => {
  await openDiscover(page);
  await expectCards(page, Object.keys(state.codes));

  const closed = page.waitForRequest(
    (r) => r.url().includes("ProductService/ProductDiscover") && (r.postData() ?? "").includes("PRODUCT_LOCK_FILTER_CLOSED"),
  );
  await page.getByTestId("discover-lock-filter-locked").click();
  await closed;
  await expectCards(page, ["Kaos Lain Kurang", "Kaos Lain Dikunci"]);
  await expect(page.getByTestId("discover-count")).toHaveText(/^2\s/);
  await expect(page).toHaveURL(/lock=locked/);

  const orderable = page.waitForRequest(
    (r) => r.url().includes("ProductService/ProductDiscover") && (r.postData() ?? "").includes("PRODUCT_LOCK_FILTER_ORDERABLE"),
  );
  await page.getByTestId("discover-lock-filter-open").click();
  await orderable;
  await expectCards(page, ["Kaos Lain Terbuka", "Kaos Lain Pas"]);
  await expect(page.getByTestId("discover-count")).toHaveText(/^2\s/);

  // Semua: all four again.
  await page.getByTestId("discover-lock-filter-").click();
  await expectCards(page, Object.keys(state.codes));
});

// ── Gudang, Stok siap, Harga cross, Kategori — narrowed on the server ─────────────────────────────────────────────────

// The grid's next ProductDiscover whose body passes `test`.
function discoverAsked(page: Page, test: (body: Record<string, unknown>) => boolean) {
  return page.waitForRequest((r) => {
    if (!r.url().includes("ProductService/ProductDiscover")) return false;
    try {
      return test(JSON.parse(r.postData() ?? "{}"));
    } catch {
      return false;
    }
  });
}

test("Gudang: only what holds ready units there now — and every card reads that warehouse", async ({ page }) => {
  await openDiscover(page);
  await expectCards(page, Object.keys(state.codes));

  const asked = discoverAsked(page, (b) => b.warehouseId === state.gudang2);
  const cards = page.waitForRequest(
    (r) => r.url().includes("InventoryService/DiscoverStockByIds") && (r.postData() ?? "").includes(`"warehouseId":"${state.gudang2}"`),
  );
  await pickTeam(page, page.getByTestId("discover-filter-warehouse"), `DW2${SUFFIX}`);
  await asked;
  await cards;

  // Gudang 2 holds Kurang (4) and Pas (4) — never Terbuka nor Dikunci, held in Gudang 1 alone.
  await expectCards(page, ["Kaos Lain Kurang", "Kaos Lain Pas"]);
  await expect(page.getByTestId("discover-count")).toHaveText(/^2\s/);
  await expect(page).toHaveURL(new RegExp(`warehouse=${state.gudang2}`));

  // The cards say Gudang 2's figures: 4, not 9 — and 24.000 with 10% on top, not the two warehouses' range.
  const under = state.ids["Kaos Lain Kurang"];
  await expect(page.getByTestId(`discover-stock-ready-${under}`)).toContainText("4 pcs");
  await expect(page.getByTestId(`discover-price-cross-${under}`)).toHaveText(/^Rp\s?26\.400$/);
  // The lock badge still reads every warehouse: 9 of 10, Terkunci.
  await expect(page.getByTestId(`discover-lock-${under}`)).toHaveAttribute("data-now", "true");
});

test("Stok siap: a band keeps the ready stock inside it, both ends included; Kosong keeps nothing here", async ({ page }) => {
  await openDiscover(page);
  await expectCards(page, Object.keys(state.codes));

  // 1–10 over every warehouse: 5, 9, exactly 10 and 2 — all four.
  const band = discoverAsked(page, (b) => JSON.stringify(b.ready) === JSON.stringify({ min: "1", max: "10" }));
  await page.getByTestId("discover-stock-range-chips-1-10").click();
  await band;
  await expectCards(page, Object.keys(state.codes));

  // Kosong: every one of them holds stock.
  const empty = discoverAsked(page, (b) => JSON.stringify(b.ready) === JSON.stringify({ max: "0" }) || JSON.stringify(b.ready) === JSON.stringify({ min: "0", max: "0" }));
  await page.getByTestId("discover-stock-range-chips-0-0").click();
  await empty;
  await expect(page.getByTestId("discover-none-match")).toBeVisible();
  await expectCards(page, []);

  // A range of one's own, 6–9: Kurang is exactly 9; Pas (10) and Terbuka (5) fall outside.
  await page.getByTestId("discover-stock-range-custom").click();
  await page.getByTestId("discover-stock-range-min").fill("6");
  const custom = discoverAsked(page, (b) => JSON.stringify(b.ready) === JSON.stringify({ min: "6", max: "9" }));
  await page.getByTestId("discover-stock-range-max").fill("9");
  await custom;
  await expect(page.getByTestId("discover-count")).toHaveText(/^1\s/);
  await expectCards(page, ["Kaos Lain Kurang"]);
  await expect(page).toHaveURL(/stock=custom/);
  await expect(page).toHaveURL(/stockMin=6/);
  await expect(page).toHaveURL(/stockMax=9/);
});

test("Harga cross: a band keeps a cross range that touches it — and with a Gudang, that warehouse's range", async ({ page }) => {
  await openDiscover(page);
  await expectCards(page, Object.keys(state.codes));

  // 25–50rb: Kurang's 22.000 – 26.400 straddles 25.000; every other is 11.000.
  const band = discoverAsked(page, (b) => JSON.stringify(b.crossPrice) === JSON.stringify({ min: 25000, max: 50000 }));
  await page.getByTestId("discover-cross-range-chips-25000-50000").click();
  await band;
  await expect(page.getByTestId("discover-count")).toHaveText(/^1\s/);
  await expectCards(page, ["Kaos Lain Kurang"]);
  await expect(page).toHaveURL(/cross=25000-50000/);

  // ≤ 10rb: nothing here is that cheap.
  await page.getByTestId("discover-cross-range-chips-0-10000").click();
  await expect(page.getByTestId("discover-none-match")).toBeVisible();
  await expectCards(page, []);

  // From the URL, with a Gudang: in Gudang 1 Kurang is 22.000 — out; in Gudang 2 it is 26.400 — in.
  await browseDiscover(page, `&warehouse=${state.gudang1}&cross=25000-50000`);
  await expect(page.getByTestId("discover-none-match")).toBeVisible();
  await expectCards(page, []);

  await browseDiscover(page, `&warehouse=${state.gudang2}&cross=25000-50000`);
  await expect(page.getByTestId("discover-count")).toHaveText(/^1\s/);
  await expectCards(page, ["Kaos Lain Kurang"]);
});

test("Kategori: a branch keeps everything filed under it, an end category itself", async ({ page }) => {
  await openDiscover(page);
  await expectCards(page, Object.keys(state.codes));

  const field = page.getByTestId("discover-filter-category");
  const pick = async (name: string) => {
    await field.getByTestId("category-select").click();
    await page.getByTestId("category-search").fill(name);
    await page.getByTestId(`category-node-${name}`).click();
  };

  // The sub-category: Pas alone.
  await pick(SUB_CATEGORY);
  await expect(page.getByTestId("discover-count")).toHaveText(/^1\s/);
  await expectCards(page, ["Kaos Lain Pas"]);
  await expect(page).toHaveURL(/category=\d+/);

  // The branch above it: everything — Pas included, filed one level down.
  await pick(CATEGORY);
  await expectCards(page, Object.keys(state.codes));
  await expect(page.getByTestId("discover-count")).toHaveText(/^4\s/);
});

test("Detail: another team's cross price and on-its-way are the card's — real, per warehouse, never a cost", async ({
  page,
}) => {
  await openDiscover(page);
  await page.getByTestId(`discover-open-${state.codes["Kaos Lain Kurang"]}`).click();
  await expect(page.getByTestId("discover-detail-page")).toBeVisible();

  // Info: the card's range — the two warehouses' costs, each with 10% on top.
  await expect(page.getByTestId("discover-detail-cross")).toContainText(/Rp\s?22\.000 – Rp\s?26\.400/);
  // Harga per Gudang: each warehouse its own.
  await expect(page.getByTestId(`discover-stock-cross-${state.gudang1}`)).toHaveText(/^Rp\s?22\.000$/);
  await expect(page.getByTestId(`discover-stock-cross-${state.gudang2}`)).toHaveText(/^Rp\s?26\.400$/);
  await expect(page.getByTestId(`discover-stock-cost-${state.gudang1}`)).toHaveCount(0);
  await expect(page.getByTestId("discover-detail-cost")).toHaveCount(0);
  await expect(page.getByTestId("not-implemented-crossPrice")).toHaveCount(0);
  await expect(page.getByTestId("not-implemented-ongoing")).toHaveCount(0);

  // Terbuka: the 7 raised and not yet accepted are on their way — in every warehouse and in Gudang 1, none in Gudang 2.
  await browseDiscover(page);
  await page.getByTestId(`discover-open-${state.codes["Kaos Lain Terbuka"]}`).click();
  await expect(page.getByTestId("discover-detail-highlight-line")).toContainText("+7 pcs on the way");
  await expect(page.getByTestId("discover-detail-cross")).toContainText(/Rp\s?11\.000/);
  await expect(page.getByTestId("dd-overview-ongoing")).toContainText("7 pcs");

  await pickTeam(page, page.getByTestId("dd-warehouse-filter"), `DW2${SUFFIX}`);
  await expect(page.getByTestId("dd-overview-ongoing")).toContainText("0 pcs");
  await expect(page.getByTestId("dd-overview-cross")).toHaveText("—");
});

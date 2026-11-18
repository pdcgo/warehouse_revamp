import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";
import { pickTeam } from "./pickers";

// THE DISCOVER DETAIL SHOWS ANOTHER TEAM'S WHOLE GALLERY AND ITS REAL STOCK HISTORY — end to end, on the real server and
// Postgres (backlog #69):
//
//   the-discover-detail-shows-no-markup (docs/technical/frontend/products_decision.md) — "the pictures are the product
//     page's gallery": ProductByIds' IMAGES slice, every picture in order, the cover first; the record's cover alone while
//     it loads or when it is refused; IMAGES is Discover's slice, so a WAREHOUSE role asking for it is refused while the
//     rest of ProductByIds still answers it;
//   stock-history-is-everyones — "riwayat stok boleh dibaca semua orang": another team's Riwayat Stok is the OWNER's
//     ledger read through InventoryService.DiscoverStockHistory — units, building, time and the owner's running balance,
//     never a price, value, batch, reason, reference or person; a price correction moved no unit, so it is not a row;
//     the same policy as Discover (no warehouse role);
//   the-discover-history-names-no-batch — the columns are Waktu · Transaksi · Gudang · Perubahan · Sesudahnya;
//   the team's OWN product on the discover detail still reads OwnerStockHistory, unchanged.
//
// The ground, all the spec's own: a VIEWER selling team (root's) looks at a product of ANOTHER selling team (the OWNER,
// root's too) — three pictures; 5 received into Gudang A, 3 into Gudang B, then A's batch price corrected (no unit
// moved). Wawan is STAFF of Gudang A. No order is placed; root's own team is never touched.

const SUFFIX = Date.now().toString().slice(-6);
const PASSWORD = "e2e-ddetail-pass-1";
// A username is lowercase letters and digits only.
const WAWAN = `e2eddwawan${SUFFIX}`;
const VIEWER = `E2E DD Viewer ${SUFFIX}`;
const OWNER = `E2E DD Owner ${SUFFIX}`;
const WH_A = `DDA${SUFFIX}`;
const WH_B = `DDB${SUFFIX}`;

// A small square of one colour, drawn by the browser with no network — each picture its own colour, so the order shows.
const square = (fill: string, size: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><rect width='${size}' height='${size}' fill='${fill}'/></svg>`,
  )}`;
const PICTURES = ["#e11d48", "#4f46e5", "#059669"].map((fill) => ({ url: square(fill, 16), thumbnailUrl: square(fill, 8) }));

const state = {
  viewer: "",
  owner: "",
  whA: "",
  whB: "",
  whAName: "",
  whBName: "",
  product: "",
  code: "",
  // The owner's ledger rows: the two receipts and the price correction.
  receiveA: "",
  receiveB: "",
  correction: "",
  ownerIds: [] as string[],
};

type Movement = Record<string, unknown>;

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

// A ledger answer's rows in its own order — `ids`, each looked up in the MOVEMENT slice.
function rowsOf(res: { ids?: string[]; items?: { movement?: { mapData?: Record<string, Movement> } }[] }) {
  const map = res.items?.find((item) => item.movement)?.movement?.mapData ?? {};

  return (res.ids ?? []).map((id) => ({ id, ...(map[id] ?? {}) }) as Movement & { id: string });
}

const ownerHistory = (page: Page, warehouseId = "0") =>
  ok(page, "inventory.v1.InventoryService/OwnerStockHistory", {
    teamId: state.owner,
    filter: { productId: state.product, warehouseId },
    dataRequest: ["OWNER_STOCK_HISTORY_DATA_TYPE_MOVEMENT"],
    page: { page: 1, limit: 50 },
  });

const discoverHistory = (page: Page, teamId: string, warehouseId = "0") =>
  call(page, "inventory.v1.InventoryService/DiscoverStockHistory", {
    teamId,
    filter: { productId: state.product, warehouseId },
    dataRequest: ["DISCOVER_STOCK_HISTORY_DATA_TYPE_MOVEMENT"],
    page: { page: 1, limit: 50 },
  });

// Root, standing in `team`, on the discover detail of the owner's product.
async function openDetail(page: Page, team = state.viewer) {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  await page.goto(`/products/discover/${state.product}`);
  await expect(page.getByTestId("discover-detail-page")).toBeVisible();
}

// The picture an <img> draws once loaded — 0 while it has not.
const drawn = (img: ReturnType<Page["getByTestId"]>) =>
  expect.poll(() => img.evaluate((el) => ((el as HTMLImageElement).complete ? (el as HTMLImageElement).naturalWidth : 0)));

test.describe.configure({ mode: "serial" });

test("Setup: another selling team's product — three pictures, 5 in Gudang A, 3 in Gudang B, A's price corrected", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, teamCode: string, type: string) =>
    String((await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

  state.viewer = await team(VIEWER, `DDV${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.owner = await team(OWNER, `DDO${SUFFIX}`, "TEAM_TYPE_SELLING");
  state.whAName = `E2E DD Gudang A ${SUFFIX}`;
  state.whBName = `E2E DD Gudang B ${SUFFIX}`;
  state.whA = await team(state.whAName, WH_A, "TEAM_TYPE_WAREHOUSE");
  state.whB = await team(state.whBName, WH_B, "TEAM_TYPE_WAREHOUSE");

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E DD ${SUFFIX}` })).category.id;
  const product = (
    await ok(page, "product.v1.ProductService/ProductCreate", {
      teamId: state.owner,
      productCodePart: `DDP${SUFFIX}`,
      name: `E2E DD Kaos ${SUFFIX}`,
      categoryId: category,
      crossMarkupBps: 1000,
      images: PICTURES,
    })
  ).product;
  state.product = String(product.id);
  state.code = String(product.productCode);

  const account = String(
    (
      await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: state.owner,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: `E2E DD restock ${SUFFIX}`,
        holderName: "E2E",
        accountNumber: `E2E-DD-${SUFFIX}`,
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      })
    ).account.id,
  );
  await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: state.owner,
    accountId: account,
    operational: true,
  });

  // A restock of `count` for `total`, accepted onto a rack of the warehouse.
  const receive = async (warehouse: string, count: number, total: number) => {
    const created = await ok(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: state.owner,
      warehouseId: warehouse,
      financeAccountId: account,
      items: [{ productId: state.product, productCode: state.code, name: `E2E DD Kaos ${SUFFIX}`, count, total }],
    });
    const rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: warehouse, code: `dd-${SUFFIX}` })).rack.id;
    await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse,
      requestId: created.request.id,
      lines: [{ itemId: created.request.items[0].id, receivedCount: count, placements: [{ placementId: rack, quantity: count }] }],
    });
  };
  await receive(state.whA, 5, 50_000);
  await receive(state.whB, 3, 36_000);

  // Gudang A's batch: Rp 10.000 → Rp 12.000 — money only, no unit moves.
  const batches = await ok<{ ids: string[] }>(page, "inventory.v1.InventoryService/BatchList", {
    teamId: state.whA,
    filter: { productId: state.product },
    dataRequest: ["BATCH_LIST_DATA_TYPE_BATCH"],
    page: { page: 1, limit: 10 },
  });
  expect(batches.ids).toHaveLength(1);
  await ok(page, "inventory.v1.InventoryService/BatchRevalue", {
    teamId: state.owner,
    batchId: batches.ids[0],
    expectedPriceUnit: 10000,
    newPriceUnit: 12000,
    reason: "harga nota yang benar",
  });

  // Wawan, staff of Gudang A.
  await ok(page, "user.v1.UserService/CreateUser", {
    teamId: state.whA,
    username: WAWAN,
    password: PASSWORD,
    name: `Wawan DD ${SUFFIX}`,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  // The owner's ledger: the correction and the two receipts.
  const rows = rowsOf(await ownerHistory(page));
  state.ownerIds = rows.map((r) => r.id);
  expect(rows).toHaveLength(3);
  state.correction = rows.find((r) => r.kind === "MOVEMENT_KIND_REVALUATION")!.id;
  state.receiveA = rows.find((r) => r.kind === "MOVEMENT_KIND_RECEIVE" && r.warehouseId === state.whA)!.id;
  state.receiveB = rows.find((r) => r.kind === "MOVEMENT_KIND_RECEIVE" && r.warehouseId === state.whB)!.id;
  expect(state.correction && state.receiveA && state.receiveB).toBeTruthy();
});

test("Gallery: another team's product shows every picture, the cover first, from ProductByIds' IMAGES", async ({ page }) => {
  const asked = page.waitForRequest(
    (r) => r.url().includes("ProductService/ProductByIds") && (r.postData() ?? "").includes("PRODUCT_BY_IDS_DATA_TYPE_IMAGES"),
  );
  await openDetail(page);

  const body = JSON.parse((await asked).postData() ?? "{}");
  expect(body.filter.ids).toEqual([state.product]);
  expect(body.teamId).toBe(state.viewer);

  // Three thumbnails, in the gallery's order; the first picture shown is the cover.
  for (const [i, picture] of PICTURES.entries()) {
    await expect(page.getByTestId(`discover-detail-thumb-${i}`).locator("img")).toHaveAttribute("src", picture.thumbnailUrl);
  }
  await expect(page.getByTestId(`discover-detail-thumb-${PICTURES.length}`)).toHaveCount(0);
  await expect(page.getByTestId("discover-detail-image-0")).toHaveAttribute("src", PICTURES[0]!.url);
  await drawn(page.getByTestId("discover-detail-image-0")).toBeGreaterThan(0);

  // The cover-only mark is gone.
  await expect(page.getByTestId("not-implemented-gallery")).toHaveCount(0);
});

test("Gallery: refused or failing, the page keeps the record's cover — one picture, no thumbnails", async ({ page }) => {
  let refused = 0;
  await page.route("**/warehouse.product.v1.ProductService/ProductByIds", async (route) => {
    if (!(route.request().postData() ?? "").includes("PRODUCT_BY_IDS_DATA_TYPE_IMAGES")) {
      await route.continue();
      return;
    }
    refused += 1;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ code: "permission_denied", message: "refused by the spec" }),
    });
  });

  await openDetail(page);
  await expect.poll(() => refused).toBeGreaterThan(0);

  await expect(page.getByTestId("discover-detail-image-0")).toHaveAttribute("src", PICTURES[0]!.url);
  await expect(page.getByTestId("discover-detail-thumb-0")).toHaveCount(0);
  await expect(page.getByTestId("discover-detail-error")).toHaveCount(0);
  await page.unroute("**/warehouse.product.v1.ProductService/ProductByIds");
});

test("History: another team's Riwayat Stok is the owner's units — no price correction, no batch, no money", async ({ page }) => {
  await openDetail(page);

  const asked = page.waitForRequest((r) => r.url().includes("InventoryService/DiscoverStockHistory"));
  await page.getByTestId("dd-tab-history").click();
  const body = JSON.parse((await asked).postData() ?? "{}");
  expect(body.teamId).toBe(state.viewer);
  expect(body.filter.productId).toBe(state.product);

  const history = page.getByTestId("dd-history");
  await expect(history).toBeVisible();

  // The two receipts, each in its building with the owner's balance there; the price correction is not a row.
  const rowA = history.getByTestId(`pd-history-row-${state.receiveA}`);
  const rowB = history.getByTestId(`pd-history-row-${state.receiveB}`);
  await expect(rowA).toBeVisible();
  await expect(rowB).toBeVisible();
  await expect(history.getByTestId(`pd-history-row-${state.correction}`)).toHaveCount(0);
  await expect(history.locator('[data-testid^="pd-history-row-"]')).toHaveCount(2);

  const cells = (row: typeof rowA) => row.locator("td");
  await expect(cells(rowA).nth(2)).toHaveText(state.whAName);
  await expect(cells(rowA).nth(3)).toHaveText("+5");
  await expect(cells(rowA).nth(4)).toHaveText("5");
  await expect(cells(rowB).nth(2)).toHaveText(state.whBName);
  await expect(cells(rowB).nth(3)).toHaveText("+3");
  await expect(cells(rowB).nth(4)).toHaveText("3");

  // Waktu · Transaksi · Gudang · Perubahan · Sesudahnya — no Batch, and no money anywhere in it.
  const headers = history.locator("th");
  await expect(headers).toHaveCount(5);
  expect((await headers.allTextContents()).join(" | ")).not.toMatch(/batch/i);
  await expect(history).not.toContainText("Rp");
  await expect(page.getByTestId("not-implemented-history")).toHaveCount(0);

  // The warehouse picker narrows it: Gudang B holds only its own receipt.
  await pickTeam(page, page.getByTestId("dd-warehouse-filter"), WH_B);
  await expect(rowA).toHaveCount(0);
  await expect(rowB).toBeVisible();
  await expect(history.locator('[data-testid^="pd-history-row-"]')).toHaveCount(1);
});

test("API: DiscoverStockHistory answers the owner's rows and balances, units only — never price, batch, reason or person", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const owner = rowsOf(await ownerHistory(page));
  const res = await discoverHistory(page, state.viewer);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const rows = rowsOf(res.body);

  // The owner's ledger in its own order, the price correction left out.
  expect(rows.map((r) => r.id)).toEqual(state.ownerIds.filter((id) => id !== state.correction));
  expect(res.body.pageInfo.totalItems).toBe("2");

  const allowed = ["id", "productId", "warehouseId", "kind", "delta", "balance", "createdAtUnix"];
  for (const row of rows) {
    // Only units, building and time — whatever the owner's row carries besides is not sent.
    expect(Object.keys(row).filter((k) => !allowed.includes(k)), `row ${row.id}`).toEqual([]);
    const theirs = owner.find((o) => o.id === row.id)!;
    expect(row.balance).toBe(theirs.balance);
    expect(row.delta).toBe(theirs.delta);
    expect(row.warehouseId).toBe(theirs.warehouseId);
    expect(row.productId).toBe(state.product);
  }

  // One warehouse: only what moved there.
  const inB = await discoverHistory(page, state.viewer, state.whB);
  expect(inB.status).toBe(200);
  expect(rowsOf(inB.body).map((r) => r.id)).toEqual([state.receiveB]);
});

test("A warehouse is refused the gallery and the history — and ProductByIds still answers it without IMAGES", async ({
  page,
}) => {
  await signIn(page, WAWAN, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), state.whA);

  const byIds = (dataRequest: string[]) =>
    call(page, "product.v1.ProductService/ProductByIds", { teamId: state.whA, filter: { ids: [state.product] }, dataRequest });

  const images = await byIds(["PRODUCT_BY_IDS_DATA_TYPE_IMAGES"]);
  expect(images.status, JSON.stringify(images.body)).toBe(403);
  expect(images.body.code).toBe("permission_denied");

  const both = await byIds(["PRODUCT_BY_IDS_DATA_TYPE_PRODUCT", "PRODUCT_BY_IDS_DATA_TYPE_IMAGES"]);
  expect(both.status, JSON.stringify(both.body)).toBe(403);

  // The box on Wawan's shelf is still named for him.
  const row = await byIds(["PRODUCT_BY_IDS_DATA_TYPE_PRODUCT"]);
  expect(row.status, JSON.stringify(row.body)).toBe(200);
  expect(JSON.stringify(row.body)).toContain(state.code);

  const history = await discoverHistory(page, state.whA);
  expect(history.status, JSON.stringify(history.body)).toBe(403);
  expect(history.body.code).toBe("permission_denied");
});

test("Own product: the owner's discover detail still reads its own ledger (OwnerStockHistory), correction included", async ({
  page,
}) => {
  await openDetail(page, state.owner);

  let discoverAsked = false;
  page.on("request", (r) => {
    if (r.url().includes("InventoryService/DiscoverStockHistory")) discoverAsked = true;
  });
  const asked = page.waitForRequest((r) => r.url().includes("InventoryService/OwnerStockHistory"));
  await page.getByTestId("dd-tab-history").click();
  await asked;

  const panel = page.getByTestId("dd-panel-history");
  await expect(panel.getByTestId(`pd-history-row-${state.receiveA}`)).toBeVisible();
  await expect(panel.getByTestId(`pd-history-row-${state.receiveB}`)).toBeVisible();
  // The owner's own ledger keeps its price correction, as the product page does.
  await expect(panel.getByTestId(`pd-history-row-${state.correction}`)).toBeVisible();
  await expect(panel.getByTestId("dd-history")).toHaveCount(0);
  // Still no Batch column on the discover detail.
  await expect(panel.locator("th")).toHaveCount(5);
  expect(discoverAsked).toBe(false);
});

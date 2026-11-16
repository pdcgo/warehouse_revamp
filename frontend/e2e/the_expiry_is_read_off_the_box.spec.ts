import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { listLanded } from "./pickers";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE EXPIRY IS READ OFF THE BOX, END TO END (docs/business/inventory/context_decision.md —
// the-warehouse-types-the-expiry-at-the-accept, the-expiry-report-is-the-batch-list; the screens:
// docs/technical/frontend/batches_decision.md the-expiry-prototypes-are-accepted, products_decision.md
// the-product-pages-side-cards-stack-when-narrow) — against the real server and Postgres, on Indonesian screens:
//
//   · a warehouse and a selling team of its own (root their owner, #50); a restock of two products to the warehouse;
//   · the warehouse counts it in ON THE ACCEPT SCREEN: Susu with an expiry 20 days out, Sabun with none — the confirm
//     lists Susu's *20 hari lagi* and Sabun's —;
//   · the warehouse's Batch list, *Kedaluwarsa ≤ 30 hari*: Susu's batch, with the rack it sits on; Sabun's is not there,
//     and on the whole list its Kedaluwarsa reads —;
//   · the owning team's product page: Susu's batch reads *20 hari lagi*, Sabun's —;
//   · that product page at 1440 with the sidebar open: the side cards below Batch, nothing scrolls sideways.
//
// Every seed is a real RPC as root; the accept and every reading go through the screens. Only this spec's rows are
// asserted.

const SUFFIX = Date.now().toString().slice(-6);
const RACK_CODE = `ex-r-${SUFFIX}`;

const state = { warehouse: "", seller: "", rack: "", susu: "", sabun: "", restock: "", susuBatch: "", sabunBatch: "" };

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

// Root, working in one of its teams, on Indonesian screens: the active team is per tab (sessionStorage, TeamContext),
// the language per browser (localStorage).
async function asTeam(page: Page, teamId: string) {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.evaluate((id) => {
    window.sessionStorage.setItem("warehouse_revamp.team", id);
    window.localStorage.setItem("warehouse.lang", "id");
  }, teamId);
}

/** The Jakarta day `days` from today, `yyyy-mm-dd` — the day the picker's cell carries. */
function jakartaDayIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** Pick `day` on a DatePicker (`testId` its trigger): open it, page to the month, click the day's cell. */
async function pickDay(page: Page, testId: string, day: string) {
  await page.getByTestId(testId).click();
  const content = page.getByTestId(`${testId}-content`);
  await expect(content).toBeVisible();

  const cell = content.locator(`[data-part="table-cell-trigger"][data-value="${day}"]:not([data-outside-range])`);
  for (let step = 0; step < 3 && !(await cell.isVisible()); step++) {
    await content.locator('[data-part="next-trigger"]').filter({ visible: true }).first().click();
  }
  await cell.click();
}

/** Count a line whole on the accept screen: all arrived, every unit onto the spec's rack. */
async function countWhole(page: Page, productId: string) {
  await page.getByTestId(`accept-all-arrived-${productId}`).click();
  const row = page.getByTestId(`accept-placement-${productId}-0`);
  // RackSelect draws its list inline; pick once the list has landed.
  await listLanded(row.getByTestId(`rack-select-option-${state.rack}`));
  await row.getByTestId("rack-select").click();
  await row.getByTestId(`rack-select-option-${state.rack}`).click();
  await expect(page.getByTestId(`accept-balanced-${productId}`)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("Setup: a warehouse and a selling team of its own, a rack, a restock of Susu and Sabun", async ({ page }) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  const team = async (name: string, code: string, type: string) =>
    (await ok(page, "team.v1.TeamService/TeamCreate", { name, teamCode: code, type, ownerUserId: ROOT_USER_ID })).team
      .id as string;
  state.warehouse = await team(`E2E Expiry Gudang ${SUFFIX}`, `EXG${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
  state.seller = await team(`E2E Expiry Seller ${SUFFIX}`, `EXS${SUFFIX}`, "TEAM_TYPE_SELLING");

  state.rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: RACK_CODE })).rack.id;
  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Expiry ${SUFFIX}` })).category.id;
  const product = async (part: string, name: string) =>
    (await ok(page, "product.v1.ProductService/ProductCreate", { teamId: state.seller, productCodePart: part, name, categoryId: category }))
      .product;
  const susu = await product(`EXA${SUFFIX}`, "Susu Kedaluwarsa");
  const sabun = await product(`EXB${SUFFIX}`, "Sabun Tanpa Tanggal");
  state.susu = susu.id;
  state.sabun = sabun.id;

  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E expiry restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-EX-${SUFFIX}`,
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
    items: [
      { productId: susu.id, productCode: susu.productCode, name: "Susu Kedaluwarsa", count: 6, total: 60000 },
      { productId: sabun.id, productCode: sabun.productCode, name: "Sabun Tanpa Tanggal", count: 4, total: 20000 },
    ],
  });
  state.restock = restock.request.id;
});

test("The warehouse counts it in: Susu with an expiry 20 days out, Sabun with none — the confirm lists both", async ({ page }) => {
  await asTeam(page, state.warehouse);
  await page.goto(`/inventories/restock/${state.restock}/accept`);
  await expect(page.getByTestId(`accept-line-${state.susu}`)).toBeVisible();

  await countWhole(page, state.susu);
  await countWhole(page, state.sabun);

  // The date read off Susu's box, in its line's What arrived — and how long is left beside it.
  await pickDay(page, `accept-expiry-${state.susu}-input`, jakartaDayIn(20));
  await expect(page.getByTestId(`accept-expiry-${state.susu}-left`)).toHaveText("20 hari lagi");
  await expect(page.getByTestId(`accept-expiry-${state.sabun}-input`)).toContainText("Pilih tanggal");

  await expect(page.getByTestId("accept-submit")).toBeEnabled();
  await page.getByTestId("accept-submit").click();
  const list = page.getByTestId("accept-confirm-expiry");
  await expect(list.getByTestId(`accept-confirm-expiry-${state.susu}`)).toContainText("20 hari lagi");
  await expect(list.getByTestId(`accept-confirm-expiry-${state.sabun}-day`)).toHaveText("—");
  // The dialog's own buttons speak Indonesian too (ConfirmDialog's default dismiss).
  await expect(page.getByTestId("confirm-dismiss")).toHaveText("Batal");

  const accepted = page.waitForResponse((r) => r.url().endsWith("/RestockRequestAccept") && r.status() === 200);
  await page.getByTestId("confirm-action").click();
  await accepted;
  await expect(page).toHaveURL(new RegExp(`/inventories/restock/${state.restock}$`));

  // The two batches the accept minted, by product — the readings below are on screen.
  const batchOf = async (productId: string) =>
    (
      await ok<{ ids: string[] }>(page, "inventory.v1.InventoryService/BatchList", {
        teamId: state.warehouse,
        filter: { productId },
        page: { page: 1, limit: 10 },
      })
    ).ids[0];
  state.susuBatch = await batchOf(state.susu);
  state.sabunBatch = await batchOf(state.sabun);
  expect(state.susuBatch).toBeTruthy();
  expect(state.sabunBatch).toBeTruthy();
});

test("The warehouse's Batch list, Kedaluwarsa ≤ 30 hari: Susu's batch with its rack; Sabun's reads — on the whole list", async ({ page }) => {
  await asTeam(page, state.warehouse);

  await page.goto("/inventories/batches?expiry=1");
  const row = page.getByTestId(`batches-row-${state.susuBatch}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId(`batches-expiry-${state.susuBatch}-left`)).toHaveText("20 hari lagi");
  await expect(row.getByTestId(`batches-racks-${state.susuBatch}`)).toHaveText(RACK_CODE);
  await expect(page.getByTestId(`batches-row-${state.sabunBatch}`)).toHaveCount(0);

  await page.goto("/inventories/batches");
  const sabun = page.getByTestId(`batches-row-${state.sabunBatch}`);
  await expect(sabun).toBeVisible();
  await expect(sabun.getByTestId(`batches-expiry-${state.sabunBatch}`)).toHaveText("—");
  // Sabun sits on the rack too — the Rak column names it on every row, not only under the filter.
  await expect(sabun.getByTestId(`batches-racks-${state.sabunBatch}`)).toHaveText(RACK_CODE);
});

test("The owning team's product page: Susu's batch reads 20 hari lagi, Sabun's —", async ({ page }) => {
  await asTeam(page, state.seller);

  await page.goto(`/products/${state.susu}`);
  const susu = page.getByTestId(`pd-batch-row-${state.susuBatch}`);
  await expect(susu).toBeVisible();
  await expect(page.getByTestId("pd-batch-table").getByRole("columnheader", { name: "Kedaluwarsa" })).toBeVisible();
  await expect(susu.getByTestId(`pd-batch-expiry-${state.susuBatch}-left`)).toHaveText("20 hari lagi");

  await page.goto(`/products/${state.sabun}`);
  const sabun = page.getByTestId(`pd-batch-row-${state.sabunBatch}`);
  await expect(sabun).toBeVisible();
  await expect(sabun.getByTestId(`pd-batch-expiry-${state.sabunBatch}`)).toHaveText("—");
});

test("The product page at 1440 with the sidebar open: the side cards below Batch, nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await asTeam(page, state.seller);

  await page.goto(`/products/${state.susu}`);
  await expect(page.getByTestId(`pd-batch-row-${state.susuBatch}`)).toBeVisible();
  // The app's sidebar is open (its default on a desktop).
  await expect(page.getByTestId("current-user")).toBeVisible();

  const batch = await page.getByTestId("pd-section-batch").boundingBox();
  const cross = await page.getByTestId("pd-section-cross").boundingBox();
  expect(cross!.y).toBeGreaterThanOrEqual(batch!.y + batch!.height);
  expect(Math.abs(cross!.x - batch!.x)).toBeLessThan(1);

  const widths = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('[data-testid="pd-batch-scroll"]')!;
    return {
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      box: box.scrollWidth,
      boxClient: box.clientWidth,
    };
  });
  expect(widths.page, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
  expect(widths.box, JSON.stringify(widths)).toBeLessThanOrEqual(widths.boxClient);
});

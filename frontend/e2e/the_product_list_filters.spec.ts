import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE PRODUCT LIST'S KUNCI AND UMUR STOK, END TO END (lock-and-stock-age-filter-ahead-of-the-contract,
// one-lock-three-ways, a-minimum-closes-only-under-it, the-dates-read-as-ages) — against the real server and Postgres:
// ProductList narrows its own count and page, asking inventory's batches for the minimums in force now and the stock's
// age through the composition root.
//
// Root in A SELLING TEAM OF THIS SPEC'S OWN (backlog #50: a spec asserts only on its own team's rows), with a warehouse of
// its own. Five products, stocked by one accepted restock:
//
//   Kaos Terbuka   open                 5 ready
//   Kaos Kurang    minimum 10           9 ready   — under it: Terkunci sekarang
//   Kaos Pas       minimum 10          10 ready   — exactly at it: open, NOT locked now
//   Kaos Kosong    minimum 3            nothing on a shelf — under any minimum, and no age
//   Kaos Dikunci   always locked        2 ready
//
// Every batch here arrived today — 0 days old — and no RPC back-dates a batch, so the age is proven on its edge: *30 days
// or more* keeps none of them (the stocked ones are too young, the empty one has no age), and the request carried it.
// The age's positive cases (30 / 60 / 90 days, the warehouse lens) are the Go tests' (product_stock_narrower_test.go).
//
// No order is placed; root's own team is never touched.

const SUFFIX = Date.now().toString().slice(-6);
const TEAM_NAME = `E2E Kunci Seller ${SUFFIX}`;

const state = { seller: "", warehouse: "", codes: {} as Record<string, string> };

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

// Root, working in the spec's own selling team: the active team is per tab, in sessionStorage (TeamContext).
async function openProducts(page: Page, query = "") {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), state.seller);
  await page.goto(`/products${query}`);
  await expect(page.getByTestId("products-page")).toBeVisible();
  await expect(page.getByTestId("team-switcher")).toContainText(TEAM_NAME);
}

const row = (page: Page, name: string) => page.getByTestId(`product-row-${state.codes[name]}`);

/** Exactly these of the five are listed. */
async function expectRows(page: Page, listed: string[]) {
  for (const name of Object.keys(state.codes)) {
    if (listed.includes(name)) {
      await expect(row(page, name)).toBeVisible();
    } else {
      await expect(row(page, name)).toHaveCount(0);
    }
  }
}

async function pick(page: Page, select: string, value: string) {
  await page.getByTestId(select).click();
  await page.getByTestId(`${select}-option-${value}`).click();
}

test.describe.configure({ mode: "serial" });

test("Setup: a selling team of its own holds five products in every way of the lock, stocked in its own warehouse", async ({
  page,
}) => {
  await signIn(page, ROOT_USERNAME, ROOT_PASSWORD);

  state.seller = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: TEAM_NAME,
      teamCode: `KU${SUFFIX}`,
      type: "TEAM_TYPE_SELLING",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;
  state.warehouse = (
    await ok(page, "team.v1.TeamService/TeamCreate", {
      name: `E2E Kunci WH ${SUFFIX}`,
      teamCode: `KUW${SUFFIX}`,
      type: "TEAM_TYPE_WAREHOUSE",
      ownerUserId: ROOT_USER_ID,
    })
  ).team.id;

  const category = (await ok(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Kunci ${SUFFIX}` })).category.id;

  // name → [part, locked, minimum, ready]
  const catalogue: Record<string, [string, boolean, number, number]> = {
    "Kaos Terbuka": ["OPEN", false, 0, 5],
    "Kaos Kurang": ["UNDER", false, 10, 9],
    "Kaos Pas": ["AT", false, 10, 10],
    "Kaos Kosong": ["EMPTY", false, 3, 0],
    "Kaos Dikunci": ["ALWAYS", true, 0, 2],
  };

  const lines: { productId: string; productCode: string; name: string; count: number; total: number }[] = [];

  for (const [name, [part, locked, minimum, ready]] of Object.entries(catalogue)) {
    const product = (
      await ok(page, "product.v1.ProductService/ProductCreate", {
        teamId: state.seller,
        productCodePart: `${part}${SUFFIX}`,
        name,
        categoryId: category,
        crossLocked: locked,
        reservedStock: minimum,
      })
    ).product;
    state.codes[name] = product.productCode;

    if (ready > 0) {
      lines.push({ productId: product.id, productCode: product.productCode, name, count: ready, total: ready * 10_000 });
    }
  }

  // One restock of the four stocked lines, paid from an operational account of the team, accepted onto one rack.
  const rack = (await ok(page, "inventory.v1.RackService/RackCreate", { teamId: state.warehouse, code: `ku-${SUFFIX}` })).rack.id;
  const account = (
    await ok(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: state.seller,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E kunci restock ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `E2E-KU-${SUFFIX}`,
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
    items: lines,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = restock.request.items as any[];
  await ok(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: state.warehouse,
    requestId: restock.request.id,
    lines: items.map((item) => ({
      itemId: item.id,
      receivedCount: Number(item.count),
      placements: [{ placementId: rack, quantity: Number(item.count) }],
    })),
  });
});

test("Kunci: each way narrows the list — Terkunci sekarang keeps only a minimum the stock is UNDER", async ({ page }) => {
  await openProducts(page);
  await expectRows(page, Object.keys(state.codes));

  await pick(page, "product-lock-select", "open");
  await expectRows(page, ["Kaos Terbuka"]);

  await pick(page, "product-lock-select", "min");
  await expectRows(page, ["Kaos Kurang", "Kaos Pas", "Kaos Kosong"]);

  await pick(page, "product-lock-select", "always");
  await expectRows(page, ["Kaos Dikunci"]);

  // 9 < 10 is locked now; exactly 10 is open; nothing on a shelf is under any minimum.
  const sent = page.waitForRequest(
    (r) => r.url().includes("ProductService/ProductList") && (r.postData() ?? "").includes("PRODUCT_LOCK_FILTER_LOCKED_NOW"),
  );
  await pick(page, "product-lock-select", "lockedNow");
  await sent;
  await expectRows(page, ["Kaos Kurang", "Kaos Kosong"]);
  await expect(page).toHaveURL(/lock=lockedNow/);

  // The URL keeps it: a reload opens the same narrowed list.
  await page.reload();
  await expect(page.getByTestId("product-lock-select")).toContainText("Locked now");
  await expectRows(page, ["Kaos Kurang", "Kaos Kosong"]);
});

test("Umur stok: 30 days or more keeps none of today's stock nor the empty shelf; Clear Filters brings all back", async ({
  page,
}) => {
  await openProducts(page, "?lock=min");
  await expectRows(page, ["Kaos Kurang", "Kaos Pas", "Kaos Kosong"]);

  const sent = page.waitForRequest(
    (r) => r.url().includes("ProductService/ProductList") && /"stockAgeMinDays":\s*30/.test(r.postData() ?? ""),
  );
  await pick(page, "product-age-select", "30");
  await sent;

  const empty = page.getByTestId("products-empty");
  await expect(empty).toContainText("No products found.");
  await expect(page).toHaveURL(/age=30/);

  await empty.getByRole("button", { name: "Clear Filters" }).click();
  await expectRows(page, Object.keys(state.codes));
  await expect(page).not.toHaveURL(/lock=|age=/);

  // Today's stock reads 0 days on its row — the age the filter counts.
  await expect(row(page, "Kaos Terbuka").getByTestId(`stock-age-${state.codes["Kaos Terbuka"]}`)).toHaveText("0 days");
});

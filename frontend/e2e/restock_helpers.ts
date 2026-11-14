import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_USER_ID } from "./global-setup";
import { signIn } from "./session";
import { API_URL } from "./env";

// THE RESTOCK SPECS' SHARED HELPERS. restock.spec.ts (62 tests, about 12 of the full run's ~35 minutes) was split by its
// describe blocks into five files (backlog #51) so `san test full --workers N` can run them on different workers at
// once: restock.spec.ts (the screens), restock_selling_wants_to_raise, restock_warehouse_wants_to_receive,
// restock_warehouse_wants_to_accept and restock_selling_wants_to_edit (.spec.ts). Every test and title is unchanged; each
// block already seeded its own ground in beforeAll, so each file runs alone on a fresh database. Not a spec file — it
// holds no test — so Playwright never runs it.

// #105 — Restock requests (a selling team asks a warehouse to restock a product; the warehouse
// fulfils). The list-page render check came first; the CREATE FORM had no coverage at all until #165
// rewired how products get onto it, which is a change you cannot honestly make blind.
//
// The Restock Requests menu lives in the Inventories sub-menu (warehouse/selling teams), but root
// holds ROLE_ROOT so the RPCs are authorised in the root team. We reach each page by its route
// directly — the menu gate is UX only.

// ⚠ EVERY TEST BELOW SEEDS ITS OWN DATA, and that is not tidiness — it is required.
//
// Playwright restarts the worker process after a failing test, so a module constant like this SUFFIX
// is re-evaluated and comes back DIFFERENT. A test that leant on a previous test's seed then looks
// for products that were created under the old suffix and does not find them, which reads as the
// feature being broken rather than as the seed having moved. It cost a debugging round to see that.
export const SUFFIX = Date.now().toString().slice(-6);

// Unique per test as well as per run: two tests in one process must not collide on a team code either.
export function names(tag: string) {
  return {
    whCode: `RW${tag}${SUFFIX}`.slice(0, 10),
    whName: `E2E Restock Warehouse ${tag} ${SUFFIX}`,
    category: `E2E RstCat ${tag} ${SUFFIX}`,
    // TWO products, because the whole point of a multi-select picker is picking more than one.
    skuA: `RPA${tag}${SUFFIX}`,
    skuB: `RPB${tag}${SUFFIX}`,
  };
}

export async function login(page: Page, username: string, password: string) {
  await signIn(page, username, password);
}

// The real contract, called with the signed-in user's token — every seed below goes through it, so a seed that the
// server would refuse fails here, by name, rather than as a screen that never fills.
export async function api(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body, API_URL] as const,
  );
}

// An operational account of team 1 to pay from — every restock names the account that paid
// (a-restock-must-name-the-account-that-paid), and the form offers operational ones only.
export async function payingAccount(page: Page, tag: string): Promise<string> {
  const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
    teamId: "1",
    type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
    provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
    name: `E2E restock ${tag} ${SUFFIX}`,
    holderName: "E2E",
    accountNumber: `E2E-RST-${tag}-${SUFFIX}`,
    openingBalance: 0,
    openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  });
  const accountId = String(created.account.id);

  await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
    teamId: "1",
    accountId,
    operational: true,
  });

  return accountId;
}

// Everything a restock needs before it can be raised and counted in: the warehouse it goes to, a rack there for the
// good units (there-is-no-unplaced-pile), one of team 1's products, and the account that paid.
export async function restockGround(page: Page, tag: string) {
  const { whCode, whName, category, skuA } = names(tag);

  const wh = await api(page, "team.v1.TeamService/TeamCreate", {
    type: 3,
    name: whName,
    teamCode: whCode,
    ownerUserId: ROOT_USER_ID,
  });
  const warehouseId = String(wh.team.id);

  const rack = await api(page, "inventory.v1.RackService/RackCreate", {
    teamId: warehouseId,
    code: `e2e-${tag.toLowerCase()}`,
    name: "E2E shelf",
  });

  const cat = await api(page, "category.v1.CategoryService/CategoryCreate", { name: category });
  const product = await api(page, "product.v1.ProductService/ProductCreate", {
    teamId: "1",
    productCodePart: skuA,
    name: `E2E ${skuA}`,
    categoryId: cat.category.id,
  });

  return {
    skuA,
    warehouseId,
    rackId: String(rack.rack.id),
    productId: String(product.product.id),
    accountId: await payingAccount(page, tag),
  };
}

// Seeds the warehouse team and the two products through the API. The form under test is the product
// PICKER, not product creation — seeding those through their own screens would make this test fail
// for reasons that have nothing to do with what it is named after.
export async function seed(page: Page, tag: string) {
  const { whCode, whName, category, skuA, skuB } = names(tag);

  const supplier = await page.evaluate(
    async ([whCode, whName, category, skuA, skuB, ownerId, apiUrl]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const call = async (method: string, body: unknown) => {
        const res = await fetch(`${apiUrl}/warehouse.${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`);
        return res.json();
      };

      // TEAM_TYPE_WAREHOUSE = 3 — the restock form's warehouse picker only offers this type.
      await call("team.v1.TeamService/TeamCreate", {
        type: 3,
        name: whName,
        teamCode: whCode,
        ownerUserId: ownerId,
      });

      // Categories are their own service and DELIBERATELY unscoped — the taxonomy is shared, so there
      // is no team on this call.
      const cat = await call("category.v1.CategoryService/CategoryCreate", { name: category });

      // skuA gets a COVER, skuB deliberately does not — so one test can prove both that a picked
      // product keeps its picture and that one without a picture still renders (the placeholder).
      //
      // A data: URI, not a document-service upload: it loads in the browser with no network and no
      // files on disk, so this asserts the COVER SURVIVES THE PICK — which is the bug — rather than
      // re-testing image storage, which has its own coverage and its own reasons to fail.
      const cover =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

      for (const productCode of [skuA, skuB]) {
        await call("product.v1.ProductService/ProductCreate", {
          teamId: "1",
          productCodePart: productCode,
          name: `E2E ${productCode}`,
          categoryId: cat.category.id,
          images: productCode === skuA ? [{ url: cover, thumbnailUrl: cover }] : [],
        });
      }

      // A SUPPLIER for the lines — the form will not save a product with none
      // (the-checks-run-products-warehouse-account-resi). Kept by a selling team of its own, since only a selling team
      // has suppliers and the root team is not one; the line picker searches every team's.
      const vendorTeam = await call("team.v1.TeamService/TeamCreate", {
        type: "TEAM_TYPE_SELLING",
        name: `E2E Vendor ${whCode}`,
        teamCode: `VT${whCode}`.slice(0, 10),
        ownerUserId: ownerId,
      });
      const supplier = await call("supplier.v1.SupplierService/SupplierCreate", {
        teamId: vendorTeam.team.id,
        name: `E2E Supplier ${whCode}`,
      });

      return { supplierId: supplier.supplier.id as string, supplierName: `E2E Supplier ${whCode}` };
    },
    [whCode, whName, category, skuA, skuB, ROOT_USER_ID, API_URL] as const,
  );

  return { whCode, whName, skuA, skuB, ...supplier, accountId: await payingAccount(page, tag) };
}

// Searches for one product by SKU and toggles it, leaving the dialog OPEN — a caller ticks several
// before confirming, which is the behaviour this whole issue is about.
//
// The toggle is verified ON THE ROW, so a click that silently failed to register is reported where it
// happened rather than as an empty form three steps later. It used to read the dialog's ticked COUNT,
// which said the same thing about the whole draft; that count is gone from the dialog, and the row's
// own checkbox is the more direct claim anyway.
//
// `ticked` is the state EXPECTED AFTER the click — this toggles, so a row that was already ticked
// comes back unticked, which is the untick half of the reconcile test below.
export async function tick(page: Page, productCode: string, ticked = true) {
  await page.getByTestId("product-picker-search").fill(productCode);

  // Each row's testid carries the product's ID, which this test has no way to know — so the row is
  // found by the SKU it displays.
  //
  // ⚠ Matched on CONTENT, never as "the only row". The search is debounced, so for a moment after
  // typing the list still holds the PREVIOUS product's row — which satisfies "exactly one row" just
  // as well, and clicking it un-ticks the product ticked a moment ago. That failure looks exactly
  // like the picker losing selections, and it cost a debugging round to tell apart.
  const row = page
    .getByTestId("product-picker-list")
    .locator('[data-testid^="product-picker-option-"]')
    .filter({ hasText: productCode });
  await expect(row).toHaveCount(1);

  // The row IS the checkbox's label, so the click goes to its control — the row's centre lands on the
  // product's name, and a label click there is not what Chakra's hidden input listens to.
  await row.locator('[data-part="control"]').click();

  const box = row.locator('input[type="checkbox"]');
  if (ticked) {
    await expect(box).toBeChecked();
  } else {
    await expect(box).not.toBeChecked();
  }
}

// A product's Ongoing figure, as the seller's product picker shows it.
export async function ongoingOf(page: Page, productCode: string) {
  await page.goto("/inventories/restock/new");
  await page.getByTestId("restock-pick-products").click();
  await page.getByTestId("product-picker-search").fill(productCode);
  const row = page
    .getByTestId("product-picker-list")
    .locator('[data-testid^="product-picker-option-"]')
    .filter({ hasText: productCode });
  await expect(row).toHaveCount(1);
  return row.locator('[data-testid^="product-picker-ongoing-"]');
}

// A row of a warehouse's inbound list, every status shown — searched for `q` (its product code, say) when the warehouse
// holds more restocks than the first page shows, newest first.
export async function inboundRow(page: Page, restockId: string, q = "") {
  await page.goto(`/inventories/restock?status=all${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  await expect(page.getByTestId("restock-inbound-table").or(page.getByTestId("restock-inbound-empty"))).toBeVisible();
  return page.getByTestId(`restock-row-${restockId}`);
}

// A product's Ready figure at one warehouse, as the seller's product picker shows it once that warehouse is chosen on the
// form (Ready needs a building to be about).
//
// ⚠ The warehouse is typed again until its option SHOWS: typed before the teams have loaded, the select remounts when
// they land (a combobox whose collection fills late) and closes, leaving the option in the DOM but hidden.
export async function readyAt(page: Page, warehouseCode: string, productCode: string) {
  await page.goto("/inventories/restock/new");
  const input = page.getByTestId("restock-warehouse").locator("input");
  const option = page.getByTestId(`team-select-option-${warehouseCode}`);
  await expect(async () => {
    await input.fill("");
    await input.fill(warehouseCode);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await option.click();
  await page.getByTestId("restock-pick-products").click();
  await page.getByTestId("product-picker-search").fill(productCode);
  const row = page
    .getByTestId("product-picker-list")
    .locator('[data-testid^="product-picker-option-"]')
    .filter({ hasText: productCode });
  await expect(row).toHaveCount(1);
  return row.locator('[data-testid^="product-picker-ready-"]');
}

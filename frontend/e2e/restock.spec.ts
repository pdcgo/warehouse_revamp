import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

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
const SUFFIX = Date.now().toString().slice(-6);

// Unique per test as well as per run: two tests in one process must not collide on a team code either.
function names(tag: string) {
  return {
    whCode: `RW${tag}${SUFFIX}`.slice(0, 10),
    whName: `E2E Restock Warehouse ${tag} ${SUFFIX}`,
    category: `E2E RstCat ${tag} ${SUFFIX}`,
    // TWO products, because the whole point of a multi-select picker is picking more than one.
    skuA: `RPA${tag}${SUFFIX}`,
    skuB: `RPB${tag}${SUFFIX}`,
  };
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toHaveText(username);
}

// Seeds the warehouse team and the two products through the API. The form under test is the product
// PICKER, not product creation — seeding those through their own screens would make this test fail
// for reasons that have nothing to do with what it is named after.
async function seed(page: Page, tag: string) {
  const { whCode, whName, category, skuA, skuB } = names(tag);

  await page.evaluate(
    async ([whCode, whName, category, skuA, skuB]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const call = async (method: string, body: unknown) => {
        const res = await fetch(`http://localhost:8081/warehouse.${method}`, {
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
      });

      // Categories are their own service and DELIBERATELY unscoped — the taxonomy is shared, so there
      // is no team on this call.
      const cat = await call("category.v1.CategoryService/CategoryCreate", { name: category });

      for (const sku of [skuA, skuB]) {
        await call("product.v1.ProductService/ProductCreate", {
          teamId: "1",
          sku,
          name: `E2E ${sku}`,
          categoryId: cat.category.id,
        });
      }
    },
    [whCode, whName, category, skuA, skuB] as const,
  );

  return { whCode, whName, skuA, skuB };
}

// Searches for one product by SKU and toggles it, leaving the dialog OPEN — a caller ticks several
// before confirming, which is the behaviour this whole issue is about. `expected` is the ticked count
// AFTER the toggle: asserting it here means a click that silently failed to register is reported at
// the row it happened on, rather than as an empty form three steps later.
async function tick(page: Page, sku: string, expected: number) {
  await page.getByTestId("product-picker-search").fill(sku);

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
    .filter({ hasText: sku });
  await expect(row).toHaveCount(1);

  // The row IS the checkbox's label, so the click goes to its control — the row's centre lands on the
  // product's name, and a label click there is not what Chakra's hidden input listens to.
  await row.locator('[data-part="control"]').click();

  await expect(page.getByTestId("product-picker-count")).toContainText(String(expected));
}

test("Restock requests page renders for root", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/inventories/restock");

  // The list always renders its table once loaded (empty for a fresh e2e DB). That is enough to
  // prove the page mounts, the client is wired, and the list RPC is reachable for root.
  await expect(page.getByTestId("restock-requests-table")).toBeVisible();
});

// #165 (owner: "not product select but product-picker") — the create form builds its list in the
// shared multi-select dialog, in one pass, instead of one combobox per line.
test("Restock create: tick two products in the picker and save (#165)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  const { whCode, skuA, skuB } = await seed(page, "S");

  await page.goto("/inventories/restock/new");

  // Nothing picked yet, and the form SAYS so rather than showing an empty line pretending to be one.
  // The old form opened with a blank row that could not be removed; there is no such thing now.
  await expect(page.getByTestId("restock-no-products")).toBeVisible();
  await expect(page.getByTestId("submit-restock")).toBeDisabled();

  await page.getByTestId("restock-pick-products").click();
  await tick(page, skuA, 1);
  await tick(page, skuB, 2);
  await page.getByTestId("product-picker-confirm").click();

  // TWO lines from ONE dialog — the thing a per-line combobox could not do.
  await expect(page.getByTestId("restock-line-0")).toBeVisible();
  await expect(page.getByTestId("restock-line-1")).toBeVisible();
  await expect(page.getByTestId("restock-product-count")).toContainText("2");

  await page.getByTestId("restock-qty-0").fill("4");
  await page.getByTestId("restock-total-price-0").fill("40000");
  await page.getByTestId("restock-qty-1").fill("2");
  await page.getByTestId("restock-total-price-1").fill("30000");

  // The money adds up across both lines — Rp 70.000.
  await expect(page.getByTestId("restock-total")).toContainText("70.000");

  // The warehouse that receives the goods.
  await page.getByTestId("restock-warehouse").locator("input").fill(whCode);
  await page.getByTestId(`team-select-option-${whCode}`).click();

  await expect(page.getByTestId("submit-restock")).toBeEnabled();
  await page.getByTestId("submit-restock").click();

  // A successful create returns to the LIST — there was no row to come from, so there is none to go
  // back to. The new request is on it, found by the first product the picker put there — the list
  // names its warehouse by ID, not by the name this test chose.
  await expect(page).toHaveURL(/\/inventories\/restock$/);

  const row = page
    .getByTestId("restock-requests-table")
    .locator("tbody tr")
    .filter({ hasText: skuA });
  await expect(row).toHaveCount(1);

  // …and it really carries BOTH products, which is the only proof the picker's set reached the server
  // rather than just the screen.
  await row.click();
  await expect(page.getByTestId("restock-detail-page")).toContainText(skuA);
  await expect(page.getByTestId("restock-detail-page")).toContainText(skuB);
});

// THE REGRESSION THIS CHANGE COULD MOST EASILY CAUSE, and the reason pickProducts reconciles rather
// than rebuilds: the picker hands back the WHOLE ticked set every time it closes, so the naive
// implementation — map the set to fresh lines — silently resets every quantity and price on screen
// the moment somebody reopens the dialog to add one more product.
//
// Reopening is not an edge case. It is what you do when you remember a fourth thing to buy.
test("Restock create: reopening the picker keeps what was already typed (#165)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  const { skuA, skuB } = await seed(page, "R");

  await page.goto("/inventories/restock/new");

  // One product, with a quantity typed against it.
  await page.getByTestId("restock-pick-products").click();
  await tick(page, skuA, 1);
  await page.getByTestId("product-picker-confirm").click();
  await page.getByTestId("restock-qty-0").fill("7");
  await page.getByTestId("restock-total-price-0").fill("70000");

  // Reopen and add a SECOND product. The first is already ticked — the picker's ticks are derived
  // from the lines, so it opens showing what is on the form rather than a blank slate.
  await page.getByTestId("restock-pick-products").click();
  await tick(page, skuB, 2);
  await page.getByTestId("product-picker-confirm").click();

  await expect(page.getByTestId("restock-line-1")).toBeVisible();

  // The typed numbers SURVIVED, and stayed on their own product — a rebuild would show "1" here.
  await expect(page.getByTestId("restock-qty-0")).toHaveValue("7");
  await expect(page.getByTestId("restock-total-price-0")).toHaveValue("70.000");

  // Unticking is the other half of the same edit: reopen, untick the first, and it leaves — while the
  // one that stayed keeps ITS numbers.
  await page.getByTestId("restock-qty-1").fill("3");
  await page.getByTestId("restock-pick-products").click();
  await tick(page, skuA, 1); // already ticked → this unticks it, leaving one
  await page.getByTestId("product-picker-confirm").click();

  await expect(page.getByTestId("restock-line-1")).toBeHidden();
  await expect(page.getByTestId("restock-qty-0")).toHaveValue("3");
});

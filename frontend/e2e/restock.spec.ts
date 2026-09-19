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

      // skuA gets a COVER, skuB deliberately does not — so one test can prove both that a picked
      // product keeps its picture and that one without a picture still renders (the placeholder).
      //
      // A data: URI, not a document-service upload: it loads in the browser with no network and no
      // files on disk, so this asserts the COVER SURVIVES THE PICK — which is the bug — rather than
      // re-testing image storage, which has its own coverage and its own reasons to fail.
      const cover =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

      for (const sku of [skuA, skuB]) {
        await call("product.v1.ProductService/ProductCreate", {
          teamId: "1",
          sku,
          name: `E2E ${sku}`,
          categoryId: cat.category.id,
          images: sku === skuA ? [{ url: cover, thumbnailUrl: cover }] : [],
        });
      }
    },
    [whCode, whName, category, skuA, skuB] as const,
  );

  return { whCode, whName, skuA, skuB };
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
async function tick(page: Page, sku: string, ticked = true) {
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

  const box = row.locator('input[type="checkbox"]');
  if (ticked) {
    await expect(box).toBeChecked();
  } else {
    await expect(box).not.toBeChecked();
  }
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
  await tick(page, skuA);
  await tick(page, skuB);
  await page.getByTestId("product-picker-confirm").click();

  // TWO lines from ONE dialog — the thing a per-line combobox could not do.
  await expect(page.getByTestId("restock-line-0")).toBeVisible();
  await expect(page.getByTestId("restock-line-1")).toBeVisible();
  await expect(page.getByTestId("restock-summary-count")).toContainText("2");

  // THE COVER SURVIVES THE PICK (owner: "product show and it has image, i choose it but in list
  // product that i choosed not showed"). The dialog rendered a photo and the line it produced showed a
  // grey placeholder, because the emitted snapshot carried only id/sku/name — so the picked product
  // stopped looking like the one that was ticked, which reads as having picked the wrong thing.
  //
  // skuA is the seeded product WITH a cover; skuB has none and keeps the placeholder, which is why the
  // assertion names line 0 rather than "an image somewhere on the form".
  await expect(page.getByTestId("restock-line-0").locator("img")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );

  await page.getByTestId("restock-qty-0").fill("4");
  await page.getByTestId("restock-total-price-0").fill("40000");
  await page.getByTestId("restock-qty-1").fill("2");
  await page.getByTestId("restock-total-price-1").fill("30000");

  // The money adds up across both lines — Rp 70.000. Read from the SIDEBAR: the left column no
  // longer repeats the count or the total (#165) — the sidebar already carries both.
  await expect(page.getByTestId("restock-summary-products")).toContainText("70.000");

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

  // The lines live on the PRODUCT tab, so the tab gets clicked rather than the assertion reaching
  // through it: an unselected Chakra tab panel is hidden but still in the DOM, so a `toContainText`
  // against the whole page would pass on text nobody can see — and would keep passing if the tab
  // stopped opening.
  await page.getByTestId("restock-detail-tab-products").click();
  await expect(page.getByTestId("restock-detail-products")).toContainText(skuA);
  await expect(page.getByTestId("restock-detail-products")).toContainText(skuB);

  // Who raised it, on the tab that answers it. The BY LINE is asserted, not just the step: the row
  // carries a user id and the name comes from a second read, so a `UserByIDs` that failed would
  // silently leave a step with a date and no person — and nothing else on the page would notice.
  // It asserts the line EXISTS rather than which name is in it, because the account the suite logs
  // in as is the fixture's business, not this assertion's.
  await page.getByTestId("restock-detail-tab-timeline").click();
  await expect(page.getByTestId("restock-timeline-created-by")).toBeVisible();
  // A pending request ends with what has NOT happened yet, rather than stopping dead at "raised".
  await expect(page.getByTestId("restock-timeline-awaiting")).toBeVisible();

  await page.getByTestId("restock-detail-tab-info").click();

  // …and EDITING it shows the cover too, which is a SEPARATE path worth its own assertion: a stored
  // restock line holds sku/name and no image at all, so the form has to resolve covers by id rather
  // than read them off the row. Line 0's picture proves that lookup ran and landed on the right line.
  await page.getByTestId("restock-detail-edit").click();
  await expect(page.getByTestId("restock-edit-page")).toBeVisible();
  await expect(page.getByTestId("restock-line-0").locator("img")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );

  // ── ONGOING: the request just filed is now "on the way" (owner) ──────────────────────────────
  //
  // The double-order guard, asserted against a restock this test really created rather than a seeded
  // number: 4 of skuA were ordered above, nobody has accepted them, so the picker must say 4 the next
  // time somebody opens it to buy more.
  //
  // On a FRESH create form, with NO destination warehouse chosen — which is the point of totalling
  // ongoing across every warehouse. Ready needs a building to be about and shows nothing here; "have I
  // already bought this?" is a question about the purchase, so it answers straight away.
  await page.goto("/inventories/restock/new");
  await page.getByTestId("restock-pick-products").click();
  await page.getByTestId("product-picker-search").fill(skuA);

  const picked = page
    .getByTestId("product-picker-list")
    .locator('[data-testid^="product-picker-option-"]')
    .filter({ hasText: skuA });
  await expect(picked).toHaveCount(1);

  // ⚠ `product-picker-ongoing-`, NOT `product-list-item-ongoing-`. ProductPickerShell has TWO
  // layouts and this picker asks for `layout="table"`: the list layout renders a ProductListItem
  // (whose badge carries the other testid), the table layout renders its own cell. The badge never
  // stopped working — this assertion was reading the layout the picker no longer uses, so it failed
  // with "element not found" and looked like a missing number.
  await expect(picked.locator('[data-testid^="product-picker-ongoing-"]')).toContainText("4");

  // And the two numbers are LABELLED on screen, because ready and ongoing count different sets of
  // warehouses and two bare figures side by side would read as one number about one place.
  //
  // ⚠ This used to assert a `product-picker-stock-scope` note, which no longer exists — the table
  // layout says it with NAMED COLUMNS instead, and a sticky header so the labels survive scrolling.
  // That is the same claim, made better; the assertion just outlived the element.
  const head = page.getByTestId("product-picker-list").locator("thead");
  await expect(head).toContainText("On the way");
  await expect(head).toContainText("Ready stock");

  // skuB was ordered on the SAME request (2 of them), so it is on the way too — proof the badge
  // reflects the line rather than the request.
  await page.getByTestId("product-picker-search").fill(skuB);
  const pickedB = page
    .getByTestId("product-picker-list")
    .locator('[data-testid^="product-picker-option-"]')
    .filter({ hasText: skuB });
  await expect(pickedB).toHaveCount(1);
  await expect(pickedB.locator('[data-testid^="product-picker-ongoing-"]')).toContainText("2");
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
  await tick(page, skuA);
  await page.getByTestId("product-picker-confirm").click();
  await page.getByTestId("restock-qty-0").fill("7");
  await page.getByTestId("restock-total-price-0").fill("70000");

  // Reopen and add a SECOND product. The first is already ticked — the picker's ticks are derived
  // from the lines, so it opens showing what is on the form rather than a blank slate.
  await page.getByTestId("restock-pick-products").click();
  await tick(page, skuB);
  await page.getByTestId("product-picker-confirm").click();

  await expect(page.getByTestId("restock-line-1")).toBeVisible();

  // The typed numbers SURVIVED, and stayed on their own product — a rebuild would show "1" here.
  await expect(page.getByTestId("restock-qty-0")).toHaveValue("7");
  await expect(page.getByTestId("restock-total-price-0")).toHaveValue("70.000");

  // Unticking is the other half of the same edit: reopen, untick the first, and it leaves — while the
  // one that stayed keeps ITS numbers.
  await page.getByTestId("restock-qty-1").fill("3");
  await page.getByTestId("restock-pick-products").click();
  await tick(page, skuA, false); // already ticked → this unticks it, leaving one
  await page.getByTestId("product-picker-confirm").click();

  await expect(page.getByTestId("restock-line-1")).toBeHidden();
  await expect(page.getByTestId("restock-qty-0")).toHaveValue("3");
});

// LOST and BROKEN on the buyer's Product tab (#154 → owner). The two come from ONE `damaged` array
// filtered by TYPE, and crossing them is a bug nothing else would catch: both cells would still show a
// number, both would still show a reason, and the buyer would chase a re-send for goods that arrived
// crushed. So the test asserts the pairing — which number and which reason land in which column.
//
// The delivery is accepted through the API rather than the accept FORM: that form has its own coverage
// in orders.spec, and driving it here would make a rendering test fail for reasons about racks and
// placements. `unplaced` is a legal place (#135), which is what lets this skip creating shelves.
test("Restock detail: lost and broken show with their reasons (#154)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const tag = "D";
  const { whCode, whName, category, skuA } = names(tag);

  const seeded = await page.evaluate(
    async ([whCode, whName, category, skuA]) => {
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

      const wh = await call("team.v1.TeamService/TeamCreate", {
        type: 3,
        name: whName,
        teamCode: whCode,
      });
      const cat = await call("category.v1.CategoryService/CategoryCreate", { name: category });
      const product = await call("product.v1.ProductService/ProductCreate", {
        teamId: "1",
        sku: skuA,
        name: `E2E ${skuA}`,
        categoryId: cat.category.id,
      });

      // 10 asked. 7 turn up sellable, 2 arrive crushed, 1 was never in the box — so the three columns
      // must each show a different number, and the row is legitimately short by 3.
      const created = await call("inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: "1",
        warehouseId: wh.team.id,
        shippingCode: "jne",
        items: [
          { productId: product.product.id, sku: skuA, name: `E2E ${skuA}`, quantity: 10, totalPrice: 500000 },
        ],
      });

      await call("inventory.v1.RestockRequestService/RestockRequestFulfill", {
        teamId: wh.team.id,
        requestId: created.request.id,
        lines: [
          {
            itemId: created.request.items[0].id,
            receivedQuantity: 7,
            // The unplaced pile — a real place (#135), so no rack has to exist for this test.
            placements: [{ unplaced: true, quantity: 7 }],
            damaged: [
              { quantity: 2, reason: "crushed in transit", type: "RESTOCK_DAMAGE_TYPE_BROKEN" },
              { quantity: 1, reason: "never in the box", type: "RESTOCK_DAMAGE_TYPE_LOST" },
            ],
          },
        ],
      });

      return {
        requestId: created.request.id,
        productId: product.product.id,
        warehouseId: wh.team.id,
      };
    },
    [whCode, whName, category, skuA] as const,
  );

  await page.goto(`/inventories/restock/${seeded.requestId}`);
  await page.getByTestId("restock-detail-tab-products").click();

  // ACCEPTED is what became sellable stock — 7, not the 10 asked and not the 9 that physically turned
  // up. And the shortfall is flagged, because 3 of what was paid for is not on a shelf.
  const accepted = page.getByTestId(`restock-detail-received-${seeded.productId}`);
  await expect(accepted).toContainText("7");

  // The shortfall is flagged ONCE, in the page header — the per-line "short by n" badge was removed
  // (owner) because the row itself now itemises the gap: asked 10, accepted 7, lost 1, broken 2.
  await expect(page.getByTestId("restock-detail-short")).toBeVisible();

  // ⚠ THE PAIRING IS THE POINT. Each cell carries ITS OWN number and ITS OWN reason; a filter on the
  // wrong damage type puts "crushed in transit" under Lost and reads as a supplier who shorted us.
  const lost = page.getByTestId(`restock-detail-lost-${seeded.productId}`);
  await expect(lost).toContainText("1");
  await expect(lost).toContainText("never in the box");
  await expect(lost).not.toContainText("crushed in transit");

  const broken = page.getByTestId(`restock-detail-broken-${seeded.productId}`);
  await expect(broken).toContainText("2");
  await expect(broken).toContainText("crushed in transit");
  await expect(broken).not.toContainText("never in the box");

  // The columns are there on a request NOBODY HAS COUNTED too, reading "—" rather than 0 — a pending
  // delivery has not arrived empty, and gating the columns on acceptance is what used to hide them
  // from every restock still in flight.
  const pending = await page.evaluate(
    async ([skuA, warehouseId, productId]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(
        "http://localhost:8081/warehouse.inventory.v1.RestockRequestService/RestockRequestCreate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            teamId: "1",
            warehouseId,
            items: [{ productId, sku: skuA, name: `E2E ${skuA}`, quantity: 4, totalPrice: 100000 }],
          }),
        },
      );
      if (!res.ok) throw new Error(`create pending: ${res.status} ${await res.text()}`);

      return (await res.json()).request.id;
    },
    [skuA, seeded.warehouseId, seeded.productId] as const,
  );

  await page.goto(`/inventories/restock/${pending}`);
  await page.getByTestId("restock-detail-tab-products").click();
  await expect(page.getByTestId(`restock-detail-lost-${seeded.productId}`)).toHaveText("—");
  await expect(page.getByTestId(`restock-detail-broken-${seeded.productId}`)).toHaveText("—");
  await expect(page.getByTestId(`restock-detail-received-${seeded.productId}`)).toHaveText("—");
});

// THE COD FEE, ON THE SCREEN OF THE TEAM THAT HAS TO PAY IT (#155/#184).
//
// The backend has this covered where the numbers are written; what only a browser can answer is
// whether the fee reaches the SELLING team's page at all — the fee is entered by the warehouse, and
// the requesting team never sees the accept form. Two things are asserted, and they fail separately:
// the money (the fee is listed and the total moved by exactly it) and the HISTORY (paying the courier
// and counting the box in are TWO steps, in that order).
//
// Accepted through the API rather than the accept form for the same reason the test above it is: that
// form has its own coverage, and driving it here would make this fail for reasons about racks.
test("Restock detail: a COD fee shows in the total and as its own timeline step (#155)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const tag = "C";
  const { whCode, whName, category, skuA } = names(tag);

  const seeded = await page.evaluate(
    async ([whCode, whName, category, skuA]) => {
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

      const wh = await call("team.v1.TeamService/TeamCreate", {
        type: 3,
        name: whName,
        teamCode: whCode,
      });
      const cat = await call("category.v1.CategoryService/CategoryCreate", { name: category });
      const product = await call("product.v1.ProductService/ProductCreate", {
        teamId: "1",
        sku: skuA,
        name: `E2E ${skuA}`,
        categoryId: cat.category.id,
      });

      // 500.000 of goods and 15.000 of freight agreed up front — so the only number that can move the
      // total once the delivery lands is the fee the courier takes at the door.
      const created = await call("inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: "1",
        warehouseId: wh.team.id,
        shippingCode: "jne",
        shippingCost: 15000,
        items: [
          {
            productId: product.product.id,
            sku: skuA,
            name: `E2E ${skuA}`,
            quantity: 10,
            totalPrice: 500000,
          },
        ],
      });

      await call("inventory.v1.RestockRequestService/RestockRequestFulfill", {
        teamId: wh.team.id,
        requestId: created.request.id,
        // What the delivery cost the warehouse — known only to it, and only now.
        // `INCIDENTAL` with a required note — see the liability spec for why the pair rule went.
        costLines: [
          { kind: "RESTOCK_COST_KIND_INCIDENTAL", amount: 25000, note: "courier asked at the door" },
        ],
        lines: [
          {
            itemId: created.request.items[0].id,
            receivedQuantity: 10,
            placements: [{ unplaced: true, quantity: 10 }],
          },
        ],
      });

      return { requestId: created.request.id };
    },
    [whCode, whName, category, skuA] as const,
  );

  await page.goto(`/inventories/restock/${seeded.requestId}`);

  // ── THE MONEY ────────────────────────────────────────────────────────────────────────────────
  await page.getByTestId("restock-detail-tab-products").click();

  // Listed as its own line, not folded into the freight: the fee is a separate obligation to the
  // warehouse (#184), and a total that merely got bigger tells nobody what to settle.
  await expect(page.getByTestId("restock-detail-cost-incidental")).toContainText("25.000");

  // 500.000 goods + 15.000 freight + 25.000 at the door. A total still reading 515.000 means the fee
  // was stored and never counted — which is exactly how it stays unpaid.
  await expect(page.getByTestId("restock-detail-total")).toContainText("540.000");

  // ── THE HISTORY ──────────────────────────────────────────────────────────────────────────────
  await page.getByTestId("restock-detail-tab-timeline").click();

  // The WHOLE sequence, in order, rather than two separate visibility checks: the order is the claim
  // — the courier is paid at the door and THEN the box is opened and counted. `-by` nodes are the
  // person inside a step, not steps of their own.
  const steps = await page.getByTestId("restock-detail-timeline").evaluate((root) =>
    Array.from(root.querySelectorAll("[data-testid^='restock-timeline-']"))
      .map((node) => node.getAttribute("data-testid"))
      .filter((id): id is string => !!id && !id.endsWith("-by")),
  );

  expect(steps).toEqual([
    "restock-timeline-created",
    "restock-timeline-cost-recorded",
    "restock-timeline-accepted",
  ]);
});

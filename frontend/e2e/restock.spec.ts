import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";

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

// The real contract, called with the signed-in user's token — every seed below goes through it, so a seed that the
// server would refuse fails here, by name, rather than as a screen that never fills.
async function api(page: Page, method: string, body: unknown) {
  return page.evaluate(
    async ([m, b]) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch(`http://localhost:8081/warehouse.${m as string}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
      if (!res.ok) throw new Error(`${m as string}: ${res.status} ${await res.text()}`);

      return res.json();
    },
    [method, body] as const,
  );
}

// An operational account of team 1 to pay from — every restock names the account that paid
// (a-restock-must-name-the-account-that-paid), and the form offers operational ones only.
async function payingAccount(page: Page, tag: string): Promise<string> {
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
async function restockGround(page: Page, tag: string) {
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
async function seed(page: Page, tag: string) {
  const { whCode, whName, category, skuA, skuB } = names(tag);

  const supplier = await page.evaluate(
    async ([whCode, whName, category, skuA, skuB, ownerId]) => {
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
    [whCode, whName, category, skuA, skuB, ROOT_USER_ID] as const,
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
async function tick(page: Page, productCode: string, ticked = true) {
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

test("Restock requests page renders for root", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/inventories/restock");

  // Once loaded the list renders its table, or — for a fresh e2e DB — its empty hint
  // (an-empty-list-shows-a-hint). Either proves the page mounts, the client is wired, and the list RPC
  // is reachable for root.
  await expect(
    page.getByTestId("restock-requests-table").or(page.getByTestId("restock-requests-empty")),
  ).toBeVisible();
});

// a-who-filter-lists-the-people-on-its-rows: the two "who" filters offer the people on this team's restocks —
// inventory_service's answer (RestockActorList), never a member list — and each narrows the list to theirs.
test("Restock list: raised-by and accepted-by offer who did it, and narrow to theirs", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const ground = await restockGround(page, "W");

  // Raised by root, and accepted by root at the warehouse it owns — so root is on the row twice.
  const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: "1",
    warehouseId: ground.warehouseId,
    financeAccountId: ground.accountId,
    items: [{ productId: ground.productId, productCode: ground.skuA, name: `E2E ${ground.skuA}`, count: 2, total: 20000 }],
  });

  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouseId,
    requestId: created.request.id,
    lines: [
      {
        itemId: created.request.items[0].id,
        receivedCount: 2,
        placements: [{ placementId: ground.rackId, quantity: 2 }],
      },
    ],
  });

  const requestId = String(created.request.id);

  await page.goto("/inventories/restock");
  await expect(page.getByTestId(`restock-row-${requestId}`)).toBeVisible();

  for (const filter of ["restock-created-by-filter", "restock-accepted-by-filter"]) {
    await page.getByTestId(filter).getByRole("combobox").click();
    // Both pickers keep their lists in the page once opened, so the option is the VISIBLE one.
    await page.getByTestId(`person-filter-option-${ROOT_USER_ID}`).filter({ visible: true }).click();
    await expect(page.getByTestId(`restock-row-${requestId}`)).toBeVisible();

    // Cleared, it is "anybody" again — the filter removed, not stuck.
    await page.getByTestId(filter).getByRole("button", { name: /clear/i }).click();
  }
});

// #165 (owner: "not product select but product-picker") — the create form builds its list in the
// shared multi-select dialog, in one pass, instead of one combobox per line.
test("Restock create: tick two products in the picker and save (#165)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  const { whCode, skuA, skuB, accountId, supplierId, supplierName } = await seed(page, "S");

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

  // The account that paid (a-restock-must-name-the-account-that-paid) — picked by its id, since other tests open
  // operational accounts on the same team and the form only pre-fills when there is exactly one.
  await page.getByTestId("restock-finance-account").click();
  await page.getByTestId(`restock-finance-account-option-${accountId}`).click();

  // Every product names its supplier, and the restock its resi (the-checks-run-products-warehouse-account-resi) — the
  // supplier set ONCE for both lines, from the card's supplier part (one-supplier-for-all-in-two-steps). It sells from
  // no store, so "no store" is chosen for it and Connect is live at once.
  await expect(page.getByTestId("restock-form-missing-supplier")).toBeVisible();
  await page.getByTestId("restock-all-supplier-picker-trigger").click();
  await page.getByTestId("restock-all-supplier-picker-search").fill(supplierName);
  await page.getByTestId(`restock-all-supplier-picker-supplier-${supplierId}`).click();
  await page.getByTestId("restock-all-supplier-picker-confirm").click();
  await expect(page.getByTestId("restock-line-1-supplier-shown")).toContainText(supplierName);

  // The courier (the-courier-is-required-on-the-form) — JNE, which the shipment catalogue's first migration seeds.
  await expect(page.getByTestId("restock-form-missing-courier")).toBeVisible();
  await page.getByTestId("restock-courier").getByRole("combobox").click();
  await page.getByTestId("shipment-channel-option-jne").click();

  // The resi, which no other restock holds (a-reference-in-use-stops-the-restock-form) — asked of the list's search.
  await expect(page.getByTestId("restock-form-missing-receipt")).toBeVisible();
  await page.getByTestId("restock-receipt").fill(`E2E-RESI-${whCode}`);

  await expect(page.getByTestId("restock-form-ready")).toBeVisible();
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
  await page.getByTestId("section-nav-products").click();
  await expect(page.getByTestId("restock-detail-products")).toContainText(skuA);
  await expect(page.getByTestId("restock-detail-products")).toContainText(skuB);

  // Who raised it, on the tab that answers it. The BY LINE is asserted, not just the step: the row
  // carries a user id and the name comes from a second read, so a `UserByIDs` that failed would
  // silently leave a step with a date and no person — and nothing else on the page would notice.
  // It asserts the line EXISTS rather than which name is in it, because the account the suite logs
  // in as is the fixture's business, not this assertion's.
  await page.getByTestId("section-nav-timeline").click();
  await expect(page.locator("[data-kind='created'] [data-testid$='-by']")).toBeVisible();
  // A pending request ends with what has NOT happened yet, rather than stopping dead at "raised".
  await expect(page.getByTestId("restock-timeline-awaiting")).toBeVisible();

  await page.getByTestId("section-nav-delivery").click();

  // …and EDITING it shows the cover too, which is a SEPARATE path worth its own assertion: a stored
  // restock line holds sku/name and no image at all, so the form has to resolve covers by id rather
  // than read them off the row. Line 0's picture proves that lookup ran and landed on the right line.
  // The action carries the restock's id, which the URL already says.
  const restockId = new URL(page.url()).pathname.split("/").pop();
  await page.getByTestId(`restock-action-edit-${restockId}`).click();
  await expect(page.getByTestId("restock-edit-page")).toBeVisible();
  await expect(page.getByTestId("restock-line-0").locator("img")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );

  // ── ONGOING: the request just filed is now "ongoing" (owner) ──────────────────────────────
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
  await expect(head).toContainText("Ongoing");
  await expect(head).toContainText("Ready");

  // skuB was ordered on the SAME request (2 of them), so it is ongoing too — proof the badge
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

// BROKEN and MISSING on the buyer's Product tab (#154, a-short-unit-at-the-door-is-missing). The warehouse types what
// was IN THE BOX and how many of those are broken; missing is worked out. Crossing the two kinds is a bug nothing else
// would catch: both cells would still show a number and a note, and the buyer would chase a re-send for goods that
// arrived crushed. So the test asserts the pairing — which number and which note land in which column.
//
// The delivery is accepted through the API rather than the accept FORM: that form has its own coverage in its
// stories, and driving it here would make a rendering test fail for reasons about racks and placements.
test("Restock detail: broken and missing show with the warehouse's notes (#154)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const ground = await restockGround(page, "D");

  // 10 ordered. 9 in the box, 2 of them crushed — so 7 good, 2 broken, 1 missing, and each column shows a different
  // number.
  const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: "1",
    warehouseId: ground.warehouseId,
    financeAccountId: ground.accountId,
    items: [{ productId: ground.productId, productCode: ground.skuA, name: `E2E ${ground.skuA}`, count: 10, total: 500000 }],
  });

  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouseId,
    requestId: created.request.id,
    lines: [
      {
        itemId: created.request.items[0].id,
        receivedCount: 9,
        brokenCount: 2,
        brokenNote: "crushed in transit",
        missingNote: "never in the box",
        placements: [{ placementId: ground.rackId, quantity: 7 }],
      },
    ],
  });

  const productId = ground.productId;

  await page.goto(`/inventories/restock/${created.request.id}`);
  await page.getByTestId("section-nav-products").click();

  // The count is ONE column, Penyesuaian, and its figures open in a dialog (the-count-is-one-adjustment-column).
  await page.getByTestId(`restock-detail-adjustment-${productId}`).click();
  await expect(page.getByTestId(`restock-detail-adjustment-${productId}-dialog`)).toBeVisible();

  // RECEIVED is what was in the box, broken included (any-warehouse-member-counts-what-arrived); GOOD is what became
  // stock. And the shortfall is flagged once, in the header.
  await expect(page.getByTestId(`restock-detail-received-${productId}`)).toContainText("9");
  await expect(page.getByTestId(`restock-detail-good-${productId}`)).toContainText("7");
  await expect(page.getByTestId("restock-detail-missing")).toContainText("1");

  // ⚠ THE PAIRING IS THE POINT. Each cell carries ITS OWN count and ITS OWN note.
  await expect(page.getByTestId(`restock-detail-broken-${productId}-count`)).toContainText("2");
  await expect(page.getByTestId(`restock-detail-broken-${productId}-note`)).toContainText("crushed in transit");
  await expect(page.getByTestId(`restock-detail-broken-${productId}`)).not.toContainText("never in the box");

  await expect(page.getByTestId(`restock-detail-missing-${productId}-count`)).toContainText("1");
  await expect(page.getByTestId(`restock-detail-missing-${productId}-note`)).toContainText("never in the box");
  await expect(page.getByTestId(`restock-detail-missing-${productId}`)).not.toContainText("crushed in transit");

  // Each problem row is worth the landed unit price, filled by the server (the-problem-price-is-filled-by-the-system):
  // 500.000 ÷ 10, and no freight on this one — Rp 100.000 broken, Rp 50.000 missing.
  await expect(page.getByTestId(`restock-detail-broken-${productId}-value`)).toContainText("100.000");
  await expect(page.getByTestId(`restock-detail-missing-${productId}-value`)).toContainText("50.000");

  // A restock NOBODY HAS COUNTED reads "—" rather than 0 — a box on its way has not arrived empty — and has nothing to
  // open.
  await page.keyboard.press("Escape");
  const pending = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: "1",
    warehouseId: ground.warehouseId,
    financeAccountId: ground.accountId,
    items: [{ productId, productCode: ground.skuA, name: `E2E ${ground.skuA}`, count: 4, total: 100000 }],
  });

  await page.goto(`/inventories/restock/${pending.request.id}`);
  await page.getByTestId("section-nav-products").click();
  await expect(page.getByTestId(`restock-detail-adjustment-${productId}`)).toHaveText("—");
});

// THE COURIER'S CHARGE, ON THE SCREEN OF THE TEAM THAT OWES IT (#155/#184). The warehouse types it at the door; the
// selling team never sees the accept form, so only a browser can answer whether it reaches the selling team's page.
// Two things are asserted, and they fail separately: the MONEY — the charge shows on its own and the total stays goods
// plus shipping (the-couriers-charge-stays-out-of-total) — and the HISTORY — the charge sits on the accept's step, not a
// step of its own (every-status-change-is-logged).
test("Restock detail: the courier's charge shows on its own and stays out of the total (#155)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const ground = await restockGround(page, "C");

  // 500.000 of goods and 15.000 of freight agreed up front.
  const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: "1",
    warehouseId: ground.warehouseId,
    financeAccountId: ground.accountId,
    shipmentCost: 15000,
    items: [{ productId: ground.productId, productCode: ground.skuA, name: `E2E ${ground.skuA}`, count: 10, total: 500000 }],
  });

  await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
    teamId: ground.warehouseId,
    requestId: created.request.id,
    // What the courier asked at the door — known only to the warehouse, and only now; its note is required.
    warehouseAdditionalCost: 25000,
    warehouseAdditionalCostNote: "courier asked at the door",
    lines: [
      {
        itemId: created.request.items[0].id,
        receivedCount: 10,
        placements: [{ placementId: ground.rackId, quantity: 10 }],
      },
    ],
  });

  await page.goto(`/inventories/restock/${created.request.id}`);

  // ── THE MONEY ────────────────────────────────────────────────────────────────────────────────
  // Listed on its own, with its note: the charge is the selling team's debt to the warehouse, and a total that merely
  // got bigger tells nobody what to settle.
  await expect(page.getByTestId("restock-detail-courier-charge")).toContainText("25.000");
  await expect(page.getByTestId("restock-detail-courier-charge-note")).toContainText("courier asked at the door");

  // 500.000 goods + 15.000 freight — what the paying account was charged. The courier's charge is NOT in it.
  await expect(page.getByTestId("restock-detail-total")).toContainText("515.000");

  // ── THE HISTORY ──────────────────────────────────────────────────────────────────────────────
  await page.getByTestId("section-nav-timeline").click();

  // Two steps, in order — raised, then counted in — and the charge is on the second, where it was paid.
  const steps = page.locator("[data-testid^='restock-timeline-'][data-kind]");
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(0)).toHaveAttribute("data-kind", "created");
  await expect(steps.nth(1)).toContainText("25.000");
});

// #18 — A RESTOCK'S LABEL PHOTO OPENS. `receipt_file` is the DOCUMENT ID the form's ReceiptUpload stored, and the page
// used it as an href, so the link went nowhere. The selling team (the photo's owner) now gets a button that mints a signed
// URL on click through GetDownloadUrl. Asserted on the RPC answer beside the popup: headless Chromium's popup never fires
// `load`, so its url() cannot be read.
test("Restock detail: the label photo opens through a signed link (#18)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const ground = await restockGround(page, "P");

  // The upload the form does: RequestUpload → PUT the bytes → ConfirmUpload, in the selling team's scope.
  const requested = await api(page, "document.v1.DocumentService/RequestUpload", {
    teamId: "1",
    filename: "label.png",
    contentType: "image/png",
    sizeBytes: "70",
    resourceType: "DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT",
  });
  const put = await page.evaluate(
    async ([url, method, headers]) => {
      const png = Uint8Array.from(
        atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
        (c) => c.charCodeAt(0),
      );
      const res = await fetch(url as string, { method: method as string, headers: headers as Record<string, string>, body: png });
      return res.status;
    },
    [requested.uploadUrl, requested.method, requested.headers ?? {}] as const,
  );
  expect(put).toBeLessThan(300);
  const confirmed = await api(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: requested.uploadToken });
  const documentId = String(confirmed.document.id);

  const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: "1",
    warehouseId: ground.warehouseId,
    financeAccountId: ground.accountId,
    receipt: `E2ELBL${SUFFIX}`,
    receiptFile: documentId,
    items: [{ productId: ground.productId, productCode: ground.skuA, name: `E2E ${ground.skuA}`, count: 2, total: 20000 }],
  });

  await page.goto(`/inventories/restock/${created.request.id}`);

  const button = page.getByTestId("restock-detail-receipt-photo-open");
  await expect(button).toBeVisible();
  // Never an href: the stored value is an id, and a signed URL rendered on the page would expire while it is open.
  await expect(page.getByTestId("restock-detail-tracking").locator("a")).toHaveCount(0);

  const minted = page.waitForResponse((r) => r.url().includes("DocumentService/GetDownloadUrl"));
  const popup = page.waitForEvent("popup");
  await button.click();

  const res = await minted;
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(String(body.url)).toMatch(/^https?:\/\//);
  await popup;
});

// the-restocks-warehouse-opens-its-label-photo — the WAREHOUSE the restock is going to opens the selling team's label
// photo. A warehouse STAFF member (the floor crew matching the box at the door), created here with that one role, opens
// the warehouse's restock detail and the photo opens through RestockReceiptPhoto — the restock checked to be this
// warehouse's, the link signed in-process. Nothing was shared: as the file's "owner" the warehouse still reads NotFound.
test("Restock detail: the warehouse's staff opens the seller's label photo", async ({ page }) => {
  const STAFF = `e2ephotostaff${SUFFIX}`;
  const PASSWORD = "e2e-photo-pass-1";

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const ground = await restockGround(page, "H");

  const requested = await api(page, "document.v1.DocumentService/RequestUpload", {
    teamId: "1",
    filename: "label.png",
    contentType: "image/png",
    sizeBytes: "70",
    resourceType: "DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT",
  });
  const put = await page.evaluate(
    async ([url, method, headers]) => {
      const png = Uint8Array.from(
        atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
        (c) => c.charCodeAt(0),
      );
      const res = await fetch(url as string, { method: method as string, headers: headers as Record<string, string>, body: png });
      return res.status;
    },
    [requested.uploadUrl, requested.method, requested.headers ?? {}] as const,
  );
  expect(put).toBeLessThan(300);
  const confirmed = await api(page, "document.v1.DocumentService/ConfirmUpload", { uploadToken: requested.uploadToken });
  const documentId = String(confirmed.document.id);

  const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
    teamId: "1",
    warehouseId: ground.warehouseId,
    financeAccountId: ground.accountId,
    receipt: `E2EWPH${SUFFIX}`,
    receiptFile: documentId,
    items: [{ productId: ground.productId, productCode: ground.skuA, name: `E2E ${ground.skuA}`, count: 2, total: 20000 }],
  });
  const restockId = String(created.request.id);

  await api(page, "user.v1.UserService/CreateUser", {
    teamId: ground.warehouseId,
    username: STAFF,
    password: PASSWORD,
    name: STAFF,
    role: "ROLE_WAREHOUSE_STAFF",
  });

  await login(page, STAFF, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), ground.warehouseId);

  await page.goto(`/inventories/restock/${restockId}`);
  await expect(page.getByTestId("restock-detail-page")).toBeVisible();
  await expect(page.getByText("only the selling team can open it")).toHaveCount(0);

  const button = page.getByTestId("restock-detail-receipt-photo-open");
  await expect(button).toBeVisible();
  await expect(page.getByTestId("restock-detail-tracking").locator("a")).toHaveCount(0);

  // The link comes from INVENTORY, and names the seller's file. (Headless Chromium's popup never settles, so the answer
  // that minted the link is what is read, beside the tab opening.)
  const [answer, popup] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/warehouse.inventory.v1.RestockRequestService/RestockReceiptPhoto")),
    page.waitForEvent("popup"),
    button.click(),
  ]);
  expect(answer.status()).toBe(200);
  const body = (await answer.json()) as { url: string; expiresAtUnix: string };
  expect(String(body.url)).toMatch(/^https?:\/\//);
  expect(String(body.url)).toContain("label.png");
  expect(Number(body.expiresAtUnix)).toBeGreaterThan(Date.now() / 1000);
  await popup.close();

  // Never shared: asked as the document's owner, the warehouse reads NotFound.
  await expect(
    api(page, "document.v1.DocumentService/GetDownloadUrl", { teamId: ground.warehouseId, documentId }),
  ).rejects.toThrow(/404|not_found/);
});

// A product's Ongoing figure, as the seller's product picker shows it.
async function ongoingOf(page: Page, productCode: string) {
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
async function inboundRow(page: Page, restockId: string, q = "") {
  await page.goto(`/inventories/restock?status=all${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  await expect(page.getByTestId("restock-inbound-table").or(page.getByTestId("restock-inbound-empty"))).toBeVisible();
  return page.getByTestId(`restock-row-${restockId}`);
}

// ── selling:all wants to restock — the checks behind docs/acceptances/inventory/restock.md ─────────────────────────────
//
// An acceptance has no test file of its own (docs/acceptances/guide.md#acceptances-are-markdown): its checks live here,
// in the regression spec of the feature its WHEN belongs to. The rows' statuses are the owner's, set by hand on the
// owner's instruction — never by this block.
//
// One test per GIVEN — `selling:all wants to restock` in each of its cases — run as EVERY selling role, through the
// seller's own list and form. Each THEN is its own step, named exactly as its row, and checked SOFTLY so one failing then
// does not hide the next. The warehouse's side is read as one warehouse role (status-is-per-then). Every role and case
// pays from its OWN account, so a balance read in one test is never moved by another test's event. The ground is seeded
// in beforeAll, so a worker restarted after a failure seeds its own instead of reading a moved SUFFIX.
test.describe("selling:all wants to restock", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  // The givens' cases, each with its thens as its rows say them (given-is-who-wants-what-in-which-case). A then the case
  // does not change keeps the plain words.
  const CASES = [
    {
      cond: "1 product",
      key: "p1",
      products: 1,
      shipping: 0,
      created: "restock created",
      warehouse: "recorded at warehouse",
      ongoing: "ongoing stock increases",
      balance: "paying account balance decreases",
    },
    {
      cond: "2 products",
      key: "p2",
      products: 2,
      shipping: 0,
      created: "restock created with 2 products",
      warehouse: "recorded at warehouse, both products",
      ongoing: "ongoing stock of product 1 and product 2 increases",
      balance: "paying account balance decreases by both products",
    },
    {
      cond: "with shipping cost",
      key: "sc",
      products: 1,
      shipping: 15_000,
      created: "restock created with shipping cost",
      warehouse: "recorded at warehouse",
      ongoing: "ongoing stock increases",
      balance: "paying account balance decreases, shipping cost included",
    },
  ] as const;
  // Every line of every case: 10 pcs for Rp 100.000.
  const LINE_COUNT = 10;
  const LINE_TOTAL = 100_000;

  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  const username = (role: string) => `e2eacc${role}${SUFFIX}`;
  const WH_USER = `e2eaccwh${SUFFIX}`;
  // One product code per role, case and line, so a list row is found by what only that restock carries.
  const code = (role: string, kase: string, line: number) => `AC${role.toUpperCase()}${kase.toUpperCase()}${line}${SUFFIX}`;
  const at = (role: string, kase: string) => `${role}-${kase}`;
  const WH_CODE = `AW${SUFFIX}`;
  const SUPPLIER_NAME = `E2E Acc Supplier ${SUFFIX}`;
  const ground = { team: "", warehouse: "", supplier: "", accounts: {} as Record<string, string> };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Acc Seller ${SUFFIX}`, `AS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Acc Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");

    const user = (teamId: string, name: string, role: string) =>
      api(page, "user.v1.UserService/CreateUser", { teamId, username: name, password: PASSWORD, name, role });
    for (const r of ROLES) await user(ground.team, username(r.key), r.role);
    await user(ground.warehouse, WH_USER, "ROLE_WAREHOUSE_STAFF");

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: SUPPLIER_NAME })).supplier.id,
    );

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Acc Cat ${SUFFIX}` });
    let n = 0;
    for (const r of ROLES) {
      for (const c of CASES) {
        for (let line = 0; line < c.products; line++) {
          await api(page, "product.v1.ProductService/ProductCreate", {
            teamId: ground.team,
            productCodePart: code(r.key, c.key, line),
            name: `E2E ${code(r.key, c.key, line)}`,
            categoryId: category.category.id,
          });
        }

        const account = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.team,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Acc ${r.key} ${c.key} ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `77${SUFFIX}${++n}`,
          openingBalance: 10_000_000,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        });
        const accountId = String(account.account.id);
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
          teamId: ground.team,
          accountId,
          operational: true,
        });
        ground.accounts[at(r.key, c.key)] = accountId;
      }
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // An account's balance as its own page shows it — "—" until it has loaded, so the figure is waited for.
  async function balanceOf(page: Page, accountId: string): Promise<number> {
    await page.goto(`/financial-accounts/${accountId}`);
    const balance = page.getByTestId("account-detail-balance");
    await expect(balance).toHaveText(/\d/);
    return Number((await balance.innerText()).replace(/[^\d-]/g, ""));
  }

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} create restock (${c.cond})`, async ({ page }) => {
        const account = ground.accounts[at(r.key, c.key)];
        const lines = Array.from({ length: c.products }, (_, line) => code(r.key, c.key, line));
        const paid = c.products * LINE_TOTAL + c.shipping;
        // How a list row sizes the box — the seller's list and the warehouse's alike.
        const size = `${c.products} ${c.products === 1 ? "product" : "products"} · ${c.products * LINE_COUNT} pcs`;

        await signIn(page, username(r.key), ground.team);
        const before = await balanceOf(page, account);

        // WHEN — through the seller's own list and form, as this role.
        await page.goto("/inventories/restock");
        await page.getByTestId("open-create-restock").or(page.getByTestId("open-create-restock-empty")).first().click();
        await expect(page).toHaveURL(/\/inventories\/restock\/new$/);

        await page.getByTestId("restock-pick-products").click();
        for (const line of lines) {
          await tick(page, line);
        }
        await page.getByTestId("product-picker-confirm").click();

        for (let line = 0; line < lines.length; line++) {
          await page.getByTestId(`restock-qty-${line}`).fill(String(LINE_COUNT));
          await page.getByTestId(`restock-total-price-${line}`).fill(String(LINE_TOTAL));
        }

        await page.getByTestId("restock-warehouse").locator("input").fill(WH_CODE);
        await page.getByTestId(`team-select-option-${WH_CODE}`).click();

        await page.getByTestId("restock-finance-account").click();
        await page.getByTestId(`restock-finance-account-option-${account}`).click();

        await page.getByTestId("restock-all-supplier-picker-trigger").click();
        await page.getByTestId("restock-all-supplier-picker-search").fill(SUPPLIER_NAME);
        await page.getByTestId(`restock-all-supplier-picker-supplier-${ground.supplier}`).click();
        await page.getByTestId("restock-all-supplier-picker-confirm").click();

        await page.getByTestId("restock-courier").getByRole("combobox").click();
        await page.getByTestId("shipment-channel-option-jne").click();

        await page.getByTestId("restock-receipt").fill(`E2E-ACC-${r.key.toUpperCase()}-${c.key.toUpperCase()}-${SUFFIX}`);
        if (c.shipping > 0) {
          await page.getByTestId("restock-shipping-cost").fill(String(c.shipping));
        }

        await expect(page.getByTestId("restock-form-ready")).toBeVisible();
        await page.getByTestId("submit-restock").click();
        await expect(page).toHaveURL(/\/inventories\/restock$/);

        // The restock just made: the ongoing row carrying this case's first product.
        const made = page
          .getByTestId("restock-requests-table")
          .locator("tbody tr")
          .filter({ hasText: lines[0] })
          .filter({ has: page.getByTestId("restock-status-1") });
        await expect(made).toHaveCount(1);
        const restockId = (await made.getAttribute("data-testid"))!.replace("restock-row-", "");

        // THEN — as the seller. Listed as ongoing and sized as raised; the shipping cost is read on its own page.
        await test.step(`then: ${c.created}`, async () => {
          await expect.soft(made).toContainText(size);
          if (c.shipping > 0) {
            await page.goto(`/inventories/restock/${restockId}`);
            await expect.soft(page.getByTestId("restock-detail-shipping")).toContainText(c.shipping.toLocaleString("id-ID"));
          }
        });

        // Each line's Ongoing, as the seller's picker shows it — re-read until it lands rather than once.
        await test.step(`then: ${c.ongoing}`, async () => {
          for (const line of lines) {
            await expect
              .soft(async () => {
                await expect(await ongoingOf(page, line)).toContainText(String(LINE_COUNT), { timeout: 2_000 });
              })
              .toPass({ timeout: 30_000 });
          }
        });

        // The account moves when financial_account_service takes the Restock Created event, so it is re-read until
        // it lands rather than once.
        await test.step(`then: ${c.balance} (by ${rupiah(paid)}, from ${rupiah(before)})`, async () => {
          await expect
            .soft(async () => {
              await page.goto(`/financial-accounts/${account}`);
              await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(before - paid), {
                timeout: 2_000,
              });
            })
            .toPass({ timeout: 30_000 });
        });

        // The line financial_account_service writes for it: "Restock #<id>".
        await test.step(`then: recorded in account history (Restock #${restockId})`, async () => {
          await expect
            .soft(async () => {
              await page.goto(`/financial-accounts/${account}`);
              await expect(page.getByTestId("account-log-table")).toContainText(`Restock #${restockId}`, {
                timeout: 2_000,
              });
            })
            .toPass({ timeout: 30_000 });
        });

        // THEN — as the warehouse: on its inbound list, sized as raised.
        await signIn(page, WH_USER, ground.warehouse);
        await test.step(`then: ${c.warehouse}`, async () => {
          await expect.soft(await inboundRow(page, restockId)).toContainText(size);
        });
      });
    }
  }
});

// ── warehouse:all wants to receive a restock — the checks behind docs/acceptances/inventory/restock.md ─────────────────
//
// Same shape as the create block above: one test per GIVEN, run as EVERY warehouse role, marking the box arrived on its
// own inbound list. The restock is the given's state — ongoing, or given up as lost by the seller
// (a-late-lost-box-is-signed-for-as-arrived) — so it is seeded through the API; the mark is the WHEN, through the
// screen. (set courier charge) is 🚧 unimplemented — the server drops the charge — so it has no check here yet.
test.describe("warehouse:all wants to receive a restock", () => {
  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;
  // The givens' cases: the status the restock is in when the box is marked arrived.
  const CASES = [
    { cond: "from ongoing", key: "on", from: "ongoing", status: 1 },
    { cond: "from lost", key: "lo", from: "lost", status: 5 },
  ] as const;

  const username = (role: string) => `e2earr${role}${SUFFIX}`;
  const displayName = (given: string) => `Arr ${given} ${SUFFIX}`;
  const ground = { team: "", warehouse: "", restocks: {} as Record<string, string> };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Arr Seller ${SUFFIX}`, `RS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Arr Warehouse ${SUFFIX}`, `RA${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");

    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.warehouse,
        username: username(r.key),
        password: PASSWORD,
        name: displayName(r.given),
        role: r.role,
      });
    }

    const account = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E Arr BCA ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `78${SUFFIX}01`,
      openingBalance: 10_000_000,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    });
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: ground.team,
      accountId: account.account.id,
      operational: true,
    });

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Arr Cat ${SUFFIX}` });
    const sku = `ARR${SUFFIX}`;
    const product = await api(page, "product.v1.ProductService/ProductCreate", {
      teamId: ground.team,
      productCodePart: sku,
      name: `E2E ${sku}`,
      categoryId: category.category.id,
    });

    // GIVEN — per role and case, a restock on its way to the warehouse; the (from lost) ones given up by the seller.
    for (const r of ROLES) {
      for (const c of CASES) {
        const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: ground.team,
          warehouseId: ground.warehouse,
          financeAccountId: account.account.id,
          items: [{ productId: product.product.id, productCode: sku, name: `E2E ${sku}`, count: 10, total: 100_000 }],
        });
        const id = String(created.request.id);
        if (c.key === "lo") {
          await api(page, "inventory.v1.RestockRequestService/RestockRequestMarkLost", { teamId: ground.team, requestId: id });
        }
        ground.restocks[`${r.key}-${c.key}`] = id;
      }
    }

    await page.close();
  });

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} mark arrived restock (${c.cond})`, async ({ page }) => {
        const id = ground.restocks[`${r.key}-${c.key}`];

        // WHEN — Mark Arrived on the warehouse's own inbound list, as this role, from the case's status.
        await login(page, username(r.key), PASSWORD);
        await page.evaluate((team) => window.sessionStorage.setItem("warehouse_revamp.team", team), ground.warehouse);
        await page.goto("/inventories/restock?status=all");
        await expect(page.getByTestId("restock-inbound-page")).toBeVisible();
        const row = page.getByTestId(`restock-row-${id}`);
        await expect(row.getByTestId(`restock-status-${c.status}`)).toBeVisible();
        await page.getByTestId(`restock-action-sign-${id}`).click();
        await page.getByTestId("confirm-action").click();

        await test.step(`then: status changed from ${c.from} to arrived`, async () => {
          await expect.soft(row.getByTestId("restock-status-4")).toBeVisible();
          await expect.soft(row.getByTestId(`restock-status-${c.status}`)).toHaveCount(0);
        });

        await test.step("then: receiver and time recorded", async () => {
          await expect.soft(page.getByTestId(`restock-arrived-${id}`)).toContainText(/\d/);
          await expect.soft(page.getByTestId(`restock-arrived-${id}-by`)).toContainText(displayName(r.given));
        });
      });
    }
  }
});

// A product's Ready figure at one warehouse, as the seller's product picker shows it once that warehouse is chosen on the
// form (Ready needs a building to be about).
//
// ⚠ The warehouse is typed again until its option SHOWS: typed before the teams have loaded, the select remounts when
// they land (a combobox whose collection fills late) and closes, leaving the option in the DOM but hidden.
async function readyAt(page: Page, warehouseCode: string, productCode: string) {
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

// ── warehouse:all wants to accept a restock — the checks behind docs/acceptances/inventory/restock.md ─────────────────
//
// One test per GIVEN, run as EVERY warehouse role. The accept itself goes through the API, with that role's own token:
// the accept FORM has its own coverage in its stories, and what these givens check is where the figures land, which
// the form does not change. Every then is read on a screen — the warehouse's inbound list, rack, and batch, and the
// selling team's product picker for its Ready and Ongoing.
//
// (from arrived) and (from ongoing) count a restock of 10 pcs for Rp 100.000 whole onto the shelf. Each product also has
// a second restock of 5 pcs that stays ongoing, so `ongoing stock decreases` reads 15 → 5 rather than "something → none".
//
// (product new to warehouse) and (product already listed) read the warehouse's own Products — every product it holds or
// has held — for the product's ONE row. (has brokens, thrown away) counts 10 in with 2 broken: 8 reach the shelf, and the
// 2 are a broken row the selling team reads on its restock page. (has brokens, put on rack) is 🚧 unimplemented — the
// accept keeps no rack for broken units — so it has no check here yet. (has missing items) counts
// 7 in of 10, and the 3 are a missing row, read the same way. (1 supplier) and (multi suppliers) check
// `recorded at supplier`. (set courier charge) is not tested here yet. (multi suppliers) is ❌ error: supplier_service folds a restock under ONE restock-level supplier, so a restock
// whose lines name different suppliers is recorded at none (commonLineSupplier). Its check is `test.fail` — green while
// the bug stands, red the day it is fixed, which is the sign to ask the owner to change the status
// (acceptances-are-markdown). A one-supplier restock accepted AFTER the mixed one is its CONTROL: once that shows, the
// fold has run, so the mixed one's absence is the bug and not a slow fold. A broken fold fails the (1 supplier) test
// beside it, so `test.fail` hides nothing.
test.describe("warehouse:all wants to accept a restock", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;
  // The givens whose restock is counted whole onto the shelf, by the status it is in when it is counted.
  const CASES = [
    { cond: "from arrived", key: "ar", from: "arrived", status: 4 },
    { cond: "from ongoing", key: "on", from: "ongoing", status: 1 },
  ] as const;
  // A counted restock: 10 pcs for Rp 100.000, so Rp 10.000 a unit. Its product's other restock: 5 pcs, left ongoing.
  const COUNTED = 10;
  const COUNTED_TOTAL = 100_000;
  const LEFT_ONGOING = 5;
  // Of a (has brokens, thrown away) restock's 10, how many are broken; of a (has missing items) one's, how many never came.
  const BROKEN = 2;
  const MISSING = 3;

  type Raised = { request: { id: string; items: { id: string }[] } };

  const username = (role: string) => `e2eacp${role}${SUFFIX}`;
  const displayName = (given: string) => `Acp ${given} ${SUFFIX}`;
  const SELLER = `e2eacpseller${SUFFIX}`;
  const WH_CODE = `PW${SUFFIX}`;
  // Per role: line C (supplier A) of the one-supplier restock; lines A (supplier A) and B (supplier B) of the MIXED
  // restock, and line D (supplier A) of its control.
  const sku = (role: string, line: "A" | "B" | "C" | "D") => `ACP${role.toUpperCase()}${line}${SUFFIX}`;
  // Per role and case: the product of the restock counted whole onto the shelf.
  const caseSku = (role: string, kase: string) => `ACP${role.toUpperCase()}${kase.toUpperCase()}${SUFFIX}`;
  const ground = {
    team: "",
    warehouse: "",
    rack: "",
    account: "",
    supplierA: "",
    supplierB: "",
    products: {} as Record<string, string>,
    restocks: {} as Record<string, Raised>,
  };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    ground.team = String(
      (
        await api(page, "team.v1.TeamService/TeamCreate", {
          name: `E2E Acp Seller ${SUFFIX}`,
          teamCode: `PS${SUFFIX}`,
          type: "TEAM_TYPE_SELLING",
          ownerUserId: ROOT_USER_ID,
        })
      ).team.id,
    );
    ground.warehouse = String(
      (
        await api(page, "team.v1.TeamService/TeamCreate", {
          name: `E2E Acp Warehouse ${SUFFIX}`,
          teamCode: WH_CODE,
          type: "TEAM_TYPE_WAREHOUSE",
          ownerUserId: ROOT_USER_ID,
        })
      ).team.id,
    );
    ground.rack = String(
      (
        await api(page, "inventory.v1.RackService/RackCreate", {
          teamId: ground.warehouse,
          code: `acp-${SUFFIX}`,
          name: "E2E accept shelf",
        })
      ).rack.id,
    );

    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.warehouse,
        username: username(r.key),
        password: PASSWORD,
        name: displayName(r.given),
        role: r.role,
      });
    }
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.team,
      username: SELLER,
      password: PASSWORD,
      name: `Acp selling:owner ${SUFFIX}`,
      role: "ROLE_SELLING_OWNER",
    });

    ground.supplierA = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Acp Sup A ${SUFFIX}` }))
        .supplier.id,
    );
    ground.supplierB = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Acp Sup B ${SUFFIX}` }))
        .supplier.id,
    );

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Acp Cat ${SUFFIX}` });
    const product = async (code: string) => {
      const created = await api(page, "product.v1.ProductService/ProductCreate", {
        teamId: ground.team,
        productCodePart: code,
        name: `E2E ${code}`,
        categoryId: category.category.id,
      });
      ground.products[code] = String(created.product.id);
    };
    for (const r of ROLES) {
      for (const line of ["A", "B", "C", "D"] as const) await product(sku(r.key, line));
      for (const c of CASES) await product(caseSku(r.key, c.key));
      for (const kase of ["nw", "al", "br", "ms"]) await product(caseSku(r.key, kase));
    }

    const account = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: ground.team,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: `E2E Acp BCA ${SUFFIX}`,
      holderName: "E2E",
      accountNumber: `79${SUFFIX}01`,
      openingBalance: 10_000_000,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    });
    ground.account = String(account.account.id);
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: ground.team,
      accountId: ground.account,
      operational: true,
    });

    // GIVEN — per role, the restocks it will count in, raised here by root (any seller would do; the seller is not who
    // is being checked): one with one supplier, one with multi suppliers, and the multi one's control.
    for (const r of ROLES) {
      ground.restocks[`${r.key}-single`] = await raise(page, [{ code: sku(r.key, "C"), supplierId: ground.supplierA }]);
      ground.restocks[`${r.key}-mixed`] = await raise(page, [
        { code: sku(r.key, "A"), supplierId: ground.supplierA },
        { code: sku(r.key, "B"), supplierId: ground.supplierB },
      ]);
      ground.restocks[`${r.key}-control`] = await raise(page, [{ code: sku(r.key, "D"), supplierId: ground.supplierA }]);
    }

    // GIVEN — per role and case, the restock to count whole (signed for first when the case is from arrived), and the
    // same product's second restock, which stays ongoing.
    for (const r of ROLES) {
      for (const c of CASES) {
        const code = caseSku(r.key, c.key);
        const counted = await raise(page, [
          { code, supplierId: ground.supplierA, count: COUNTED, total: COUNTED_TOTAL },
        ]);
        if (c.key === "ar") {
          await api(page, "inventory.v1.RestockRequestService/RestockRequestArrive", {
            teamId: ground.warehouse,
            requestId: counted.request.id,
          });
        }
        ground.restocks[`${r.key}-${c.key}`] = counted;
        await raise(page, [{ code, supplierId: ground.supplierA, count: LEFT_ONGOING, total: LEFT_ONGOING * 10_000 }]);
      }
    }

    // GIVEN — per role, a product the warehouse has never held, and one it already lists: counted in once here, by root,
    // before the role counts in its second restock.
    for (const r of ROLES) {
      const fresh = caseSku(r.key, "nw");
      ground.restocks[`${r.key}-nw`] = await raise(page, [
        { code: fresh, supplierId: ground.supplierA, count: COUNTED, total: COUNTED_TOTAL },
      ]);

      const listed = caseSku(r.key, "al");
      const first = await raise(page, [{ code: listed, supplierId: ground.supplierA, count: COUNTED, total: COUNTED_TOTAL }]);
      await acceptWhole(page, [first], COUNTED);
      ground.restocks[`${r.key}-al`] = await raise(page, [
        { code: listed, supplierId: ground.supplierA, count: COUNTED, total: COUNTED_TOTAL },
      ]);

      // …and two ongoing restocks: one that will come in with broken units, one with units missing.
      ground.restocks[`${r.key}-br`] = await raise(page, [
        { code: caseSku(r.key, "br"), supplierId: ground.supplierA, count: COUNTED, total: COUNTED_TOTAL },
      ]);
      ground.restocks[`${r.key}-ms`] = await raise(page, [
        { code: caseSku(r.key, "ms"), supplierId: ground.supplierA, count: COUNTED, total: COUNTED_TOTAL },
      ]);
    }

    await page.close();
  });

  // The rows of the warehouse's own Products (every product it holds or has held) that carry this product code.
  async function warehouseRows(page: Page, code: string) {
    await page.goto(`/products?q=${code}`);
    return page.locator('[data-testid^="stock-row-"]').filter({ hasText: code });
  }

  // A restock of the given lines — 2 pcs for Rp 20.000 each unless said — raised for the selling team by `page`'s user.
  async function raise(
    page: Page,
    lines: { code: string; supplierId: string; count?: number; total?: number }[],
  ): Promise<Raised> {
    const created = await page.evaluate(
      async ([body]) => {
        const token =
          window.sessionStorage.getItem("warehouse_revamp.token") ??
          window.localStorage.getItem("warehouse_revamp.token");
        const res = await fetch("http://localhost:8081/warehouse.inventory.v1.RestockRequestService/RestockRequestCreate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`RestockRequestCreate: ${res.status} ${await res.text()}`);
        return res.json();
      },
      [
        {
          teamId: ground.team,
          warehouseId: ground.warehouse,
          financeAccountId: ground.account,
          items: lines.map((l) => ({
            productId: ground.products[l.code],
            productCode: l.code,
            name: `E2E ${l.code}`,
            count: l.count ?? 2,
            total: l.total ?? 20000,
            supplierId: l.supplierId,
          })),
        },
      ] as const,
    );
    return created as Raised;
  }

  // WHEN — `page`'s warehouse role counts each restock in, whole, onto the shelf, in the order given.
  async function acceptWhole(page: Page, restocks: Raised[], count = 2) {
    for (const restock of restocks) {
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: restock.request.id,
        lines: restock.request.items.map((item) => ({
          itemId: item.id,
          receivedCount: count,
          placements: [{ placementId: ground.rack, quantity: count }],
        })),
      });
    }
  }

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // THEN is read by the selling team, on a supplier's Statistics, by product.
  async function asSeller(page: Page) {
    await signIn(page, SELLER, ground.team);
  }

  async function byProduct(page: Page, supplierId: string) {
    await page.goto(`/inventories/suppliers/${supplierId}`);
    await page.getByTestId("supplier-tab-statistics").click();
    await page.getByTestId("statistics-view-product").click();
    return page.getByTestId("supplier-statistics");
  }

  // The fold runs on an event, so a product is re-read until it lands rather than once.
  async function untilRecorded(page: Page, supplierId: string, code: string) {
    await expect(async () => {
      const stats = await byProduct(page, supplierId);
      await expect(stats.getByTestId("statistics-products")).toContainText(`E2E ${code}`, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} accept restock (${c.cond})`, async ({ page }) => {
        const restock = ground.restocks[`${r.key}-${c.key}`];
        const id = restock.request.id;
        const code = caseSku(r.key, c.key);
        const productId = ground.products[code];

        await signIn(page, username(r.key), ground.warehouse);
        const row = await inboundRow(page, id, code);
        await expect(row.getByTestId(`restock-status-${c.status}`)).toBeVisible();

        await acceptWhole(page, [restock], COUNTED);

        // THEN — as the warehouse that counted it.
        await test.step(`then: status changed from ${c.from} to accepted`, async () => {
          const after = await inboundRow(page, id, code);
          await expect.soft(after.getByTestId("restock-status-2")).toBeVisible();
          await expect.soft(after.getByTestId(`restock-status-${c.status}`)).toHaveCount(0);
        });

        // Counted straight from ongoing, the box arrived the moment it was counted, signed for by whoever counted it.
        if (c.key === "on") {
          await test.step("then: receiver and time recorded", async () => {
            await inboundRow(page, id, code);
            await expect.soft(page.getByTestId(`restock-arrived-${id}`)).toContainText(/\d/);
            await expect.soft(page.getByTestId(`restock-arrived-${id}-by`)).toContainText(displayName(r.given));
          });
        }

        await test.step("then: units on rack", async () => {
          await page.goto(`/inventories/racks/${ground.rack}`);
          await expect.soft(page.getByTestId(`rack-stock-onhand-${productId}`)).toHaveText(String(COUNTED));
        });

        // The batch the count minted, on the warehouse's batch list: Rp 100.000 ÷ 10 a unit. ⚠ Found by its RESTOCK
        // number, then its product: the list's search reads the restock number and the receipt only, whatever its
        // placeholder says about products (batch_list.go).
        await test.step("then: price set on batch", async () => {
          await page.goto(`/inventories/batches?q=${id}`);
          const batch = page.locator('[data-testid^="batches-row-"]').filter({ hasText: code });
          await expect.soft(batch).toHaveCount(1);
          if ((await batch.count()) === 1) {
            await batch.click();
            await expect.soft(page.getByTestId("batch-detail-unit-cost")).toContainText(
              (COUNTED_TOTAL / COUNTED).toLocaleString("id-ID"),
            );
          }
        });

        // THEN — as the selling team, whose Ready and Ongoing these are.
        await signIn(page, SELLER, ground.team);
        await test.step("then: ready stock increases", async () => {
          await expect.soft(await readyAt(page, WH_CODE, code)).toHaveText(String(COUNTED));
        });

        await test.step(`then: ongoing stock decreases (from ${COUNTED + LEFT_ONGOING} to ${LEFT_ONGOING})`, async () => {
          await expect.soft(await ongoingOf(page, code)).toHaveText(String(LEFT_ONGOING));
        });
      });
    }
  }

  for (const r of ROLES) {
    test(`${r.given} accept restock (has brokens, thrown away)`, async ({ page }) => {
      const restock = ground.restocks[`${r.key}-br`];
      const id = restock.request.id;
      const code = caseSku(r.key, "br");
      const productId = ground.products[code];

      await signIn(page, username(r.key), ground.warehouse);
      await expect((await inboundRow(page, id, code)).getByTestId("restock-status-1")).toBeVisible();

      // WHEN — 10 in the box, 2 of them broken and thrown away: the 8 good ones go on the shelf.
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: id,
        lines: [
          {
            itemId: restock.request.items[0].id,
            receivedCount: COUNTED,
            brokenCount: BROKEN,
            brokenNote: "crushed in transit",
            placements: [{ placementId: ground.rack, quantity: COUNTED - BROKEN }],
          },
        ],
      });

      await test.step("then: status changed from ongoing to accepted", async () => {
        const after = await inboundRow(page, id, code);
        await expect.soft(after.getByTestId("restock-status-2")).toBeVisible();
        await expect.soft(after.getByTestId("restock-status-1")).toHaveCount(0);
      });

      // THEN — as the selling team: its Ready, and its restock page's count.
      await signIn(page, SELLER, ground.team);
      await test.step(`then: ready stock increases, broken excluded (${COUNTED} − ${BROKEN})`, async () => {
        await expect.soft(await readyAt(page, WH_CODE, code)).toHaveText(String(COUNTED - BROKEN));
      });

      await test.step("then: broken items recorded", async () => {
        await page.goto(`/inventories/restock/${id}`);
        await page.getByTestId("section-nav-products").click();
        await page.getByTestId(`restock-detail-adjustment-${productId}`).click();
        await expect.soft(page.getByTestId(`restock-detail-adjustment-${productId}-dialog`)).toBeVisible();
        await expect.soft(page.getByTestId(`restock-detail-broken-${productId}-count`)).toContainText(String(BROKEN));
      });
    });

    test(`${r.given} accept restock (has missing items)`, async ({ page }) => {
      const restock = ground.restocks[`${r.key}-ms`];
      const id = restock.request.id;
      const code = caseSku(r.key, "ms");
      const productId = ground.products[code];
      const arrived = COUNTED - MISSING;

      await signIn(page, username(r.key), ground.warehouse);
      await expect((await inboundRow(page, id, code)).getByTestId("restock-status-1")).toBeVisible();

      // WHEN — 10 ordered, 7 in the box, all good on the shelf: the other 3 are worked out as missing.
      await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
        teamId: ground.warehouse,
        requestId: id,
        lines: [
          {
            itemId: restock.request.items[0].id,
            receivedCount: arrived,
            missingNote: "never in the box",
            placements: [{ placementId: ground.rack, quantity: arrived }],
          },
        ],
      });

      await test.step("then: status changed from ongoing to accepted", async () => {
        const after = await inboundRow(page, id, code);
        await expect.soft(after.getByTestId("restock-status-2")).toBeVisible();
        await expect.soft(after.getByTestId("restock-status-1")).toHaveCount(0);
      });

      // THEN — as the selling team: its Ready, and its restock page's count.
      await signIn(page, SELLER, ground.team);
      await test.step(`then: ready stock increases, missing excluded (${COUNTED} − ${MISSING})`, async () => {
        await expect.soft(await readyAt(page, WH_CODE, code)).toHaveText(String(arrived));
      });

      await test.step("then: missing items recorded", async () => {
        await page.goto(`/inventories/restock/${id}`);
        await page.getByTestId("section-nav-products").click();
        await page.getByTestId(`restock-detail-adjustment-${productId}`).click();
        await expect.soft(page.getByTestId(`restock-detail-adjustment-${productId}-dialog`)).toBeVisible();
        await expect.soft(page.getByTestId(`restock-detail-missing-${productId}-count`)).toContainText(String(MISSING));
      });
    });

    test(`${r.given} accept restock (product new to warehouse)`, async ({ page }) => {
      const code = caseSku(r.key, "nw");

      await signIn(page, username(r.key), ground.warehouse);
      await acceptWhole(page, [ground.restocks[`${r.key}-nw`]], COUNTED);

      await test.step("then: product listed in target warehouse", async () => {
        const rows = await warehouseRows(page, code);
        await expect.soft(rows).toHaveCount(1);
        await expect.soft(rows.locator('[data-testid^="stock-onhand-"]')).toHaveText(String(COUNTED));
      });
    });

    test(`${r.given} accept restock (product already listed)`, async ({ page }) => {
      const code = caseSku(r.key, "al");

      await signIn(page, username(r.key), ground.warehouse);
      const before = await warehouseRows(page, code);
      await expect(before).toHaveCount(1);

      await acceptWhole(page, [ground.restocks[`${r.key}-al`]], COUNTED);

      // Still ONE row, now holding both counts.
      await test.step("then: product not listed again", async () => {
        const rows = await warehouseRows(page, code);
        await expect.soft(rows.locator('[data-testid^="stock-onhand-"]')).toHaveText(String(COUNTED * 2));
        await expect.soft(rows).toHaveCount(1);
      });
    });

    test(`${r.given} accept restock (1 supplier)`, async ({ page }) => {
      await login(page, username(r.key), PASSWORD);
      await acceptWhole(page, [ground.restocks[`${r.key}-single`]]);

      await asSeller(page);
      await test.step("then: recorded at supplier", async () => {
        await untilRecorded(page, ground.supplierA, sku(r.key, "C"));
      });
    });

    test(`${r.given} accept restock (multi suppliers)`, async ({ page }) => {
      test.fail(true, "❌ error — docs/acceptances/inventory/restock.md#a-multi-supplier-restock-is-recorded-at-no-supplier");

      // The mixed one first, its control after.
      await login(page, username(r.key), PASSWORD);
      await acceptWhole(page, [ground.restocks[`${r.key}-mixed`], ground.restocks[`${r.key}-control`]]);

      await asSeller(page);
      // The control has landed, so the fold has run past the mixed restock.
      await untilRecorded(page, ground.supplierA, sku(r.key, "D"));

      await test.step("then: recorded at supplier", async () => {
        const atA = await byProduct(page, ground.supplierA);
        await expect.soft(atA.getByTestId("statistics-products")).toContainText(`E2E ${sku(r.key, "A")}`);
        const atB = await byProduct(page, ground.supplierB);
        await expect.soft(atB).toContainText(`E2E ${sku(r.key, "B")}`);
      });
    });
  }
});

// ── selling:all edit — the checks behind docs/acceptances/inventory/restock.md ────────────────────────────────────────
//
// Every selling role edits through its own restock page and form, in three cases: an ongoing restock's count and total
// (the same account), an ongoing restock moved to another warehouse and another account, and an arrived restock's count
// with a product added. The restocks are the GIVEN, seeded through the API; each case has its OWN paying account, so a
// balance read in one test is never moved by another test's events.
test.describe("selling:all edit", () => {
  test.describe.configure({ timeout: 120_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  const CASES = [
    { cond: "ongoing", key: "on" },
    { cond: "ongoing, moved to another warehouse and account", key: "mv" },
    { cond: "arrived", key: "ar" },
  ] as const;

  const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
  const username = (role: string) => `e2eedt${role}${SUFFIX}`;
  const W1_USER = `e2eedtwa${SUFFIX}`;
  const W2_USER = `e2eedtwb${SUFFIX}`;
  const W1_CODE = `EA${SUFFIX}`;
  const W2_CODE = `EB${SUFFIX}`;
  const SUPPLIER_NAME = `E2E Edt Supplier ${SUFFIX}`;
  // P is the restock's line; Q the product an arrived restock gains by the edit.
  const code = (role: string, kase: string, line: "P" | "Q") => `ED${role.toUpperCase()}${kase.toUpperCase()}${line}${SUFFIX}`;
  const at = (role: string, kase: string) => `${role}-${kase}`;

  const ground = {
    team: "",
    w1: "",
    w2: "",
    supplier: "",
    accounts: {} as Record<string, string>,
    // The account a moved restock moves to, per role.
    newAccounts: {} as Record<string, string>,
    restocks: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Edt Seller ${SUFFIX}`, `ES${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.w1 = await team(`E2E Edt Warehouse A ${SUFFIX}`, W1_CODE, "TEAM_TYPE_WAREHOUSE");
    ground.w2 = await team(`E2E Edt Warehouse B ${SUFFIX}`, W2_CODE, "TEAM_TYPE_WAREHOUSE");

    const user = (teamId: string, name: string, role: string) =>
      api(page, "user.v1.UserService/CreateUser", { teamId, username: name, password: PASSWORD, name, role });
    for (const r of ROLES) await user(ground.team, username(r.key), r.role);
    await user(ground.w1, W1_USER, "ROLE_WAREHOUSE_STAFF");
    await user(ground.w2, W2_USER, "ROLE_WAREHOUSE_STAFF");

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: SUPPLIER_NAME })).supplier.id,
    );

    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Edt Cat ${SUFFIX}` });
    const product = async (productCode: string) =>
      String(
        (
          await api(page, "product.v1.ProductService/ProductCreate", {
            teamId: ground.team,
            productCodePart: productCode,
            name: `E2E ${productCode}`,
            categoryId: category.category.id,
          })
        ).product.id,
      );

    const account = async (name: string, number: string) => {
      const created = await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: ground.team,
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name,
        holderName: "E2E",
        accountNumber: number,
        openingBalance: 10_000_000,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      });
      const id = String(created.account.id);
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId: ground.team,
        accountId: id,
        operational: true,
      });
      return id;
    };

    let n = 0;
    for (const r of ROLES) {
      ground.newAccounts[r.key] = await account(`E2E Edt New ${r.key} ${SUFFIX}`, `80${SUFFIX}${++n}`);

      for (const c of CASES) {
        const p = code(r.key, c.key, "P");
        const productId = await product(p);
        if (c.key === "ar") await product(code(r.key, c.key, "Q"));

        const accountId = await account(`E2E Edt ${r.key} ${c.key} ${SUFFIX}`, `80${SUFFIX}${++n}`);
        ground.accounts[at(r.key, c.key)] = accountId;

        // GIVEN — an ongoing restock of 10 × Rp 10.000 to warehouse A, one supplier, paid from its own account.
        const created = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: ground.team,
          warehouseId: ground.w1,
          financeAccountId: accountId,
          receipt: `E2E-EDT-${r.key}-${c.key}-${SUFFIX}`.toUpperCase(),
          items: [{ productId, productCode: p, name: `E2E ${p}`, count: 10, total: 100_000, supplierId: ground.supplier }],
        });
        const id = String(created.request.id);
        // …and for the arrived case, signed for by warehouse A.
        if (c.key === "ar") {
          await api(page, "inventory.v1.RestockRequestService/RestockRequestArrive", { teamId: ground.w1, requestId: id });
        }
        ground.restocks[at(r.key, c.key)] = id;
      }
    }

    await page.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // An account's balance as its page shows it, once the line `text` is in its history — the create's payment, or the
  // edit's — so a read is never of an account an event has yet to reach.
  async function balanceOnceRecorded(page: Page, accountId: string, text: string): Promise<number> {
    let balance = 0;
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-log-table")).toContainText(text, { timeout: 2_000 });
      const shown = page.getByTestId("account-detail-balance");
      await expect(shown).toHaveText(/\d/, { timeout: 2_000 });
      balance = Number((await shown.innerText()).replace(/[^\d-]/g, ""));
    }).toPass({ timeout: 30_000 });
    return balance;
  }

  async function balanceIs(page: Page, accountId: string, expected: number) {
    await expect(async () => {
      await page.goto(`/financial-accounts/${accountId}`);
      await expect(page.getByTestId("account-detail-balance")).toHaveText(rupiah(expected), { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  }

  for (const c of CASES) {
    for (const r of ROLES) {
      test(`${r.given} edit (${c.cond})`, async ({ page }) => {
        const id = ground.restocks[at(r.key, c.key)];
        const account = ground.accounts[at(r.key, c.key)];
        const p = code(r.key, c.key, "P");
        const q = code(r.key, c.key, "Q");

        await signIn(page, username(r.key), ground.team);
        const before = await balanceOnceRecorded(page, account, `Restock #${id}`);
        const beforeNew = c.key === "mv" ? await balanceOnceRecorded(page, ground.newAccounts[r.key], "") : 0;

        // WHEN — from the restock's own page, as this role: Edit while ongoing, Edit Lines once it has arrived (only the
        // lines can change then).
        await page.goto(`/inventories/restock/${id}`);
        await page.getByTestId(c.key === "ar" ? `restock-action-edit-lines-${id}` : `restock-action-edit-${id}`).click();
        await expect(page.getByTestId("restock-edit-page")).toBeVisible();

        if (c.key === "on" || c.key === "ar") {
          await page.getByTestId("restock-qty-0").fill("12");
          await page.getByTestId("restock-total-price-0").fill("120000");
        }

        if (c.key === "mv") {
          await page.getByTestId("restock-warehouse").locator("input").fill(W2_CODE);
          await page.getByTestId(`team-select-option-${W2_CODE}`).click();
          await page.getByTestId("restock-finance-account").click();
          await page.getByTestId(`restock-finance-account-option-${ground.newAccounts[r.key]}`).click();
        }

        if (c.key === "ar") {
          // A product added after the box arrived names its own supplier and says why (a-line-added-after-arrival-names-its-supplier).
          await page.getByTestId("restock-pick-products").click();
          await tick(page, q);
          await page.getByTestId("product-picker-confirm").click();
          await page.getByTestId("restock-line-1-picker-trigger").click();
          const dialog = page.getByTestId("restock-line-1-picker-dialog");
          await dialog.getByTestId("restock-line-1-picker-search").fill(SUPPLIER_NAME);
          await dialog.getByTestId(`restock-line-1-picker-supplier-${ground.supplier}`).click();
          await dialog.getByTestId("restock-line-1-picker-confirm").click();
          await page.getByTestId("restock-qty-1").fill("5");
          await page.getByTestId("restock-total-price-1").fill("50000");
          await page.getByTestId("restock-line-1-note").fill("added after the box arrived");
        } else {
          // The courier is asked for while the parcel is open (the-courier-is-required-on-the-form); the seed named none.
          await page.getByTestId("restock-courier").getByRole("combobox").click();
          await page.getByTestId("shipment-channel-option-jne").click();
        }

        await expect(page.getByTestId("restock-form-ready")).toBeVisible();
        await page.getByTestId("submit-restock").click();
        await expect(page).toHaveURL(new RegExp(`/inventories/restock/${id}$`));

        // THEN — as the seller.
        if (c.key === "on") {
          await test.step("then: restock shows changes", async () => {
            await page.getByTestId("section-nav-products").click();
            await expect.soft(page.getByTestId("restock-detail-products")).toContainText("12");
          });
        }

        if (c.key === "ar") {
          await test.step("then: restock shows changed lines", async () => {
            await page.getByTestId("section-nav-products").click();
            await expect.soft(page.getByTestId("restock-detail-products")).toContainText("12");
          });
          await test.step("then: restock shows added product", async () => {
            await expect.soft(page.getByTestId("restock-detail-products")).toContainText(q);
          });
        }

        if (c.key === "on" || c.key === "ar") {
          await test.step("then: ongoing stock follows new count", async () => {
            await expect.soft(await ongoingOf(page, p)).toContainText("12");
            if (c.key === "ar") await expect.soft(await ongoingOf(page, q)).toContainText("5");
          });

          const paid = c.key === "ar" ? 20_000 + 50_000 : 20_000;
          await test.step(`then: paying account balance follows difference (by ${rupiah(paid)})`, async () => {
            await expect.soft(async () => balanceIs(page, account, before - paid)).toPass({ timeout: 35_000 });
          });
          await test.step("then: edit recorded in account history", async () => {
            await page.goto(`/financial-accounts/${account}`);
            await expect.soft(page.getByTestId("account-log-table")).toContainText(`Restock #${id} edited`);
          });
        }

        if (c.key === "mv") {
          await test.step("then: payment moves to new account", async () => {
            await expect.soft(async () => balanceIs(page, account, before + 100_000)).toPass({ timeout: 35_000 });
            await expect.soft(async () => balanceIs(page, ground.newAccounts[r.key], beforeNew - 100_000)).toPass({
              timeout: 35_000,
            });
          });
        }

        // THEN — as the warehouses.
        if (c.key === "on" || c.key === "ar") {
          await signIn(page, W1_USER, ground.w1);
          await test.step("then: target warehouse sees new lines", async () => {
            const row = await inboundRow(page, id);
            await expect.soft(row).toContainText(c.key === "ar" ? "2 products · 17 pcs" : "1 product · 12 pcs");
          });
        }

        if (c.key === "mv") {
          await signIn(page, W2_USER, ground.w2);
          await test.step("then: recorded at new warehouse", async () => {
            await expect.soft(await inboundRow(page, id)).toBeVisible();
          });
          await signIn(page, W1_USER, ground.w1);
          await test.step("then: removed from old warehouse", async () => {
            await expect.soft(await inboundRow(page, id)).toHaveCount(0);
          });
        }
      });
    }
  }
});

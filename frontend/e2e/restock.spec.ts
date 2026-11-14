import { expect, test } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, restockGround, seed, tick } from "./restock_helpers";

// #105 — Restock requests (a selling team asks a warehouse to restock a product; the warehouse
// fulfils). The list-page render check came first; the CREATE FORM had no coverage at all until #165
// rewired how products get onto it, which is a change you cannot honestly make blind.
//
// The Restock Requests menu lives in the Inventories sub-menu (warehouse/selling teams), but root
// holds ROLE_ROOT so the RPCs are authorised in the root team. We reach each page by its route
// directly — the menu gate is UX only.

//
// The acceptance blocks that used to follow live in their own files since backlog #51 (restock_selling_wants_to_raise,
// restock_warehouse_wants_to_receive, restock_warehouse_wants_to_accept, restock_selling_wants_to_edit .spec.ts), so
// parallel workers can run them at once; the helpers they share are in restock_helpers.ts.

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


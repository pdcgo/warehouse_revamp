import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { statSync } from "node:fs";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #68 — Order list + read-only detail. #90 — the order CREATE form.
//
// The Orders/Shops/Products menus are SELLING-team surfaces, but root holds ROLE_ROOT so the RPCs are
// authorised in the root team; we reach each page by its route directly (the menu gate is UX only).
// This file is SERIAL (the config runs one worker): the empty-state test must observe the orders
// screen BEFORE the create flow adds a permanent order (OrderService has no delete). The create flow
// builds its own shop + product so it depends on nothing else.

const SUFFIX = Date.now().toString().slice(-6);
const CATEGORY = `E2E OrdCat ${SUFFIX}`;
const SHOP_CODE = `OSH${SUFFIX}`;
const SHOP_NAME = `E2E Order Shop ${SUFFIX}`;
const SKU = `OP${SUFFIX}`;
// What the product is STORED as — its team's code in front of the part typed (the-field-is-product-code-composed-on-write);
// root files it under team 1, whose code is ROOT.
const CODE = `ROOT-${SKU}`;
const PRODUCT_NAME = `E2E Order Product ${SUFFIX}`;
const CUSTOMER = `E2E Customer ${SUFFIX}`;
// The marketplace's own id for the order — shaped like one a storefront actually issues, and made
// unique per run so the search that finds it cannot match a leftover from an earlier one.
const MARKETPLACE_REF = `250815MP${SUFFIX}`;
// The number printed on the slip — invented in a courier's shape, and unlike the ref, so a search or an assertion
// for one can never match the other.
const TRACKING_NUMBER = `JX9${SUFFIX}Q4`;
// An order names the warehouse that ships it (#72), so this spec creates its own rather than
// depending on warehouses.spec.ts having run first.
const WH_CODE = `OWH${SUFFIX}`.slice(0, 10);
const WH_NAME = `E2E Order Warehouse ${SUFFIX}`;
const STREET = "Jl. E2E No. 1";

// The one region chain the e2e DB is seeded with (e2e/fixtures/regions.csv) — five rows, enough to
// prove the cascade and the snapshot without loading the whole country.
const PROVINSI = "11";
const KABUPATEN = "11.01";
const KECAMATAN = "11.01.01";
const DESA = "11.01.01.2001"; // Keude Bakongan, kode pos 23773
const DESA_NAME = "Keude Bakongan";
const KODE_POS = "23773";

// Drives one rung of the AddressPicker cascade (#118). Each level is a Chakra Combobox: the testid is
// on the root, so the input is reached through it (same convention as ProductSelect). Clicking the
// input opens the list (openOnClick), then the option is picked by its code.
//
// No explicit waiting between rungs: a level is DISABLED until the one above resolves, so Playwright's
// actionability check on the input is what sequences the four calls.
async function pickRegion(page: Page, level: string, code: string) {
  await page.getByTestId(level).locator("input").click();
  await page.getByTestId(`${level}-option-${code}`).click();
}

// Fills the whole address: the four cascading levels, then the street. The kode pos is NOT typed — the
// desa fills it in, which the caller asserts.
async function fillAddress(page: Page) {
  await pickRegion(page, "address-provinsi", PROVINSI);
  await pickRegion(page, "address-kabupaten", KABUPATEN);
  await pickRegion(page, "address-kecamatan", KECAMATAN);
  await pickRegion(page, "address-desa", DESA);
  await page.getByTestId("address-line").fill(STREET);
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

// Ticks one product in the ProductPicker dialog, the same way the restock spec does.
//
// ⚠ The row is matched on the SKU it DISPLAYS, never as "the only row": the search is debounced, so
// for a moment after typing the list still holds the previous product's row, which satisfies "exactly
// one row" just as well and un-ticks what was ticked a moment ago.
async function tickProduct(page: Page, productCode: string) {
  await page.getByTestId("product-picker-search").fill(productCode);

  const row = page
    .getByTestId("product-picker-list")
    .locator('[data-testid^="product-picker-option-"]')
    .filter({ hasText: productCode });
  await expect(row).toHaveCount(1);

  // The click goes to the CONTROL, never the row's centre. In the table layout the centre lands on the
  // product's name — a cell, not a label — and in the list layout a label click there is not what
  // Chakra's hidden input listens to. The control is the one target that works in both.
  await row.locator('[data-part="control"]').click();
}

// THE MARKETPLACE'S ORDER DATE — required to place (platform-created-at-is-required-at-finalize). Picked off the
// calendar: the trigger opens it, today's cell sets the day at 00:00, Escape closes it. Today, in the browser's own
// clock, which is the one the picker's cells are labelled in.
async function pickOrderDate(page: Page) {
  await page.getByTestId("order-create-order-date").click();
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await page
    .getByTestId("order-create-order-date-content")
    .locator(`[data-part="table-cell-trigger"][data-value="${today}"]`)
    .click();
  await page.keyboard.press("Escape");
}

// The courier — every order names one (no-order-without-a-courier): the server refuses an order without it. JNE is
// seeded by shipment_service's first migration in every database.
async function pickCourier(page: Page, code = "jne") {
  await page.getByTestId("shipment-channel-select").getByRole("combobox").click();
  await page.getByTestId(`shipment-channel-option-${code}`).click();
}

// Adds products to the order through the picker dialog (#165's pattern, now the order form's too).
async function addProducts(page: Page, skus: string[]) {
  await page.getByTestId("order-create-add-line").click();

  for (const productCode of skus) {
    await tickProduct(page, productCode);
  }

  await page.getByTestId("product-picker-confirm").click();
}

// Fills the smallest placeable order on the form (the setup shop + product), the marketplace ref last, and stops
// short of Create. Returns the shop's id, read off the option picked — the duplicate-ref test pushes a draft into it.
async function fillOrderForm(page: Page, customer: string, ref: string): Promise<string> {
  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await page.getByTestId("order-create-customer-name").fill(customer);
  await page.getByTestId("shop-select").click();
  const shopOption = page.getByRole("option").filter({ hasText: SHOP_NAME });
  const shopId = ((await shopOption.getAttribute("data-testid")) ?? "").replace("shop-select-option-", "");
  await shopOption.click();
  // Which warehouse ships it (#72) — required, so the form cannot submit without it. Chosen BEFORE
  // the products so the picker can show what that warehouse holds on each row.
  await page.getByTestId("order-warehouse").locator("input").fill(WH_CODE);
  await page.getByTestId(`team-select-option-${WH_CODE}`).click();
  await addProducts(page, [SKU]);
  await page.getByTestId("order-line-qty-0").fill("1");
  await pickOrderDate(page);
  // What the buyer paid on the storefront — required to place (platform-total-is-required-at-finalize).
  await page.getByTestId("order-marketplace-total").fill("25000");
  // The marketplace ref — required to place (an-order-ref-is-required-by-the-rpc).
  await page.getByTestId("order-external-ref-id").fill(ref);
  await pickCourier(page);
  // No price: a line is valued at the warehouse HPP, which this fixture's product has none of.
  await expect(page.getByTestId("order-create-save")).toBeEnabled();

  return shopId;
}

// Places one order through the form (reusing the setup shop + product) and lands on its detail page.
// Deliberately fills NO address: it is optional (#118), so this also proves the form submits and the
// detail page renders without one. One ref per order, so the duplicate warning never stands between two orders
// this spec places.
async function placeOrderViaForm(page: Page, customer: string) {
  await fillOrderForm(page, customer, `E2E-${Date.now()}`);
  await page.getByTestId("order-create-save").click();
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("Orders: the orders screen is reachable and starts empty", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders");

  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByTestId("orders-empty")).toBeVisible();
});

// An order names the warehouse that ships it (#72), so this spec creates its own rather than
// depending on warehouses.spec.ts having run first.
//
// It runs BEFORE the shop/product setup deliberately: creating a team leaves the app on the Teams
// screen, and the shop/product setup is what puts the selling team back in context for the order
// form. Doing it the other way round left the form pointed at the new warehouse, which has no shops.
test("setup: a warehouse for the order to ship from (#72)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Warehouses live on a TAB of the Teams page, not their own route. The sidebar link is scoped to
  // the nav because a detail page carries a breadcrumb "Teams" link too.
  await page.getByRole("navigation").first().getByRole("link", { name: "Teams", exact: true }).click();
  await page.getByTestId("teams-tab-warehouse").click();
  await page.getByTestId("open-create-warehouse").click();
  await page.getByTestId("new-team-name").fill(WH_NAME);
  await page.getByTestId("new-team-code").fill(WH_CODE);

  // The form names the team's Owner (the-create-team-form-names-the-first-owner) — root, so it acts in the
  // new warehouse as a member.
  await page.getByTestId("new-team-owner").getByRole("combobox").fill(ROOT_USERNAME);
  await page.getByTestId(`user-select-option-${ROOT_USERNAME}`).click();

  await page.getByTestId("submit-create-team").click();
  await expect(page.getByTestId(`team-row-${WH_CODE}`)).toBeVisible();
});

test("setup: a category, a shop, and a product for the order to reference", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // A category the product can be filed under (products require one).
  await page.getByRole("link", { name: "Categories" }).click();
  await page.getByTestId("open-create-category").click();
  await page.getByTestId("new-category-name").fill(CATEGORY);
  await page.getByTestId("submit-create-category").click();
  await expect(page.getByTestId("submit-create-category")).toBeHidden();

  // A marketplace shop the order is placed through.
  await page.goto("/shops");
  // The header's New Shop — a fresh database has no shops yet, so the page shows its empty hint, not a table.
  await expect(page.getByTestId("open-create-shop")).toBeVisible();
  await page.getByTestId("open-create-shop").click();
  await page.getByTestId("shop-name").fill(SHOP_NAME);
  await page.getByTestId("shop-code").fill(SHOP_CODE);
  await page.getByTestId("marketplace-select").click();
  await page.getByRole("option", { name: "Shopee" }).click();
  await page.getByTestId("submit-shop").click();
  await expect(page.getByTestId(`shop-row-${SHOP_CODE}`)).toBeVisible();

  // A product the order's line references.
  await page.goto("/products/new");
  await expect(page.getByTestId("product-edit-page")).toBeVisible();
  await page.getByTestId("product-edit-sku").fill(SKU);
  await page.getByTestId("product-edit-name").fill(PRODUCT_NAME);
  await page.getByTestId("category-select").click();
  await page.getByTestId(`category-node-${CATEGORY}`).click();
  await page.getByTestId("product-edit-save").click();
  await expect(page.getByTestId(`product-row-${CODE}`)).toBeVisible();
});

// Stock for the order to take (#149). Placing an order now DEDUCTS from its warehouse, and a warehouse
// with nothing in it refuses the order — correctly, and that is the whole point of the feature. So the
// order flow below needs goods on the shelf before it can succeed, exactly as it would in life.
//
// Seeded through the API rather than the Stock screen, and the reason is a real gap worth naming: that
// screen is PRODUCT-DRIVEN (it lists the warehouse's own catalogue and joins stock onto it), so it
// cannot show — or receive — a product belonging to a selling team. Which is precisely this case: the
// order's product belongs to the ordering team while the stock sits in the warehouse. See
// Fixing that screen is its own piece of work, not this spec's job to route around.
test("setup: stock in the warehouse for the order to draw", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // The ids the API needs are not on screen, so read them back the same way the app would.
  const ids = await page.evaluate(async ([whCode, productCode]) => {
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

    // The guideline list shape: response has `items` (a per-slice oneof keyed by id) + sorted `ids`.
    // Pull the row slice's map and match within it.
    const rowMap = (res: { items?: Record<string, { mapData?: Record<string, unknown> }>[] }, slice: string) =>
      Object.values(res.items?.find((it) => it[slice])?.[slice]?.mapData ?? {}) as Record<string, string>[];

    const teams = await call("team.v1.TeamService/TeamList", { page: { page: 1, limit: 200 } });
    const warehouse = rowMap(teams, "team").find((t) => t.teamCode === whCode);

    const products = await call("product.v1.ProductService/ProductDiscover", {
      teamId: "1",
      page: { page: 1, limit: 200 },
    });
    const discovered = rowMap(products, "product");
    const product = discovered.find((p) => p.productCode === productCode);
    if (!product) {
      throw new Error(`product ${productCode} not found among ${discovered.length} discovered`);
    }

    // Stock comes in the way it really does — a restock raised by the product's OWN team and accepted onto a rack
    // (a-restock-carries-only-the-teams-own-products, there-is-no-unplaced-pile). At Rp 0 a unit, so every money
    // figure below stays the Rp 0 this spec has always asserted.
    const rack = await call("inventory.v1.RackService/RackCreate", {
      teamId: warehouse.id,
      code: "e2e-seed",
      name: "E2E seed",
    });

    const account = await call("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
      teamId: product.teamId,
      type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
      provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
      name: "E2E restock",
      holderName: "E2E",
      accountNumber: "E2E-ORDERS-1",
      openingBalance: 0,
      openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
    });
    // The restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account) — the server refuses any other.
    await call("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: product.teamId,
      accountId: account.account.id,
      operational: true,
    });

    const restock = await call("inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: product.teamId,
      warehouseId: warehouse.id,
      financeAccountId: account.account.id,
      items: [{ productId: product.id, productCode: product.productCode, name: product.name, count: "50", total: "0" }],
    });

    await call("inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: warehouse.id,
      requestId: restock.request.id,
      lines: [
        {
          itemId: restock.request.items[0].id,
          receivedCount: "50",
          placements: [{ placementId: rack.rack.id, quantity: "50" }],
        },
      ],
    });

    // THE WAREHOUSE'S FEE — without one it takes no orders (a-warehouse-with-no-rate-takes-no-orders), and order create
    // prices every order on it and freezes the answer (the-flat-rate-is-dropped-last step 3). A percent with a FLOOR, so
    // on goods at Rp 0 the fee is exactly the floor: Rp 1.500, a figure the create test can pin end to end.
    await call("warehouse.v1.WarehouseFeeService/WarehouseFeeSet", {
      teamId: warehouse.id,
      feePercent: 2.5,
      minFee: 1500,
    });

    // THE RETURN WAREHOUSE — order create refuses a team that has none (create-refuses-a-team-with-no-return-warehouse).
    // Root's team returns to the warehouse that ships its orders.
    await call("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: product.teamId,
      warehouseId: warehouse.id,
    });

    return { warehouse: warehouse.id, product: product.id };
  }, [WH_CODE, CODE]);

  expect(ids.warehouse).toBeTruthy();
  expect(ids.product).toBeTruthy();
});

// The create form's STOCK GUARD (#90). Placing an order draws its goods out of the chosen warehouse
// in the same transaction that writes it, so a line asking for more than the shelf holds does not
// become a backorder — it fails the whole order. This proves the form says so BEFORE the person has
// filled in a customer, an address and four more lines.
//
// It runs before the Create test, while the seeded 50 are untouched, and it places NOTHING — so the
// order counts every later test asserts are unaffected.
test("Create: the form shows what the warehouse holds and refuses to over-draw (#90)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();

  // An order starts with NO lines — products arrive by picking, so there is no blank row to remove.
  await expect(page.getByTestId("order-create-no-products")).toBeVisible();

  // And picking is REFUSED until a warehouse is named: what a product costs and whether it can be
  // shipped are both facts about one building. The button says no and the line beside it says why.
  await expect(page.getByTestId("order-create-add-line")).toBeDisabled();
  await expect(page.getByTestId("order-create-need-warehouse")).toBeVisible();

  await page.getByTestId("order-warehouse").locator("input").fill(WH_CODE);
  await page.getByTestId(`team-select-option-${WH_CODE}`).click();

  await addProducts(page, [SKU]);

  // 50 were received into this warehouse in the setup above, and the badge on the line says so.
  await expect(page.getByTestId("order-line-0")).toContainText("50");

  // Ask for more than exists: the line goes red, the page says why at the top, and Create is refused
  // here rather than by the server after everything else has been typed.
  await page.getByTestId("order-line-qty-0").fill("51");
  await expect(page.getByTestId("order-create-short")).toBeVisible();
  // The stock COLUMN keeps reporting what is there; the badge under it says what that is short of.
  await expect(page.getByTestId("order-line-stock-0")).toHaveText("50");
  await expect(page.getByTestId("order-line-0")).toContainText("needs 51");
  await expect(page.getByTestId("order-create-save")).toBeDisabled();

  // Back inside what the shelf holds, and the warning clears.
  await page.getByTestId("order-line-qty-0").fill("30");
  await expect(page.getByTestId("order-create-short")).toBeHidden();

  // Unticking in the dialog removes the line — the ticks and the rows are two views of one list, so
  // there is no way for them to disagree.
  await page.getByTestId("order-create-add-line").click();
  await tickProduct(page, SKU);
  await page.getByTestId("product-picker-confirm").click();
  await expect(page.getByTestId("order-create-no-products")).toBeVisible();

  // And back on, with a fresh quantity — a re-picked product is a new line, not the old one restored.
  await addProducts(page, [SKU]);
  await expect(page.getByTestId("order-line-qty-0")).toHaveValue("1");

  // THE CATALOGUE IS THE CATALOGUE: the dialog browses every team's products (AllProductPicker), and
  // the chosen warehouse's figures ride along as columns — so the seeded product is there and its
  // READY column reads what that building can actually ship.
  await page.getByTestId("order-create-add-line").click();
  await expect(page.getByTestId("product-picker-list")).toContainText(SKU);
  await expect(page.getByTestId("product-picker-list")).toContainText("50");
  // And the tick that produced the line on the page behind is still ticked — read off the ROW, since
  // the dialog no longer states a count.
  await expect(
    page
      .getByTestId("product-picker-list")
      .locator('[data-testid^="product-picker-option-"]')
      .filter({ hasText: SKU })
      .locator('input[type="checkbox"]'),
  ).toBeChecked();

  // A term that matches nothing in the catalogue finds nothing here either — the search is resolved
  // against the catalogue and handed to the warehouse as a narrowing.
  await page.getByTestId("product-picker-search").fill("NOSUCHSKU-ZZZ");
  await expect(page.getByTestId("product-picker-empty")).toBeVisible();
  await page.getByTestId("product-picker-cancel").click();

  await page.getByTestId("order-line-qty-0").fill("7");
  await page.getByTestId("order-create-customer-name").fill("Layout shot");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.screenshot({ path: "../.claude/skills/run-warehouse-revamp/shots/order-create-grid.png" });

  // Leaving a half-typed order asks first — a line and a customer on the phone is real work, and a
  // mis-aimed click used to throw it away silently.
  await page.getByTestId("order-create-back").click();
  await expect(page.getByText("Discard This Order?")).toBeVisible();

  // Cancelling the dialog STAYS on the form, with the work intact.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await expect(page.getByTestId("order-line-qty-0")).toHaveValue("7");

  // Confirming discards it and leaves.
  await page.getByTestId("order-create-back").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("orders-table")).toBeVisible();
});

test("Create: place an order through the form; money computes; the detail opens", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders");
  await page.getByTestId("open-create-order").click();

  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/new$/);

  // Nothing chosen yet → Create is disabled (no shop, no valid line).
  await expect(page.getByTestId("order-create-save")).toBeDisabled();

  await page.getByTestId("order-create-customer-name").fill(CUSTOMER);
  await page.getByTestId("order-create-customer-phone").fill("0812345678");

  // The address is the shared AddressPicker (#118), not free text: four cascading region levels.
  await fillAddress(page);
  // Picking the desa is what carries the kode pos — it arrives without being typed. The field is a
  // Combobox now (it is also the postcode SEARCH), so the value is on the input inside it.
  await expect(page.getByTestId("address-kodepos").locator("input")).toHaveValue(KODE_POS);

  // Shop is a Chakra Select whose options show the name + marketplace badge; open it and pick ours.
  await page.getByTestId("shop-select").click();
  await page.getByRole("option").filter({ hasText: SHOP_NAME }).click();

  // WHICH WAREHOUSE ships it (#72) comes before the products now, and that ordering is the design
  // rather than the test's convenience: from #69 this is the building the stock leaves, and what a
  // product costs and whether it can be shipped are both facts about THAT building. Picking is refused
  // until it is named — the guard test above covers the refusal itself.
  await page.getByTestId("order-warehouse").locator("input").fill(WH_CODE);
  await page.getByTestId(`team-select-option-${WH_CODE}`).click();

  // Lines come from the picker dialog (#165's pattern) — search the catalogue, tick, confirm.
  await addProducts(page, [SKU]);
  await expect(page.getByTestId("order-line-0")).toContainText(SKU);

  await page.getByTestId("order-line-qty-0").fill("3");

  // NO price is typed any more — a line is valued at the warehouse's HPP (owner): what its batches are worth. This
  // fixture's restock cost Rp 0, and on StockCost's contract a cost of 0 means UNKNOWN, never free — so the line says
  // "not recorded" rather than booking the goods as costing nothing.
  await expect(page.getByTestId("order-line-hpp-0")).toContainText("not recorded");
  await expect(page.getByTestId("order-line-total-0")).toHaveText("Rp 0");
  // There is no subtotal line any more — the rebuilt form states one TOTAL, asserted below.

  // What the storefront took is a NOTE: typed here, stored on the order, and added to NOTHING.
  await page.getByTestId("order-marketplace-total").fill("58000");

  // The MARKETPLACE'S own id for this order — typed beside the shop that took it, because that pair
  // is what lets anybody find this order again on the storefront.
  await page.getByTestId("order-external-ref-id").fill(MARKETPLACE_REF);
  await pickCourier(page);

  // THE TRACKING NUMBER printed on the slip — its own field now (`receipt_code`), kept beside the slip itself.
  await page.getByTestId("order-receipt-code").fill(TRACKING_NUMBER);

  // THE SHIPPING RECEIPT (owner): the courier's slip or the marketplace's PDF, attached to the order.
  // The bytes go to document_service the moment the file is picked — two phases, straight to storage
  // — and what the order stores is the document's id. Driving the hidden input directly is how a
  // FileUpload is exercised; the visible trigger only opens the OS dialog Playwright cannot enter.
  await page
    .getByTestId("order-receipt-upload")
    .locator("input[type=file]")
    .setInputFiles({
      name: "resi-jne.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 e2e receipt"),
    });

  // Attached, and named — the upload has finished by the time the row appears.
  await expect(page.getByTestId("order-receipt-attached")).toContainText("resi-jne.pdf");

  // …and shipment's REAL ReceiptCheck read it, beside the upload (the-receipt-check-prototype-is-accepted). This file
  // is a PDF header and nothing else, so the answer is UNREADABLE — a notice, never a refusal — and the numbers typed
  // above are left exactly as they were.
  await expect(page.getByTestId("order-create-scan-notice")).toHaveAttribute("data-result", "unreadable");
  await expect(page.getByTestId("order-receipt-code")).toHaveValue(TRACKING_NUMBER);

  // The total is the goods PLUS the warehouse's fee — no shipping (owner), and the marketplace figure was never in
  // the sum. The warehouse PRICES the fee (WarehouseFeeCalculate): 2.5% of Rp 0 is below the floor, so it is the
  // floor set in setup. The server prices it again at create and freezes that — the detail below reads it back.
  await expect(page.getByTestId("order-create-products-total")).toHaveText("Rp 0");
  await expect(page.getByTestId("order-create-warehouse-fee")).toHaveText("Rp 1.500");
  await expect(page.getByTestId("order-create-total")).toHaveText("Rp 1.500");

  // The buyer's marketplace username — optional (the-buyers-username-is-optional), typed with stray spaces that the
  // order must not keep.
  await page.getByTestId("order-create-buyer-username").fill("  budi.e2e  ");

  // THE MARKETPLACE'S ORDER DATE is required (platform-created-at-is-required-at-finalize): everything else is
  // filled, and Create still waits for it.
  await expect(page.getByTestId("order-create-save")).toBeDisabled();
  await pickOrderDate(page);

  await expect(page.getByTestId("order-create-save")).toBeEnabled();
  await page.getByTestId("order-create-save").click();

  // Success lands on the read-only detail for the new order — the SELLER's page of sections, since
  // root is not a warehouse (`the-two-ends-are-two-screens`).
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  await expect(page.getByTestId("order-detail-page")).toContainText(CUSTOMER);
  // …with the buyer's username under the customer, trimmed.
  await expect(page.getByTestId("order-detail-buyer-username")).toHaveText("budi.e2e");
  await expect(page.getByTestId("section-items")).toContainText(SKU);
  // The marketplace figure survived onto the order, as its own tile beside ours and not inside it.
  await expect(page.getByTestId("tile-mp")).toContainText("Rp 58.000");
  // THE FEE WAS FROZEN ON THE ORDER (the-flat-rate-is-dropped-last step 3) — the figure the warehouse priced at
  // create, read back from the order itself rather than from the form.
  await expect(page.getByTestId("money-fees")).toContainText("Rp 1.500");
  // …and so did the storefront's own id for it, verbatim — the whole point of the field is that the
  // number a buyer quotes is readable on the order they are asking about.
  await expect(page.getByTestId("order-reference-mp")).toContainText(MARKETPLACE_REF);
  // …and the tracking number, as typed.
  await expect(page.getByTestId("order-reference-receipt")).toContainText(TRACKING_NUMBER);

  // The receipt travelled with the order: the detail names the file and offers to open it. The
  // document itself is PRIVATE, so there is no URL on the page to assert — the button fetches a
  // short-lived signed one when it is pressed.
  await expect(page.getByTestId("order-detail-receipt")).toContainText("resi-jne.pdf");
  await expect(page.getByTestId("order-receipt-open")).toBeVisible();

  // The address was FROZEN onto the order: the street, the region path, and the kode pos all read
  // back off the snapshot.
  const address = page.getByTestId("order-detail-address");
  await expect(address).toContainText(STREET);
  await expect(address).toContainText(DESA_NAME);
  await expect(address).toContainText("Kabupaten Aceh Selatan");
  await expect(address).toContainText(KODE_POS);

  // THE ORDER OPENED ITS OWN SETTLEMENT ACCOUNT (settlement-opens-the-sale-from-the-order-event). Nobody
  // typed anything in the Settlement section — placing an order with a marketplace total publishes *Order
  // Placed*, and the emulator PUSHES it to settlement, which posts its `initial_total`. The section reading
  // the sale back is the whole seam, proven through the real broker, server and database.
  //
  // ⚠ IT IS ASYNCHRONOUS, so the page is reloaded until the push has landed — the account opens a moment
  // after the order does, which is the design, not a race to hide.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("order-ledger-panel")).toBeVisible();
    await expect(page.getByTestId("settlement-summary")).toContainText("Rp 58.000", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId("settlement-absent")).toHaveCount(0);
  await expect(page.getByTestId("ledger-table").locator('[data-testid^="entry-"]')).toHaveCount(1);

  // And it now shows in the list — by the marketplace's id for it, which is what a row leads with now
  // (the list has no customer column).
  await page.getByTestId("order-detail-back").click();
  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByTestId("orders-table")).toContainText(MARKETPLACE_REF);

  // The search finds it by the tracking number on the slip (a-label-scan-reads-the-ref-or-the-receipt).
  await page.getByTestId("orders-search").fill(TRACKING_NUMBER);
  await expect(page.getByTestId("orders-table")).toContainText(TRACKING_NUMBER);
  await expect(page.getByTestId("orders-table").locator('[data-testid^="order-row-"]')).toHaveCount(1);
});

// A WAREHOUSE OPENS THE SELLER'S LABEL (a-warehouse-prints-the-labels-of-orders-it-ships). The label of the order placed
// above was uploaded by the SELLING side, so as the document's owner the warehouse reads NotFound — that was the bug:
// Print Label failed on every order. A warehouse STAFF member — the person who actually prints it, created here with
// that one role — opens the order detail and the label opens through OrderLabels, the order checked to ship from here.
test("Label: the warehouse's staff opens the seller's label from the order detail", async ({ page }) => {
  const STAFF = `e2elabelstaff${SUFFIX}`;
  const PASSWORD = "e2e-label-pass-1";

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const seed = await page.evaluate(
    async ([whCode, ref, staff, password]) => {
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

      const rowMap = (res: { items?: Record<string, { mapData?: Record<string, unknown> }>[] }, slice: string) =>
        Object.values(res.items?.find((it) => it[slice])?.[slice]?.mapData ?? {}) as Record<string, string>[];

      const teams = await call("team.v1.TeamService/TeamList", { page: { page: 1, limit: 200 } });
      const warehouse = rowMap(teams, "team").find((t) => t.teamCode === whCode)!;

      const list = await call("selling.v1.OrderService/OrderList", {
        teamId: "1",
        filter: { search: ref },
        page: { page: 1, limit: 5 },
      });

      await call("user.v1.UserService/CreateUser", {
        teamId: warehouse.id,
        username: staff,
        password,
        name: staff,
        role: "ROLE_WAREHOUSE_STAFF",
      });

      return { warehouse: warehouse.id as string, order: (list.ids as string[])[0] };
    },
    [WH_CODE, MARKETPLACE_REF, STAFF, PASSWORD],
  );

  expect(seed.order).toBeTruthy();

  await login(page, STAFF, PASSWORD);
  await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), seed.warehouse);

  await page.goto(`/orders/${seed.order}`);
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  await expect(page.getByTestId("order-detail-receipt")).toContainText("resi-jne.pdf");

  // The label opens in a new tab, from a link the ORDER SERVICE signed — and the file is the seller's upload. (A PDF tab
  // never settles in headless Chromium, so the answer that minted the link is what is read, beside the tab opening.)
  const [answer, popup] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/warehouse.selling.v1.OrderService/OrderLabels")),
    page.waitForEvent("popup"),
    page.getByTestId("order-receipt-open").click(),
  ]);
  expect(answer.status()).toBe(200);
  const labels = (await answer.json()) as { url: string; results: { orderId: string; included?: boolean }[] };
  expect(labels.results).toEqual([{ orderId: seed.order, included: true }]);
  expect(labels.url).toContain("resi-jne.pdf");
  await popup.close();

  // No refusal toast was shown, and the label was never shared: as its "owner" the warehouse still reads NotFound.
  await expect(page.getByText(/does not ship from this warehouse|has no label attached/)).toHaveCount(0);
  const asOwner = await page.evaluate(async ([warehouse, order]) => {
    const token =
      window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
    const post = (method: string, body: unknown) =>
      fetch(`http://localhost:8081/warehouse.${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

    const detail = await (await post("selling.v1.OrderService/OrderDetail", { teamId: warehouse, orderId: order })).json();
    const res = await post("document.v1.DocumentService/GetDownloadUrl", {
      teamId: warehouse,
      documentId: detail.order.receipt.documentId,
    });

    return res.status;
  }, [seed.warehouse, seed.order]);
  expect(asOwner).toBe(404);
});

// THE SETTLEMENT REPORT is wired end to end: the route, settlement's metric RPCs and their policy.
//
// The report lays out EVERY day of the window as a row, so the series table exists only if MetricData
// answered — a policy or mounting mistake shows as the error line instead. (The emulator pushes now, so
// the fold runs too; the figures are not what this asserts.)
test("Settlement report: the report screen answers from the metric RPCs", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/settlement/report");

  await expect(page.getByTestId("settlement-report-page")).toBeVisible();
  await expect(page.getByTestId("report-error")).toHaveCount(0);
  await expect(page.getByTestId("report-summary")).toBeVisible();
  await expect(page.getByTestId("report-series-table")).toBeVisible();
  await expect(page.getByTestId("report-series-table").locator('[data-testid^="report-series-row-"]')).toHaveCount(20);
});

// The picker's FAST PATH, and it is the postcode (owner): five digits off the buyer's message, pick
// the address they name, and all four levels fill in at once. It replaced a search over region
// names — a name is spelled three ways and shared by hundreds of desa, a kode pos is neither.
test("Address: a postal code suggests the address and fills the whole cascade", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();

  // A PARTIAL code is enough — it matches from the start, so both fixture desa are offered.
  await page.getByTestId("address-kodepos").locator("input").fill("2377");
  await expect(page.getByTestId(`address-kodepos-option-${DESA}`)).toBeVisible();
  await expect(page.getByTestId("address-kodepos-option-11.01.01.2002")).toBeVisible();

  await page.getByTestId(`address-kodepos-option-${DESA}`).click();

  // ONE pick, four levels — none of them typed.
  await expect(page.getByTestId("address-provinsi").locator("input")).toHaveValue("Aceh");
  await expect(page.getByTestId("address-kabupaten").locator("input")).toHaveValue(
    "Kabupaten Aceh Selatan",
  );
  await expect(page.getByTestId("address-kecamatan").locator("input")).toHaveValue("Bakongan");
  await expect(page.getByTestId("address-desa").locator("input")).toHaveValue(DESA_NAME);

  // And the field completes itself: "2377" was typed, the chosen desa's full code is what stays.
  await expect(page.getByTestId("address-kodepos").locator("input")).toHaveValue(KODE_POS);
});

// How many units stand on this spec's seed rack — the one shelf the setup put the product on. Read the way the app reads
// a rack (RackList with its stock totals), so a cancel's stock coming back is asserted on the shelf itself.
async function seedRackStock(page: Page): Promise<number> {
  return page.evaluate(async (whCode) => {
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

    const slice = (res: { items?: Record<string, { mapData?: Record<string, unknown> }>[] }, name: string) =>
      Object.values(res.items?.find((it) => it[name])?.[name]?.mapData ?? {}) as Record<string, string>[];

    const teams = await call("team.v1.TeamService/TeamList", { page: { page: 1, limit: 200 } });
    const warehouse = slice(teams, "team").find((t) => t.teamCode === whCode)!;

    const racks = await call("inventory.v1.RackService/RackList", {
      teamId: warehouse.id,
      filter: { q: "e2e-seed" },
      dataRequest: ["RACK_LIST_DATA_TYPE_RACK", "RACK_LIST_DATA_TYPE_STOCK"],
      page: { page: 1, limit: 5 },
    });
    const rack = slice(racks, "rack").find((r) => r.code === "e2e-seed")!;
    const stock = slice(racks, "stock").find((r) => r.rackId === rack.id);

    return Number(stock?.stockCount ?? 0);
  }, WH_CODE);
}

// The order the Lifecycle test places and cancels. The list has no customer column, and this order
// has no marketplace ref, so the list tests below find its row by id. (The file is serial, one worker.)
let lifecycleOrderId = "";

// The SELLING seat's half of an order's life: it can call the order off, and that is all.
//
// Confirming used to be here too (#91). It is now the WAREHOUSE's first step (owner) — see the
// fulfilment test below — so this seat offers exactly one action and the order sits at Pending until
// the building takes it on.
test("Lifecycle: the selling seat can cancel, and cannot confirm (#91, owner)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  const onShelf = await seedRackStock(page);
  await placeOrderViaForm(page, `${CUSTOMER} lifecycle`);
  expect(await seedRackStock(page)).toBeLessThan(onShelf);
  lifecycleOrderId = /\/orders\/(\d+)$/.exec(page.url())![1]!;
  const detail = page.getByTestId("order-detail-page");

  // A fresh order is PENDING and waiting on the warehouse rather than on this seat.
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
  await expect(page.getByTestId("order-action-cancel")).toBeVisible();
  await expect(page.getByTestId("order-action-confirm")).toHaveCount(0);

  // Cancel goes through the confirm dialog (destructive) -> CANCEL, a terminal state with no actions.
  await page.getByTestId("order-action-cancel").click();
  await page.getByTestId("confirm-action").click();
  await expect(detail).toContainText("Cancelled");
  await expect(page.getByTestId("order-action-cancel")).toBeHidden();

  // THE STOCK COMES BACK A MOMENT LATER, not inside the cancel: inventory releases the take when OrderCancelled reaches
  // it (inventory-returns-stock-on-order-cancelled), so the shelf is polled until it reads what it held before the order.
  await expect(async () => {
    expect(await seedRackStock(page)).toBe(onShelf);
  }).toPass({ timeout: 45_000 });
});

// The header and the status tabs above the list.
//
// It runs HERE on purpose: the two tests before it have left exactly one PLACED order and one
// CANCELLED one, which is the smallest set that tells two stages apart — with only placed orders on
// the board, a tab or a summary card reading the wrong stage would look identical.
test("Orders: the summary counts each stage and the tabs filter by it", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders");
  await expect(page.getByTestId("orders-table")).toBeVisible();

  // The statistics are shut until asked (the-statistics-are-shut-and-read-when-opened), and the tabs carry no counts
  // (the-status-tabs-carry-no-counts) — so the counts are read off the strip, opened.
  await expect(page.getByTestId("order-summary")).toHaveCount(0);
  await expect(page.getByTestId(/^orders-tab-count-/)).toHaveCount(0);
  await page.getByTestId("order-summary-toggle").click();

  // The summary on the All tab: one card per stage plus the total, each a COUNT of orders ("N tx").
  // The 30-day tiles are gone (owner) — every figure follows the filter bar's date range instead.
  // Its lines are valued at an UNRECORDED HPP and the form takes no shipping cost, so the money is
  // genuinely Rp 0; the counts are what tell the piles apart.
  await expect(page.getByTestId("order-summary-total")).toContainText("2 tx");
  await expect(page.getByTestId("order-summary-row-pending")).toContainText("1 tx");
  await expect(page.getByTestId("order-summary-row-cancel")).toContainText("1 tx");
  await expect(page.getByTestId("order-summary-row-shipped")).toContainText("0 tx");

  // The tabs are the owner's stages: a fresh order is PENDING, a cancelled one CANCEL. The tab narrows the TABLE.
  await page.getByTestId("orders-tab-cancel").click();
  await expect(page.getByTestId(`order-row-${lifecycleOrderId}`)).toBeVisible();
  // One row, not two: the placed order is genuinely filtered out server-side rather than the tab
  // merely highlighting it.
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(1);
  // …while the SUMMARY follows the tab: it now reads the chosen stage's own figures.
  await expect(page.getByTestId("order-summary")).toHaveAttribute("data-pile", "cancel");
  await expect(page.getByTestId("order-summary-measure-tx")).toContainText("1");

  // A status with nothing in it says so as that status, not as "no orders yet" — the second would read
  // as an empty system rather than an empty shelf.
  await page.getByTestId("orders-tab-shipped").click();
  await expect(page.getByTestId("orders-empty")).toContainText("Shipped");
});

// The filter bar — search, shop and date range — and the ONE property that cannot be unit-tested:
// that the header and the table are narrowed by the same thing.
//
// The backend's own tests prove each filter narrows the query. What only a running app can show is
// that the SCREEN sends the filter to BOTH RPCs — the list and the stat are separate calls, so a page
// that filtered the table and left the counts alone would look entirely correct until you read the
// tabs, which would then be describing orders that are not on screen.
test("Orders: the filter bar narrows the table AND the counts together", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders");
  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(2);
  // The counts are the statistics' — shut until opened (the-statistics-are-shut-and-read-when-opened).
  await page.getByTestId("order-summary-toggle").click();
  await expect(page.getByTestId("order-summary-total")).toContainText("2 tx");

  // Search for the cancelled order alone. The two customers share a prefix, so "lifecycle" is the
  // only term that separates them — which also makes this a real substring match rather than an
  // equality check that happens to pass.
  await page.getByTestId("orders-search").fill("lifecycle");

  await expect(page.getByTestId(/^order-row-/)).toHaveCount(1);
  await expect(page.getByTestId(`order-row-${lifecycleOrderId}`)).toBeVisible();

  // ⚠ The counts moved WITH the table. This is the assertion the whole test exists for: 2 → 1 in the
  // total, and the placed order's pile down to 0, because the search is a filter on the screen rather
  // than on the table alone.
  await expect(page.getByTestId("order-summary-total")).toContainText("1 tx");
  await expect(page.getByTestId("order-summary-row-pending")).toContainText("0 tx");
  await expect(page.getByTestId("order-summary-row-cancel")).toContainText("1 tx");

  // A term nothing matches says so AS A FILTER result, never as "no orders yet" — the second would
  // tell somebody their orders had vanished when they are one Clear away.
  await page.getByTestId("orders-search").fill("nothing matches this at all");
  await expect(page.getByTestId("orders-empty")).toContainText("filters");

  // Clearing puts everything back — both the rows and the counts.
  await page.getByTestId("orders-filters-clear").click();
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(2);
  await expect(page.getByTestId("order-summary-total")).toContainText("2 tx");

  // The date window, driven by the shared Grafana-style picker. Everything here was placed today, so
  // "Today" keeps both orders and a window that ENDED before today keeps none — which is what pins
  // that the range is actually reaching the server rather than being cosmetic.
  await page.getByTestId("orders-date").click();
  await page.getByTestId("orders-date-quick-1").click();
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(2);

  await page.getByTestId("orders-filters-clear").click();

  // And the shop filter, over the team's one shop: picking it keeps both orders (they were placed on
  // it), which proves the id is being sent correctly — a wrong id would empty the table.
  await page.getByTestId("shop-select").click();
  await page.getByTestId(/^shop-select-option-/).first().click();
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(2);
  await expect(page.getByTestId("order-summary-total")).toContainText("2 tx");
});

// Opening an order FROM THE LIST, which is the way anybody actually reaches it — every other detail
// test here lands on the page via the create form's redirect or a typed URL, so all of them passed
// through a period where the list's rows did nothing at all when clicked.
test("Orders: clicking a row opens that order's detail", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders");
  await expect(page.getByTestId("orders-table")).toBeVisible();

  // The CREATED cell, deliberately — not the id one. The id text was once the only live target on the
  // row, so a click there would pass with the rest of the row dead. (Not the tracking-number cell
  // either: that one is a copy control, and a click there copies instead of opening.)
  await page.getByTestId(/^order-row-/).first().getByRole("cell").nth(3).click();

  await expect(page).toHaveURL(/\/orders\/\d+$/);
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
});

// EDIT RESI (the-seller-edits-the-resi-until-handover) on the order the Create test placed — still pending, so the
// counts the tests above read are untouched. The number changes, the file stays, and the order's notes say both values.
test("Edit Resi: the seller replaces the tracking number while the parcel is in the building", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  const replaced = `${TRACKING_NUMBER}B`;

  await page.goto("/orders");
  await page.getByTestId("orders-search").fill(TRACKING_NUMBER);
  const row = page.getByTestId(/^order-row-/).first();
  await expect(row).toContainText(TRACKING_NUMBER);
  const orderId = (await row.getAttribute("data-testid"))!.replace("order-row-", "");

  await page.getByTestId(`order-actions-${orderId}`).click();
  await page.getByTestId(`order-editReceipt-${orderId}`).click();

  const dialog = page.getByTestId("edit-receipt-dialog");
  await expect(dialog.getByTestId("edit-receipt-code")).toHaveValue(TRACKING_NUMBER);
  await expect(dialog.getByTestId("order-receipt-attached")).toContainText("resi-jne.pdf");
  await dialog.getByTestId("edit-receipt-code").fill(replaced);
  await dialog.getByTestId("edit-receipt-save").click();
  await expect(dialog).toBeHidden();

  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId("order-reference-receipt")).toContainText(replaced);
  await expect(page.getByTestId("order-detail-receipt")).toContainText("resi-jne.pdf");
  await expect(page.getByTestId("section-notes")).toContainText(`Resi: ${TRACKING_NUMBER} → ${replaced}`);
});

// THE ORDER METRICS, END TO END (order_statistic_metric.md): the orders this spec placed reach the analytic screen
// through the real path — OrderPlaced published, pushed by the emulator to selling's fold, folded into
// order_daily_reports, ranked and filled by OrderAnalyticService. The fold is asynchronous, so the page is re-read until
// the push has landed.
test("Analytic: the orders placed today count in Orders created, by shop", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const headline = page.getByTestId("analytic-headline-created_count-value");

  await expect
    .poll(
      async () => {
        await page.goto("/analytic?g=shop&m=metrics/orders/created");
        await expect(page.getByTestId("analytic-page")).toBeVisible();

        return Number(((await headline.textContent({ timeout: 5000 })) ?? "0").replace(/\./g, ""));
      },
      { timeout: 30_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBeGreaterThan(0);

  // The row is the order's shop, named by ShopByIds.
  await expect(page.getByTestId("analytic-table")).toContainText(SHOP_NAME);
});

// Switches the app to the WAREHOUSE team — the crew's seat (#151).
//
// The pick screens are scoped to the warehouse, not to the selling team, so nothing about them can be
// exercised from the seat that placed the order. This is the switch that makes the crew's view real.
async function switchToWarehouse(page: Page) {
  await page.getByTestId("team-switcher").click();
  // Search is per section (the-workspace-searches-one-section) — root owns this team, so it is under My teams.
  await page.getByTestId("team-search-mine").click();
  await page.getByTestId("team-search").fill(WH_NAME);
  await page.getByTestId(/^team-option-/).first().click();
  await expect(page.getByTestId("team-switcher")).toContainText(WH_NAME);
}

// SET PICKED IS THE SCAN'S (the-item-scans-live-on-the-page): on a processed order's pick page, below the racks, every
// line is scanned exact — each line's product code, once per unit — and only then does Set Picked press.
async function pickByScan(page: Page) {
  const scan = page.getByTestId("pick-scan-input");
  await expect(scan).toBeVisible();
  // No plain "Mark Picked" any more.
  await expect(page.getByTestId("pick-order-advance")).toBeHidden();

  const lines = page.locator("[data-testid^='pick-scan-line-']");
  for (let i = 0; i < (await lines.count()); i += 1) {
    const line = lines.nth(i);
    const code = (await line.getAttribute("data-code")) ?? "";
    const quantity = Number(await line.getAttribute("data-quantity"));

    for (let n = 0; n < quantity; n += 1) {
      await scan.fill(code);
      await scan.press("Enter");
    }
    await expect(line).toHaveAttribute("data-exact", "true");
  }

  await page.getByTestId("pick-order-set-picked").click();
  await expect(page.getByTestId("pick-order-advance")).toContainText("Mark Handed Over");
}

// #151 — the crew's whole job, end to end: find the order the moment it arrives, open it, ACCEPT IT,
// read WHICH SHELF to walk to, and walk it through picked → handed over (the-status-move-is-the-only-journey).
//
// All three moves belong to the warehouse (owner). The selling seat only places the order here — it
// never confirms, which is the change that made a just-placed order visible to the building at all.
test("Fulfilment: the warehouse takes an order from pending through to the handover (#151)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Placed from the SELLING seat and left there — PENDING, untouched, waiting on the warehouse.
  await placeOrderViaForm(page, `${CUSTOMER} picking`);
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
  const placedId = /\/orders\/(\d+)$/.exec(page.url())![1]!;

  await switchToWarehouse(page);

  await page.goto("/warehouse-orders");

  // The screen opens on To Confirm — orders this building has not accepted yet (the-warehouse-tabs-are-the-processed-steps).
  await expect(page.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
  const row = page.getByTestId(`pick-queue-row-${placedId}`);
  await expect(row).toBeVisible();
  // The row's "created by" cell — the first after its tick box — opens the order's pick page.
  await row.locator("td").nth(1).click();

  // THE POINT OF THE SCREEN: the line names the rack the take drew from — the seed's, the only one holding it.
  const pickList = page.getByTestId("pick-list-table");
  await expect(pickList).toBeVisible();
  await expect(pickList).toContainText(PRODUCT_NAME);
  await expect(pickList).toContainText("e2e-seed");

  // Forward, one move at a time — and the button always reads as the single next thing that happens.
  // THREE moves: this building accepting the job, Set Picked — the item scan's, never a plain button
  // (the-item-scans-live-on-the-page) — and the handover.
  const advance = page.getByTestId("pick-order-advance");

  await expect(advance).toContainText("Confirm Order");
  await advance.click();

  await pickByScan(page);

  await page.getByTestId("pick-order-advance").click();

  // THE HANDOVER is the end of the warehouse's work: the goods have left the building, so there is no
  // next step to offer and the button goes away entirely.
  await expect(page.getByTestId("pick-order-advance")).toBeHidden();

  // THE HISTORY THE PLACEMENT AND THOSE THREE CLICKS WROTE (00011). This is the only place the whole sequence can be
  // checked end to end: each step is recorded by the transition that performed it, so nothing short of
  // actually walking an order through picking proves the steps land, land in order, and land attributed.
  //
  // Read from the WAREHOUSE seat, which is also the #151 rule holding — the crew that shipped it can
  // open the order it shipped.
  const orderId = new URL(page.url()).pathname.split("/").pop();

  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId("order-detail-page")).toBeVisible();

  // Info is the DEFAULT tab, so the lines — the pick list — are what the page opens on. The timeline is
  // one click away rather than the other way round.
  await expect(page.getByTestId("order-detail-items")).toBeVisible();
  await expect(page.getByTestId("order-detail-timeline")).toBeHidden();

  await page.getByTestId("order-detail-tab-timeline").click();

  const timeline = page.getByTestId("order-detail-timeline");
  await expect(timeline).toBeVisible();

  for (const step of ["pending", "processed", "picked", "shipping"]) {
    await expect(page.getByTestId(`order-timeline-${step}`)).toBeVisible();
  }

  // WHO — the steps name the person who took them, which is the half the status column can never
  // carry. Everything in this run is done by the same root account, so the assertion is that the
  // attribution is THERE at all: an event written with actor 0 would render no person.
  await expect(page.getByTestId("order-timeline-shipping-by")).toBeVisible();

  // THE HANDOVER IS THE WAREHOUSE'S END, NOT THE ORDER'S: customer service still marks it moving on the
  // platform, so the timeline says what it is waiting for.
  await expect(page.getByTestId("order-timeline-awaiting")).toBeVisible();
});

// #151 — the queue belongs to a WAREHOUSE. A selling team places orders but has no shelves and nobody
// to walk to them, so the screen says so rather than showing an empty table that looks like a quiet day.
test("Picking: a selling team is told the queue is a warehouse screen (#151)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/warehouse-orders");

  await expect(page.getByTestId("pick-queue-not-warehouse")).toBeVisible();
  await expect(page.getByTestId("pick-queue-table")).toBeHidden();
});

// THE RETURN ACCEPT (the-accept-is-the-status-return-completed), end to end: customer service claims a handed-over order
// back, the parcel reaches the warehouse — the team's return warehouse (only-the-return-warehouse-accepts-a-return) — the
// crew finds it on its Returns tab and accepts it on the accept page — with the courier's charge at the door, which
// liability posts from OrderReturnAccepted as the selling team's debt to the warehouse (a-return-may-carry-the-couriers-ask).
// The event is the real one: the e2e broker pushes it to :8081.
//
// The box comes back EMPTY — every unit missing (a-short-return-is-missing-at-the-door) — so no unit goes back on a shelf
// and the stock this file's later tests count is untouched. A return racked back is the_return_goes_back_on_the_shelf.
test("Return: the warehouse accepts a returned parcel and the courier's charge lands on the balance", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await placeOrderViaForm(page, `${CUSTOMER} return`);
  const orderId = /\/orders\/(\d+)$/.exec(page.url())![1]!;

  // Root's team returns to the warehouse that ships its orders.
  await page.evaluate(
    async ([whCode]) => {
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

      const teams = await call("team.v1.TeamService/TeamList", { page: { page: 1, limit: 200 } });
      const warehouse = (Object.values(teams.items?.find((it: any) => it.team)?.team?.mapData ?? {}) as any[]).find(
        (t: any) => t.teamCode === whCode,
      );
      await call("selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
        teamId: "1",
        warehouseId: warehouse.id,
      });
    },
    [WH_CODE] as const,
  );

  // The warehouse walks it to the courier — three moves on the crew's screen.
  await switchToWarehouse(page);
  await page.goto(`/warehouse-orders/${orderId}`);

  // Confirm, then Set Picked by the item scan (the-item-scans-live-on-the-page), then the handover.
  await expect(page.getByTestId("pick-order-advance")).toContainText("Confirm Order");
  await page.getByTestId("pick-order-advance").click();
  await pickByScan(page);

  await page.getByTestId("pick-order-advance").click();
  await expect(page.getByTestId("pick-order-advance")).toBeHidden();

  // Customer service claims it back from the selling seat: `return` is a claim, the parcel may still be in transit.
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto(`/orders/${orderId}`);
  await page.getByTestId("order-action-returnGoods").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "return");

  // The parcel arrives: the crew finds it on the Returns tab — the accept's queue, return and return_completed together
  // (the-warehouse-list-has-a-returns-tab), and the tab is in the URL.
  await switchToWarehouse(page);
  await page.goto("/warehouse-orders");
  await page.getByTestId("pick-tab-return").click();
  await expect(page).toHaveURL(/step=return/);
  await page.getByTestId(`pick-queue-row-${orderId}`).locator("td").nth(1).click();

  // Accept Return opens the accept page (the-return-accept-page-is-accepted). Every unit missing — nothing to rack; the
  // courier asked for postage, and the charge needs what it was for before Accept presses.
  await page.getByTestId("pick-order-accept-return").click();
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}/accept-return$`));

  const lines = page.locator('[data-testid^="return-accept-line-"]');
  await expect(lines.first()).toBeVisible();
  for (const testId of await lines.evaluateAll((els) => els.map((el) => el.getAttribute("data-testid") ?? ""))) {
    const itemId = testId.replace("return-accept-line-", "");
    const ordered = (await page.getByTestId(`return-accept-ordered-${itemId}`).innerText()).replace(/\D/g, "");
    await page.getByTestId(`return-accept-missing-${itemId}`).fill(ordered);
    await expect(page.getByTestId(`return-accept-nothing-to-place-${itemId}`)).toBeVisible();
  }

  await page.getByTestId("return-accept-charge").fill("12000");
  await expect(page.getByTestId("return-accept-charge-note-error")).toBeVisible();
  await expect(page.getByTestId("return-accept-submit")).toBeDisabled();

  await page.getByTestId("return-accept-charge-note").fill("ongkir retur");
  await page.getByTestId("return-accept-submit").click();
  await page.getByTestId("confirm-action").click();

  // Accepted, the page goes back to where it was opened — the order, whose one return step is gone.
  await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}$`));
  await expect(page.getByTestId("pick-order-accept-return")).toBeHidden();
  await expect(page.getByText("Return received").first()).toBeVisible();

  // THE CHARGE ON THE BALANCE — the selling seat owes the warehouse, named as a return's courier charge on this order.
  // It arrives through the broker, after the accept answered, so it is waited for.
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await expect
    .poll(
      async () => {
        await page.goto("/liability");
        await expect(page.getByTestId("liability-list-page")).toBeVisible();

        const row = page.locator('[data-testid^="liability-row-"]').filter({ hasText: WH_NAME });
        const found = await row
          .first()
          .waitFor({ timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        if (!found) return "";

        await row.first().click();
        await page.getByTestId("liability-detail-tab-payable").click({ timeout: 5_000 });

        return (await page.getByTestId("liability-detail-payable").textContent({ timeout: 5_000 })) ?? "";
      },
      { timeout: 30_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toContain(`Courier at a return · order #${orderId}`);
});

// A WAREHOUSE'S PRODUCTS IS WHAT IT HOLDS (a-warehouses-products-is-what-it-holds). It was #142's list of what the
// warehouse had been ASKED to handle — the restock arrangement, with the seller's catalogue columns read as "—" and the
// owner as "Team #1". Now it is every product with a batch here, any team's, at 0 too: the setup received this product
// into this warehouse, so it is listed, its owner named and its units on hand, searchable. The owner's actions and the
// seller's columns are not a warehouse's.
test("Products: a warehouse's Products lists what it holds, without the seller's columns", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await switchToWarehouse(page);
  await page.goto("/products");

  // The product the setup received here is on ITS list, even though a selling team owns it.
  const row = page.getByTestId(`stock-row-${CODE}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(PRODUCT_NAME);
  await expect(page.getByTestId(`stock-owner-${CODE}`)).not.toBeEmpty();
  await expect(page.getByTestId(`stock-owner-${CODE}`)).not.toContainText("Team #");
  await expect(page.getByTestId(`stock-onhand-${CODE}`)).toHaveText(/^\d+$/);

  // The OWNER's actions are not offered — a warehouse handles these products, it does not own them — and the seller's
  // columns (Cross markup, Lock, the cost range, the catalogue's figures) are not on its view.
  await expect(page.getByTestId(`edit-${CODE}`)).toHaveCount(0);
  await expect(page.getByTestId(`archive-${CODE}`)).toHaveCount(0);
  await expect(page.getByTestId("open-create-product")).toHaveCount(0);
  await expect(page.getByTestId("products-table")).toHaveCount(0);
  await expect(page.getByTestId(`cross-${CODE}`)).toHaveCount(0);
  await expect(page.getByTestId(`lock-${CODE}`)).toHaveCount(0);

  // It searches, on the server.
  await page.getByTestId("inventory-search").fill(SKU);
  await expect(row).toBeVisible();
});

// #153 — placing an order RECORDS ITS EXPECTED REVENUE, with nothing in between.
//
// This is the payoff test for the whole revenue chain: #74 froze the money onto the order, #75 built
// the record, #78 built the screen, and until #153 nothing connected them — the table stayed empty and
// the report had nothing to show. Placing an order here goes through the real publisher, the real
// event, and the real push handler.
// ⛔ SKIPPED — IT TESTS A SCREEN THAT WAS DELETED, NOT A BUG.
//
// `/revenue` went with `revenue_service` in `0d4cbc4`, and [router.tsx] says so out loud: *"/revenue
// and /profit are GONE with `revenue_service`, and there is deliberately no redirect"*. The route
// 404s, so every assertion below is about a page that cannot render.
//
// ⚠ SKIPPED RATHER THAN DELETED, because the capability is DEFERRED and not cancelled
// (the-daily-report-is-deferred): `revenue_service` held the SELLING team's income, which is exactly
// what §Responsbility 2 still promises them. This test is the specification of what has to work again
// when it returns — throwing it away would mean rewriting it from scratch.
//
// ⚠ It must be un-skipped in the same change that brings the report back. A permanently skipped test
// is one nobody ever reads again.
test.skip("Revenue: placing an order records its expected revenue (#153)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const customer = `${CUSTOMER} revenue`;
  await placeOrderViaForm(page, customer);

  // The order's id, from the detail page it lands on.
  const heading = await page.getByTestId("order-detail-page").innerText();
  const orderId = heading.match(/#(\d+)/)?.[1];
  expect(orderId).toBeTruthy();

  await page.goto("/revenue");

  // A row for THIS order, put there by the event rather than by any call the screen made.
  await expect(page.getByTestId(`revenue-row-${orderId}`)).toBeVisible();

  // Its cost is unknown — the e2e's product was never restocked, so no cost was ever recorded for it
  // (#74). That must show as "Unknown" rather than as a confident Rp 0, and the margin beside it
  // carries the warning that says the number is not to be trusted.
  await expect(page.getByTestId(`revenue-cogs-unknown-${orderId}`)).toBeVisible();
  await expect(page.getByTestId(`revenue-margin-untrusted-${orderId}`)).toBeVisible();
});

// #157 — THE ACCEPT SCREEN, end to end: count a delivery, split it across two shelves, write off the
// breakage, and record the COD fee.
//
// The accept flow had no e2e at all before this — the dialog it replaced was never covered — so this
// is the first test that walks a delivery through the door.
test("Accept: a delivery is counted, split across shelves, and its breakage written off (#157)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // A restock for 10 on its way, plus two shelves to put them on.
  const seeded = await page.evaluate(
    async ([whCode, productCode]) => {
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

      const teams = await call("team.v1.TeamService/TeamList", { page: { page: 1, limit: 200 } });
      const warehouse = (Object.values(teams.items?.find((it: any) => it.team)?.team?.mapData ?? {}) as any[]).find((t: any) => t.teamCode === whCode);

      const products = await call("product.v1.ProductService/ProductDiscover", {
        teamId: "1",
        filter: { q: productCode },
        page: { page: 1, limit: 50 },
      });
      const product = (Object.values(products.items?.find((it: any) => it.product)?.product?.mapData ?? {}) as any[]).find((p: any) => p.productCode === productCode);
      if (!product) throw new Error(`product ${productCode} not found`);

      // Saved lowercase (rack-codes-are-saved-lowercase).
      const shelves: string[] = [];
      for (const code of ["acc-01", "acc-02"]) {
        const rack = await call("inventory.v1.RackService/RackCreate", { teamId: warehouse.id, code });
        shelves.push(rack.rack.id);
      }

      // A supplier kept by a SELLING team of its own — only a selling team has suppliers
      // (only-a-selling-team-has-suppliers), and the buying root team is not one. Team 1 restocks from it
      // (a-team-restocks-from-another-teams-supplier), and the warehouse names it: neither keeps it, so naming
      // it on the accept screen is a genuine cross-team read and not an accident of two sides being one team.
      const vendorTeam = await call("team.v1.TeamService/TeamCreate", {
        type: "TEAM_TYPE_SELLING",
        name: `E2E Vendor Team ${whCode}`,
        teamCode: `VT${whCode}`.slice(0, 10),
        ownerUserId: "1",
      });
      const supplierName = "Sinar Jaya Textile";
      const supplier = await call("supplier.v1.SupplierService/SupplierCreate", {
        teamId: vendorTeam.team.id,
        name: supplierName,
      });

      // Every restock names the account that paid (a-restock-must-name-the-account-that-paid).
      const account = await call("financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
        teamId: "1",
        type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
        provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
        name: "E2E accept",
        holderName: "E2E",
        accountNumber: "E2E-ORDERS-3",
        openingBalance: 0,
        openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
      });
      // The restock is paid from an OPERATIONAL account (a-restock-names-its-paying-account).
      await call("financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId: "1",
        accountId: account.account.id,
        operational: true,
      });

      // The supplier is the LINE's (a-line-names-the-channel-it-was-bought-from).
      const created = await call("inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: "1",
        warehouseId: warehouse.id,
        financeAccountId: account.account.id,
        shipmentCost: 20000,
        items: [
          { productId: product.id, productCode, name: "e2e accept", count: "10", total: 100000, supplierId: supplier.supplier.id },
        ],
      });

      return { requestId: created.request.id, productId: product.id, supplierName, shelves };
    },
    [WH_CODE, CODE],
  );

  const pid = seeded.productId;
  const [first, second] = seeded.shelves;

  await switchToWarehouse(page);
  await page.goto(`/inventories/restock/${seeded.requestId}/accept`);

  const line = page.getByTestId(`accept-line-${pid}`);
  await expect(line).toBeVisible();

  // No supplier at the door (the-line-reads-ordered-then-what-it-came-to): where it was bought is the selling team's
  // purchase, so the warehouse's Terima names none.
  await expect(page.getByTestId(`accept-supplier-${pid}`)).toHaveCount(0);

  // Nothing counted yet, so nothing can be accepted.
  await expect(page.getByTestId("accept-submit")).toBeDisabled();

  // The warehouse types what is IN THE BOX and how many of those are broken (any-warehouse-member-counts-what-arrived):
  // 10 arrived, 2 crushed — so 8 good and nothing missing.
  await page.getByTestId(`accept-received-${pid}`).fill("10");
  await page.getByTestId(`accept-broken-${pid}`).fill("2");
  await page.getByTestId(`accept-broken-note-${pid}`).fill("crushed in transit");
  await expect(page.getByTestId(`accept-good-${pid}`)).toContainText("8");

  // RackSelect is a Chakra Select, not a native one, so a place is CHOSEN — open the trigger, click the option — rather
  // than set with selectOption().
  const pickRack = async (index: number, rackId: string) => {
    const row = page.getByTestId(`accept-placement-${pid}-${index}`);
    await row.getByTestId("rack-select").click();
    // Inline, not portalled — every row holds its own list, so the option is found in ITS row.
    await row.getByTestId(`rack-select-option-${rackId}`).click();
  };

  // The 8 good units split over two shelves: 3 on the second, and the first follows what is left — 5.
  await pickRack(0, first);
  await page.getByTestId(`accept-add-placement-${pid}`).click();
  await page.getByTestId(`accept-placement-qty-${pid}-1`).fill("3");
  await pickRack(1, second);
  await expect(page.getByTestId(`accept-placement-qty-${pid}-0`)).toHaveValue("5");
  await expect(page.getByTestId(`accept-balanced-${pid}`)).toBeVisible();

  // The courier's charge changes what every unit cost, so what the 2 broken units were worth must move as it is typed
  // (the-couriers-ask-is-in-the-unit-price). The line shows no price per piece (the-accept-line-shows-no-price).
  const worth = page.getByTestId(`accept-broken-value-${pid}`);
  const before = await worth.innerText();
  // Said as text, changed on Ubah (the-cod-paid-is-said-in-its-own-section); then asked first
  // (the-charge-is-asked-for-before-it-is-filled) — Ada reveals the charge.
  await page.getByTestId("accept-courier-edit").click();
  await page.getByTestId("accept-courier-asked-yes").click();
  await page.getByTestId("accept-courier-charge").fill("8000");
  await expect(worth).not.toHaveText(before);

  // ⚠ THE NOTE IS REQUIRED once there is a charge (the-courier-is-paid-once-per-restock), and without it Accept stays
  // disabled.
  await expect(page.getByTestId("accept-submit")).toBeDisabled();
  await page.getByTestId("accept-courier-note").fill("courier asked at the door");

  await expect(page.getByTestId("accept-submit")).toBeEnabled();
  await page.getByTestId("accept-submit").click();
  await page.getByTestId("confirm-action").click();

  // It lands on the restock, accepted, showing BOTH shelves with their quantities — read back from the accept's own
  // rack rows (putting-away-at-accept-is-not-a-move).
  await expect(page.getByTestId("restock-detail-page")).toBeVisible();
  await expect(page.getByTestId("restock-detail-page")).toContainText("acc-01 (5)");
  await expect(page.getByTestId("restock-detail-page")).toContainText("acc-02 (3)");

  // #207 — once accepted, the warehouse prints the shelf labels for exactly what entered stock.
  // The OLD address — it lands on the labels' one address with this restock on it (the-labels-have-one-address).
  await page.goto(`/inventories/restock/${seeded.requestId}/labels`);
  await expect(page).toHaveURL(new RegExp(`/inventories/restock/labels\\?ids=${seeded.requestId}$`));
  await expect(page.getByTestId("labels-sheet")).toBeVisible();

  // Yang Dicetak lists each label once — the two shelves — with its count (the-print-list-is-each-label-and-its-count).
  // Piece mode by default: 8 good units (5 + 3) → 8 labels to print. The 2 broken got none, and the screen says so.
  const printed = page.getByTestId("labels-print-root").locator(".print-label");
  await expect(page.getByTestId("labels-sheet").locator(".label-sticker")).toHaveCount(2);
  await expect(printed).toHaveCount(8);
  await expect(page.getByTestId("labels-excluded")).toContainText("2");

  // One-per-shelf starts each count at 1 — the two shelves, two labels.
  await page.getByTestId("labels-mode").getByText("Shelf").click();
  await expect(printed).toHaveCount(2);

  // THERE IS NO STRUK (there-is-no-struk) — the receipt's old address lands on the restock itself.
  await page.goto(`/inventories/restock/${seeded.requestId}/receipt`);
  await expect(page).toHaveURL(new RegExp(`/inventories/restock/${seeded.requestId}$`));
  await expect(page.getByTestId("restock-detail-page")).toBeVisible();
});

// #145 — a selling team's DEFAULT SHIPPING WAREHOUSE pre-fills the order form.
//
// Every order must name a warehouse (#72) and a team almost always ships from the same building, so
// answering that question on every single order is asking something whose answer never changes.
//
// It stays a DEFAULT: the field is still required, still visible, still changeable — and the server
// still refuses an order that names none. This only saves the picking.
test("Settings: a default warehouse pre-fills the order form (#145)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Root is a ROOT team, not a selling one, so the card is deliberately absent — a warehouse (or the
  // root team) does not ship from a warehouse.
  await page.goto("/settings");
  await expect(page.getByTestId("save-default-warehouse")).toBeHidden();

  // Configure it through the API for the team the order form actually runs as.
  await page.evaluate(
    async ([whCode]) => {
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

      const teams = await call("team.v1.TeamService/TeamList", { page: { page: 1, limit: 200 } });
      const warehouse = (Object.values(teams.items?.find((it: any) => it.team)?.team?.mapData ?? {}) as any[]).find((t: any) => t.teamCode === whCode);

      await call("team.v1.TeamService/TeamInfoUpdate", {
        teamId: "1",
        defaultWarehouseId: String(warehouse.id),
      });
    },
    [WH_CODE],
  );

  // The form now opens with it already chosen — the picker shows the warehouse's name.
  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await expect(page.getByTestId("order-warehouse").locator("input")).toHaveValue(WH_NAME);
});

// #144/#158 — the WAREHOUSE's view of a product: the stock, not the catalogue entry it does not own.
//
// It runs after the Accept test, so this product has a real history here: received onto two shelves,
// with two units written off. That is what the page has to show.
test("Warehouse product: the stock view shows placement, valuation and history (#158)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await switchToWarehouse(page);

  // Reached by clicking the product in the warehouse's own Products — what it holds (a-warehouses-products-is-what-it-holds)
  // — which must NOT open the selling team's catalogue page.
  await page.goto("/products");
  await page.getByTestId(`stock-row-${CODE}`).getByText(PRODUCT_NAME).click();

  await expect(page.getByTestId("warehouse-product-page")).toBeVisible();

  // A — the product, B — whose catalogue it is (a warehouse holds other teams' products).
  await expect(page.getByTestId("warehouse-product-owner")).toBeVisible();

  // C — the warehouse holds some, and the cost is known because a fulfilled restock recorded it
  // (#155), so the valuation is a real figure rather than "Unknown".
  //
  // NOT asserted as an exact number on purpose: this file is serial, and by now the product has been
  // received, ordered against, cancelled and accepted by earlier tests. Pinning the running total
  // would make every future test that touches this product break this one, which is a test asserting
  // the suite's history rather than the page's behaviour.
  // THE ACTION GROUP (#198/#209) — Move and Adjust only. There is deliberately NO Receive here: stock
  // enters through restock acceptance (which freezes a cost layer), never a manual receive on the
  // product page.
  await expect(page.getByTestId("wp-action-receive")).toHaveCount(0);
  await expect(page.getByTestId("wp-action-move")).toBeVisible();
  await expect(page.getByTestId("wp-action-adjust")).toBeVisible();

  // It really opens the shared dialog, not a lookalike.
  await page.getByTestId("wp-action-move").click();
  await expect(page.getByTestId("move-quantity")).toBeVisible();
  await page.keyboard.press("Escape");

  // Info is the tab that opens (#198), and it carries the stock facts.
  await expect(page.getByTestId("warehouse-product-onhand")).not.toHaveText("0");

  // F — never counted, because nothing has adjusted it. This is the assertion the server-side kind
  // filter earns: without it, page one of the ledger would decide the answer.
  await expect(page.getByTestId("warehouse-product-last-opname")).toHaveText("Never counted");

  // Prices — one cost layer, its cost known because a fulfilled restock froze it (#155/#209), so the
  // layers table and the total valuation are real figures rather than "Unknown".
  await page.getByTestId("wp-tab-prices").click();
  await expect(page.getByTestId("wp-prices-table")).not.toContainText("Unknown");
  await expect(page.getByTestId("warehouse-product-valuation")).not.toHaveText("Unknown");

  // Placements — both shelves it was split across, their codes saved lowercase (rack-codes-are-saved-lowercase). by the codes as saved (rack-codes-are-saved-lowercase).
  await page.getByTestId("wp-tab-placement").click();
  await expect(page.getByTestId("wp-placement-table")).toContainText("acc-01");
  await expect(page.getByTestId("wp-placement-table")).toContainText("acc-02");

  // Tab 4 — the receives that put it there.
  await page.getByTestId("wp-tab-history").click();
  await expect(page.getByTestId("wp-history-table")).toContainText("Received");

  // Tab 5 — nothing has been MOVED between shelves, so this one is honestly empty.
  await page.getByTestId("wp-tab-placement-history").click();
  await expect(page.getByTestId("wp-placement-history-empty")).toBeVisible();

  // E/G (#159) — the last order and the last delivery, answerable only because the list RPCs can now
  // be narrowed to one product. Back to Info, which is where they sit (#198).
  await page.getByTestId("wp-tab-info").click();
  await expect(page.getByTestId("warehouse-product-last-order")).not.toHaveText("None");
  await expect(page.getByTestId("warehouse-product-last-restock")).not.toHaveText("None");

  // Tab 1 (#160) — a BATCH IS A DELIVERY. Two restocks were counted in here — the setup's 50 and the Accept test's 8
  // of 10 with 2 written off — so the product has exactly two batches, and the second remembers both numbers.
  await page.getByTestId("wp-tab-batches").click();
  const batches = page.getByTestId("wp-batches-table");
  await expect(batches).toBeVisible();
  await expect(batches.locator("tbody tr")).toHaveCount(2);
  await expect(batches).toContainText("8");
  await expect(batches).toContainText("2");
});

// #164 — CANCELLING AN ORDER STOPS ITS REVENUE COUNTING.
//
// The bug: a row is written when an order is placed (#153), an order can be cancelled right up to
// SHIPPED (#150), and nothing told revenue — so the report counted money from orders that fell
// through. This walks the whole path: place, read the total, cancel, read it again.
// ⛔ SKIPPED FOR THE SAME REASON as the revenue test above: `/revenue` went with `revenue_service`
// in `0d4cbc4` and the route deliberately 404s. Skipped rather than deleted — it is the specification
// of what has to work again when the deferred selling report returns, and it must be un-skipped in
// the same change that brings it back.
test.skip("Revenue: cancelling an order stops it counting, but the row stays visible (#164)", async ({
  page,
}) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const customer = `${CUSTOMER} voided`;
  await placeOrderViaForm(page, customer);

  const heading = await page.getByTestId("order-detail-page").innerText();
  const orderId = heading.match(/#(\d+)/)?.[1];
  expect(orderId).toBeTruthy();

  // The total WITH this order counted.
  await page.goto("/revenue");
  await expect(page.getByTestId(`revenue-row-${orderId}`)).toBeVisible();
  const before = await page.getByTestId("revenue-total-revenue").innerText();

  // Cancel it — the goods are still in the building, so this is allowed (#150).
  await page.goto(`/orders/${orderId}`);
  await page.getByTestId("order-action-cancel").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("order-detail-page")).toContainText("Cancelled");

  await page.goto("/revenue");

  // The row is STILL THERE and flagged — voiding is not deleting, and an order that was placed then
  // cancelled is exactly what somebody looking at the money wants to see.
  await expect(page.getByTestId(`revenue-row-${orderId}`)).toBeVisible();
  await expect(page.getByTestId(`revenue-voided-${orderId}`)).toBeVisible();

  // But the total has DROPPED — it no longer counts an order that fell through.
  await expect(page.getByTestId("revenue-total-revenue")).not.toHaveText(before);
});

// THE LIST AS A FILE (one-export-is-the-list-as-a-file) — the whole chain on a real server: the stream, the file stored
// in document_service as the person exporting, and the expiring link the browser downloads.
test("Export: the order list downloads as an .xlsx file", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto("/orders");
  await expect(page.getByTestId("orders-export")).toBeVisible();

  const downloading = page.waitForEvent("download");
  await page.getByTestId("orders-export").click();
  const download = await downloading;

  // The file's OWN name, not its storage key (a-download-keeps-its-files-name): the link is on another origin, where a
  // browser ignores the anchor's `download` name, so the name comes from the storage's Content-Disposition.
  expect(download.suggestedFilename()).toMatch(/^orders-.*\.xlsx$/);

  const path = await download.path();
  expect(statSync(path).size).toBeGreaterThan(0);

  await expect(page.getByText("Export ready — the file is downloading")).toBeVisible();
});

// #11 — THE MOVES THE SERVER ALLOWED WITH NO BUTTON. §Status Move draws shipped → problem, problem → return and
// problem → lost (customer-service-sets-shipped-and-problem-by-hand, a-forced-return-follows-the-status-move); the
// selling seat's buttons now make each, through OrderStatusChange, the destructive two behind a confirm. Last in the
// file: each places an order, and the tests above count orders and stock.
async function toShipped(page: Page, customer: string): Promise<string> {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await placeOrderViaForm(page, customer);
  const orderId = /\/orders\/(\d+)$/.exec(page.url())![1]!;

  // The warehouse walks it to the courier.
  await switchToWarehouse(page);
  await page.goto(`/warehouse-orders/${orderId}`);
  // Confirm, then Set Picked by the item scan (the-item-scans-live-on-the-page), then the handover.
  await expect(page.getByTestId("pick-order-advance")).toContainText("Confirm Order");
  await page.getByTestId("pick-order-advance").click();
  await pickByScan(page);
  await page.getByTestId("pick-order-advance").click();
  await expect(page.getByTestId("pick-order-advance")).toBeHidden();

  // Customer service sees it moving on the platform.
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto(`/orders/${orderId}`);
  await page.getByTestId("order-action-ship").click();
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "shipped");

  return orderId;
}

test("Moves: a shipped order is marked a problem, then returned (#11)", async ({ page }) => {
  await toShipped(page, `${CUSTOMER} problem-return`);

  // shipped → problem — customer service, by hand from the platform. A waystation: no confirm.
  await page.getByTestId("order-action-markProblem").click();
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "problem");

  // problem → return — destructive, so it confirms first.
  await expect(page.getByTestId("order-action-resolveDispute")).toBeVisible();
  await page.getByTestId("order-action-returnGoods").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "return");
});

test("Moves: a problem order is written off as lost (#11)", async ({ page }) => {
  await toShipped(page, `${CUSTOMER} problem-lost`);

  await page.getByTestId("order-action-markProblem").click();
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "problem");

  // problem → lost — destructive, so it confirms first; then nothing is left to press.
  await page.getByTestId("order-action-markLost").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "lost");
  await expect(page.getByTestId("order-action-bar")).toBeHidden();
});

// every-allowed-move-has-a-button — the last two edges of orderMoves the seller's screen had no button for, each confirmed.
test("Moves: a shipped order is written off as lost directly", async ({ page }) => {
  await toShipped(page, `${CUSTOMER} shipped-lost`);

  // shipped → lost, without passing through problem. Four actions on shipped, so the destructive two sit in ⋯.
  await page.getByTestId("order-action-more").click();
  await page.getByTestId("order-action-markLost").click();
  await expect(page.getByText(/Mark order #\d+ as lost\?/)).toBeVisible();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "lost");
  await expect(page.getByTestId("order-action-bar")).toBeHidden();
});

test("Moves: a completed order is returned", async ({ page }) => {
  await toShipped(page, `${CUSTOMER} completed-return`);

  // shipped → completed — customer service, no confirm.
  await page.getByTestId("order-action-complete").click();
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "completed");

  // completed → return — the buyer sent it back; destructive, so it confirms first.
  await page.getByTestId("order-action-returnGoods").click();
  await expect(page.getByText(/Return the goods on order #\d+\?/)).toBeVisible();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "return");
});

// THE DUPLICATE MARKETPLACE REF IS WARNED, NOT REFUSED (a-duplicate-ref-is-warned-not-refused,
// the-duplicate-warning-reads-drafts-too, the-duplicate-ref-warning-is-accepted). A first order on a fresh ref goes
// straight through; a second order typed on the same shop + ref is stopped by a warning naming the first (a link, its
// status, the WIB day it was typed in); Go Back keeps the form as typed; Create Anyway places the double. A draft
// pushed on another ref in the same shop is named the same way, as "Draft #id". LAST in the file: the double it places
// would otherwise change the counts the list tests above assert.
test("Duplicate ref: a second order on a used ref is warned about, and can still be created", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const ref = `250817DU${SUFFIX}`;
  const customer = `E2E Duplicate ${SUFFIX}`;

  // THE FIRST ORDER on the ref: nothing recorded yet, so no warning — Create goes straight to the detail.
  await fillOrderForm(page, `${customer} first`, ref);
  await page.getByTestId("order-create-save").click();
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  const firstId = /\/orders\/(\d+)$/.exec(page.url())![1]!;

  const shopId = await fillOrderForm(page, customer, ref);
  await page.getByTestId("order-create-save").click();

  const dialog = page.getByTestId("duplicate-ref-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("duplicate-ref-lead")).toContainText(ref);
  const link = dialog.getByTestId(`duplicate-ref-order-link-${firstId}`);
  await expect(link).toHaveText(`Order #${firstId}`);
  await expect(link).toHaveAttribute("href", `/orders/${firstId}`);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(dialog.getByTestId(`duplicate-ref-order-${firstId}`)).toContainText("Pending");
  // Typed in today — the short WIB day, off the lookup itself (OrderRefItem.created_at_unix), no detail read.
  const today = new Date().toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  await expect(dialog.getByTestId(`duplicate-ref-order-${firstId}`)).toContainText(`created ${today}`);

  // GO BACK keeps the form exactly as typed, and places nothing.
  await dialog.getByTestId("duplicate-ref-go-back").click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/orders\/new$/);
  await expect(page.getByTestId("order-create-customer-name")).toHaveValue(customer);
  await expect(page.getByTestId("order-external-ref-id")).toHaveValue(ref);
  await expect(page.getByTestId("order-line-0")).toContainText(SKU);

  // CREATE ANYWAY places the double — the server refuses nothing for a repeated ref.
  await page.getByTestId("order-create-save").click();
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("duplicate-ref-create-anyway").click();
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  expect(page.url()).not.toMatch(new RegExp(`/orders/${firstId}$`));
  await expect(page.getByTestId("order-reference-mp")).toContainText(ref);

  // A DRAFT ON THE SHOP + REF IS NAMED TOO — pushed the way the external app pushes one, into this shop.
  const draftRef = `250816DR${SUFFIX}`;
  const draftId = await page.evaluate(
    async ({ draft, shop }: { draft: string; shop: string }) => {
      const token =
        window.sessionStorage.getItem("warehouse_revamp.token") ??
        window.localStorage.getItem("warehouse_revamp.token");

      const res = await fetch("http://localhost:8081/warehouse.selling.v1.OrderDraftService/OrderDraftPush", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamId: "1", source: "e2e-scraper", externalId: draft, shopId: shop, customerName: "Budi" }),
      });
      if (res.status !== 200) throw new Error(`OrderDraftPush: ${res.status} ${await res.text()}`);

      return ((await res.json()) as { draft: { id: string } }).draft.id;
    },
    { draft: draftRef, shop: shopId },
  );

  await fillOrderForm(page, customer, draftRef);
  await page.getByTestId("order-create-save").click();
  await expect(dialog).toBeVisible();
  const draftLink = dialog.getByTestId(`duplicate-ref-draft-link-${draftId}`);
  await expect(draftLink).toHaveText(`Draft #${draftId}`);
  await expect(draftLink).toHaveAttribute("href", `/orders/new?draft=${draftId}`);
  await expect(dialog.getByTestId(`duplicate-ref-draft-${draftId}`)).toContainText(`created ${today}`);
  await expect(dialog.locator('[data-testid^="duplicate-ref-order-"]')).toHaveCount(0);
  await dialog.getByTestId("duplicate-ref-go-back").click();
  await expect(dialog).toBeHidden();

  // The draft is left as it was found — deleted here so the drafts screen of a later spec starts as it did.
  const deleted = await page.evaluate(async (id: string) => {
    const token =
      window.sessionStorage.getItem("warehouse_revamp.token") ??
      window.localStorage.getItem("warehouse_revamp.token");

    const res = await fetch("http://localhost:8081/warehouse.selling.v1.OrderDraftService/OrderDraftDelete", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ teamId: "1", draftIds: [id] }),
    });

    return res.status;
  }, draftId);
  expect(deleted).toBe(200);
});

// WAREHOUSE FEE, END TO END (the-warehouse-fee-prototype-is-accepted): an order's frozen fee reaches Analytic through the
// order metrics' fold — OrderPlaced adds +1 and the fee on the placement day, OrderCancelled takes both back on the
// cancel's day (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day), so placing and cancelling one
// order today nets the day back to where it stood. The warehouse reads the amount too (a-warehouse-sees-its-own-fee-amount).
// Read as DELTAS from a settled baseline: root reads every order this spec placed. LAST in the file: it places an order.
test("Analytic: an order's warehouse fee counts when placed and nets back when cancelled", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  const digits = (text: string | null) => Number((text ?? "").replace(/[^\d-]/g, ""));
  const readFee = async (url = "/analytic?g=warehouse&m=metrics/warehouse_fee") => {
    await page.goto(url);
    await expect(page.getByTestId("analytic-page")).toBeVisible();
    const count = page.getByTestId("analytic-headline-transaction_count-value");
    const amount = page.getByTestId("analytic-headline-amount-value");
    await expect(amount).toBeVisible({ timeout: 10_000 });

    return `${digits(await count.textContent())}|${digits(await amount.textContent())}`;
  };

  // A SETTLED BASELINE — the earlier tests' folds have landed when two reads a few seconds apart agree.
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = await readFee();
        const settled = now === previous;
        previous = now;

        return settled;
      },
      { timeout: 45_000, intervals: [3_000] },
    )
    .toBe(true);
  const [baseCount, baseAmount] = previous.split("|").map(Number) as [number, number];

  // Place one order; its fee is the one frozen on it, read off its detail.
  await placeOrderViaForm(page, `${CUSTOMER} warehouse-fee`);
  const orderUrl = page.url();
  const fee = digits(await page.getByTestId("money-fees").textContent());
  expect(fee).toBeGreaterThan(0);

  // PLACED — one more fee transaction and the fee, once the push has been folded.
  await expect.poll(() => readFee(), { timeout: 45_000, intervals: [1_000, 2_000, 3_000] }).toBe(
    `${baseCount + 1}|${baseAmount + fee}`,
  );

  // THE WAREHOUSE READS THE AMOUNT — its own income, by seller (a-warehouse-sees-its-own-fee-amount).
  await switchToWarehouse(page);
  await page.goto("/analytic?g=team&m=metrics/warehouse_fee");
  await expect(page.getByTestId("analytic-page")).toBeVisible();
  await expect
    .poll(async () => digits(await page.getByTestId("analytic-headline-amount-value").textContent()), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(fee);

  // CANCELLED — the cancel takes the fee back on its own day (today), so the day nets back to the baseline.
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await page.goto(orderUrl);
  await page.getByTestId("order-action-cancel").click();
  await page.getByTestId("confirm-action").click();
  await expect(page.getByTestId("order-detail-page")).toContainText("Cancelled");

  await expect.poll(() => readFee(), { timeout: 45_000, intervals: [1_000, 2_000, 3_000] }).toBe(
    `${baseCount}|${baseAmount}`,
  );
});

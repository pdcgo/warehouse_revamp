import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
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
const PRODUCT_NAME = `E2E Order Product ${SUFFIX}`;
const CUSTOMER = `E2E Customer ${SUFFIX}`;
// The marketplace's own id for the order — shaped like one a storefront actually issues, and made
// unique per run so the search that finds it cannot match a leftover from an earlier one.
const MARKETPLACE_REF = `250815MP${SUFFIX}`;
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
async function tickProduct(page: Page, sku: string) {
  await page.getByTestId("product-picker-search").fill(sku);

  const row = page
    .getByTestId("product-picker-list")
    .locator('[data-testid^="product-picker-option-"]')
    .filter({ hasText: sku });
  await expect(row).toHaveCount(1);

  // The click goes to the CONTROL, never the row's centre. In the table layout the centre lands on the
  // product's name — a cell, not a label — and in the list layout a label click there is not what
  // Chakra's hidden input listens to. The control is the one target that works in both.
  await row.locator('[data-part="control"]').click();
}

// Adds products to the order through the picker dialog (#165's pattern, now the order form's too).
async function addProducts(page: Page, skus: string[]) {
  await page.getByTestId("order-create-add-line").click();

  for (const sku of skus) {
    await tickProduct(page, sku);
  }

  await page.getByTestId("product-picker-confirm").click();
}

// Places one order through the form (reusing the setup shop + product) and lands on its detail page.
// Deliberately fills NO address: it is optional (#118), so this also proves the form submits and the
// detail page renders without one.
async function placeOrderViaForm(page: Page, customer: string) {
  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await page.getByTestId("order-create-customer-name").fill(customer);
  await page.getByTestId("shop-select").click();
  await page.getByRole("option").filter({ hasText: SHOP_NAME }).click();
  // Which warehouse ships it (#72) — required, so the form cannot submit without it. Chosen BEFORE
  // the products so the picker can show what that warehouse holds on each row.
  await page.getByTestId("order-warehouse").locator("input").fill(WH_CODE);
  await page.getByTestId(`team-select-option-${WH_CODE}`).click();
  await addProducts(page, [SKU]);
  await page.getByTestId("order-line-qty-0").fill("1");
  // No price: a line is valued at the warehouse HPP, which this fixture's product has none of.
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
  await expect(page.getByTestId("shops-table")).toBeVisible();
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
  await expect(page.getByTestId(`product-row-${SKU}`)).toBeVisible();
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
  const ids = await page.evaluate(async ([whCode, sku]) => {
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
    const product = discovered.find((p) => p.sku === sku);
    if (!product) {
      throw new Error(`product ${sku} not found among ${discovered.length} discovered`);
    }

    await call("inventory.v1.InventoryService/StockReceive", {
      warehouseId: warehouse.id,
      productId: product.id,
      quantity: "50",
      reason: "e2e seed",
    });

    return { warehouse: warehouse.id, product: product.id };
  }, [WH_CODE, SKU]);

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

  // NO price is typed any more — a line is valued at the warehouse's HPP (owner). This fixture's
  // product reached the shelf through StockReceive and was never restocked, so no cost was ever
  // recorded for it: the line says "not recorded" rather than showing a confident Rp 0, which is the
  // same distinction the revenue screen already makes for this product (#74).
  await expect(page.getByTestId("order-line-hpp-0")).toContainText("not recorded");
  await expect(page.getByTestId("order-line-total-0")).toHaveText("Rp 0");
  await expect(page.getByTestId("order-create-subtotal")).toHaveText("Rp 0");

  // What the storefront took is a NOTE: typed here, stored on the order, and added to NOTHING.
  await page.getByTestId("order-marketplace-total").fill("58000");

  // The MARKETPLACE'S own id for this order — typed beside the shop that took it, because that pair
  // is what lets anybody find this order again on the storefront.
  await page.getByTestId("order-external-ref-id").fill(MARKETPLACE_REF);

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

  // The total IS the subtotal now: the shipping cost was removed from this form (owner), and the
  // marketplace figure was never in the sum.
  await expect(page.getByTestId("order-create-total")).toHaveText("Rp 0");

  await expect(page.getByTestId("order-create-save")).toBeEnabled();
  await page.getByTestId("order-create-save").click();

  // Success lands on the read-only detail for the new order.
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  await expect(page.getByTestId("order-detail-page")).toContainText(CUSTOMER);
  await expect(page.getByTestId(`order-item-${SKU}`)).toBeVisible();
  await expect(page.getByTestId("order-detail-total")).toContainText("Rp 0");
  // The marketplace note survived onto the order, beside the total and not inside it.
  await expect(page.getByTestId("order-detail-marketplace-total")).toContainText("Rp 58.000");
  // …and so did the storefront's own id for it, verbatim — the whole point of the field is that the
  // number a buyer quotes is readable on the order they are asking about.
  await expect(page.getByTestId("order-detail-external-ref")).toHaveText(MARKETPLACE_REF);

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

  // And it now shows in the list.
  await page.getByTestId("order-detail-back").click();
  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByTestId("orders-table")).toContainText(CUSTOMER);
});

// SAVE AS DRAFT, the button above Create (owner): work that is not ready to be an order goes to the
// drafts screen instead — and NO STOCK MOVES, which is the whole reason it is not just a half-filled
// order.
//
// It runs BEFORE the address test so it can prove the other half: a draft is savable while Create is
// still refusing (no warehouse, no lines), because a draft's only requirement is that something was
// typed at all.
test("Draft: an unfinished order is saved as a draft instead of placed", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();

  // Nothing typed: neither button will do anything yet.
  await expect(page.getByTestId("order-create-save")).toBeDisabled();
  await expect(page.getByTestId("order-create-save-draft")).toBeDisabled();

  // A customer and a product, but NO warehouse — an order the form refuses to place.
  await page.getByTestId("order-create-customer-name").fill("Draft Buyer");
  await page.getByTestId("shop-select").click();
  await page.getByRole("option").filter({ hasText: SHOP_NAME }).click();

  await expect(page.getByTestId("order-create-save")).toBeDisabled();
  await expect(page.getByTestId("order-create-save-draft")).toBeEnabled();

  await page.getByTestId("order-create-save-draft").click();

  // It lands on the draft it just made — no discard prompt on the way, because saving IS the exit.
  await expect(page).toHaveURL(/\/order-drafts\/\d+$/);
  await expect(page.getByTestId("draft-customer-name")).toHaveValue("Draft Buyer");
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

// The SELLING seat's half of an order's life: it can call the order off, and that is all.
//
// Confirming used to be here too (#91). It is now the WAREHOUSE's first step (owner) — see the
// fulfilment test below — so this seat offers exactly one action and the order sits at Placed until
// the building takes it on.
test("Lifecycle: the selling seat can cancel, and cannot confirm (#91, owner)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await placeOrderViaForm(page, `${CUSTOMER} lifecycle`);
  const detail = page.getByTestId("order-detail-page");

  // A fresh order is PLACED, and waiting on the warehouse rather than on this seat.
  await expect(detail).toContainText("Placed");
  await expect(page.getByTestId("order-cancel")).toBeVisible();
  await expect(page.getByTestId("order-confirm")).toHaveCount(0);

  // Cancel goes through the confirm dialog (destructive) -> CANCELLED, a terminal state with no actions.
  await page.getByTestId("order-cancel").click();
  await page.getByTestId("confirm-action").click();
  await expect(detail).toContainText("Cancelled");
  await expect(page.getByTestId("order-cancel")).toBeHidden();
});

// The header and the status tabs above the list.
//
// It runs HERE on purpose: the two tests before it have left exactly one PLACED order and one
// CANCELLED one, which is the smallest set that can tell the stat's two halves apart — a cancelled
// order has to be counted in the census and left out of the money, and with only placed orders on the
// board both rules would look identical.
test("Orders: the stat counts the queue and the tabs filter by status", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders");
  await expect(page.getByTestId("orders-table")).toBeVisible();

  // The work queue — a live census of where each order is sitting right now.
  await expect(page.getByTestId("orders-stat-to-confirm")).toHaveText("1");
  await expect(page.getByTestId("orders-stat-in-warehouse")).toHaveText("0");
  await expect(page.getByTestId("orders-stat-shipped")).toHaveText("0");

  // The money — the surviving order only. Its lines are valued at an UNRECORDED HPP and the form no
  // longer takes a shipping cost, so its total is genuinely Rp 0; the cancelled one is left out of
  // these three figures entirely, though it is in the census above. That gap is the whole rule, and
  // the COUNT is what still proves it — one order in the money, two on the board.
  await expect(page.getByTestId("orders-stat-orders-30d")).toHaveText("1");
  await expect(page.getByTestId("orders-stat-revenue-30d")).toHaveText("Rp 0");
  await expect(page.getByTestId("orders-stat-avg-order")).toHaveText("Rp 0");

  await expect(page.getByTestId("orders-tab-count-all")).toHaveText("2");
  await expect(page.getByTestId("orders-tab-count-placed")).toHaveText("1");
  await expect(page.getByTestId("orders-tab-count-cancelled")).toHaveText("1");
  await expect(page.getByTestId("orders-tab-count-shipped")).toHaveText("0");

  // The tab narrows the TABLE and leaves the stat alone: the counts are what you read to decide which
  // tab to open, so a tab that rewrote them would erase its own signpost.
  await page.getByTestId("orders-tab-cancelled").click();
  await expect(page.getByTestId("orders-table")).toContainText(`${CUSTOMER} lifecycle`);
  // One row, not two: the placed order is genuinely filtered out server-side rather than the tab
  // merely highlighting it. (Asserted by row COUNT — the two customers share a prefix, so a
  // text assertion could not tell them apart.)
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(1);
  await expect(page.getByTestId("orders-tab-count-all")).toHaveText("2");
  await expect(page.getByTestId("orders-stat-to-confirm")).toHaveText("1");

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

  // Search for the cancelled order alone. The two customers share a prefix, so "lifecycle" is the
  // only term that separates them — which also makes this a real substring match rather than an
  // equality check that happens to pass.
  await page.getByTestId("orders-search").fill("lifecycle");

  await expect(page.getByTestId(/^order-row-/)).toHaveCount(1);
  await expect(page.getByTestId("orders-table")).toContainText(`${CUSTOMER} lifecycle`);

  // ⚠ The counts moved WITH the table. This is the assertion the whole test exists for: 2 → 1 on
  // "All", and the placed order's tab down to 0, because the search is a filter on the screen rather
  // than on the table alone.
  await expect(page.getByTestId("orders-tab-count-all")).toHaveText("1");
  await expect(page.getByTestId("orders-tab-count-placed")).toHaveText("0");
  await expect(page.getByTestId("orders-tab-count-cancelled")).toHaveText("1");

  // A term nothing matches says so AS A FILTER result, never as "no orders yet" — the second would
  // tell somebody their orders had vanished when they are one Clear away.
  await page.getByTestId("orders-search").fill("nothing matches this at all");
  await expect(page.getByTestId("orders-empty")).toContainText("filters");

  // Clearing puts everything back — both the rows and the counts.
  await page.getByTestId("orders-clear-filters").click();
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(2);
  await expect(page.getByTestId("orders-tab-count-all")).toHaveText("2");

  // The date window, driven by the shared Grafana-style picker. Everything here was placed today, so
  // "Today" keeps both orders and a window that ENDED before today keeps none — which is what pins
  // that the range is actually reaching the server rather than being cosmetic.
  await page.getByTestId("orders-date").click();
  await page.getByTestId("orders-date-quick-1").click();
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(2);

  await page.getByTestId("orders-clear-filters").click();

  // And the shop filter, over the team's one shop: picking it keeps both orders (they were placed on
  // it), which proves the id is being sent correctly — a wrong id would empty the table.
  await page.getByTestId("shop-select").click();
  await page.getByTestId(/^shop-select-option-/).first().click();
  await expect(page.getByTestId(/^order-row-/)).toHaveCount(2);
  await expect(page.getByTestId("orders-tab-count-all")).toHaveText("2");
});

// Opening an order FROM THE LIST, which is the way anybody actually reaches it — every other detail
// test here lands on the page via the create form's redirect or a typed URL, so all of them passed
// through a period where the list's rows did nothing at all when clicked.
test("Orders: clicking a row opens that order's detail", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders");
  await expect(page.getByTestId("orders-table")).toBeVisible();

  // The CUSTOMER cell, deliberately — not the `#id` one. The id text was once the only live target on
  // the row, so a click there would pass with the other three quarters of the row dead.
  await page.getByTestId(/^order-row-/).first().getByRole("cell").nth(1).click();

  await expect(page).toHaveURL(/\/orders\/\d+$/);
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
});

// Switches the app to the WAREHOUSE team — the crew's seat (#151).
//
// The pick screens are scoped to the warehouse, not to the selling team, so nothing about them can be
// exercised from the seat that placed the order. This is the switch that makes the crew's view real.
async function switchToWarehouse(page: Page) {
  await page.getByTestId("team-switcher").click();
  await page.getByTestId("team-search").fill(WH_NAME);
  await page.getByTestId(/^team-option-/).first().click();
  await expect(page.getByTestId("team-switcher")).toContainText(WH_NAME);
}

// #151 — the crew's whole job, end to end: find the order the moment it arrives, open it, ACCEPT IT,
// read WHICH SHELF to walk to, and walk it through picking → packed → shipped.
//
// All four steps belong to the warehouse (owner). The selling seat only places the order here — it
// never confirms, which is the change that made a just-placed order visible to the building at all.
test("Fulfilment: the warehouse takes an order from placed through to shipped (#151)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Placed from the SELLING seat and left there — PLACED, untouched, waiting on the warehouse.
  await placeOrderViaForm(page, `${CUSTOMER} picking`);
  await expect(page.getByTestId("order-detail-page")).toContainText("Placed");

  await switchToWarehouse(page);

  await page.goto("/warehouse-orders");

  // The screen opens on NEW — orders this building has not accepted yet. This is the tab that was
  // missing: the order below is PLACED, and before it existed the crew's screen opened on To Pick and
  // showed an empty table.
  const row = page.getByTestId("pick-queue-table").getByText(`${CUSTOMER} picking`);
  await expect(row).toBeVisible();
  await row.click();

  // THE POINT OF THE SCREEN: the line names a shelf. The e2e's stock was received without a rack, so
  // the honest answer is the unplaced pile — a real place in this system (#135), named in words rather
  // than left blank. A blank would read as "we forgot" instead of "it is not on a shelf yet".
  const pickList = page.getByTestId("pick-list-table");
  await expect(pickList).toBeVisible();
  await expect(pickList).toContainText(PRODUCT_NAME);
  await expect(pickList).toContainText("Unplaced");

  // Forward, one step at a time — and the button always reads as the single next thing that happened.
  // FOUR steps now, not three: the first is this building accepting the job.
  const advance = page.getByTestId("pick-order-advance");

  await expect(advance).toContainText("Confirm Order");
  await advance.click();
  await expect(page.getByTestId("pick-order-advance")).toContainText("Start Picking");

  await page.getByTestId("pick-order-advance").click();
  await expect(page.getByTestId("pick-order-advance")).toContainText("Mark Packed");

  await page.getByTestId("pick-order-advance").click();
  await expect(page.getByTestId("pick-order-advance")).toContainText("Mark Shipped");

  await page.getByTestId("pick-order-advance").click();

  // SHIPPED is the end of the warehouse's work: the goods have left the building, so there is no next
  // step to offer and the button goes away entirely.
  await expect(page.getByTestId("pick-order-advance")).toBeHidden();

  // THE HISTORY THOSE FIVE CLICKS WROTE (00011). This is the only place the whole sequence can be
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

  for (const step of ["placed", "confirmed", "picking", "packed", "shipped"]) {
    await expect(page.getByTestId(`order-timeline-${step}`)).toBeVisible();
  }

  // WHO — the steps name the person who took them, which is the half the status column can never
  // carry. Everything in this run is done by the same root account, so the assertion is that the
  // attribution is THERE at all: an event written with actor 0 would render no person.
  await expect(page.getByTestId("order-timeline-shipped-by")).toBeVisible();

  // SHIPPED is an ending, so nothing is pending under it. A waiting step here would promise work
  // nobody is going to do.
  await expect(page.getByTestId("order-timeline-awaiting")).toBeHidden();
});

// #151 — the queue belongs to a WAREHOUSE. A selling team places orders but has no shelves and nobody
// to walk to them, so the screen says so rather than showing an empty table that looks like a quiet day.
test("Picking: a selling team is told the queue is a warehouse screen (#151)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/warehouse-orders");

  await expect(page.getByTestId("pick-queue-not-warehouse")).toBeVisible();
  await expect(page.getByTestId("pick-queue-table")).toBeHidden();
});

// #142 — a WAREHOUSE's Products screen shows what it has been ASKED to handle.
//
// Before this, a warehouse team opened Products and saw nothing: ProductList is scoped to the team that
// OWNS the products, and a warehouse owns none. The restock request is what creates the arrangement, so
// this places one and then looks at the screen from the warehouse's seat.
test("Products: a warehouse sees the products it was asked to stock (#142)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Ask this warehouse to stock the product — the API, because the restock create form is a different
  // issue's surface and what is under test here is the warehouse's product list.
  await page.evaluate(
    async ([whCode, sku]) => {
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

      // Searched by SKU rather than scanned out of a page: this test runs late in a serial suite, and
      // relying on the wanted product being inside an arbitrary first page is a fuse waiting to blow.
      const products = await call("product.v1.ProductService/ProductDiscover", {
        teamId: "1",
        filter: { q: sku },
        page: { page: 1, limit: 50 },
      });
      const product = (Object.values(products.items?.find((it: any) => it.product)?.product?.mapData ?? {}) as any[]).find((p: any) => p.sku === sku);
      if (!product) {
        throw new Error(
          `product ${sku} not found among ${(Object.values(products.items?.find((it: any) => it.product)?.product?.mapData ?? {}) as any[]).length} results for q=${sku}`,
        );
      }

      // RestockRequestService, not InventoryService — restock requests are their own proto service, and
      // the wrong path is a 404 rather than a helpful error.
      await call("inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: "1",
        warehouseId: warehouse.id,
        items: [{ productId: product.id, sku, name: "e2e", quantity: "1", price: "1000" }],
      });
    },
    [WH_CODE, SKU],
  );

  await switchToWarehouse(page);
  await page.goto("/products");

  // The product the warehouse was asked to stock is on ITS list, even though a selling team owns it.
  await expect(page.getByTestId("products-table")).toContainText(SKU);

  // And the actions that belong to the OWNER are not offered: a warehouse handles these products, it
  // does not own them, so edit/delete would only ever be refused by the server.
  await expect(page.getByTestId(`edit-${SKU}`)).toBeHidden();
  await expect(page.getByTestId(`delete-${SKU}`)).toBeHidden();
  await expect(page.getByTestId("open-create-product")).toBeHidden();
  await expect(page.getByTestId("product-search")).toBeHidden();
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

  // A pending restock for 10, plus two shelves to put them on.
  const seeded = await page.evaluate(
    async ([whCode, sku]) => {
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
        filter: { q: sku },
        page: { page: 1, limit: 50 },
      });
      const product = (Object.values(products.items?.find((it: any) => it.product)?.product?.mapData ?? {}) as any[]).find((p: any) => p.sku === sku);
      if (!product) throw new Error(`product ${sku} not found`);

      for (const code of ["ACC-01", "ACC-02"]) {
        await call("inventory.v1.RackService/RackCreate", { teamId: warehouse.id, code });
      }

      // A supplier owned by the BUYING team (1), never by the warehouse — so naming it on the accept
      // screen is a genuine cross-team read and not an accident of both sides being the same team.
      const supplierName = "Sinar Jaya Textile";
      const supplier = await call("inventory.v1.SupplierService/SupplierCreate", {
        teamId: "1",
        code: "E2E-ACC",
        name: supplierName,
      });

      const created = await call("inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: "1",
        warehouseId: warehouse.id,
        shippingCost: "20000",
        supplierId: supplier.supplier.id,
        items: [
          { productId: product.id, sku, name: "e2e accept", quantity: "10", totalPrice: "100000" },
        ],
      });

      return { requestId: created.request.id, productId: product.id, supplierName };
    },
    [WH_CODE, SKU],
  );

  await switchToWarehouse(page);
  await page.goto(`/inventories/restock/${seeded.requestId}/accept`);

  const line = page.getByTestId(`accept-line-${seeded.productId}`);
  await expect(line).toBeVisible();

  // The vendor is named, not numbered. This is the whole point of SupplierByIds: the supplier belongs
  // to team 1 and we are reading as the WAREHOUSE, which every other supplier read refuses. If this
  // regresses to "Supplier #<id>", the crew at the door is back to matching a carton against a number.
  await expect(page.getByTestId("accept-supplier")).toHaveText(seeded.supplierName);

  // The count is DERIVED now (#206): the line seeds with the ordered 10 on ONE row with no shelf, so
  // Accept is blocked until every quantity has a home — there is no separate "arrived" box to type.
  const firstQty = line.getByTestId(/^accept-placement-qty-/).first();
  await expect(firstQty).toHaveValue("10");
  await expect(page.getByTestId(`accept-unbalanced-${seeded.productId}`)).toBeVisible();
  await expect(page.getByTestId("accept-submit")).toBeDisabled();

  // The disabled button SAYS WHY, beside itself — the header names the line still to place.
  await expect(page.getByTestId("accept-progress")).toContainText("1 line not placed");

  // RackSelect is a Chakra Select, not a native one, so a place is CHOSEN — open the trigger, click
  // the option — rather than set with selectOption(). `getByRole` only sees the open listbox: a
  // closed Select.Content is hidden, and hidden nodes are out of the accessibility tree.
  const pickRack = async (index: number, code: string) => {
    await line.getByTestId("rack-select").nth(index).click();
    await page.getByRole("option", { name: new RegExp(`^${code}\\b`) }).click();
  };

  // 8 are sellable: split 5 on the first shelf, 3 on the second.
  await firstQty.fill("5");
  await pickRack(0, "ACC-01");

  await page.getByTestId(`accept-add-placement-${seeded.productId}`).click();
  await line.getByTestId(/^accept-placement-qty-/).nth(1).fill("3");
  await pickRack(1, "ACC-02");

  // Everything typed now has a shelf — the blocking pill is gone and the progress line with it.
  await expect(page.getByTestId(`accept-unbalanced-${seeded.productId}`)).toBeHidden();
  await expect(page.getByTestId("accept-progress")).toBeHidden();

  // The other 2 never arrived sellable — recorded as a PROBLEM (broken), which never enters stock.
  // The problems section is COLLAPSED until asked for: most deliveries have none.
  await expect(line.getByTestId(/^accept-problem-qty-/)).toHaveCount(0);
  await page.getByTestId(`accept-add-problem-${seeded.productId}`).click();
  await line.getByTestId(/^accept-problem-qty-/).first().fill("2");
  await line.getByTestId(/^accept-problem-note-/).first().fill("crushed in transit");

  // The COD fee changes what everything cost, and the HPP must move as it is typed (#155).
  const hpp = page.getByTestId(`accept-hpp-${seeded.productId}`);
  const before = await hpp.innerText();
  await page.getByTestId("accept-cod-fee").fill("8000");
  await expect(hpp).not.toHaveText(before);

  // ⚠ THE NOTE IS REQUIRED, and without it Accept stays disabled
  // (an-incidental-line-must-say-what-it-was-for). It used to be a PAIR rule — optional for the COD
  // kind because the kind said what the money was, required for OTHER — and collapsing the kinds took
  // away the thing it keyed on: every line is the untyped case now, so the words are the only thing
  // saying what the courier was paid for. This test predates that and typed an amount alone.
  await page.getByTestId("accept-cost-note-0").fill("courier asked at the door");

  await expect(page.getByTestId("accept-submit")).toBeEnabled();
  await page.getByTestId("accept-submit").click();
  await page.getByTestId("confirm-action").click();

  // It lands on the request, now fulfilled, showing BOTH shelves with their quantities (#154).
  await expect(page.getByTestId("restock-detail-page")).toBeVisible();
  await expect(page.getByTestId("restock-detail-page")).toContainText("ACC-01 (5)");
  await expect(page.getByTestId("restock-detail-page")).toContainText("ACC-02 (3)");

  // #207 — once accepted, the warehouse prints the shelf labels for exactly what entered stock.
  await page.getByTestId("restock-detail-labels").click();
  await expect(page.getByTestId("labels-sheet")).toBeVisible();

  // Piece mode by default: 8 sellable units (5 + 3) → 8 labels. The 2 broken got none, and the screen
  // says so out loud.
  await expect(page.getByTestId("labels-sheet").locator(".print-label")).toHaveCount(8);
  await expect(page.getByTestId("labels-excluded")).toContainText("2");

  // One-per-shelf collapses the run to one label per placement — the two shelves, two labels.
  await page.getByTestId("labels-mode").getByText("Shelf").click();
  await expect(page.getByTestId("labels-sheet").locator(".print-label")).toHaveCount(2);

  // #219 — the goods-received receipt for the whole delivery. One product line, and the numbers the
  // acceptance wrote: 10 arrived, 2 broken, 8 accepted into stock, so the delivery total is 8.
  await page.goto(`/inventories/restock/${seeded.requestId}/receipt`);
  await expect(page.getByTestId("batch-receipt-doc")).toBeVisible();
  const receiptLine = page.getByTestId("batch-receipt-lines");
  await expect(receiptLine).toContainText("e2e accept");
  await expect(page.getByTestId("batch-receipt-total-accepted")).toHaveText("8");
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

  // Reached by clicking the product in the warehouse's own list (#142) — which must NOT open the
  // selling team's catalogue page.
  await page.goto("/products");
  await page.getByTestId(`product-row-${SKU}`).click();

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

  // Placements — both shelves it was split across.
  await page.getByTestId("wp-tab-placement").click();
  await expect(page.getByTestId("wp-placement-table")).toContainText("ACC-01");
  await expect(page.getByTestId("wp-placement-table")).toContainText("ACC-02");

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

  // Tab 1 (#160) — a BATCH IS A DELIVERY. The Accept test received 8 of 10 with 2 written off, so
  // this product has exactly one batch and it remembers both numbers.
  await page.getByTestId("wp-tab-batches").click();
  const batches = page.getByTestId("wp-batches-table");
  await expect(batches).toBeVisible();
  await expect(batches.locator("tbody tr")).toHaveCount(1);
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
  await page.getByTestId("order-cancel").click();
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

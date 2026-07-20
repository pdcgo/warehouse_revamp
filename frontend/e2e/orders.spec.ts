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

// Places one order through the form (reusing the setup shop + product) and lands on its detail page.
// Deliberately fills NO address: it is optional (#118), so this also proves the form submits and the
// detail page renders without one.
async function placeOrderViaForm(page: Page, customer: string) {
  await page.goto("/orders/new");
  await expect(page.getByTestId("order-create-page")).toBeVisible();
  await page.getByTestId("order-create-customer-name").fill(customer);
  await page.getByTestId("shop-select").selectOption({ label: `${SHOP_NAME} · Shopee` });
  await page.getByTestId("product-select").locator("input").fill(SKU);
  await page.getByTestId(`product-select-option-${SKU}`).click();
  await page.getByTestId("order-line-qty-0").fill("1");
  await page.getByTestId("order-line-price-0").fill("10000");
  // Which warehouse ships it (#72) — required, so the form cannot submit without it.
  await page.getByTestId("order-warehouse").locator("input").fill(WH_CODE);
  await page.getByTestId(`team-select-option-${WH_CODE}`).click();
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
  // Picking the desa is what carries the kode pos — it arrives without being typed.
  await expect(page.getByTestId("address-kodepos")).toHaveValue(KODE_POS);

  // Shop is a native select; pick ours by its "name · marketplace" label.
  await page.getByTestId("shop-select").selectOption({ label: `${SHOP_NAME} · Shopee` });

  // The first line exists by default: search the catalogue and pick the product.
  await page.getByTestId("product-select").locator("input").fill(SKU);
  await page.getByTestId(`product-select-option-${SKU}`).click();
  await expect(page.getByTestId("order-line-picked-0")).toContainText(SKU);

  await page.getByTestId("order-line-qty-0").fill("3");
  await page.getByTestId("order-line-price-0").fill("10000");

  // 3 × Rp 10.000 = Rp 30.000, mirrored into the subtotal.
  await expect(page.getByTestId("order-line-total-0")).toHaveText("Rp 30.000");
  await expect(page.getByTestId("order-create-subtotal")).toHaveText("Rp 30.000");

  // Shipping adds on top: total = subtotal + shipping.
  await page.getByTestId("order-create-shipping-cost").fill("5000");
  await expect(page.getByTestId("order-create-total")).toHaveText("Rp 35.000");

  // Everything else is filled, but the order still cannot be placed: it has not said WHICH warehouse
  // ships it (#72), and from #69 that is the building the stock actually leaves.
  await expect(page.getByTestId("order-create-save")).toBeDisabled();

  await page.getByTestId("order-warehouse").locator("input").fill(WH_CODE);
  await page.getByTestId(`team-select-option-${WH_CODE}`).click();

  await expect(page.getByTestId("order-create-save")).toBeEnabled();
  await page.getByTestId("order-create-save").click();

  // Success lands on the read-only detail for the new order.
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  await expect(page.getByTestId("order-detail-page")).toContainText(CUSTOMER);
  await expect(page.getByTestId(`order-item-${SKU}`)).toBeVisible();
  await expect(page.getByTestId("order-detail-total")).toContainText("Rp 35.000");

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

test("Lifecycle: confirm then cancel from the detail page (#91)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await placeOrderViaForm(page, `${CUSTOMER} lifecycle`);
  const detail = page.getByTestId("order-detail-page");

  // A fresh order is PLACED and offers both actions.
  await expect(detail).toContainText("Placed");
  await expect(page.getByTestId("order-confirm")).toBeVisible();
  await expect(page.getByTestId("order-cancel")).toBeVisible();

  // Confirm -> CONFIRMED: the confirm action goes away, cancel remains.
  await page.getByTestId("order-confirm").click();
  await expect(detail).toContainText("Confirmed");
  await expect(page.getByTestId("order-confirm")).toBeHidden();
  await expect(page.getByTestId("order-cancel")).toBeVisible();

  // Cancel goes through the confirm dialog (destructive) -> CANCELLED, a terminal state with no actions.
  await page.getByTestId("order-cancel").click();
  await page.getByTestId("confirm-action").click();
  await expect(detail).toContainText("Cancelled");
  await expect(page.getByTestId("order-confirm")).toBeHidden();
  await expect(page.getByTestId("order-cancel")).toBeHidden();
});

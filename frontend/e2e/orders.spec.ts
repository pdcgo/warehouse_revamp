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

test.describe.configure({ mode: "serial" });

test("Orders: the orders screen is reachable and starts empty", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/orders");

  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByTestId("orders-empty")).toBeVisible();
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
  await page.getByTestId("order-create-customer-address").fill("Jl. E2E No. 1");

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

  await expect(page.getByTestId("order-create-save")).toBeEnabled();
  await page.getByTestId("order-create-save").click();

  // Success lands on the read-only detail for the new order.
  await expect(page.getByTestId("order-detail-page")).toBeVisible();
  await expect(page).toHaveURL(/\/orders\/\d+$/);
  await expect(page.getByTestId("order-detail-page")).toContainText(CUSTOMER);
  await expect(page.getByTestId(`order-item-${SKU}`)).toBeVisible();
  await expect(page.getByTestId("order-detail-total")).toContainText("Rp 35.000");

  // And it now shows in the list.
  await page.getByTestId("order-detail-back").click();
  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByTestId("orders-table")).toContainText(CUSTOMER);
});

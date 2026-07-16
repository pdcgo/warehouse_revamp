import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";

// #60 — Create/Edit Product as a PAGE (not a popup), with a required category and up to 5 images.
//
// Images need a real object store to upload (document_service two-phase upload), which the e2e
// environment does not provide — so the gallery bytes are covered by backend unit tests, and this
// spec drives the rest end to end: the create/edit PAGE, the required-category gate, and CRUD.
//
// The Products menu is intentionally hidden on a ROOT team (it is a warehouse/selling surface), but
// root holds ROLE_ROOT so the product RPCs are authorised in the root team. We reach the page by
// its route directly — the menu gate is UX only.

const SUFFIX = Date.now().toString().slice(-6);
const SKU = `P${SUFFIX}`;
const SKU_IMG = `PI${SUFFIX}`;
const SKU_SUB = `PS${SUFFIX}`;
const NAME = `E2E Product ${SUFFIX}`;
const CATEGORY = `E2E Cat ${SUFFIX}`;
const SUBCATEGORY = `E2E Sub ${SUFFIX}`;

// A tiny valid 1×1 PNG — enough to exercise the real upload + thumbnail path.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

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

async function gotoProducts(page: Page) {
  await page.goto("/products");
  await expect(page.getByTestId("products-table")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("setup: create a category products can be filed under", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.getByRole("link", { name: "Categories" }).click();
  await page.getByTestId("open-create-category").click();
  await page.getByTestId("new-category-name").fill(CATEGORY);
  await page.getByTestId("submit-create-category").click();

  // The dialog closes on success — the category now exists in the global taxonomy.
  await expect(page.getByTestId("submit-create-category")).toBeHidden();
});

test("Create: product create is a PAGE; category is required; the product appears", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoProducts(page);

  await page.getByTestId("open-create-product").click();

  // A dedicated page, not a dialog.
  await expect(page.getByTestId("product-edit-page")).toBeVisible();
  await expect(page).toHaveURL(/\/products\/new$/);

  await page.getByTestId("product-edit-sku").fill(SKU);
  await page.getByTestId("product-edit-name").fill(NAME);
  await page.getByTestId("product-edit-description").fill("made by e2e");

  // Category is required — Save stays disabled until one is chosen.
  await expect(page.getByTestId("product-edit-save")).toBeDisabled();

  await page.getByTestId("category-select").click();
  await page.getByTestId(`category-node-${CATEGORY}`).click();

  await expect(page.getByTestId("product-edit-save")).toBeEnabled();
  await page.getByTestId("product-edit-save").click();

  // Saving returns to the list, where the new product shows.
  await expect(page.getByTestId("products-table")).toBeVisible();
  await expect(page.getByTestId(`product-row-${SKU}`)).toBeVisible();
  await expect(page.getByTestId(`product-row-${SKU}`)).toContainText(NAME);
});

test("Create with image: the upload succeeds and the cover shows in the list (#80)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoProducts(page);

  await page.getByTestId("open-create-product").click();
  await expect(page.getByTestId("product-edit-page")).toBeVisible();

  await page.getByTestId("product-edit-sku").fill(SKU_IMG);
  await page.getByTestId("product-edit-name").fill(`${NAME} with image`);
  await page.getByTestId("category-select").click();
  await page.getByTestId(`category-node-${CATEGORY}`).click();

  // Upload a real PNG through the hidden file input — this drives requestUpload → PUT the bytes →
  // confirmUpload → product_images. #80 was that the documents resource_type CHECK rejected the
  // 'product_image' value, so requestUpload failed with "violates check constraint".
  await page.getByTestId("product-images-input").locator('input[type="file"]').setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  });

  // The thumbnail appears only once the upload + confirm resolves.
  await expect(page.getByTestId("product-image-0")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("product-edit-save").click();

  // Back on the list, the product shows its denormalised cover thumbnail.
  await expect(page.getByTestId("products-table")).toBeVisible();
  await expect(page.getByTestId(`product-row-${SKU_IMG}`)).toBeVisible();
  await expect(page.getByTestId(`product-cover-${SKU_IMG}`)).toBeVisible();
});

test("Detail: the product detail page opens from the row (#83)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoProducts(page);

  await page.getByTestId(`open-product-${SKU_IMG}`).click();

  await expect(page.getByTestId("product-detail-page")).toBeVisible();
  await expect(page.getByTestId("product-detail-name")).toHaveText(`${NAME} with image`);
  await expect(page.getByTestId("product-detail-page")).toContainText(SKU_IMG);
  // The category shows as a breadcrumb, and the image uploaded earlier is in the gallery.
  await expect(page.getByTestId("product-detail-page")).toContainText(CATEGORY);
  await expect(page.getByTestId("product-detail-image-0")).toBeVisible();

  await page.getByTestId("product-detail-back").click();
  await expect(page.getByTestId("products-table")).toBeVisible();
});

test("Multistage category: create a subcategory, then drill parent → child to file a product (#63)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Create SUBCATEGORY under CATEGORY — the create dialog's parent picker is this same component.
  await page.getByRole("link", { name: "Categories" }).click();
  await page.getByTestId("open-create-category").click();
  await page.getByTestId("new-category-name").fill(SUBCATEGORY);
  // Open the picker and select the parent (a top-level category) as the parent.
  await page.getByTestId("category-select").click();
  await page.getByTestId(`category-node-${CATEGORY}`).click();
  await page.getByTestId("submit-create-category").click();
  await expect(page.getByTestId("submit-create-category")).toBeHidden();

  // Now file a product under the SUBCATEGORY by DRILLING the Miller columns: open parent → pick child.
  await gotoProducts(page);
  await page.getByTestId("open-create-product").click();
  await page.getByTestId("product-edit-sku").fill(SKU_SUB);
  await page.getByTestId("product-edit-name").fill(`${NAME} sub`);

  await page.getByTestId("category-select").click();
  // Drill into the parent (its chevron), then select the child in the next column.
  await page.getByTestId(`category-drill-${CATEGORY}`).click();
  await page.getByTestId(`category-node-${SUBCATEGORY}`).click();

  // Selecting closes the popover; the trigger now shows the breadcrumb "Parent › Child".
  await expect(page.getByTestId("category-select")).toContainText(`${CATEGORY} › ${SUBCATEGORY}`);
  await expect(page.getByTestId("product-edit-save")).toBeEnabled();

  await page.getByTestId("product-edit-save").click();
  await expect(page.getByTestId(`product-row-${SKU_SUB}`)).toBeVisible();
});

test("Edit: edit is a PAGE, pre-filled; the rename persists", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoProducts(page);

  await page.getByTestId(`edit-${SKU}`).click();

  await expect(page.getByTestId("product-edit-page")).toBeVisible();
  await expect(page).toHaveURL(/\/products\/\d+\/edit$/);

  // ProductDetail pre-fills the form.
  await expect(page.getByTestId("product-edit-name")).toHaveValue(NAME);
  await expect(page.getByTestId("product-edit-sku")).toHaveValue(SKU);

  await page.getByTestId("product-edit-name").fill(`${NAME} renamed`);
  await page.getByTestId("product-edit-save").click();

  await expect(page.getByTestId("products-table")).toBeVisible();
  await expect(page.getByTestId(`product-row-${SKU}`)).toContainText(`${NAME} renamed`);
});

test("Delete: the product is gone", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  await gotoProducts(page);

  await page.getByTestId(`delete-${SKU}`).click();
  await page.getByTestId("confirm-action").click();

  await expect(page.getByTestId(`product-row-${SKU}`)).toBeHidden();
});

// #106 — Discover lists products across ALL teams (SKU_IMG, created above, is not deleted). Root
// reaches the page by route (it's a selling-team menu, but ROLE_ROOT authorises ProductDiscover).
test("Discover: products across teams are listed (#106)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/products/discover");
  await expect(page.getByTestId("discover-table")).toBeVisible();
  await expect(page.getByTestId(`discover-row-${SKU_IMG}`)).toBeVisible();
});

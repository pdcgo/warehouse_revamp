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

// Stock for the order to take (#149). Placing an order now DEDUCTS from its warehouse, and a warehouse
// with nothing in it refuses the order — correctly, and that is the whole point of the feature. So the
// order flow below needs goods on the shelf before it can succeed, exactly as it would in life.
//
// Seeded through the API rather than the Stock screen, and the reason is a real gap worth naming: that
// screen is PRODUCT-DRIVEN (it lists the warehouse's own catalogue and joins stock onto it), so it
// cannot show — or receive — a product belonging to a selling team. Which is precisely this case: the
// order's product belongs to the ordering team while the stock sits in the warehouse. See
// plans/inventory_service/brainstorming.md §4; fixing that screen is its own piece of work, not this
// spec's job to route around.
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

    const teams = await call("team.v1.TeamService/TeamList", { page: { page: 1, limit: 200 } });
    const warehouse = teams.teams.find((t: { teamCode: string }) => t.teamCode === whCode);

    // No `q`: Connect's JSON omits empty arrays, so a search that matches nothing comes back with no
    // `products` key at all — indistinguishable from a broken call. Listing and matching here fails
    // loudly and obviously instead.
    const products = await call("product.v1.ProductService/ProductDiscover", {
      teamId: "1",
      page: { page: 1, limit: 200 },
    });
    const product = (products.products ?? []).find((p: { sku: string }) => p.sku === sku);
    if (!product) {
      throw new Error(`product ${sku} not found among ${(products.products ?? []).length} discovered`);
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

// #151 — the crew's whole job, end to end: find the order in the queue, open it, read WHICH SHELF to
// walk to, and walk it through picking → packed → shipped.
test("Picking: the warehouse works a confirmed order through to shipped (#151)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  // Place and confirm from the SELLING seat — an order only reaches the queue once it is confirmed.
  await placeOrderViaForm(page, `${CUSTOMER} picking`);
  await page.getByTestId("order-confirm").click();
  await expect(page.getByTestId("order-detail-page")).toContainText("Confirmed");

  await switchToWarehouse(page);

  await page.goto("/inventories/picking");

  // The queue opens on To Pick, which is the tab a picker wants: the next job, not a history.
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
  const advance = page.getByTestId("pick-order-advance");

  await expect(advance).toContainText("Start Picking");
  await advance.click();
  await expect(page.getByTestId("pick-order-advance")).toContainText("Mark Packed");

  await page.getByTestId("pick-order-advance").click();
  await expect(page.getByTestId("pick-order-advance")).toContainText("Mark Shipped");

  await page.getByTestId("pick-order-advance").click();

  // SHIPPED is the end of the warehouse's work: the goods have left the building, so there is no next
  // step to offer and the button goes away entirely.
  await expect(page.getByTestId("pick-order-advance")).toBeHidden();
});

// #151 — the queue belongs to a WAREHOUSE. A selling team places orders but has no shelves and nobody
// to walk to them, so the screen says so rather than showing an empty table that looks like a quiet day.
test("Picking: a selling team is told the queue is a warehouse screen (#151)", async ({ page }) => {
  await login(page, ROOT_USERNAME, ROOT_PASSWORD);

  await page.goto("/inventories/picking");

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
      const warehouse = teams.teams.find((t: { teamCode: string }) => t.teamCode === whCode);

      // Searched by SKU rather than scanned out of a page: this test runs late in a serial suite, and
      // relying on the wanted product being inside an arbitrary first page is a fuse waiting to blow.
      const products = await call("product.v1.ProductService/ProductDiscover", {
        teamId: "1",
        q: sku,
        page: { page: 1, limit: 50 },
      });
      const product = (products.products ?? []).find((p: { sku: string }) => p.sku === sku);
      if (!product) {
        throw new Error(
          `product ${sku} not found among ${(products.products ?? []).length} results for q=${sku}`,
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

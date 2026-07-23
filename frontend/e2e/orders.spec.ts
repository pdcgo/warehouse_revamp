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

// #153 — placing an order RECORDS ITS EXPECTED REVENUE, with nothing in between.
//
// This is the payoff test for the whole revenue chain: #74 froze the money onto the order, #75 built
// the record, #78 built the screen, and until #153 nothing connected them — the table stayed empty and
// the report had nothing to show. Placing an order here goes through the real publisher, the real
// event, and the real push handler.
test("Revenue: placing an order records its expected revenue (#153)", async ({ page }) => {
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
      const warehouse = teams.teams.find((t: { teamCode: string }) => t.teamCode === whCode);

      const products = await call("product.v1.ProductService/ProductDiscover", {
        teamId: "1",
        q: sku,
        page: { page: 1, limit: 50 },
      });
      const product = (products.products ?? []).find((p: { sku: string }) => p.sku === sku);
      if (!product) throw new Error(`product ${sku} not found`);

      for (const code of ["ACC-01", "ACC-02"]) {
        await call("inventory.v1.RackService/RackCreate", { teamId: warehouse.id, code });
      }

      const created = await call("inventory.v1.RestockRequestService/RestockRequestCreate", {
        teamId: "1",
        warehouseId: warehouse.id,
        shippingCost: "20000",
        items: [
          { productId: product.id, sku, name: "e2e accept", quantity: "10", totalPrice: "100000" },
        ],
      });

      return { requestId: created.request.id, productId: product.id };
    },
    [WH_CODE, SKU],
  );

  await switchToWarehouse(page);
  await page.goto(`/inventories/restock/${seeded.requestId}/accept`);

  const line = page.getByTestId(`accept-line-${seeded.productId}`);
  await expect(line).toBeVisible();

  // The count is DERIVED now (#206): the line seeds with the ordered 10 on ONE row with no shelf, so
  // Accept is blocked until every quantity has a home — there is no separate "arrived" box to type.
  const firstQty = line.getByTestId(/^accept-placement-qty-/).first();
  await expect(firstQty).toHaveValue("10");
  await expect(page.getByTestId(`accept-unbalanced-${seeded.productId}`)).toBeVisible();
  await expect(page.getByTestId("accept-submit")).toBeDisabled();

  // The disabled button SAYS WHY, beside itself — the header names the line still to place.
  await expect(page.getByTestId("accept-progress")).toContainText("1 line not placed");

  // 8 are sellable: split 5 on the first shelf, 3 on the second.
  await firstQty.fill("5");
  await line.getByTestId("rack-select").first().selectOption({ label: "ACC-01" });

  await page.getByTestId(`accept-add-placement-${seeded.productId}`).click();
  await line.getByTestId(/^accept-placement-qty-/).nth(1).fill("3");
  await line.getByTestId("rack-select").nth(1).selectOption({ label: "ACC-02" });

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
      const warehouse = teams.teams.find((t: { teamCode: string }) => t.teamCode === whCode);

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
  await expect(page.getByTestId("wp-placement-history-table-empty")).toBeVisible();

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
test("Revenue: cancelling an order stops it counting, but the row stays visible (#164)", async ({
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

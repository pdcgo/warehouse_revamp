import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";

// ── warehouse:all wants to pick goods for many orders — bulk pick order's givens of docs/acceptances/inventory/order.md
//
// bulk pick order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks
// for its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are
// the owner's, set by hand — never by this file.
//
// Business rules:
// - docs/business/inventory/order.md, How Warehouse Process The Order › Order Picked Process — the crew walks the racks
//   and takes the goods ("All Goods Taken From Placement"), then checks each parcel on its order's page and sets Picked.
// - docs/technical/frontend/warehouse_order_list_decision.md — the-bulk-pick-list-prototype-is-accepted: Daftar Ambil
//   (Pick List) on the Dikonfirmasi tab's bulk bar opens the ticked orders' pick list; Per Produk (first) gives each
//   product's total and each rack's quantity, Per Pesanan each order's products with the racks ITS take used; no status
//   moves — the orders stay Dikonfirmasi, each parcel is still scanned on its own pick page.
// - docs/business/inventory/context_decision.md — an-order-takes-from-the-lowest-shelf-first: an order's take lowers the
//   shelf holding the FEWEST of the product first, so which racks each order's take drew from is known from the ground.
//
// Run as EVERY warehouse role (warehouse:owner, warehouse:admin, warehouse:staff), each in its own browser session.
//
// The ground (beforeAll, root): one warehouse with three racks (A, B, C); one seller (return warehouse = it) with a shop.
// Per role two products: P restocked 1 onto rack A and 3 onto rack B (its whole stock), Q restocked 2 onto rack C. Per
// role three orders placed by root, in this order, and confirmed by root (each stands processed):
//   (1) P ×2 — the take empties A first (it holds fewest): A ×1, then B ×1
//   (2) P ×1 + Q ×1 — P from B ×1, Q from C ×1
//   (3) P ×1 — B ×1
// So P is shared by all three orders (total 4 = 2 + 1 + 1, on 2 racks: A ×1, B ×3) and Q is in one (total 1, C ×1 — the
// take's units, not the 2 the shelf holds). The orders' refs share a stem per role, so the list's search narrows to them.
//
// The WHEN — the role opens the bulk pick list: Orders › Dikonfirmasi, the three orders ticked (narrowed by their ref),
// the bulk bar's Pick List (Daftar Ambil). (… grouped by product) reads the view it opens on, Per Produk;
// (… grouped by order) switches to Per Pesanan.
//
// How each then is read:
// - `each product shown with total quantity and its racks` — Per Produk is the open view and lists exactly the two
//   products; each row's total is the sum over the ticked orders (P 4, Q 1) and its racks are exactly the racks the
//   takes drew from, each with the units to take there (P: A ×1, B ×3; Q: C ×1), nothing left unrecorded; P is for
//   3 orders, Q for 1.
// - `order stays processed` — no status change is sent while the page is used, every order's own record still says
//   ORDER_STATUS_PROCESSED, and on Orders each still stands on the Dikonfirmasi tab.
// - `each order shown with its products and racks` — Per Pesanan lists exactly the three orders, each by its ref, with
//   exactly its own products and quantities, and each line names exactly the racks its OWN take drew from, each with
//   its units: (1) P ×2 from A ×1 + B ×1; (2) P ×1 from B ×1 and Q ×1 from C ×1; (3) P ×1 from B ×1.
test.describe("warehouse:all wants to pick goods for many orders", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;

  const COND_BY_PRODUCT = "status: processed · multi orders · grouped by product";
  const COND_BY_ORDER = "status: processed · multi orders · grouped by order";

  // What each order holds, and the racks its take draws (lowest shelf first — see the ground above).
  const ON_A = 1; // P on rack A
  const ON_B = 3; // P on rack B
  const ON_C = 2; // Q on rack C
  const UNIT_COST = 10_000;
  const PLATFORM_TOTAL = 100_000;

  const username = (key: string) => `e2eobp${key}${SUFFIX}`;
  // Team codes are at most 10 characters. SUFFIX is ONE per worker, shared by every spec file the worker runs, so each
  // code's prefix must be this file's alone: the YB… ones are.
  const SELLER_CODE = `YBS${SUFFIX}`;
  const WH_CODE = `YBW${SUFFIX}`;
  const skuP = (key: string) => `YBP${SUFFIX}${key.toUpperCase()}`;
  const skuQ = (key: string) => `YBQ${SUFFIX}${key.toUpperCase()}`;
  const RACK_A = `yba-${SUFFIX}`;
  const RACK_B = `ybb-${SUFFIX}`;
  const RACK_C = `ybc-${SUFFIX}`;
  // The marketplace ref. A role's orders share a stem, so the list's search narrows to exactly them.
  const stemOf = (key: string) => `YBO${SUFFIX}${key.toUpperCase()}`;
  const refOf = (key: string, n: number) => `${stemOf(key)}${n}`;

  type Ground = {
    seller: string;
    warehouse: string;
    racks: { a: string; b: string; c: string };
    p: Record<string, string>;
    q: Record<string, string>;
    orders: Record<string, [string, string, string]>;
  };
  const ground: Ground = { seller: "", warehouse: "", racks: { a: "", b: "", c: "" }, p: {}, q: {}, orders: {} };

  // The order's own record, read with the page's signed-in token — its status, as the server keeps it.
  async function statusOf(page: Page, team: string, orderId: string): Promise<string> {
    const res = await api(page, "selling.v1.OrderService/OrderDetail", { teamId: team, orderId });
    return String(res.order?.status ?? "");
  }

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // Watch the page for a status change being sent.
  function countMoves(page: Page) {
    const sent = { n: 0 };
    page.on("request", (req) => {
      if (req.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")) sent.n += 1;
    });
    return sent;
  }

  // Orders › Dikonfirmasi, narrowed to the role's orders by their ref stem.
  async function openConfirmedTab(page: Page, key: string) {
    await page.goto(`/warehouse-orders?step=confirm&q=${stemOf(key)}`);
    await expect(page.getByTestId("pick-tab-confirm")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pick-queue-table")).toBeVisible();
  }

  // THE WHEN — the role's three orders ticked on Dikonfirmasi, the bulk bar's Pick List (Daftar Ambil).
  async function openBulkPick(page: Page, key: string) {
    const ids = ground.orders[key]!;
    await openConfirmedTab(page, key);
    for (const id of ids) await expect(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
    for (const id of ids) await page.getByTestId(`pick-queue-select-${id}`).click();
    await expect(page.getByTestId("pick-queue-bulk-count")).toContainText(`${ids.length} selected`);
    await page.getByTestId("pick-queue-bulk-pick-list").click();
    await expect(page).toHaveURL(/\/warehouse-orders\/bulk-pick\?/);
    await expect(page.getByTestId("bulk-pick-page")).toBeVisible();
    // The page's one address names exactly the ticked orders.
    const asked = (new URL(page.url()).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    expect([...asked].sort()).toEqual([...ids].sort());
  }

  type Rack = { id: string; code: string; quantity: number };

  // A RackLine's racks: exactly these, each with its own quantity, and nothing said unrecorded (the prefix also takes
  // the line's `-unrecorded` mark, so an exact count proves there is none).
  async function expectRacks(page: Page, testId: string, racks: Rack[], what: string) {
    const line = page.getByTestId(testId);
    await expect.soft(line.locator(`[data-testid^='${testId}-']`), `${what}: its racks, no more`).toHaveCount(racks.length);
    await expect.soft(page.getByTestId(`${testId}-unrecorded`), `${what}: nothing unrecorded`).toHaveCount(0);
    for (const rack of racks) {
      const cell = page.getByTestId(`${testId}-${rack.id}`);
      await expect.soft(cell, `${what}: rack ${rack.code}`).toHaveAttribute("data-rack-code", rack.code);
      await expect.soft(cell, `${what}: rack ${rack.code}'s quantity`).toHaveAttribute("data-quantity", String(rack.quantity));
      await expect.soft(cell, `${what}: rack ${rack.code} as read`).toContainText(rack.code);
      await expect.soft(cell, `${what}: rack ${rack.code} as read`).toContainText(`×${rack.quantity}`);
    }
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

    ground.seller = await team(`E2E Obp Seller ${SUFFIX}`, SELLER_CODE, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Obp Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");
    const rack = async (code: string, name: string) =>
      String((await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code, name })).rack.id);
    ground.racks.a = await rack(RACK_A, "E2E obp shelf A");
    ground.racks.b = await rack(RACK_B, "E2E obp shelf B");
    ground.racks.c = await rack(RACK_C, "E2E obp shelf C");
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 10, minFee: 0 });
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
    });

    // A user per warehouse role.
    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.warehouse,
        username: username(r.key),
        password: PASSWORD,
        name: `Obp ${r.given} ${SUFFIX}`,
        role: r.role,
      });
    }

    // The seller's products, per role: P (1 on rack A, 3 on rack B — its whole stock) and Q (2 on rack C).
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Obp Cat ${SUFFIX}` });
    const product = async (sku: string) =>
      String(
        (
          await api(page, "product.v1.ProductService/ProductCreate", {
            teamId: ground.seller,
            productCodePart: sku,
            name: `E2E ${sku}`,
            categoryId: category.category.id,
          })
        ).product.id,
      );
    for (const r of ROLES) {
      ground.p[r.key] = await product(skuP(r.key));
      ground.q[r.key] = await product(skuQ(r.key));
    }

    const supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.seller, name: `E2E Obp Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Obp BCA ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-OBP-${SUFFIX}`,
          openingBalance: 10_000_000,
          openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        })
      ).account.id,
    );
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
      teamId: ground.seller,
      accountId: account,
      operational: true,
    });

    const lines = ROLES.flatMap((r) => [
      {
        productId: ground.p[r.key]!,
        sku: skuP(r.key),
        count: ON_A + ON_B,
        placements: [
          { placementId: ground.racks.a, quantity: ON_A },
          { placementId: ground.racks.b, quantity: ON_B },
        ],
      },
      { productId: ground.q[r.key]!, sku: skuQ(r.key), count: ON_C, placements: [{ placementId: ground.racks.c, quantity: ON_C }] },
    ]);
    const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
      financeAccountId: account,
      items: lines.map((l) => ({
        productId: l.productId,
        productCode: l.sku,
        name: `E2E ${l.sku}`,
        count: l.count,
        total: UNIT_COST * l.count,
        supplierId: supplier,
      })),
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouse,
      requestId: raised.request.id,
      lines: (raised.request.items as { id: string; productId: string }[]).map((item) => {
        const line = lines.find((l) => l.productId === String(item.productId))!;
        return { itemId: item.id, receivedCount: line.count, placements: line.placements };
      }),
    });

    const shop = String(
      (
        await api(page, "selling.v1.ShopService/ShopCreate", {
          teamId: ground.seller,
          name: `E2E Obp Shop ${SUFFIX}`,
          shopCode: `YBH${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );

    // GIVEN — per role, three orders placed by root in this order (the takes draw as the ground says), then confirmed by
    // root: each stands processed.
    const placed: string[] = [];
    for (const r of ROLES) {
      const P = { productId: ground.p[r.key]!, productCode: skuP(r.key), name: `E2E ${skuP(r.key)}` };
      const Q = { productId: ground.q[r.key]!, productCode: skuQ(r.key), name: `E2E ${skuQ(r.key)}` };
      const items = [[{ ...P, quantity: 2 }], [{ ...P, quantity: 1 }, { ...Q, quantity: 1 }], [{ ...P, quantity: 1 }]];
      const ids: string[] = [];
      for (const [i, orderItems] of items.entries()) {
        const made = await api(page, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-obp-${SUFFIX}-${r.key}-${i + 1}`,
          shipmentChannelId: "1",
          teamId: ground.seller,
          shopId: shop,
          warehouseId: ground.warehouse,
          customerName: `E2E Obp Buyer ${r.key} ${i + 1}`,
          platformTotal: PLATFORM_TOTAL,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: refOf(r.key, i + 1),
          items: orderItems,
        });
        ids.push(String(made.order.id));
      }
      ground.orders[r.key] = ids as [string, string, string];
      placed.push(...ids);
    }
    const confirmed = await api(page, "selling.v1.OrderService/OrderStatusChange", {
      teamId: ground.warehouse,
      orderIds: placed,
      to: "ORDER_STATUS_PROCESSED",
    });
    for (const x of confirmed.results as { orderId: string; moved?: boolean; refusedReason?: string }[]) {
      if (!x.moved) throw new Error(`confirm #${x.orderId}: ${x.refusedReason}`);
    }

    await page.close();
  });

  for (const r of ROLES) {
    test(`${r.given} bulk pick order (${COND_BY_PRODUCT})`, async ({ page }) => {
      await signIn(page, username(r.key), ground.warehouse);
      const ids = ground.orders[r.key]!;
      const p = ground.p[r.key]!;
      const q = ground.q[r.key]!;
      for (const id of ids) expect(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_PROCESSED");
      const sent = countMoves(page);

      // WHEN — Orders › Dikonfirmasi, the three orders ticked, Pick List: it opens on Per Produk.
      await openBulkPick(page, r.key);

      await test.step("then: each product shown with total quantity and its racks", async () => {
        await expect.soft(page.getByTestId("bulk-pick-view-product")).toHaveAttribute("aria-selected", "true");
        const list = page.getByTestId("bulk-pick-by-product");
        await expect(list).toBeVisible();
        await expect.soft(list.locator("[data-total]"), "one row per product, no more").toHaveCount(2);

        const rowP = page.getByTestId(`bulk-pick-product-${p}`);
        await expect.soft(rowP).toContainText(`E2E ${skuP(r.key)}`);
        await expect.soft(rowP, "P's total: 2 + 1 + 1").toHaveAttribute("data-total", "4");
        await expect.soft(page.getByTestId(`bulk-pick-product-total-${p}`)).toHaveText("4");
        await expectRacks(
          page,
          `bulk-pick-product-rack-${p}`,
          [
            { id: ground.racks.a, code: RACK_A, quantity: ON_A },
            { id: ground.racks.b, code: RACK_B, quantity: ON_B },
          ],
          "P",
        );
        await expect.soft(page.getByTestId(`bulk-pick-product-orders-${p}`)).toContainText("3 orders");

        const rowQ = page.getByTestId(`bulk-pick-product-${q}`);
        await expect.soft(rowQ).toContainText(`E2E ${skuQ(r.key)}`);
        await expect.soft(rowQ, "Q's total: one order's 1").toHaveAttribute("data-total", "1");
        await expect.soft(page.getByTestId(`bulk-pick-product-total-${q}`)).toHaveText("1");
        await expectRacks(page, `bulk-pick-product-rack-${q}`, [{ id: ground.racks.c, code: RACK_C, quantity: 1 }], "Q");
        await expect.soft(page.getByTestId(`bulk-pick-product-orders-${q}`)).toContainText("1 order");
      });

      await test.step("then: order stays processed", async () => {
        await expect.soft(page.getByTestId("bulk-pick-stays-note")).toBeVisible();
        expect.soft(sent.n, "no status change sent").toBe(0);
        for (const id of ids) expect.soft(await statusOf(page, ground.warehouse, id), `#${id}`).toBe("ORDER_STATUS_PROCESSED");
        await openConfirmedTab(page, r.key);
        for (const id of ids) await expect.soft(page.getByTestId(`pick-queue-row-${id}`), `#${id} on Dikonfirmasi`).toBeVisible();
        expect.soft(sent.n, "no status change sent").toBe(0);
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} bulk pick order (${COND_BY_ORDER})`, async ({ page }) => {
      await signIn(page, username(r.key), ground.warehouse);
      const [one, two, three] = ground.orders[r.key]!;
      const p = ground.p[r.key]!;
      const q = ground.q[r.key]!;
      const A = { id: ground.racks.a, code: RACK_A };
      const B = { id: ground.racks.b, code: RACK_B };
      const C = { id: ground.racks.c, code: RACK_C };

      // WHEN — Orders › Dikonfirmasi, the three orders ticked, Pick List, then Per Pesanan.
      await openBulkPick(page, r.key);
      await page.getByTestId("bulk-pick-view-order").click();
      await expect(page.getByTestId("bulk-pick-view-order")).toHaveAttribute("aria-selected", "true");

      await test.step("then: each order shown with its products and racks", async () => {
        const list = page.getByTestId("bulk-pick-by-order");
        await expect(list).toBeVisible();
        await expect.soft(list.locator(":scope > [data-testid^='bulk-pick-order-']"), "one block per order, no more").toHaveCount(3);

        // Each order: its ref, exactly its own products with their quantities, and each line's racks — its OWN take's.
        const expected = [
          { id: one, n: 1, lines: [{ product: p, quantity: 2, racks: [{ ...A, quantity: 1 }, { ...B, quantity: 1 }] }] },
          {
            id: two,
            n: 2,
            lines: [
              { product: p, quantity: 1, racks: [{ ...B, quantity: 1 }] },
              { product: q, quantity: 1, racks: [{ ...C, quantity: 1 }] },
            ],
          },
          { id: three, n: 3, lines: [{ product: p, quantity: 1, racks: [{ ...B, quantity: 1 }] }] },
        ];
        for (const order of expected) {
          const block = page.getByTestId(`bulk-pick-order-${order.id}`);
          await expect.soft(block, `#${order.id} shown`).toBeVisible();
          await expect.soft(block, `#${order.id} by its ref`).toContainText(refOf(r.key, order.n));
          await expect
            .soft(block.locator(`[data-testid^='bulk-pick-order-line-${order.id}-']`), `#${order.id}: its products, no more`)
            .toHaveCount(order.lines.length);
          for (const line of order.lines) {
            const row = page.getByTestId(`bulk-pick-order-line-${order.id}-${line.product}`);
            const sku = line.product === p ? skuP(r.key) : skuQ(r.key);
            await expect.soft(row, `#${order.id}: ${sku}`).toContainText(sku);
            await expect.soft(row, `#${order.id}: ${sku}'s quantity`).toHaveAttribute("data-quantity", String(line.quantity));
            await expectRacks(page, `bulk-pick-order-rack-${order.id}-${line.product}`, line.racks, `#${order.id} ${sku}`);
          }
        }
      });
    });
  }
});

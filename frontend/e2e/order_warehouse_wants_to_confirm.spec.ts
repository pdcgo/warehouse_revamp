import { expect, test } from "@playwright/test";
import type { Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api } from "./restock_helpers";
import { expectMoveCounted, expectMovesOffered } from "./order_moves_metric";

// ── warehouse:all wants to confirm an order — confirm order's givens of docs/acceptances/inventory/order.md ──────────
//
// confirm order's regression spec. An acceptance has no test file of its own (docs/acceptances/guide.md): the checks for
// its thens live here, one test.describe per given + when, one test.step("then: …") per then. The rows' statuses are
// the owner's, set by hand — never by this file.
//
// Business rules:
// - docs/business/inventory/order.md, How Warehouse Process The Order — the warehouse's first step: staff open the web,
//   print the receipt and set the order Processed; picking starts from a processed order.
// - docs/business/order/context_decision.md — pending → processed is the WAREHOUSE's move ("the warehouse confirms, the
//   label printed"); one OrderStatusChange carries a whole list (one-status-change-for-every-plain-move), each order with
//   its own result; every move is written to the order's timeline with who made it.
// - the warehouse's tabs are its steps (the-warehouse-tabs-are-the-processed-steps): To Confirm is pending, Dikonfirmasi
//   (Confirmed) is processed; Set Picked is the pick page's item scan (the-item-scans-live-on-the-page).
//
// Run as EVERY warehouse role (warehouse:owner, warehouse:admin, warehouse:staff), each in its own browser session.
//
// The ground (beforeAll, root): one warehouse (10% fee) with a rack; one seller (its return warehouse = that warehouse)
// with a shop and a product restocked onto the rack; per role THREE orders placed by root on that shop, 2 units each,
// left pending — one for the 1-order given, two for the multi-orders given. A selling:owner of the seller reads the
// selling team's side.
//
// The WHEN:
//   (status: pending · 1 order)     — the role opens the order from the To Confirm tab of Orders and presses Confirm
//                                    Order on its page (the business flow: open the web, set Processed).
//   (status: pending · multi orders) — the role ticks its two orders on To Confirm and moves them with the bulk bar's
//                                    Change Step › Confirmed — ONE OrderStatusChange for both.
//
// How each then is read:
// - `status changed from pending to processed` — the order's page now reads Processed (the status badge) and the order's
//   own record says ORDER_STATUS_PROCESSED; on Orders it has left To Confirm and stands on the Confirmed tab.
// - `confirm recorded in order timeline` — the warehouse's order detail › Timeline: a Processed step, by the role's user.
// - `selling team sees order processed` — the seller (selling:owner) opens the order: its stepper stands on processed and
//   its timeline shows the Processed step.
// - `package can be validated` — before the confirm the pick page offered no item scan; after it, the scan is there,
//   every line scans exact, Set Picked presses and the order is picked (the file's when "validate package order", which
//   was "pick order" when this check was first written as `order can be picked`).
// - `confirm recorded in analytic metric` — Analytic › Order › Order status moves (`metrics/orders/moves`, #84) counts a
//   confirm as a Confirmed, pending → processed (the-order-metric-ids-name-what-moved). Its own test per role, last in
//   the file — EVERY warehouse role on a shop of its own with TWO pending orders of which the role confirms ONE, read as
//   that role (a warehouse reads every count of the orders it ships): Add Metric › Order offers Order status moves, and
//   Analytic by shop over the last 7 days, filtered to that shop, reads `created_count` 2 (the fold landed) and
//   `confirmed_count` exactly 1 — the untouched order, still pending, adds nothing (order_moves_metric.ts).
// - multi orders: the same three, for EACH of the two orders; the bulk move's one answer moved both.
test.describe("warehouse:all wants to confirm an order", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "warehouse:owner", role: "ROLE_WAREHOUSE_OWNER", key: "own" },
    { given: "warehouse:admin", role: "ROLE_WAREHOUSE_ADMIN", key: "adm" },
    { given: "warehouse:staff", role: "ROLE_WAREHOUSE_STAFF", key: "stf" },
  ] as const;
  type Role = (typeof ROLES)[number];

  const ONE_COND = "status: pending · 1 order";
  const MULTI_COND = "status: pending · multi orders";

  const QTY = 2;
  const ORDERS_PER_ROLE = 3;
  // The metric check's own shop per role: two pending orders, ONE of them confirmed by that role.
  const METRIC_ORDERS = 2;
  const STOCK = ROLES.length * (ORDERS_PER_ROLE + METRIC_ORDERS) * QTY + 4;
  const UNIT_COST = 10_000;
  const PLATFORM_TOTAL = 100_000;

  const username = (key: string) => `e2eocf${key}${SUFFIX}`;
  const SELLER_OWNER = username("sel");
  // Team codes are at most 10 characters.
  const SELLER_CODE = `CS${SUFFIX}`;
  const WH_CODE = `CW${SUFFIX}`;
  const SKU = `CFP${SUFFIX}`;

  const ground = {
    seller: "",
    warehouse: "",
    product: "",
    shop: "",
    // Per role: [the 1-order given's order, the multi-orders given's two].
    orders: {} as Record<string, string[]>,
    // Per role, the metric check's shop and its two orders: [the one confirmed, the one left pending].
    metricShops: {} as Record<string, string>,
    metricOrders: {} as Record<string, string[]>,
  };

  // The order's own record, read with the page's signed-in token — its status, as the server keeps it.
  async function statusOf(page: Page, team: string, orderId: string): Promise<string> {
    const res = await api(page, "selling.v1.OrderService/OrderDetail", { teamId: team, orderId });
    return String(res.order?.status ?? "");
  }

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);

    ground.seller = await team(`E2E Ocf Seller ${SUFFIX}`, SELLER_CODE, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Ocf Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");
    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: ground.warehouse, code: `ocf-${SUFFIX}`, name: "E2E ocf shelf" }))
        .rack.id,
    );
    await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: ground.warehouse, feePercent: 10, minFee: 0 });
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
    });

    // A user per warehouse role, and the seller's owner who reads the selling team's side.
    for (const r of ROLES) {
      await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.warehouse,
        username: username(r.key),
        password: PASSWORD,
        name: `Ocf ${r.given} ${SUFFIX}`,
        role: r.role,
      });
    }
    const sellerOwner = String(
      (
        await api(page, "user.v1.UserService/CreateUser", {
          teamId: ground.seller,
          username: SELLER_OWNER,
          password: PASSWORD,
          name: `Ocf selling:owner ${SUFFIX}`,
          role: "ROLE_SELLING_OWNER",
        })
      ).user.id,
    );

    // The seller's product, restocked from its supplier and accepted onto the warehouse's rack.
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Ocf Cat ${SUFFIX}` });
    ground.product = String(
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.seller,
          productCodePart: SKU,
          name: `E2E ${SKU}`,
          categoryId: category.category.id,
        })
      ).product.id,
    );
    const supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.seller, name: `E2E Ocf Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: ground.seller,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E Ocf BCA ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `87${SUFFIX}01`,
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
    const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: ground.seller,
      warehouseId: ground.warehouse,
      financeAccountId: account,
      items: [{ productId: ground.product, productCode: SKU, name: `E2E ${SKU}`, count: STOCK, total: UNIT_COST * STOCK, supplierId: supplier }],
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: ground.warehouse,
      requestId: raised.request.id,
      lines: (raised.request.items as { id: string }[]).map((item) => ({
        itemId: item.id,
        receivedCount: STOCK,
        placements: [{ placementId: rack, quantity: STOCK }],
      })),
    });

    // The seller's shop, its owner on it.
    ground.shop = String(
      (
        await api(page, "selling.v1.ShopService/ShopCreate", {
          teamId: ground.seller,
          name: `E2E Ocf Shop ${SUFFIX}`,
          shopCode: `CF${SUFFIX}`,
          marketplace: "MARKETPLACE_SHOPEE",
        })
      ).shop.id,
    );
    await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.seller, shopId: ground.shop, userId: sellerOwner });

    // GIVEN — per role, three pending orders on the warehouse, placed by root.
    for (const r of ROLES) {
      ground.orders[r.key] = [];
      for (let n = 1; n <= ORDERS_PER_ROLE; n += 1) {
        const orderRef = `OCF${SUFFIX}${r.key.toUpperCase()}${n}`;
        const made = await api(page, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-ocf-${SUFFIX}-${r.key}-${n}`,
          shipmentChannelId: "1",
          teamId: ground.seller,
          shopId: ground.shop,
          warehouseId: ground.warehouse,
          customerName: `E2E Ocf Buyer ${r.key} ${n}`,
          platformTotal: PLATFORM_TOTAL,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: orderRef,
          items: [{ productId: ground.product, productCode: SKU, name: `E2E ${SKU}`, quantity: QTY }],
        });
        ground.orders[r.key]!.push(String(made.order.id));
      }
    }

    // GIVEN — per role, the metric check's own shop (so no other test's confirm counts on it) and its two pending orders.
    for (const r of ROLES) {
      const metricShop = String(
        (
          await api(page, "selling.v1.ShopService/ShopCreate", {
            teamId: ground.seller,
            name: `E2E Ocf Metric Shop ${r.key} ${SUFFIX}`,
            shopCode: `CFM${r.key.toUpperCase()}${SUFFIX}`,
            marketplace: "MARKETPLACE_SHOPEE",
          })
        ).shop.id,
      );
      ground.metricShops[r.key] = metricShop;
      ground.metricOrders[r.key] = [];
      for (let n = 1; n <= METRIC_ORDERS; n += 1) {
        const made = await api(page, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-ocf-${SUFFIX}-met-${r.key}-${n}`,
          shipmentChannelId: "1",
          teamId: ground.seller,
          shopId: metricShop,
          warehouseId: ground.warehouse,
          customerName: `E2E Ocf Buyer met ${r.key} ${n}`,
          platformTotal: PLATFORM_TOTAL,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: `OCF${SUFFIX}MET${r.key.toUpperCase()}${n}`,
          items: [{ productId: ground.product, productCode: SKU, name: `E2E ${SKU}`, quantity: QTY }],
        });
        ground.metricOrders[r.key]!.push(String(made.order.id));
      }
    }

    await page.close();
  });

  // On Orders: the order has left To Confirm and stands on the Confirmed tab.
  async function expectOnConfirmedTab(page: Page, orderIds: string[]) {
    await page.goto("/warehouse-orders");
    await expect(page.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("pick-queue-table")).toBeVisible();
    for (const id of orderIds) await expect.soft(page.getByTestId(`pick-queue-row-${id}`)).toHaveCount(0);
    await page.getByTestId("pick-tab-confirm").click();
    await expect(page.getByTestId("pick-tab-confirm")).toHaveAttribute("aria-selected", "true");
    for (const id of orderIds) await expect.soft(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
  }

  // The warehouse's order detail › Timeline: a Processed step, by the role's user.
  async function expectConfirmInTimeline(page: Page, r: Role, orderId: string) {
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByTestId("order-detail-page")).toBeVisible();
    await page.getByTestId("order-detail-tab-timeline").click();
    await expect(page.getByTestId("order-detail-timeline")).toBeVisible();
    await expect.soft(page.getByTestId("order-timeline-processed")).toHaveCount(1);
    await expect.soft(page.getByTestId("order-timeline-processed-by")).toContainText(username(r.key));
  }

  // The seller (selling:owner) opens the order: its stepper stands on processed, its timeline shows the Processed step.
  async function expectSellerSeesProcessed(seller: Page, orderId: string) {
    await seller.goto(`/orders/${orderId}`);
    await expect(seller.getByTestId("order-detail-page")).toBeVisible();
    await expect.soft(seller.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "processed");
    await expect.soft(seller.getByTestId("section-timeline").getByTestId("order-timeline-processed")).toBeVisible();
  }

  for (const r of ROLES) {
    test(`${r.given} confirm order (${ONE_COND})`, async ({ page, browser }) => {
      await signIn(page, username(r.key), ground.warehouse);
      const orderId = ground.orders[r.key]![0]!;
      expect(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PENDING");

      // WHEN — the order opened from To Confirm, and Confirm Order pressed on its page.
      await page.goto("/warehouse-orders");
      await expect(page.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
      await page.getByTestId(`pick-queue-row-${orderId}`).locator("td").nth(1).click();
      await expect(page).toHaveURL(new RegExp(`/warehouse-orders/${orderId}$`));
      await expect(page.getByTestId("pick-list-table")).toContainText(SKU);
      await expect(page.getByTestId("order-status-1")).toBeVisible();
      // Pending: nothing to scan yet — the scan is a processed order's.
      const scanBefore = await page.getByTestId("pick-scan-input").count();
      const advance = page.getByTestId("pick-order-advance");
      await expect(advance).toContainText("Confirm Order");
      const [answer] = await Promise.all([
        page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
        advance.click(),
      ]);

      await test.step("then: status changed from pending to processed", async () => {
        expect.soft(answer.status()).toBe(200);
        await expect.soft(page.getByTestId("order-status-2")).toBeVisible();
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PROCESSED");
        await expectOnConfirmedTab(page, [orderId]);
      });

      await test.step("then: confirm recorded in order timeline", async () => {
        await expectConfirmInTimeline(page, r, orderId);
      });

      await test.step("then: selling team sees order processed", async () => {
        const seller = await browser.newPage();
        await signIn(seller, SELLER_OWNER, ground.seller);
        await expectSellerSeesProcessed(seller, orderId);
        await seller.close();
      });

      await test.step("then: package can be validated", async () => {
        expect.soft(scanBefore).toBe(0);
        await page.goto(`/warehouse-orders/${orderId}`);
        const scan = page.getByTestId("pick-scan-input");
        await expect(scan).toBeVisible();
        const lines = page.locator("[data-testid^='pick-scan-line-']");
        await expect(lines).toHaveCount(1);
        const line = lines.first();
        await expect.soft(line).toHaveAttribute("data-code", SKU);
        await expect.soft(line).toHaveAttribute("data-quantity", String(QTY));
        for (let n = 0; n < QTY; n += 1) {
          await scan.fill(SKU);
          await scan.press("Enter");
        }
        await expect(line).toHaveAttribute("data-exact", "true");
        await page.getByTestId("pick-order-set-picked").click();
        await expect.soft(page.getByTestId("pick-order-advance")).toContainText("Mark Handed Over");
        await expect.soft(page.getByTestId("order-status-5")).toBeVisible();
        expect.soft(await statusOf(page, ground.warehouse, orderId)).toBe("ORDER_STATUS_PICKED");
      });
    });
  }

  for (const r of ROLES) {
    test(`${r.given} confirm order (${MULTI_COND})`, async ({ page, browser }) => {
      await signIn(page, username(r.key), ground.warehouse);
      const orderIds = ground.orders[r.key]!.slice(1);
      expect(orderIds).toHaveLength(2);
      for (const id of orderIds) expect(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_PENDING");

      // WHEN — both ticked on To Confirm and moved with the bulk bar's Change Step › Confirmed.
      await page.goto("/warehouse-orders");
      await expect(page.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
      for (const id of orderIds) {
        await expect(page.getByTestId(`pick-queue-row-${id}`)).toBeVisible();
        await page.getByTestId(`pick-queue-select-${id}`).click();
      }
      await expect(page.getByTestId("pick-queue-bulk-count")).toContainText("2");
      await page.getByTestId("pick-queue-bulk-move").click();
      const [answer] = await Promise.all([
        page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
        page.getByTestId("pick-queue-bulk-move-confirm").click(),
      ]);

      await test.step("then: status of every order changed from pending to processed", async () => {
        expect.soft(answer.status()).toBe(200);
        const results = ((await (answer as Response).json()) as { results: { orderId: string; moved?: boolean; status?: string }[] })
          .results;
        // ONE call carried both, and each came back moved.
        expect.soft(results.map((x) => x.orderId).sort()).toEqual([...orderIds].sort());
        for (const x of results) {
          expect.soft(x.moved).toBe(true);
          expect.soft(x.status).toBe("ORDER_STATUS_PROCESSED");
        }
        for (const id of orderIds) expect.soft(await statusOf(page, ground.warehouse, id)).toBe("ORDER_STATUS_PROCESSED");
        await expectOnConfirmedTab(page, orderIds);
      });

      await test.step("then: confirm recorded in each order timeline", async () => {
        for (const id of orderIds) await expectConfirmInTimeline(page, r, id);
      });

      await test.step("then: selling team sees every order processed", async () => {
        const seller = await browser.newPage();
        await signIn(seller, SELLER_OWNER, ground.seller);
        for (const id of orderIds) await expectSellerSeesProcessed(seller, id);
        await seller.close();
      });
    });
  }

  // Its own test per role, LAST in the file: each moves one order of the role's own shop (see the head of this file).
  for (const r of ROLES) {
    test(`${r.given} confirm order (${ONE_COND}): confirm recorded in analytic metric`, async ({ page }) => {
      await signIn(page, username(r.key), ground.warehouse);
      const [orderId, left] = ground.metricOrders[r.key]!;
      const shop = ground.metricShops[r.key]!;
      expect(await statusOf(page, ground.warehouse, orderId!)).toBe("ORDER_STATUS_PENDING");

      // WHEN — Confirm Order pressed on the order's page; the shop's other order stays pending.
      await page.goto(`/warehouse-orders/${orderId}`);
      const advance = page.getByTestId("pick-order-advance");
      await expect(advance).toContainText("Confirm Order");
      const [answer] = await Promise.all([
        page.waitForResponse((res) => res.url().endsWith("/warehouse.selling.v1.OrderService/OrderStatusChange")),
        advance.click(),
      ]);
      expect(answer.status()).toBe(200);
      expect(await statusOf(page, ground.warehouse, orderId!)).toBe("ORDER_STATUS_PROCESSED");
      expect(await statusOf(page, ground.warehouse, left!)).toBe("ORDER_STATUS_PENDING");

      await test.step("then: confirm recorded in analytic metric", async () => {
        // Order status moves is offered under Order, and the shop's Confirmed reads the ONE confirm.
        await expectMovesOffered(page);
        await expectMoveCounted(page, shop, "confirmed_count");
      });
    });
  }
});

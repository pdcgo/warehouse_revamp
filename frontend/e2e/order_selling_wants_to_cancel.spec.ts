import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME, ROOT_USER_ID } from "./global-setup";
import { SUFFIX, login, api, readyAt } from "./restock_helpers";
import { API_URL } from "./env";

// ── selling:all wants to cancel an order — the checks behind docs/acceptances/inventory/order.md ────────────────────
//
// An acceptance has no test file of its own (docs/acceptances/guide.md#acceptances-are-markdown): its checks live in the
// regression spec of the feature its WHEN belongs to — cancel order. orders.spec.ts is one serial chain of 2.000 lines,
// so the acceptance block is its own file beside it, as create order's is (order_selling_wants_to_create.spec.ts). The
// rows' statuses are the owner's, set by hand on the owner's instruction — never by this file.
//
// One test per GIVEN, run as EVERY selling role (selling:owner, selling:admin, selling:cs — `selling:all`), through the
// seller's own order page: Cancel Order and its confirm. Each THEN is its own step, named exactly as its row, and checked
// SOFTLY so one failing then does not hide the next. Every role and case cancels its OWN order on its OWN product (10
// units restocked from the ONE supplier, accepted onto the ONE rack at Rp 10.000 a unit) through its OWN shop, so a
// figure read in one test is never moved by another. The ground — the orders included — is seeded in beforeAll, so the
// placement's figures (fee, sale, supplier) have landed before a cancel takes them back, and a worker restarted after a
// failure seeds its own instead of reading a moved SUFFIX.
//
// The order in the GIVEN — 2 units, the marketplace paid Rp 100.000, the warehouse charges 10% of the goods:
//   goods Rp 20.000 · warehouse fee Rp 2.000 · total Rp 22.000 (cross product: Rp 24.000 goods, fee Rp 2.400).
// Each test first reads the GIVEN where a then says it moves (Ready 8, the rack's 8, the fee entry, the sale, 2 sold).
//
// How each then is read:
// - `status changed from pending to cancelled` — the order's own page: the stepper reads cancel (it read pending), the
//   header says Cancelled, and Cancel Order is gone (a cancelled order is an end).
// - `cancel recorded in order timeline` — the order's Timeline: ONE cancel row, naming the role that cancelled.
// - `ready stock of 1 product increases at 1 warehouse` — the seller's Ready at the warehouse, on its product picker:
//   8 → 10 (inventory releases the take on OrderCancelled, inventory-returns-stock-on-order-cancelled — so polled).
// - `stock on 1 rack increases` — the warehouse (warehouse:staff), the rack's page: the product's on-hand 8 → 10.
// - `recorded in product history` — the selling team's product page, Stock history: a +2 row beside the order's −2.
// - `warehouse sees order cancelled` — the warehouse's orders screen narrowed by the Order ID: All lists it as
//   Cancelled, To Confirm no longer does.
// - `warehouse fee reversed in liability` — the seller's ledger with the warehouse: the order's "Order fee" entry and
//   its Reversal, both Rp 2.000 (the-order-fee-posts-at-creation-and-reverses-on-cancel). selling:cs is not served
//   liability, so its order's entries are read as selling:owner (a then observed by any one role that can read it).
// - `sale cancelled in order settlement` — the order's Settlement (it read Rp 100.000 sold): the sale's "Estimate" row
//   stays and an "Estimate cancelled" row stands beside it, and the panel no longer reads Rp 100.000
//   (a-cancel-is-an-opposite-row, cancel-zeroes-the-live-sale). ⚠ With the live sale at 0 the panel shows its
//   no-estimate notice ("No marketplace selling price was recorded") — reported, not pinned.
// - `cancel recorded in analytic metric` — Analytic › Orders cancelled, last 7 days, by shop, the role's shop: 1.
// - `cancel recorded at 1 supplier` — the supplier's Statistics by product, the product's row: 2 sold → 0.
// (cross product) — the product is ANOTHER selling team's (the cross team, 20% cross markup), restocked by that team from
// its ONE supplier onto the same rack, its return map standing:
// - `cross team's ready stock increases` — the cross team's own Ready at the warehouse (selling:owner there): 8 → 10.
// - `product fee reversed in liability to cross team` — the seller's ledger with the cross team: the order's
//   "Product fee" entry and its Reversal, both Rp 24.000 (a-cancel-refunds-the-warehouse-fee-in-full: both fees).
// (status: processed) — the warehouse confirmed it (no-cancel-after-the-warehouse-confirms):
// - `cannot cancel order` — the order's page offers no Cancel Order, and the same OrderCancel sent anyway with the role's
//   token answers failed_precondition; the order stays processed.
// (opname running on its rack) — the order was placed, then the warehouse admin started a count of its rack, in a
// warehouse of its own (one count at a time per warehouse; a rack plan locks its products) —
// a-cancel-still-meets-the-count-first, a-lock-stops-sales-and-cancels-too:
// - `cancel refused` — Cancel Order and its confirm answer with an error, and the order stays pending.
// - `message names opname, who started it and when` — that error names the count (#id), the person who started it (by
//   name — an-abandoned-count-waits-for-the-admin: "started by Ani, Fri 17:00", so somebody knows whom to ask) and the
//   time (backlog #90: *count #12, started by Ani at 2026-11-13 17:00 WIB*, the name read even when the refusal comes
//   back through the cancel's service-to-service lock check). Its own test, LAST in the file: every role's refusal is
//   the same server text, so one test reads it for all three.
test.describe("selling:all wants to cancel an order", () => {
  test.describe.configure({ timeout: 180_000 });

  const PASSWORD = "e2e-acceptance-pass-1";
  const ROLES = [
    { given: "selling:owner", role: "ROLE_SELLING_OWNER", key: "own" },
    { given: "selling:admin", role: "ROLE_SELLING_ADMIN", key: "adm" },
    { given: "selling:cs", role: "ROLE_SELLING_CS", key: "cs" },
  ] as const;
  const CASES = {
    pending: { cond: "status: pending · 1 product · own product · 1 warehouse · 1 rack · 1 supplier", key: "po" },
    cross: { cond: "status: pending · 1 product · cross product · 1 warehouse · 1 rack · 1 supplier", key: "px" },
    processed: { cond: "status: processed · 1 product · own product · 1 warehouse", key: "pr" },
    counted: { cond: "status: pending · 1 product · own product · 1 warehouse · opname running on its rack", key: "op" },
  } as const;
  type Role = (typeof ROLES)[number];
  type Case = (typeof CASES)[keyof typeof CASES];
  const ALL: Case[] = [CASES.pending, CASES.cross, CASES.processed, CASES.counted];

  const STOCK = 10;
  const RESTOCK_TOTAL = 100_000; // Rp 10.000 a unit
  const QTY = 2;
  const FEE_PERCENT = 10;
  const PLATFORM_TOTAL = 100_000;
  const CROSS_MARKUP_BPS = 2_000; // 20% — a borrowed unit costs the seller Rp 12.000

  const username = (role: string) => `e2eok${role}${SUFFIX}`;
  const displayName = (given: string) => `Okc ${given} ${SUFFIX}`;
  const WH_USER = `e2eokwh${SUFFIX}`;
  const CROSS_USER = `e2eokxo${SUFFIX}`; // selling:owner of the cross team
  const COUNT_USER = `e2eokca${SUFFIX}`; // warehouse:admin of the counted warehouse — starts the count
  const COUNT_NAME = `Okc Counter Ani ${SUFFIX}`;
  const WH_CODE = `OKW${SUFFIX}`;
  const at = (r: Role, c: Case) => `${r.key}-${c.key}`;
  const sku = (r: Role, c: Case) => `OK${r.key.toUpperCase()}${c.key.toUpperCase()}${SUFFIX}`;
  // The marketplace's Order ID, unique per role and case — what the warehouse narrows its screen by.
  const ref = (r: Role, c: Case) => `OK${SUFFIX}${r.key.toUpperCase()}${c.key.toUpperCase()}`;

  const ground = {
    team: "",
    warehouse: "",
    rack: "",
    supplier: "",
    crossTeam: "",
    countedWarehouse: "",
    countSession: "",
    products: {} as Record<string, string>,
    shops: {} as Record<string, string>,
    orders: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const team = async (name: string, teamCode: string, type: string) =>
      String((await api(page, "team.v1.TeamService/TeamCreate", { name, teamCode, type, ownerUserId: ROOT_USER_ID })).team.id);
    ground.team = await team(`E2E Okc Seller ${SUFFIX}`, `OKS${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.crossTeam = await team(`E2E Okc Cross ${SUFFIX}`, `OKX${SUFFIX}`, "TEAM_TYPE_SELLING");
    ground.warehouse = await team(`E2E Okc Warehouse ${SUFFIX}`, WH_CODE, "TEAM_TYPE_WAREHOUSE");
    // (opname running on its rack) — a warehouse of its own: a count is one per warehouse, and a rack plan locks every
    // product on the rack, so the other givens' cancels never meet it.
    ground.countedWarehouse = await team(`E2E Okc Counted Warehouse ${SUFFIX}`, `OKO${SUFFIX}`, "TEAM_TYPE_WAREHOUSE");
    const rackOf = async (teamId: string, code: string) =>
      String((await api(page, "inventory.v1.RackService/RackCreate", { teamId, code, name: "E2E cancel shelf" })).rack.id);
    ground.rack = await rackOf(ground.warehouse, `ok-${SUFFIX}`);
    const countedRack = await rackOf(ground.countedWarehouse, `okc-${SUFFIX}`);

    const users: Record<string, string> = {};
    for (const r of ROLES) {
      const made = await api(page, "user.v1.UserService/CreateUser", {
        teamId: ground.team,
        username: username(r.key),
        password: PASSWORD,
        name: displayName(r.given),
        role: r.role,
      });
      users[r.key] = String(made.user.id);
    }
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.warehouse,
      username: WH_USER,
      password: PASSWORD,
      name: `Okc warehouse:staff ${SUFFIX}`,
      role: "ROLE_WAREHOUSE_STAFF",
    });
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.crossTeam,
      username: CROSS_USER,
      password: PASSWORD,
      name: `Okc cross selling:owner ${SUFFIX}`,
      role: "ROLE_SELLING_OWNER",
    });
    await api(page, "user.v1.UserService/CreateUser", {
      teamId: ground.countedWarehouse,
      username: COUNT_USER,
      password: PASSWORD,
      name: COUNT_NAME,
      role: "ROLE_WAREHOUSE_ADMIN",
    });

    // Both warehouses charge 10% of the goods (a warehouse with no rate takes no orders); the seller returns to the first.
    for (const wh of [ground.warehouse, ground.countedWarehouse]) {
      await api(page, "warehouse.v1.WarehouseFeeService/WarehouseFeeSet", { teamId: wh, feePercent: FEE_PERCENT, minFee: 0 });
    }
    await api(page, "selling.v1.TeamReturnConfigurationService/TeamReturnConfigurationSet", {
      teamId: ground.team,
      warehouseId: ground.warehouse,
    });

    ground.supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: ground.team, name: `E2E Okc Supplier ${SUFFIX}` }))
        .supplier.id,
    );
    const crossSupplier = String(
      (
        await api(page, "supplier.v1.SupplierService/SupplierCreate", {
          teamId: ground.crossTeam,
          name: `E2E Okc Cross Supplier ${SUFFIX}`,
        })
      ).supplier.id,
    );
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E Okc Cat ${SUFFIX}` });
    // An operational account per selling team — a restock is paid from the raising team's own.
    const accountOf = async (teamId: string, tail: string) => {
      const id = String(
        (
          await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
            teamId,
            type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
            provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
            name: `E2E Okc BCA ${tail} ${SUFFIX}`,
            holderName: "E2E",
            accountNumber: `80${SUFFIX}${tail}`,
            openingBalance: 10_000_000,
            openingOn: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
          })
        ).account.id,
      );
      await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", {
        teamId,
        accountId: id,
        operational: true,
      });
      return id;
    };
    const account = await accountOf(ground.team, "01");
    const crossAccount = await accountOf(ground.crossTeam, "02");

    // (cross product) — the seller's own product every borrowed product's return map points at.
    const mapTo = String(
      (
        await api(page, "product.v1.ProductService/ProductCreate", {
          teamId: ground.team,
          productCodePart: `OKMAP${SUFFIX}`,
          name: `E2E OKMAP${SUFFIX}`,
          categoryId: category.category.id,
        })
      ).product.id,
    );

    // GIVEN — per role and case: the product, 10 restocked and accepted onto the rack, a shop the role may write to, and
    // the order on it — 2 units, pending, placed by root.
    let n = 0;
    for (const r of ROLES) {
      for (const c of ALL) {
        const code = sku(r, c);
        const cross = c === CASES.cross;
        const counted = c === CASES.counted;
        const owner = cross ? ground.crossTeam : ground.team;
        const warehouse = counted ? ground.countedWarehouse : ground.warehouse;
        const productId = String(
          (
            await api(page, "product.v1.ProductService/ProductCreate", {
              teamId: owner,
              productCodePart: code,
              name: `E2E ${code}`,
              categoryId: category.category.id,
              ...(cross ? { crossMarkupBps: CROSS_MARKUP_BPS } : {}),
            })
          ).product.id,
        );
        ground.products[at(r, c)] = productId;

        const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
          teamId: owner,
          warehouseId: warehouse,
          financeAccountId: cross ? crossAccount : account,
          items: [
            {
              productId,
              productCode: code,
              name: `E2E ${code}`,
              count: STOCK,
              total: RESTOCK_TOTAL,
              supplierId: cross ? crossSupplier : ground.supplier,
            },
          ],
        });
        await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
          teamId: warehouse,
          requestId: raised.request.id,
          lines: [
            {
              itemId: raised.request.items[0].id,
              receivedCount: STOCK,
              placements: [{ placementId: counted ? countedRack : ground.rack, quantity: STOCK }],
            },
          ],
        });
        if (cross) {
          await api(page, "selling.v1.TeamReturnConfigurationService/ProductReturnMapCreate", {
            teamId: ground.team,
            sharedProductId: productId,
            ownProductId: mapTo,
          });
        }

        const shop = String(
          (
            await api(page, "selling.v1.ShopService/ShopCreate", {
              teamId: ground.team,
              name: `E2E Okc Shop ${r.key} ${c.key} ${SUFFIX}`,
              shopCode: `K${++n}${SUFFIX}`,
              marketplace: "MARKETPLACE_SHOPEE",
            })
          ).shop.id,
        );
        ground.shops[at(r, c)] = shop;
        await api(page, "selling.v1.ShopService/ShopUserAdd", { teamId: ground.team, shopId: shop, userId: users[r.key] });

        const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-okc-${SUFFIX}-${r.key}-${c.key}`,
          shipmentChannelId: "1",
          teamId: ground.team,
          shopId: shop,
          warehouseId: warehouse,
          customerName: `E2E Okc Buyer ${r.key} ${c.key}`,
          platformTotal: PLATFORM_TOTAL,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: ref(r, c),
          items: [{ productId, productCode: code, name: `E2E ${code}`, quantity: QTY }],
        });
        ground.orders[at(r, c)] = String(placed.order.id);

        // (status: processed) — the warehouse confirmed it.
        if (c === CASES.processed) {
          const moved = await api(page, "selling.v1.OrderService/OrderStatusChange", {
            teamId: ground.warehouse,
            orderIds: [placed.order.id],
            to: "ORDER_STATUS_PROCESSED",
          });
          expect(moved.results[0]?.moved, moved.results[0]?.refusedReason).toBe(true);
        }
      }
    }
    await page.close();

    // (opname running on its rack) — the counted warehouse's admin starts a count of the rack the orders took from.
    const counter = await browser.newPage();
    await login(counter, COUNT_USER, PASSWORD);
    const session = await api(counter, "inventory.v1.OpnameService/OpnameSessionCreate", {
      teamId: ground.countedWarehouse,
      plan: "OPNAME_PLAN_PLACEMENT",
      filterPlacementId: countedRack,
    });
    ground.countSession = String(session.session.id);
    await counter.close();
  });

  async function signIn(page: Page, user: string, team: string) {
    await login(page, user, PASSWORD);
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), team);
  }

  // A call whose refusal is the answer — its HTTP status and JSON body, with the signed-in person's token.
  async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    return page.evaluate(
      async ([m, b, apiUrl]) => {
        const token =
          window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
        const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(b),
        });
        return { status: res.status, json: (await res.json()) as Record<string, unknown> };
      },
      [method, body, API_URL] as const,
    );
  }

  // WHEN — cancel order on the order's own page, as whoever is signed in: Cancel Order, then its confirm.
  async function cancel(page: Page, orderId: string) {
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByTestId("order-detail-page")).toBeVisible();
    await page.getByTestId("order-action-cancel").click();
    await page.getByTestId("confirm-action").click();
  }

  // The product's on-hand on the one rack, as the warehouse's rack page shows it.
  async function onRack(page: Page, productId: string) {
    await page.goto(`/inventories/racks/${ground.rack}`);
    await expect(page.getByTestId("rack-detail-page")).toBeVisible();
    return page.getByTestId(`rack-stock-onhand-${productId}`);
  }

  // The seller's ledger with one counterparty: the entries this order caused.
  async function entriesOf(ledger: Page, counterparty: string, orderId: string) {
    await ledger.goto(`/liability/${counterparty}`);
    return ledger
      .getByTestId("liability-detail-all")
      .locator('[data-testid^="liability-detail-entry-"]')
      .filter({ hasText: new RegExp(`order #${orderId}(?!\\d)`) });
  }

  // The order's Settlement: the sale's figure on its summary.
  async function soldOf(page: Page, orderId: string) {
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByTestId("order-ledger-panel")).toBeVisible({ timeout: 3_000 });
    return page.getByTestId("settlement-summary").getByTestId("sold-value");
  }

  // The supplier's Statistics by product: this product's Sales cell.
  async function supplierSales(page: Page, code: string) {
    await page.goto(`/inventories/suppliers/${ground.supplier}`);
    await page.getByTestId("supplier-tab-statistics").click();
    await page.getByTestId("statistics-view-product").click();
    const row = page
      .getByTestId("supplier-statistics")
      .locator('[data-testid^="statistics-product-row-"]')
      .filter({ hasText: code });
    await expect(row).toHaveCount(1, { timeout: 2_000 });
    return row.getByTestId("figure-sales");
  }

  // "Order fee" / "Product fee" and its Reversal — the order's two entries on one ledger, each of the same amount.
  async function expectReversed(ledger: Page, counterparty: string, orderId: string, cause: string, amount: string) {
    await expect
      .soft(async () => {
        const entries = await entriesOf(ledger, counterparty, orderId);
        await expect(entries).toHaveCount(2, { timeout: 3_000 });
        const reversal = entries.filter({ has: ledger.locator('[data-testid^="liability-detail-reversal-"]') });
        await expect(reversal).toHaveCount(1);
        for (const e of [entries.first(), entries.last()]) {
          await expect(e).toContainText(cause);
          await expect(e).toContainText(amount);
        }
      })
      .toPass({ timeout: 30_000 });
  }

  // The order's page reads it cancelled: the stepper, the header, and no Cancel Order left.
  async function expectCancelled(page: Page, orderId: string) {
    await page.goto(`/orders/${orderId}`);
    await expect(page.getByTestId("order-detail-page")).toBeVisible();
    await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "cancel");
    await expect.soft(page.getByTestId("order-detail-header")).toContainText("Cancelled");
    await expect.soft(page.getByTestId("order-action-cancel")).toHaveCount(0);
  }

  for (const r of ROLES) {
    const c = CASES.pending;
    test(`${r.given} cancel order (${c.cond})`, async ({ page, browser }) => {
      const code = sku(r, c);
      const productId = ground.products[at(r, c)]!;
      const shop = ground.shops[at(r, c)]!;
      const orderId = ground.orders[at(r, c)]!;

      // The GIVEN, read where a then says it moves — as the role, then the warehouse on a page of its own, and the
      // seller's ledger (selling:owner's for selling:cs).
      await signIn(page, username(r.key), ground.team);
      await page.goto(`/orders/${orderId}`);
      await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
      await expect(async () => {
        await expect(await readyAt(page, WH_CODE, code)).toHaveText(String(STOCK - QTY), { timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await expect(async () => {
        await expect(await soldOf(page, orderId)).toHaveText("Rp 100.000", { timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await expect(async () => {
        await expect(await supplierSales(page, code)).toHaveText(/^2\s*Rp\s?100\.000$/, { timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      const ledger = r.key === "cs" ? await browser.newPage() : page;
      if (r.key === "cs") await signIn(ledger, username("own"), ground.team);
      await expect(async () => {
        await expect(await entriesOf(ledger, ground.warehouse, orderId)).toHaveCount(1, { timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      const wh = await browser.newPage();
      await signIn(wh, WH_USER, ground.warehouse);
      await expect(await onRack(wh, productId)).toHaveText(String(STOCK - QTY));

      // WHEN — through the seller's own order page, as this role.
      await cancel(page, orderId);

      // THEN — as the seller, on the order it just cancelled.
      await test.step("then: status changed from pending to cancelled", async () => {
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "cancel");
        await expectCancelled(page, orderId);
      });

      await test.step("then: cancel recorded in order timeline", async () => {
        const rows = page.getByTestId("section-timeline").getByTestId("order-timeline-cancel");
        await expect.soft(rows).toHaveCount(1);
        await expect.soft(rows).toContainText(displayName(r.given));
      });

      await test.step("then: ready stock of 1 product increases at 1 warehouse", async () => {
        await expect
          .soft(async () => {
            await expect(await readyAt(page, WH_CODE, code)).toHaveText(String(STOCK), { timeout: 2_000 });
          })
          .toPass({ timeout: 45_000 });
      });

      await test.step("then: recorded in product history", async () => {
        await page.goto(`/products/${productId}`);
        await page.getByTestId("pd-tab-history").click();
        const rows = page.getByTestId("pd-panel-history").locator('[data-testid^="pd-history-row-"]');
        // The order's −2 stays, and the cancel's +2 stands beside it (a row's cells run together in its text).
        await expect.soft(rows.locator("td").filter({ hasText: new RegExp(`^\\s*[−-]${QTY}\\s*$`) })).toHaveCount(1);
        await expect.soft(rows.locator("td").filter({ hasText: new RegExp(`^\\s*\\+${QTY}\\s*$`) })).toHaveCount(1);
      });

      await test.step("then: sale cancelled in order settlement", async () => {
        await expect
          .soft(async () => {
            await page.goto(`/orders/${orderId}`);
            const panel = page.getByTestId("order-ledger-panel");
            await expect(panel).toBeVisible({ timeout: 3_000 });
            const types = panel.locator('[data-testid^="ledger-type-"]');
            // The sale's row stays and its cancel stands beside it — the log keeps both (a-cancel-is-an-opposite-row).
            await expect(types.filter({ hasText: /^\s*Estimate\s*$/ })).toHaveCount(1, { timeout: 2_000 });
            await expect(types.filter({ hasText: "Estimate cancelled" })).toHaveCount(1, { timeout: 2_000 });
            // And the live sale no longer reads Rp 100.000 (cancel-zeroes-the-live-sale).
            await expect(panel.getByText("Rp 100.000", { exact: true })).toHaveCount(0, { timeout: 2_000 });
          })
          .toPass({ timeout: 30_000 });
      });

      await test.step("then: cancel recorded in analytic metric", async () => {
        await expect
          .soft(async () => {
            await page.goto(`/analytic?g=shop&m=metrics/orders/cancelled&r=7d&shop=${shop}`);
            await expect(page.getByTestId(`analytic-cell-${shop}-cancel_count`)).toHaveText("1", { timeout: 3_000 });
          })
          .toPass({ timeout: 30_000 });
      });

      await test.step("then: cancel recorded at 1 supplier", async () => {
        await expect
          .soft(async () => {
            await expect(await supplierSales(page, code)).toHaveText(/^0$/, { timeout: 2_000 });
          })
          .toPass({ timeout: 30_000 });
      });

      await test.step("then: warehouse fee reversed in liability", async () => {
        await expectReversed(ledger, ground.warehouse, orderId, "Order fee", "Rp 2.000");
      });
      if (ledger !== page) await ledger.close();

      // THEN — as the warehouse the order was to ship from (warehouse:staff).
      await test.step("then: stock on 1 rack increases", async () => {
        await expect
          .soft(async () => {
            await expect(await onRack(wh, productId)).toHaveText(String(STOCK), { timeout: 2_000 });
          })
          .toPass({ timeout: 45_000 });
      });

      await test.step("then: warehouse sees order cancelled", async () => {
        await wh.goto(`/warehouse-orders?q=${ref(r, c)}`);
        await wh.getByTestId("pick-tab-all").click();
        await expect(wh.getByTestId("pick-tab-all")).toHaveAttribute("aria-selected", "true");
        const row = wh.getByTestId(`pick-queue-row-${orderId}`);
        await expect.soft(row).toBeVisible();
        await expect.soft(row).toContainText("Cancelled");
        await wh.getByTestId("pick-tab-toConfirm").click();
        await expect(wh.getByTestId("pick-tab-toConfirm")).toHaveAttribute("aria-selected", "true");
        await expect.soft(row).toHaveCount(0);
      });
      await wh.close();
    });
  }

  for (const r of ROLES) {
    const c = CASES.cross;
    test(`${r.given} cancel order (${c.cond})`, async ({ page, browser }) => {
      const code = sku(r, c);
      const orderId = ground.orders[at(r, c)]!;

      // The GIVEN — the cross team's Ready reads the 8 left, and the seller owes it the borrowed goods.
      const crossPage = await browser.newPage();
      await signIn(crossPage, CROSS_USER, ground.crossTeam);
      await expect(async () => {
        await expect(await readyAt(crossPage, WH_CODE, code)).toHaveText(String(STOCK - QTY), { timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await signIn(page, username(r.key), ground.team);
      const ledger = r.key === "cs" ? await browser.newPage() : page;
      if (r.key === "cs") await signIn(ledger, username("own"), ground.team);
      await expect(async () => {
        await expect(await entriesOf(ledger, ground.crossTeam, orderId)).toHaveCount(1, { timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      await page.goto(`/orders/${orderId}`);
      await expect(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");

      // WHEN — through the seller's own order page, as this role.
      await cancel(page, orderId);

      await test.step("then: status changed from pending to cancelled", async () => {
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "cancel");
        await expectCancelled(page, orderId);
      });

      await test.step("then: cross team's ready stock increases", async () => {
        await expect
          .soft(async () => {
            await expect(await readyAt(crossPage, WH_CODE, code)).toHaveText(String(STOCK), { timeout: 2_000 });
          })
          .toPass({ timeout: 45_000 });
      });

      await test.step("then: product fee reversed in liability to cross team", async () => {
        await expectReversed(ledger, ground.crossTeam, orderId, "Product fee", "Rp 24.000");
      });
      if (ledger !== page) await ledger.close();
      await crossPage.close();
    });
  }

  for (const r of ROLES) {
    const c = CASES.processed;
    test(`${r.given} cancel order (${c.cond})`, async ({ page }) => {
      const orderId = ground.orders[at(r, c)]!;
      await signIn(page, username(r.key), ground.team);

      await test.step("then: cannot cancel order", async () => {
        // On screen: the confirmed order offers no Cancel Order (an illegal action is absent, never greyed).
        await page.goto(`/orders/${orderId}`);
        await expect(page.getByTestId("order-detail-page")).toBeVisible();
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "processed");
        await expect.soft(page.getByTestId("order-action-cancel")).toHaveCount(0);
        // And the same cancel sent anyway, with the role's own token, is refused — the order stays processed.
        const refused = await send(page, "selling.v1.OrderService/OrderCancel", { teamId: ground.team, orderId });
        expect.soft(refused.status).not.toBe(200);
        expect.soft(refused.json.code).toBe("failed_precondition");
        const still = await api(page, "selling.v1.OrderService/OrderDetail", { teamId: ground.team, orderId });
        expect.soft(still.order.status).toBe("ORDER_STATUS_PROCESSED");
      });
    });
  }

  // The error the cancel answered with — the toast the order page raises.
  const errorToast = (page: Page) => page.locator('[data-scope="toast"][data-part="root"][data-type="error"]');

  for (const r of ROLES) {
    const c = CASES.counted;
    test(`${r.given} cancel order (${c.cond})`, async ({ page }) => {
      const orderId = ground.orders[at(r, c)]!;
      await signIn(page, username(r.key), ground.team);

      // WHEN — Cancel Order and its confirm, while the count holds the rack.
      await cancel(page, orderId);

      await test.step("then: cancel refused", async () => {
        await expect.soft(errorToast(page)).toBeVisible();
        await expect.soft(errorToast(page)).toContainText("being counted");
        // Nothing changed: the order is still pending, and still offers Cancel Order.
        await page.reload();
        await expect(page.getByTestId("order-detail-page")).toBeVisible();
        await expect.soft(page.getByTestId("stage-stepper")).toHaveAttribute("data-stage", "pending");
        await expect.soft(page.getByTestId("order-action-cancel")).toBeVisible();
      });
    });
  }

  // Its own test, LAST in the file (see the head of this file): every role's refusal is the same server text, so one test
  // reads it for all three, a step per role — the count, the person who started it by name, and the time.
  test(`selling:all cancel order (${CASES.counted.cond}): message names opname, who started it and when`, async ({ page }) => {
    for (const r of ROLES) {
      await test.step(r.given, async () => {
        await signIn(page, username(r.key), ground.team);
        await cancel(page, ground.orders[at(r, CASES.counted)]!);
        await test.step("then: message names opname, who started it and when", async () => {
          const toast = errorToast(page);
          await expect(toast).toBeVisible();
          // The count, by its number.
          await expect.soft(toast).toContainText(`count #${ground.countSession}`);
          // When it started — the time of day.
          await expect.soft(toast).toContainText(/\d{1,2}[:.]\d{2}/);
          // Who started it — by name, so somebody knows whom to ask.
          await expect.soft(toast).toContainText(`started by ${COUNT_NAME}`);
        });
      });
    }
  });
});

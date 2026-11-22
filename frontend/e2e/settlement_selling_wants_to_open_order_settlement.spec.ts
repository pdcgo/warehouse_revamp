import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { PASSWORD, ROLES, entriesOfType, importThroughDialog, ledgerOf, orderOf, rp, sellingGround, settled, shopOf } from "./settlement_import_helpers";
import type { Ground } from "./settlement_import_helpers";
import { SHOPEE_INCOME, shopeeStatement, today } from "./settlement_statements";

// ── selling:all wants to see what an order earned — the checks behind docs/acceptances/settlement/order_settlement.md,
// action *open order settlement* (givens 1 and 2).
//
// An acceptance has no test file of its own (docs/acceptances/guide.md): its checks live in the regression spec of the
// feature its WHEN belongs to — opening an order's settlement. The rows' statuses are set from this file's green results
// (scripts/acceptance_mark.py), never by the file itself.
//
// The WHEN is what a person does: Penyelesaian › Daftar narrowed to the shop, the order's row clicked — it opens the
// order's page, whose Settlement section is the order's ledger (order-detail-manages-the-ledger). Opening is a READ, so
// every selling role (selling:owner, selling:admin, selling:cs — `selling:all`) reads the SAME two orders, seeded once:
// - given 1 (sale from order · payout from import · ads fee added manually): an order placed by root (its Estimate
//   posted by the order), a Shopee statement paying it Rp 85.000 imported through the Import File dialog, and an Ads fee
//   of Rp 5.000 posted by hand — both by a fourth member of the team, the ADDER, so "who added it" names somebody other
//   than the person reading;
// - given 2 (product with no recorded cost): an order of a product restocked at Rp 0 — the order's page says the cost
//   is missing, so the page hands the ledger no total cost (the-ledger-margins-need-the-hosts-total-beli).
//
// How each then is read, on the order's ledger:
// - `sale, payout and ads fee shown as rows` — exactly three rows: Estimate, Payout, Ads fee, one each.
// - `sale shown as order` — the Estimate row carries the Order source badge, and the selling price.
// - `payout shown as import` — the Payout row carries the Import badge, and the statement's amount.
// - `ads fee shown as manual with who added it` — the Ads fee row's Manual badge names the adder (*Manual · <name>*),
//   and the amount. It was ❌ (a-manual-entry-names-its-adder-by-id: the badge read the user id) until #117 made
//   OrderSettlementDetail name each row's actor; now a step of every role's own test.
// - `no margin shown` — the summary is drawn (Estimate card) but neither margin card (Estimasi margin, Margin riil) nor
//   the breakdown's "Details" is; a `regression:` step reads given 1's order, whose cost is known, drawing both, so the
//   absence is the cost's and not a summary that never renders.
test.describe("selling:all wants to see what an order earned — open order settlement", () => {
  test.describe.configure({ timeout: 120_000 });

  const PAYOUT = 85_000;
  const ADS_FEE = 5_000;
  const SALE = 100_000; // settlement_import_helpers' PLATFORM_TOTAL — every order's Estimate
  const ref = (k: string) => `SO${SUFFIX}${k}`;

  const ground = {
    g: undefined as Ground | undefined,
    shop: "",
    earned: "",
    noCost: "",
    adderName: `SO Adder ${SUFFIX}`,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "SO", 4);
    ground.g = g;

    // The ADDER — a member of the team who imports the statement and types the ads fee.
    const adderUsername = `e2esoadd${SUFFIX}`;
    const adder = String(
      (
        await api(page, "user.v1.UserService/CreateUser", {
          teamId: g.team,
          username: adderUsername,
          password: PASSWORD,
          name: ground.adderName,
          role: "ROLE_SELLING_ADMIN",
        })
      ).user.id,
    );

    // One shop, granted to the adder first (its primary CS — a shop with none cannot import) and to every role.
    ground.shop = await shopOf(page, g, `E2E SO shop ${SUFFIX}`, `SO1${SUFFIX}`, "MARKETPLACE_SHOPEE", [
      adder,
      g.users.own,
      g.users.adm,
      g.users.cs,
    ]);

    // Given 1's order — the ground's product, restocked at Rp 10.000 a unit, so its cost is known.
    ground.earned = await orderOf(page, g, ground.shop, ref("E"));

    // Given 2's product — restocked at Rp 0: the batch carries no cost, so the order takes none.
    const code = `SON${SUFFIX}`;
    const category = await api(page, "category.v1.CategoryService/CategoryCreate", { name: `E2E SO NoCost Cat ${SUFFIX}` });
    const product = String(
      (await api(page, "product.v1.ProductService/ProductCreate", { teamId: g.team, productCodePart: code, name: `E2E ${code}`, categoryId: category.category.id }))
        .product.id,
    );
    const supplier = String(
      (await api(page, "supplier.v1.SupplierService/SupplierCreate", { teamId: g.team, name: `E2E SO NoCost Supplier ${SUFFIX}` })).supplier.id,
    );
    const account = String(
      (
        await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountCreate", {
          teamId: g.team,
          type: "FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT",
          provider: "FINANCIAL_ACCOUNT_PROVIDER_BCA",
          name: `E2E SO NoCost BCA ${SUFFIX}`,
          holderName: "E2E",
          accountNumber: `E2E-SON-${SUFFIX}`,
          openingBalance: 1_000_000,
          openingOn: today(),
        })
      ).account.id,
    );
    await api(page, "financial_account.v1.FinancialAccountService/FinancialAccountOperationalSet", { teamId: g.team, accountId: account, operational: true });
    const rack = String(
      (await api(page, "inventory.v1.RackService/RackCreate", { teamId: g.warehouse, code: "son", name: "E2E no-cost shelf" })).rack.id,
    );
    const raised = await api(page, "inventory.v1.RestockRequestService/RestockRequestCreate", {
      teamId: g.team,
      warehouseId: g.warehouse,
      financeAccountId: account,
      items: [{ productId: product, productCode: code, name: `E2E ${code}`, count: 2, total: 0, supplierId: supplier }],
    });
    await api(page, "inventory.v1.RestockRequestService/RestockRequestAccept", {
      teamId: g.warehouse,
      requestId: raised.request.id,
      lines: [{ itemId: raised.request.items[0].id, receivedCount: 2, placements: [{ placementId: rack, quantity: 2 }] }],
    });
    ground.noCost = String(
      (
        await api(page, "selling.v1.OrderService/OrderCreate", {
          idempotencyKey: `e2e-so-${ref("N")}`,
          shipmentChannelId: "1",
          teamId: g.team,
          shopId: ground.shop,
          warehouseId: g.warehouse,
          customerName: `E2E SO Buyer ${ref("N")}`,
          platformTotal: SALE,
          platformCreatedAtUnix: Math.floor(Date.now() / 1000),
          orderExternalRefId: ref("N"),
          items: [{ productId: product, productCode: code, name: `E2E ${code}`, quantity: 1 }],
        })
      ).order.id,
    );
    await page.close();

    // The adder imports the day's statement paying given 1's order, then types its ads fee — the payout from import
    // and the ads fee added manually.
    const adderPage = await browser.newPage();
    await login(adderPage, adderUsername, PASSWORD);
    const dialog = await importThroughDialog(
      adderPage,
      ground.shop,
      shopeeStatement([{ kind: SHOPEE_INCOME, description: `Penghasilan ${ref("E")}`, ref: ref("E"), amount: PAYOUT }]),
    );
    await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
    await expect(dialog.getByTestId("tally-posted-value")).toHaveText("1");
    await dialog.getByTestId("import-close").click();

    await api(adderPage, "settlement.v1.SettlementWriteService/SettlementPost", {
      teamId: g.team,
      orderId: ground.earned,
      shopId: ground.shop,
      uniqueId: `manual-so-${SUFFIX}`,
      settlementType: "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE",
      sourceType: "SOURCE_TYPE_MANUAL",
      change: -ADS_FEE,
      occurredOn: today(),
      note: "ads for the order",
    });

    // Both have landed before any role reads: the ledger holds the payout and the ads fee.
    await expect(async () => {
      const panel = await ledgerOf(adderPage, ground.earned);
      await expect(entriesOfType(panel, "Payout")).toHaveCount(1, { timeout: 2_000 });
      await expect(entriesOfType(panel, "Ads fee")).toHaveCount(1, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await adderPage.close();
  });

  // WHEN — Penyelesaian › Daftar narrowed to the shop, the order's row clicked: the order's page, its ledger loaded.
  async function openOrderSettlement(page: Page, orderId: string): Promise<Locator> {
    await page.goto(`/settlement?shop=${ground.shop}`);
    const row = page.getByTestId(`settlement-row-${orderId}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await settled(page);
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}(?!\\d)`));

    const panel = page.getByTestId("order-ledger-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(entriesOfType(panel, "Estimate")).toHaveCount(1, { timeout: 10_000 });
    await settled(page);
    return panel;
  }

  for (const r of ROLES) {
    test.describe(`${r.given} wants to see what an order earned (sale from order · payout from import · ads fee added manually)`, () => {
      test(`${r.given} open order settlement (sale from order · payout from import · ads fee added manually)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const panel = await openOrderSettlement(page, ground.earned);

        await test.step("then: sale, payout and ads fee shown as rows", async () => {
          await expect.soft(panel.locator('[data-testid^="ledger-type-"]')).toHaveCount(3);
          await expect.soft(entriesOfType(panel, "Estimate")).toHaveCount(1);
          await expect.soft(entriesOfType(panel, "Payout")).toHaveCount(1);
          await expect.soft(entriesOfType(panel, "Ads fee")).toHaveCount(1);
        });

        await test.step("then: sale shown as order", async () => {
          const sale = entriesOfType(panel, "Estimate");
          await expect.soft(sale.getByTestId("source-badge-order")).toBeVisible();
          await expect.soft(sale.locator('[data-testid^="source-badge-"]')).toHaveCount(1);
          // The ledger writes the sale as the line the payouts are measured against: −Rp 100.000, the balance the
          // payouts bring back (a-residual-balance-is-normal) — so the amount is read, not its sign.
          await expect.soft(sale).toContainText(rp(SALE));
        });

        await test.step("then: payout shown as import", async () => {
          const payout = entriesOfType(panel, "Payout");
          await expect.soft(payout.getByTestId("source-badge-importer")).toBeVisible();
          await expect.soft(payout.locator('[data-testid^="source-badge-"]')).toHaveCount(1);
          await expect.soft(payout).toContainText(`+${rp(PAYOUT)}`);
        });

        // #117 fixed the ❌ (the-source-is-a-badge: *Manual · <who typed it>*) — OrderSettlementDetail now names each
        // row's actor, so the badge reads the ADDER's name, not his user id; folded into each role's own test.
        await test.step("then: ads fee shown as manual with who added it", async () => {
          const fee = entriesOfType(panel, "Ads fee");
          const badge = fee.getByTestId("source-badge-manual");
          await expect.soft(badge).toBeVisible();
          await expect.soft(fee.locator('[data-testid^="source-badge-"]')).toHaveCount(1);
          await expect.soft(badge).toHaveText(new RegExp(`^\\s*Manual\\s*·\\s*${ground.adderName}\\s*$`));
          await expect.soft(fee).toContainText(`−${rp(ADS_FEE)}`);
        });
      });
    });

    test.describe(`${r.given} wants to see what an order earned (product with no recorded cost)`, () => {
      test(`${r.given} open order settlement (product with no recorded cost)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const panel = await openOrderSettlement(page, ground.noCost);

        // GIVEN, as the page says it: the order's product carries no recorded cost.
        await expect(page.getByTestId("order-cost-missing")).toBeVisible();

        await test.step("then: no margin shown", async () => {
          await expect.soft(panel.getByTestId("sold-value")).toHaveText(rp(SALE));
          await expect.soft(panel.getByTestId("estimated-margin")).toHaveCount(0);
          await expect.soft(panel.getByTestId("margin")).toHaveCount(0);
          await expect.soft(panel.getByTestId("margin-breakdown-open")).toHaveCount(0);
        });

        await test.step("regression: an order whose cost is recorded shows both margins", async () => {
          const known = await openOrderSettlement(page, ground.earned);
          await expect.soft(page.getByTestId("order-cost-missing")).toHaveCount(0);
          await expect.soft(known.getByTestId("estimated-margin")).toBeVisible();
          await expect.soft(known.getByTestId("margin")).toBeVisible();
        });
      });
    });
  }
});

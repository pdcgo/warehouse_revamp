import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { PASSWORD, ROLES, entriesOfType, ledgerOf, orderOf, rp, sellingGround, shopOf } from "./settlement_import_helpers";
import type { Ground } from "./settlement_import_helpers";
import { today } from "./settlement_statements";

// ── selling:all wants to see how the margin adds up — the checks behind docs/acceptances/settlement/order_settlement.md,
// action *open margin breakdown* (givens 3 and 4).
//
// An acceptance has no test file of its own (docs/acceptances/guide.md): its checks live in the regression spec of the
// feature its WHEN belongs to — opening the margin breakdown of an order's settlement. The rows' statuses are set from
// this file's green results (scripts/acceptance_mark.py), never by the file itself.
//
// The WHEN is what a person does (the-margin-breakdown-opens-from-rincian): on the order's page, the True margin card's
// "Details ›" at the end of its label — a dialog on a desktop. Opening is a READ, so every selling role (selling:owner,
// selling:admin, selling:cs — `selling:all`) reads the SAME two orders, seeded once by root. Both orders take one unit of
// the ground's product, restocked at Rp 10.000 a unit, so the total cost is known (the order's goods + warehouse fee,
// read back from OrderDetail):
// - given 3 (total cost known · payout arrived): two payouts (Rp 50.000 + Rp 35.000), two ads fees (Rp 3.000 + Rp 2.000)
//   and one marketplace adjustment (+Rp 4.000) — five rows of three types, so "summed" is told apart from "listed";
// - given 4 (total cost known · no payout yet): one ads fee (Rp 5.000) and no payout — a row did arrive, so the missing
//   deduction is the payout's absence and not an empty breakdown.
//
// How each then is read, in the breakdown:
// - `each type summed as a line` — exactly three type lines for the five rows: Payout (2) +Rp 85.000, Ads fee (2)
//   −Rp 5.000, Marketplace adjustment +Rp 4.000; the sale is no line, and the lines add up to = Received Rp 84.000.
// - `true margin shown with its share of the sale` — = True margin reads Received − Total cost, with "<pct>% of the
//   selling price" under it (every-penjualan-reads-harga-jual), and equals the True margin card.
// - `deduction shown` — "Deducted at payout" reads the selling price less the payouts (Rp 15.000).
// - `no deduction shown` — the breakdown is drawn (its margin line, the ads fee's line) with no "Deducted at payout"
//   line and no Payout line: before a payout arrives the gap is money still to come (the-unitemised-take-is-a-deduction).
test.describe("selling:all wants to see how the margin adds up — open margin breakdown", () => {
  test.describe.configure({ timeout: 120_000 });

  const SALE = 100_000; // settlement_import_helpers' PLATFORM_TOTAL — every order's Estimate
  const PAYOUTS = [50_000, 35_000];
  const ADS_FEES = [3_000, 2_000];
  const ADJUSTMENT = 4_000;
  const PENDING_ADS_FEE = 5_000;
  const FUNDED = PAYOUTS[0]! + PAYOUTS[1]!; // 85.000
  const RECEIVED = FUNDED - (ADS_FEES[0]! + ADS_FEES[1]!) + ADJUSTMENT; // 84.000
  const ref = (k: string) => `MB${SUFFIX}${k}`;

  const ground = {
    g: undefined as Ground | undefined,
    shop: "",
    arrived: "",
    pending: "",
    totalCost: 0,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "MB", 3);
    ground.g = g;
    ground.shop = await shopOf(page, g, `E2E MB shop ${SUFFIX}`, `MB1${SUFFIX}`, "MARKETPLACE_SHOPEE", [g.users.own, g.users.adm, g.users.cs]);
    ground.arrived = await orderOf(page, g, ground.shop, ref("A"));
    ground.pending = await orderOf(page, g, ground.shop, ref("P"));

    // The order's own total cost — goods + warehouse fee, frozen on the order — is what the breakdown takes off.
    const detail = await api(page, "selling.v1.OrderService/OrderDetail", { teamId: g.team, orderId: ground.arrived });
    ground.totalCost = Number(detail.order.totalCost);
    expect(ground.totalCost).toBeGreaterThan(0);

    // The sale (Estimate) is posted by the order's listener — wait for both accounts to open on it before adding rows.
    for (const orderId of [ground.arrived, ground.pending]) {
      await expect
        .poll(
          async () =>
            Number(
              (await api(page, "settlement.v1.SettlementService/OrderSettlementDetail", { teamId: g.team, orderId })).settlement?.initialTotal ?? 0,
            ),
          { timeout: 30_000 },
        )
        .toBe(SALE);
    }

    const post = (orderId: string, key: string, settlementType: string, change: number) =>
      api(page, "settlement.v1.SettlementWriteService/SettlementPost", {
        teamId: g.team,
        orderId,
        shopId: ground.shop,
        uniqueId: `manual-mb-${SUFFIX}-${key}`,
        settlementType,
        sourceType: "SOURCE_TYPE_MANUAL",
        change,
        occurredOn: today(),
      });
    await post(ground.arrived, "fund-1", "SETTLEMENT_TYPE_FUND", PAYOUTS[0]!);
    await post(ground.arrived, "fund-2", "SETTLEMENT_TYPE_FUND", PAYOUTS[1]!);
    await post(ground.arrived, "ads-1", "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE", -ADS_FEES[0]!);
    await post(ground.arrived, "ads-2", "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE", -ADS_FEES[1]!);
    await post(ground.arrived, "adj-1", "SETTLEMENT_TYPE_MARKETPLACE_ADJUSTMENT", ADJUSTMENT);
    await post(ground.pending, "ads-p", "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE", -PENDING_ADS_FEE);

    // Every row has landed before any role reads.
    for (const [orderId, rows] of [
      [ground.arrived, 6],
      [ground.pending, 2],
    ] as const) {
      await expect
        .poll(
          async () => ((await api(page, "settlement.v1.SettlementService/OrderSettlementDetail", { teamId: g.team, orderId })).entries ?? []).length,
          { timeout: 30_000 },
        )
        .toBe(rows);
    }
    await page.close();
  });

  // WHEN — the order's page, its ledger loaded, then "Details ›" on the True margin card: the Margin Breakdown dialog.
  async function openMarginBreakdown(page: Page, orderId: string): Promise<{ panel: Locator; breakdown: Locator }> {
    const panel = await ledgerOf(page, orderId);
    await expect(panel.getByTestId("margin")).toBeVisible();
    await panel.getByTestId("margin-breakdown-open").click();
    const dialog = page.getByTestId("margin-breakdown-dialog");
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    await expect(dialog).toContainText("Margin Breakdown");
    const breakdown = dialog.getByTestId("margin-breakdown");
    await expect(breakdown).toBeVisible();
    return { panel, breakdown };
  }

  // The breakdown's per-type lines — every `breakdown-<type>` but its four fixed lines.
  const typeLines = (breakdown: Locator) =>
    breakdown.locator(
      '[data-testid^="breakdown-"]:not([data-testid="breakdown-received"]):not([data-testid="breakdown-margin"]):not([data-testid="breakdown-difference"]):not([data-testid="breakdown-deducted"])',
    );

  for (const r of ROLES) {
    test.describe(`${r.given} wants to see how the margin adds up (total cost known · payout arrived)`, () => {
      test(`${r.given} open margin breakdown (total cost known · payout arrived)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);

        // GIVEN, as the page says it: the cost is recorded, and the ledger holds the sale and its five rows.
        const ledger = await ledgerOf(page, ground.arrived);
        await expect(page.getByTestId("order-cost-missing")).toHaveCount(0);
        await expect(ledger.locator('[data-testid^="ledger-type-"]')).toHaveCount(6);
        await expect(entriesOfType(ledger, "Payout")).toHaveCount(2);

        const { panel, breakdown } = await openMarginBreakdown(page, ground.arrived);

        await test.step("then: each type summed as a line", async () => {
          await expect.soft(typeLines(breakdown)).toHaveCount(3);
          const fund = breakdown.getByTestId("breakdown-fund");
          await expect.soft(fund).toContainText("Payout");
          await expect.soft(fund).toContainText("(2)");
          await expect.soft(fund).toContainText(`+${rp(FUNDED)}`);
          const ads = breakdown.getByTestId("breakdown-external_ads_fee");
          await expect.soft(ads).toContainText("Ads fee");
          await expect.soft(ads).toContainText("(2)");
          await expect.soft(ads).toContainText(`−${rp(ADS_FEES[0]! + ADS_FEES[1]!)}`);
          const adj = breakdown.getByTestId("breakdown-marketplace_adjustment");
          await expect.soft(adj).toContainText("Marketplace adjustment");
          await expect.soft(adj).toContainText(`+${rp(ADJUSTMENT)}`);
          await expect.soft(adj).not.toContainText("(");
          // The sale is what the lines are measured against, never a line of its own.
          await expect.soft(breakdown.getByTestId("breakdown-initial_total")).toHaveCount(0);
          // The lines add up to Received — the same figure as its card.
          await expect.soft(breakdown.getByTestId("breakdown-received")).toContainText(rp(RECEIVED));
          await expect.soft(panel.getByTestId("received-value")).toHaveText(rp(RECEIVED));
        });

        await test.step("then: true margin shown with its share of the sale", async () => {
          const margin = RECEIVED - ground.totalCost;
          const pct = ((margin * 100) / SALE).toFixed(2);
          await expect.soft(breakdown).toContainText("Total cost");
          await expect.soft(breakdown).toContainText(`−${rp(ground.totalCost)}`);
          const line = breakdown.getByTestId("breakdown-margin");
          await expect.soft(line).toContainText("True margin");
          await expect.soft(line).toContainText(rp(margin));
          await expect.soft(line).toContainText(`${pct}% of the selling price`);
          // The breakdown explains the card: the same figure as True margin's.
          await expect.soft(panel.getByTestId("margin-value")).toHaveText(rp(margin));
        });

        await test.step("then: deduction shown", async () => {
          const deducted = breakdown.getByTestId("breakdown-deducted");
          await expect.soft(deducted).toBeVisible();
          await expect.soft(deducted).toContainText("Deducted at payout");
          await expect.soft(deducted).toContainText(rp(SALE - FUNDED));
        });
      });
    });

    test.describe(`${r.given} wants to see how the margin adds up (total cost known · no payout yet)`, () => {
      test(`${r.given} open margin breakdown (total cost known · no payout yet)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);

        // GIVEN, as the page says it: the cost is recorded, and no payout has arrived — only an ads fee.
        const ledger = await ledgerOf(page, ground.pending);
        await expect(page.getByTestId("order-cost-missing")).toHaveCount(0);
        await expect(ledger.locator('[data-testid^="ledger-type-"]')).toHaveCount(2);
        await expect(entriesOfType(ledger, "Payout")).toHaveCount(0);

        const { breakdown } = await openMarginBreakdown(page, ground.pending);

        await test.step("then: no deduction shown", async () => {
          // The breakdown is drawn — the ads fee's line and the margin — so the absence below is the payout's.
          await expect.soft(breakdown.getByTestId("breakdown-margin")).toBeVisible();
          await expect.soft(breakdown.getByTestId("breakdown-external_ads_fee")).toContainText(`−${rp(PENDING_ADS_FEE)}`);
          await expect.soft(breakdown.getByTestId("breakdown-fund")).toHaveCount(0);
          await expect.soft(breakdown.getByTestId("breakdown-deducted")).toHaveCount(0);
          await expect.soft(breakdown).not.toContainText("Deducted at payout");
        });
      });
    });
  }
});

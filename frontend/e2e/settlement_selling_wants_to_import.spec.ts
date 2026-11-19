import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { SUFFIX, login } from "./restock_helpers";
import {
  PASSWORD,
  ROLES,
  entriesOfType,
  importThroughDialog,
  importsOf,
  ledgerOf,
  orderOf,
  rp,
  sellingGround,
  shopEntries,
  shopOf,
} from "./settlement_import_helpers";
import type { Ground, Role } from "./settlement_import_helpers";
import { SHOPEE_INCOME, SHOPEE_WITHDRAWAL, shopeeStatement, today, yesterday } from "./settlement_statements";

// ── selling:all wants to record the platform's payouts — the checks behind docs/acceptances/settlement/settlement_importer.md
//
// An acceptance has no test file of its own (docs/acceptances/guide.md#acceptances-are-markdown): its checks live in the
// regression spec of the feature its WHEN belongs to — import settlement. settlement_imports.spec.ts is a serial chain
// on root and one fixture file; these are their own files beside it — this one the Shopee givens that post or refuse,
// settlement_selling_wants_to_import_more.spec.ts the TikTok, interrupted and withdrawal givens. The rows' statuses are
// the owner's, set by hand on the owner's instruction — never by this file.
//
// One test per GIVEN, run as EVERY selling role (selling:owner, selling:admin, selling:cs — `selling:all`), through the
// Import File dialog on Penyelesaian › Impor with a statement BUILT for the test (settlement_statements.ts), naming the
// orders the test's ground placed. Each THEN is its own step, named exactly as its row, checked SOFTLY so one failing then
// does not hide the next. Every role and case imports into its OWN shop, granted to that role (its first grant makes it
// the shop's primary CS — a shop with none cannot import), so a figure read in one test is never moved by another. Every
// order: 1 unit, the marketplace paid Rp 100.000 (its Estimate), a known cost (Rp 10.000 a unit, restocked).
//
// How each then is read:
// - `payout shown in each order's settlement as from import` — each order's own page, its Settlement ledger: ONE Payout
//   row, carrying the Import badge, the statement's amount.
// - `deductions shown after the payout arrives` — the order's Margin Breakdown: no "Deducted at payout" line before the
//   statement; after, the selling price less the payout (the-unitemised-take-is-a-deduction).
// - `report recorded by shop and period` — Penyelesaian › Report by shop, today's period: the shop's row carries the two
//   sales and the two payouts; a period the statement is not in (yesterday) has no row for it. The refs case runs in a
//   selling team of its own (three shops), so its rows are never paged off by the other cases' shops.
// - `row posted to the shop` — the dialog's closing summary names the ref as posted to the shop, and Penyelesaian › Shop
//   entries, narrowed to the shop, lists that one Payout from Import.
// - `nothing posted twice` — the same file uploaded again: the dialog posts 0, both lines already there; the order's
//   ledger still has ONE payout, the shop ONE entry; the imports list keeps both uploads.
// - `whole file refused` / `message names the other shop` / `nothing posted` — the dialog fails the file, the imports list
//   reads it Failed, its reason names the other shop (a-file-with-another-shops-orders-is-refused); neither order has a
//   payout and the shop no entry.
// - `both skipped` — a Gagal withdrawal and the Transaksi Selesai row returning it: the dialog skips both (2 skipped, 0
//   posted, two "did not succeed" lines), and the shop records no withdrawal (only-a-successful-withdrawal-is-recorded).
test.describe("selling:all wants to record the platform's payouts — import settlement (Shopee)", () => {
  test.describe.configure({ timeout: 150_000 });

  const CASES = {
    refs: { cond: "Shopee shop · statement · refs on orders of this shop", key: "rf" },
    noOrder: { cond: "Shopee shop · statement · ref with no order", key: "no" },
    twice: { cond: "Shopee shop · statement · same file twice", key: "tw" },
    foreign: { cond: "Shopee shop · statement · ref on an order of another shop", key: "fo" },
    failedWithdrawal: { cond: "Shopee shop · statement · failed withdrawal and its return", key: "wf" },
  } as const;
  type Case = (typeof CASES)[keyof typeof CASES];

  const PAYOUT_A = 85_000;
  const PAYOUT_B = 90_000;

  // The marketplace's Order ID ("No. Pesanan") — unique per role, case and order, and per run.
  const ref = (r: Role, c: Case, i: number) => `SI${SUFFIX}${r.key.toUpperCase()}${c.key.toUpperCase()}${i}`;
  const at = (r: Role, c: Case, extra = "") => `${r.key}-${c.key}${extra}`;
  const shopName = (r: Role, c: Case, extra = "") => `E2E Imp ${c.key}${extra} ${r.key} ${SUFFIX}`;

  const ground = {
    main: undefined as Ground | undefined,
    report: undefined as Ground | undefined,
    shops: {} as Record<string, string>,
    orders: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const main = await sellingGround(page, "IA", 12);
    const report = await sellingGround(page, "IR", 8);
    ground.main = main;
    ground.report = report;

    let n = 0;
    const shop = async (g: Ground, r: Role, c: Case, extra = "", grant = true) => {
      const id = await shopOf(page, g, shopName(r, c, extra), `IA${++n}${SUFFIX}`, "MARKETPLACE_SHOPEE", grant ? [g.users[r.key]] : []);
      ground.shops[at(r, c, extra)] = id;
      return id;
    };

    for (const r of ROLES) {
      // (refs on orders of this shop) — two orders, in the report's own team.
      const refsShop = await shop(report, r, CASES.refs);
      for (const i of [1, 2]) ground.orders[at(r, CASES.refs, `#${i}`)] = await orderOf(page, report, refsShop, ref(r, CASES.refs, i));

      await shop(main, r, CASES.noOrder);

      const twiceShop = await shop(main, r, CASES.twice);
      ground.orders[at(r, CASES.twice)] = await orderOf(page, main, twiceShop, ref(r, CASES.twice, 1));

      // (ref on an order of another shop) — this shop's order, and an order of ANOTHER shop of the team (Q), which the
      // role holds no grant on.
      const ownShop = await shop(main, r, CASES.foreign);
      ground.orders[at(r, CASES.foreign)] = await orderOf(page, main, ownShop, ref(r, CASES.foreign, 1));
      const otherShop = await shop(main, r, CASES.foreign, "Q", false);
      ground.orders[at(r, CASES.foreign, "Q")] = await orderOf(page, main, otherShop, ref(r, CASES.foreign, 2));

      await shop(main, r, CASES.failedWithdrawal);
    }
    await page.close();
  });

  // The dialog, once its stream has ended on its closing summary.
  async function finished(dialog: Locator) {
    await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
  }

  // The order's ledger, read until `check` holds (an entry lands a beat after the stream says posted).
  async function onLedger(page: Page, orderId: string, check: (panel: Locator) => Promise<void>) {
    await expect
      .soft(async () => {
        await check(await ledgerOf(page, orderId));
      })
      .toPass({ timeout: 30_000 });
  }

  // The Margin Breakdown of the order's settlement, opened.
  async function breakdownOf(page: Page, orderId: string): Promise<Locator> {
    await ledgerOf(page, orderId);
    await page.getByTestId("margin-breakdown-open").click();
    const breakdown = page.getByTestId("margin-breakdown");
    await expect(breakdown).toBeVisible({ timeout: 3_000 });
    return breakdown;
  }

  for (const r of ROLES) {
    const c = CASES.refs;
    test(`${r.given} import settlement (${c.cond})`, async ({ page }) => {
      const g = ground.report!;
      const shop = ground.shops[at(r, c)]!;
      const orders = [
        { id: ground.orders[at(r, c, "#1")]!, ref: ref(r, c, 1), payout: PAYOUT_A },
        { id: ground.orders[at(r, c, "#2")]!, ref: ref(r, c, 2), payout: PAYOUT_B },
      ];
      await login(page, g.usernames[r.key], PASSWORD);

      // GIVEN — the orders are placed and nothing has arrived: no payout, and nothing deducted yet.
      for (const o of orders) {
        await expect(async () => {
          const panel = await ledgerOf(page, o.id);
          await expect(entriesOfType(panel, "Payout")).toHaveCount(0);
        }).toPass({ timeout: 30_000 });
        const breakdown = await breakdownOf(page, o.id);
        await expect(breakdown.getByTestId("breakdown-deducted")).toHaveCount(0);
      }

      // WHEN — the day's statement, one income row per order.
      const dialog = await importThroughDialog(
        page,
        shop,
        shopeeStatement(orders.map((o) => ({ kind: SHOPEE_INCOME, description: `Penghasilan ${o.ref}`, ref: o.ref, amount: o.payout }))),
      );
      await finished(dialog);
      await expect.soft(dialog.getByTestId("tally-posted-value")).toHaveText("2");
      await dialog.getByTestId("import-close").click();

      await test.step("then: payout shown in each order's settlement as from import", async () => {
        for (const o of orders) {
          await onLedger(page, o.id, async (panel) => {
            const payout = entriesOfType(panel, "Payout");
            await expect(payout).toHaveCount(1, { timeout: 2_000 });
            await expect(payout.getByTestId("source-badge-importer")).toBeVisible();
            await expect(payout).toContainText(rp(o.payout).replace("Rp ", ""));
          });
        }
      });

      await test.step("then: deductions shown after the payout arrives", async () => {
        for (const o of orders) {
          await expect
            .soft(async () => {
              const breakdown = await breakdownOf(page, o.id);
              await expect(breakdown.getByTestId("breakdown-deducted")).toContainText(rp(100_000 - o.payout), { timeout: 2_000 });
            })
            .toPass({ timeout: 30_000 });
        }
      });

      await test.step("then: report recorded by shop and period", async () => {
        // Today's period: the shop's row carries its two sales (Rp 200.000) and the two payouts (Rp 175.000).
        await expect
          .soft(async () => {
            await page.goto(`/settlement/report?grain=day&range=${today()}..${today()}`);
            const row = page.getByTestId(`report-group-row-${shop}`);
            await expect(row).toContainText(rp(PAYOUT_A + PAYOUT_B), { timeout: 3_000 });
            await expect(row).toContainText(rp(200_000));
            await expect(page.getByTestId(`report-series-row-${today()}`)).toBeVisible();
          })
          .toPass({ timeout: 45_000 });
        // A period the statement is not in has no row for the shop.
        await page.goto(`/settlement/report?grain=day&range=${yesterday()}..${yesterday()}`);
        await expect(page.getByTestId("report-summary")).toBeVisible({ timeout: 5_000 });
        await expect.soft(page.getByTestId(`report-group-row-${shop}`)).toHaveCount(0);
      });
    });
  }

  for (const r of ROLES) {
    const c = CASES.noOrder;
    test(`${r.given} import settlement (${c.cond})`, async ({ page }) => {
      const g = ground.main!;
      const shop = ground.shops[at(r, c)]!;
      const noOrder = ref(r, c, 1); // no order carries it
      await login(page, g.usernames[r.key], PASSWORD);

      const dialog = await importThroughDialog(
        page,
        shop,
        shopeeStatement([{ kind: SHOPEE_INCOME, description: `Penghasilan ${noOrder}`, ref: noOrder, amount: 60_000 }]),
      );
      await finished(dialog);

      await test.step("then: row posted to the shop", async () => {
        await expect.soft(dialog.getByTestId("tally-posted-value")).toHaveText("1");
        await expect.soft(dialog.getByTestId("import-problem")).toContainText(`no order ${noOrder} — posted to the shop`);
        await dialog.getByTestId("import-close").click();

        await expect
          .soft(async () => {
            const { count, amounts } = await shopEntries(page, shop);
            await expect(count).toHaveText("1", { timeout: 2_000 });
            await expect(amounts).toHaveCount(1);
            await expect(amounts.first()).toContainText("60.000");
            const id = (await amounts.first().getAttribute("data-testid"))!.replace("shop-entry-amount-", "");
            await expect(page.getByTestId(`shop-entry-kind-${id}`)).toHaveText("Payout");
            await expect(page.getByTestId(`shop-entry-${id}`).getByTestId("source-badge-importer")).toBeVisible();
          })
          .toPass({ timeout: 30_000 });
      });
    });
  }

  for (const r of ROLES) {
    const c = CASES.twice;
    test(`${r.given} import settlement (${c.cond})`, async ({ page }) => {
      const g = ground.main!;
      const shop = ground.shops[at(r, c)]!;
      const orderId = ground.orders[at(r, c)]!;
      const orderRef = ref(r, c, 1);
      const noOrder = ref(r, c, 9);
      const statement = shopeeStatement([
        { kind: SHOPEE_INCOME, description: `Penghasilan ${orderRef}`, ref: orderRef, amount: 80_000 },
        { kind: SHOPEE_INCOME, description: `Penghasilan ${noOrder}`, ref: noOrder, amount: 30_000 },
      ]);
      await login(page, g.usernames[r.key], PASSWORD);

      // GIVEN — the statement was imported once: both lines posted.
      const first = await importThroughDialog(page, shop, statement);
      await finished(first);
      await expect(first.getByTestId("tally-posted-value")).toHaveText("2");
      await first.getByTestId("import-close").click();

      // WHEN — the same file, again.
      const again = await importThroughDialog(page, shop, statement);
      await finished(again);

      await test.step("then: nothing posted twice", async () => {
        await expect.soft(again.getByTestId("tally-posted-value")).toHaveText("0");
        await expect.soft(again.getByTestId("tally-existing-value")).toHaveText("2");
        await again.getByTestId("import-close").click();

        // The order still has ONE payout, the shop ONE entry.
        await onLedger(page, orderId, async (panel) => {
          await expect(entriesOfType(panel, "Payout")).toHaveCount(1, { timeout: 2_000 });
        });
        const { count } = await shopEntries(page, shop);
        await expect.soft(count).toHaveText("1");

        // Both uploads are kept — the newest posted 0, its 2 lines already there.
        const rows = await importsOf(page, shop);
        await expect.soft(rows).toHaveCount(2);
        const cells = rows.first().locator("td");
        await expect.soft(cells.nth(4)).toHaveText("0");
        await expect.soft(cells.nth(5)).toHaveText("2");
      });
    });
  }

  for (const r of ROLES) {
    const c = CASES.foreign;
    test(`${r.given} import settlement (${c.cond})`, async ({ page }) => {
      const g = ground.main!;
      const shop = ground.shops[at(r, c)]!;
      const otherShop = ground.shops[at(r, c, "Q")]!;
      const own = { id: ground.orders[at(r, c)]!, ref: ref(r, c, 1) };
      const other = { id: ground.orders[at(r, c, "Q")]!, ref: ref(r, c, 2) };
      await login(page, g.usernames[r.key], PASSWORD);

      const dialog = await importThroughDialog(
        page,
        shop,
        shopeeStatement([
          { kind: SHOPEE_INCOME, description: `Penghasilan ${own.ref}`, ref: own.ref, amount: 70_000 },
          { kind: SHOPEE_INCOME, description: `Penghasilan ${other.ref}`, ref: other.ref, amount: 60_000 },
        ]),
      );
      const reason = dialog.getByTestId("import-failed-reason");
      const rows = page.locator('[data-testid^="import-row-"]');
      let message = "";

      await test.step("then: whole file refused", async () => {
        await expect.soft(reason).toContainText("the whole file is refused", { timeout: 45_000 });
        await expect.soft(dialog.getByTestId("import-summary")).toHaveCount(0);
        message = (await reason.textContent()) ?? "";
        await dialog.getByTestId("import-close").click();

        // The stored file's row reads Failed.
        await importsOf(page, shop);
        await expect.soft(rows).toHaveCount(1);
        await expect.soft(rows.first().getByTestId("upload-status-failed")).toBeVisible();
      });

      await test.step("then: message names the other shop", async () => {
        // In the dialog's refusal, and on the file's row in the list.
        expect.soft(message).toContain(shopName(r, c, "Q"));
        await expect.soft(rows.first()).toContainText(shopName(r, c, "Q"));
      });

      await test.step("then: nothing posted", async () => {
        await expect.soft(rows.first().locator("td").nth(4)).toHaveText("0");
        for (const o of [own, other]) {
          await onLedger(page, o.id, async (panel) => {
            await expect(entriesOfType(panel, "Payout")).toHaveCount(0);
          });
        }
        for (const s of [shop, otherShop]) {
          const { count } = await shopEntries(page, s);
          await expect.soft(count).toHaveText("0");
        }
      });
    });
  }

  for (const r of ROLES) {
    const c = CASES.failedWithdrawal;
    test(`${r.given} import settlement (${c.cond})`, async ({ page }) => {
      const g = ground.main!;
      const shop = ground.shops[at(r, c)]!;
      await login(page, g.usernames[r.key], PASSWORD);

      // A withdrawal that failed, and the row returning its money — both "Penarikan Dana".
      const dialog = await importThroughDialog(
        page,
        shop,
        shopeeStatement([
          { kind: SHOPEE_WITHDRAWAL, description: `Penarikan Dana ${SUFFIX} ${r.key}`, amount: -50_000, status: "Gagal" },
          { kind: SHOPEE_WITHDRAWAL, description: `Pengembalian Penarikan Dana ${SUFFIX} ${r.key}`, amount: 50_000 },
        ]),
      );
      await finished(dialog);

      await test.step("then: both skipped", async () => {
        await expect.soft(dialog.getByTestId("tally-skipped-value")).toHaveText("2");
        await expect.soft(dialog.getByTestId("tally-posted-value")).toHaveText("0");
        await expect.soft(dialog.getByTestId("import-problem").filter({ hasText: "did not succeed" })).toHaveCount(2);
        await dialog.getByTestId("import-close").click();

        // No withdrawal recorded to the shop — no entry at all.
        const { count } = await shopEntries(page, shop);
        await expect.soft(count).toHaveText("0");
      });
    });
  }
});

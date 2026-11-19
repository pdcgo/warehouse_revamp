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
import { SHOPEE_INCOME, SHOPEE_WITHDRAWAL, shopeeStatement, tiktokStatement, today } from "./settlement_statements";

// ── selling:all wants to record the platform's payouts — the rest of docs/acceptances/settlement/settlement_importer.md
//
// The second half of import settlement's acceptance checks (the first: settlement_selling_wants_to_import.spec.ts — the
// split keeps each file well under a batch's cap): a TikTok statement, an import the person walks away from, a TikTok
// file uploaded into a Shopee shop, and a successful withdrawal. Same pattern: one test per GIVEN, run as every selling
// role, through the Import File dialog with a statement built for the test, each role and case in its OWN shop granted to
// that role; each THEN its own step, named as its row, checked softly. The rows' statuses are the owner's — never set here.
//
// How each then is read:
// - `rows matched by related order ID` — a TikTok Order row and a Logistics reimbursement whose own id is an ADJUSTMENT
//   id (19 digits, never the order's) but whose Related order ID is the order's: both land on the order's ledger, from
//   Import — the fund carrying the payout before the commission, the commission its own Affiliate fee row
//   (tiktok-affiliate-commission-posts-as-affiliate-fee), the reimbursement as Shipping reimbursed — and nothing goes to
//   the shop (a-tiktok-row-finds-its-order-by-related-order-id).
// - `import still processed until finish` — the person leaves while the bar is moving (selling:owner closes the tab,
//   selling:admin reloads it, selling:cs opens another page): the file's row in the imports list still ends Done with
//   every row posted, and the shop holds them all (an-import-finishes-whether-anyone-watches).
// - `result shown in the import list` — that row: Done, the period, every line posted, none already there, held or
//   skipped.
// - `file refused` / `nothing posted` — a TikTok export uploaded into a Shopee shop: the dialog fails it as not a Shopee
//   statement and the list reads it Failed; the order the file names has no payout, the shop no entry, the row 0 posted.
// - `withdrawal recorded to the shop` — a Penarikan Dana that completed: Penyelesaian › Shop entries, narrowed to the
//   shop and to withdrawals, lists it from Import, and the Withdrawn card reads its amount.
test.describe("selling:all wants to record the platform's payouts — import settlement (TikTok, interrupted, withdrawal)", () => {
  test.describe.configure({ timeout: 180_000 });

  const CASES = {
    tiktok: { cond: "TikTok shop · statement", key: "tt" },
    left: { cond: "Shopee shop · statement · page closed / reloaded / changed during import", key: "lv" },
    wrongFile: { cond: "Shopee shop · TikTok statement", key: "wr" },
    withdrawal: { cond: "Shopee shop · statement · successful withdrawal", key: "wd" },
  } as const;
  type Case = (typeof CASES)[keyof typeof CASES];

  // How the person leaves a running import, per role.
  const LEAVE = { own: "closes the tab", adm: "reloads the page", cs: "opens another page" } as const;
  // Big enough that the bar is still moving when the person leaves.
  const ROWS = 400;

  // TikTok's ids are digits: an order's 18, an adjustment's 19 — unique per role and run.
  const tiktokOrderId = (r: Role) => `57${SUFFIX}${r.n}01`.padEnd(18, "0");
  const tiktokAdjustmentId = (r: Role) => `77${SUFFIX}${r.n}01`.padEnd(19, "0");
  const shopeeRef = (r: Role, c: Case) => `SI${SUFFIX}${r.key.toUpperCase()}${c.key.toUpperCase()}1`;
  const at = (r: Role, c: Case) => `${r.key}-${c.key}`;
  const shopName = (r: Role, c: Case) => `E2E Imp ${c.key} ${r.key} ${SUFFIX}`;

  const ground = {
    g: undefined as Ground | undefined,
    shops: {} as Record<string, string>,
    orders: {} as Record<string, string>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "IB", 8);
    ground.g = g;

    let n = 0;
    const shop = async (r: Role, c: Case, marketplace: "MARKETPLACE_SHOPEE" | "MARKETPLACE_TIKTOK" = "MARKETPLACE_SHOPEE") => {
      const id = await shopOf(page, g, shopName(r, c), `IB${++n}${SUFFIX}`, marketplace, [g.users[r.key]]);
      ground.shops[at(r, c)] = id;
      return id;
    };

    for (const r of ROLES) {
      const tiktokShop = await shop(r, CASES.tiktok, "MARKETPLACE_TIKTOK");
      ground.orders[at(r, CASES.tiktok)] = await orderOf(page, g, tiktokShop, tiktokOrderId(r));

      await shop(r, CASES.left);

      const wrongShop = await shop(r, CASES.wrongFile);
      ground.orders[at(r, CASES.wrongFile)] = await orderOf(page, g, wrongShop, shopeeRef(r, CASES.wrongFile));

      await shop(r, CASES.withdrawal);
    }
    await page.close();
  });

  async function finished(dialog: Locator) {
    await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
  }

  async function onLedger(page: Page, orderId: string, check: (panel: Locator) => Promise<void>) {
    await expect
      .soft(async () => {
        await check(await ledgerOf(page, orderId));
      })
      .toPass({ timeout: 30_000 });
  }

  for (const r of ROLES) {
    const c = CASES.tiktok;
    test(`${r.given} import settlement (${c.cond})`, async ({ page }) => {
      const g = ground.g!;
      const shop = ground.shops[at(r, c)]!;
      const orderId = ground.orders[at(r, c)]!;
      const orderRef = tiktokOrderId(r);
      await login(page, g.usernames[r.key], PASSWORD);

      // WHEN — the order's own row (97.000 settled after a 3.000 commission), and a reimbursement whose own id is an
      // adjustment id, related to the order.
      const dialog = await importThroughDialog(
        page,
        shop,
        tiktokStatement([
          { id: orderRef, kind: "Order", related: orderRef, amount: 97_000, affiliate: -2_500, shopAds: -500 },
          { id: tiktokAdjustmentId(r), kind: "Logistics reimbursement", related: orderRef, amount: 8_000 },
        ]),
      );
      await finished(dialog);

      await test.step("then: rows matched by related order ID", async () => {
        // Three lines — the fund, its commission, the reimbursement — all posted, none to the shop.
        await expect.soft(dialog.getByTestId("tally-posted-value")).toHaveText("3");
        await expect.soft(dialog.getByTestId("import-problem").filter({ hasText: "posted to the shop" })).toHaveCount(0);
        await dialog.getByTestId("import-close").click();

        await onLedger(page, orderId, async (panel) => {
          const payout = entriesOfType(panel, "Payout");
          await expect(payout).toHaveCount(1, { timeout: 2_000 });
          await expect(payout).toContainText("100.000");
          await expect(payout.getByTestId("source-badge-importer")).toBeVisible();

          const commission = entriesOfType(panel, "Affiliate fee");
          await expect(commission).toHaveCount(1);
          await expect(commission).toContainText("3.000");

          const reimbursed = entriesOfType(panel, "Shipping reimbursed");
          await expect(reimbursed).toHaveCount(1);
          await expect(reimbursed).toContainText("8.000");
          await expect(reimbursed.getByTestId("source-badge-importer")).toBeVisible();
        });

        const { count } = await shopEntries(page, shop);
        await expect.soft(count).toHaveText("0");
      });
    });
  }

  for (const r of ROLES) {
    const c = CASES.left;
    test(`${r.given} import settlement (${c.cond})`, async ({ page }) => {
      const g = ground.g!;
      const shop = ground.shops[at(r, c)]!;
      await login(page, g.usernames[r.key], PASSWORD);

      const rows = Array.from({ length: ROWS }, (_, i) => ({
        kind: SHOPEE_INCOME,
        description: `Penghasilan ${SUFFIX} ${r.key} ${i}`,
        ref: `SL${SUFFIX}${r.key.toUpperCase()}${i}`,
        amount: 1_000 + i,
      }));
      const total = rows.reduce((sum, row) => sum + row.amount, 0);

      // WHEN — the import starts, and the person leaves as soon as the bar is moving.
      const dialog = await importThroughDialog(page, shop, shopeeStatement(rows));
      const progress = dialog.getByTestId("import-progress-text");
      await expect(progress).toHaveText(new RegExp(`^\\d+ of ${ROWS} rows$`), { timeout: 30_000 });
      const leftAt = (await progress.textContent()) ?? "";
      test.info().annotations.push({ type: "left at", description: `${LEAVE[r.key]} at ${leftAt}` });

      let reader: Page = page;
      if (r.key === "own") {
        const context = page.context();
        await page.close();
        reader = await context.newPage();
        // A new tab of the same browser is signed in already — the token is kept for the browser, not the tab.
        await reader.goto("/");
      } else if (r.key === "adm") {
        await page.reload();
      } else {
        await page.goto("/orders");
      }
      // The page the person landed on, settled — signed in, its load's CheckAccess answered. Navigating on while that
      // call is still in flight aborts it, and an aborted CheckAccess drops the token (reported to revamp_dev).
      await expect(reader.getByTestId("current-user")).toHaveText(g.usernames[r.key]);
      await reader.waitForLoadState("networkidle");

      const list = reader.locator('[data-testid^="import-row-"]');

      await test.step("then: import still processed until finish", async () => {
        // The list, opened once: while the file runs it refreshes itself, until the row reads Done.
        await importsOf(reader, shop);
        await expect.soft(list).toHaveCount(1);
        await expect.soft(list.first().getByTestId("upload-status-done")).toBeVisible({ timeout: 120_000 });
        // Every row reached the shop.
        const { count } = await shopEntries(reader, shop);
        await expect.soft(count).toHaveText(String(ROWS));
        await expect.soft(reader.getByTestId("shop-entries-received")).toContainText(rp(total).replace("Rp ", ""));
      });

      await test.step("then: result shown in the import list", async () => {
        await importsOf(reader, shop);
        const cells = list.first().locator("td");
        await expect.soft(list.first().getByTestId("upload-status-done")).toBeVisible();
        await expect.soft(cells.nth(1)).toContainText(today());
        await expect.soft(cells.nth(4)).toHaveText(String(ROWS));
        await expect.soft(cells.nth(5)).toHaveText("0");
        await expect.soft(cells.nth(6)).toHaveText("0");
        await expect.soft(cells.nth(7)).toHaveText("0");
      });

      if (reader !== page) await reader.close();
    });
  }

  for (const r of ROLES) {
    const c = CASES.wrongFile;
    test(`${r.given} import settlement (${c.cond})`, async ({ page }) => {
      const g = ground.g!;
      const shop = ground.shops[at(r, c)]!;
      const orderId = ground.orders[at(r, c)]!;
      const orderRef = shopeeRef(r, c);
      await login(page, g.usernames[r.key], PASSWORD);

      // WHEN — a TikTok export, naming this shop's order, uploaded into the Shopee shop.
      const dialog = await importThroughDialog(
        page,
        shop,
        tiktokStatement([{ id: orderRef, kind: "Order", related: orderRef, amount: 97_000, affiliate: -2_500, shopAds: -500 }]),
        "tiktok_statement.xlsx",
      );
      const rows = page.locator('[data-testid^="import-row-"]');

      await test.step("then: file refused", async () => {
        await expect.soft(dialog.getByTestId("import-failed-reason")).toContainText("This is not a Shopee statement", { timeout: 45_000 });
        await expect.soft(dialog.getByTestId("import-summary")).toHaveCount(0);
        await dialog.getByTestId("import-close").click();

        await importsOf(page, shop);
        await expect.soft(rows).toHaveCount(1);
        await expect.soft(rows.first().getByTestId("upload-status-failed")).toBeVisible();
      });

      await test.step("then: nothing posted", async () => {
        await expect.soft(rows.first().locator("td").nth(4)).toHaveText("0");
        await onLedger(page, orderId, async (panel) => {
          await expect(entriesOfType(panel, "Payout")).toHaveCount(0);
        });
        const { count } = await shopEntries(page, shop);
        await expect.soft(count).toHaveText("0");
      });
    });
  }

  for (const r of ROLES) {
    const c = CASES.withdrawal;
    test(`${r.given} import settlement (${c.cond})`, async ({ page }) => {
      const g = ground.g!;
      const shop = ground.shops[at(r, c)]!;
      await login(page, g.usernames[r.key], PASSWORD);

      const dialog = await importThroughDialog(
        page,
        shop,
        shopeeStatement([{ kind: SHOPEE_WITHDRAWAL, description: `Penarikan Dana ${SUFFIX} ${r.key}`, amount: -150_000 }]),
      );
      await finished(dialog);

      await test.step("then: withdrawal recorded to the shop", async () => {
        await expect.soft(dialog.getByTestId("tally-posted-value")).toHaveText("1");
        await dialog.getByTestId("import-close").click();

        await expect
          .soft(async () => {
            const { count, amounts } = await shopEntries(page, shop, "withdrawal");
            await expect(count).toHaveText("1", { timeout: 2_000 });
            await expect(amounts.first()).toContainText("150.000");
            const id = (await amounts.first().getAttribute("data-testid"))!.replace("shop-entry-amount-", "");
            await expect(page.getByTestId(`shop-entry-kind-${id}`)).toHaveText("Withdrawal");
            await expect(page.getByTestId(`shop-entry-${id}`).getByTestId("source-badge-importer")).toBeVisible();
            await expect(page.getByTestId("shop-entries-withdrawn")).toHaveText(rp(150_000));
          })
          .toPass({ timeout: 30_000 });
      });
    });
  }
});

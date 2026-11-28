import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { PASSWORD, ROLES, entriesOfType, importThroughDialog, orderOf, rp, sellingGround, settled, shopOf } from "./settlement_import_helpers";
import type { Ground } from "./settlement_import_helpers";
import { SHOPEE_INCOME, shopeeStatement, today } from "./settlement_statements";

// ── selling:all wants to undo a wrong entry — the checks behind docs/acceptances/settlement/order_settlement.md,
// action *reverse settlement entry* (givens 12 and 13).
//
// An acceptance has no test file of its own (docs/acceptances/guide.md): its checks live in the regression spec of the
// feature its WHEN belongs to — reversing a row of an order's settlement. The rows' statuses are set from this file's
// green results (scripts/acceptance_mark.py), never by the file itself.
//
// The WHEN is what a person does: on the order's page, the ledger row's Reverse → the "Reverse This Entry" confirm →
// Post Reversal. A row is never edited or deleted (a-correction-is-a-new-row): the reversal is a further row of the
// same type, the exact opposite amount, pointing back at the row it undoes. Every order is root's, one unit of the
// ground's product, its Estimate (Rp 100.000) posted by the order's own event. Each role reverses rows of ORDERS OF ITS
// OWN, so no role reads another's:
// - given 12 (manual payout with wrong amount) — the order is the only one of a shop of the role's own (so the shop's
//   Settlement metric is that one order); in the test the role reads the metric, then types a Payout of Rp 65.000 (the
//   wrong amount) with its own token, waits for the metric to count it, and reverses it on the ledger;
// - given 13 (imported row on the wrong order) — a Shopee statement imported through the Import File dialog by a fourth
//   member of the team (the ADDER, the shop's primary CS) pays each role's order Rp 85.000: the imported Payout the
//   role reverses.
//
// How each then is read, on the order's ledger:
// - `reversing row added` — a new row (its id from the SettlementPost answer, which names the row it reverses) of the
//   same type, the opposite amount, with the Manual badge and the line "reverses +Rp … of <day>"; the account holds
//   one more entry.
// - `original shown as reversed` — the original row stays on the ledger with its amount and its source badge, drawn
//   muted (opacity 0.5 — an unreversed row beside it is not), and offers no Reverse any more; nor does the reversal.
// - `order balance back to before` — the reversal's running balance and the Received card read what they read before
//   the wrong payout; OrderSettlementDetail's lastBalance too.
// - `settlement analytic metric back to before` — Analytic › Settlement by shop, narrowed to the role's shop (7 days):
//   Sales, Received and Gap read what they read before the wrong payout, after Received was seen counting it.
test.describe("selling:all wants to undo a wrong entry — reverse settlement entry", () => {
  test.describe.configure({ timeout: 120_000 });

  const SALE = 100_000; // settlement_import_helpers' PLATFORM_TOTAL — every order's Estimate
  const WRONG = 65_000; // given 12's payout, typed with the wrong amount
  const IMPORTED = 85_000; // given 13's payout, imported onto the wrong order
  const ref = (k: string) => `XR${SUFFIX}${k}`;

  const ground = {
    g: undefined as Ground | undefined,
    shop: "",
    metricShop: {} as Record<string, string>,
    order: {} as Record<string, string>,
    adderName: `XR Adder ${SUFFIX}`,
  };
  const orderOfCase = (given: string, r: { key: string }) => ground.order[`${given}-${r.key}`]!;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "XR", 8);
    ground.g = g;
    const everyone = [g.users.own, g.users.adm, g.users.cs];

    // The ADDER — a member of the team who imports the statement.
    const adderUsername = `e2exradd${SUFFIX}`;
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

    // Given 13's shop, granted to the adder first (its primary CS — a shop with none cannot import) and to every role.
    ground.shop = await shopOf(page, g, `E2E XR shop ${SUFFIX}`, `XR0${SUFFIX}`, "MARKETPLACE_SHOPEE", [adder, ...everyone]);

    for (const r of ROLES) {
      // Given 12's order is the only order of a shop of the role's own — the shop's metric is that order alone.
      ground.metricShop[r.key] = await shopOf(page, g, `E2E XR metric ${r.key} ${SUFFIX}`, `XRM${r.n}${SUFFIX}`, "MARKETPLACE_SHOPEE", everyone);
      ground.order[`g12-${r.key}`] = await orderOf(page, g, ground.metricShop[r.key]!, ref(`12${r.key}`));
      ground.order[`g13-${r.key}`] = await orderOf(page, g, ground.shop, ref(`13${r.key}`));
    }

    // Every order's Estimate is posted by the order's listener — wait for each account to open on it.
    const detail = (p: Page, orderId: string) => api(p, "settlement.v1.SettlementService/OrderSettlementDetail", { teamId: g.team, orderId });
    for (const orderId of Object.values(ground.order)) {
      // 404 "no settlement account" until the listener ran — caught, or expect.poll stops on the throw.
      await expect.poll(async () => Number((await detail(page, orderId).catch(() => ({ settlement: { initialTotal: -1 } }))).settlement?.initialTotal ?? 0), { timeout: 30_000 }).toBe(SALE);
    }
    await page.close();

    // The adder imports the day's statement paying each role's given-13 order — the imported row on the wrong order.
    const adderPage = await browser.newPage();
    await login(adderPage, adderUsername, PASSWORD);
    const dialog = await importThroughDialog(
      adderPage,
      ground.shop,
      shopeeStatement(
        ROLES.map((r) => ({ kind: SHOPEE_INCOME, description: `Penghasilan ${ref(`13${r.key}`)}`, ref: ref(`13${r.key}`), amount: IMPORTED })),
      ),
    );
    await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
    await expect(dialog.getByTestId("tally-posted-value")).toHaveText(String(ROLES.length));
    await dialog.getByTestId("import-close").click();
    for (const r of ROLES) {
      await expect
        .poll(async () => ((await detail(adderPage, orderOfCase("g13", r))).entries ?? []).length, { timeout: 30_000 })
        .toBe(2);
    }
    await adderPage.close();
  });

  // A signed figure as the ledger writes a balance ("+Rp 4.000", "−Rp 10.000", "Rp 0"), and an unsigned one as a card
  // writes it (a minus only).
  const signed = (n: number) => (n === 0 ? rp(0) : n > 0 ? `+${rp(n)}` : `−${rp(-n)}`);
  const money = (n: number) => (n < 0 ? `−${rp(-n)}` : rp(n));

  // The account as the role reads it, through the contract.
  async function account(page: Page, orderId: string): Promise<{ lastBalance: number; initialTotal: number; entries: number }> {
    const res = await api(page, "settlement.v1.SettlementService/OrderSettlementDetail", { teamId: ground.g!.team, orderId });
    return {
      lastBalance: Number(res.settlement?.lastBalance ?? 0),
      initialTotal: Number(res.settlement?.initialTotal ?? 0),
      entries: (res.entries ?? []).length,
    };
  }

  // The order's page, its ledger loaded (the sale's row drawn).
  async function openLedger(page: Page, orderId: string): Promise<Locator> {
    await page.goto(`/orders/${orderId}`);
    const panel = page.getByTestId("order-ledger-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(entriesOfType(panel, "Estimate").first()).toBeVisible({ timeout: 10_000 });
    await settled(page);
    return panel;
  }

  // Analytic › Settlement by shop, narrowed to one shop: its Sales, Received and Gap cells as drawn.
  async function metricOf(page: Page, shop: string): Promise<{ sales: string; received: string; gap: string }> {
    await page.goto(`/analytic?g=shop&m=metrics/settlement&r=7d&shop=${shop}`);
    await settled(page);
    const cell = (field: string) => page.getByTestId(`analytic-cell-${shop}-${field}`);
    await expect(cell("sales")).toBeVisible({ timeout: 3_000 });
    return {
      sales: (await cell("sales").innerText()).trim(),
      received: (await cell("received").innerText()).trim(),
      gap: (await cell("gap").innerText()).trim(),
    };
  }

  // WHEN — the row's Reverse, the confirm read, Post Reversal. Returns the reversal's id from the answer.
  async function reverse(page: Page, panel: Locator, entryId: string, o: { type: string; amount: number }): Promise<{ id: string; reversesId: string }> {
    await panel.getByTestId(`ledger-reverse-${entryId}`).click();
    const confirm = page.getByRole("alertdialog", { name: "Reverse This Entry" });
    await expect(confirm).toBeVisible({ timeout: 3_000 });
    // WHICH row it undoes, not only by how much: the opposite amount and the row's type.
    await expect(confirm).toContainText(`−${rp(o.amount)}`);
    await expect(confirm).toContainText(o.type);

    const posted = page.waitForResponse((res) => res.url().endsWith("/warehouse.settlement.v1.SettlementWriteService/SettlementPost"));
    await confirm.getByTestId("confirm-action").click();
    const answer = await posted;
    expect(answer.ok()).toBeTruthy();
    const entry = (await answer.json()).entry;
    const id = String(entry.id);
    await expect(confirm).toBeHidden({ timeout: 3_000 });
    await expect(panel.getByTestId(`entry-${id}`)).toBeVisible({ timeout: 10_000 });
    return { id, reversesId: String(entry.reversesId ?? "") };
  }

  const typeOf = (panel: Locator, id: string) => panel.getByTestId(`ledger-type-${id}`);
  const rowOf = (panel: Locator, id: string) => panel.getByTestId(`entry-${id}`);
  const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reversalLine = (amount: number) => new RegExp(`^\\s*reverses \\+${escaped(rp(amount))} of .+$`);

  for (const r of ROLES) {
    test.describe(`${r.given} wants to undo a wrong entry (manual payout with wrong amount)`, () => {
      test(`${r.given} reverse settlement entry (manual payout with wrong amount)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const orderId = orderOfCase("g12", r);
        const shop = ground.metricShop[r.key]!;

        // BEFORE — the account and the shop's metric as they stand with the sale alone (its fold landed: Gap = sale).
        const before = await account(page, orderId);
        let metricBefore = { sales: "", received: "", gap: "" };
        await expect(async () => {
          metricBefore = await metricOf(page, shop);
          expect(metricBefore.gap).toBe(rp(SALE));
        }).toPass({ timeout: 45_000 });

        // GIVEN — the role types a payout with the wrong amount, and the metric counts it.
        const wrong = await api(page, "settlement.v1.SettlementWriteService/SettlementPost", {
          teamId: ground.g!.team,
          orderId,
          shopId: shop,
          uniqueId: `manual-xr-${SUFFIX}-${r.key}`,
          settlementType: "SETTLEMENT_TYPE_FUND",
          sourceType: "SOURCE_TYPE_MANUAL",
          change: WRONG,
          occurredOn: today(),
          note: "payout typed with the wrong amount",
        });
        const wrongId = String(wrong.entry.id);
        await expect(async () => {
          const m = await metricOf(page, shop);
          expect(m.received).toBe(rp(WRONG));
        }).toPass({ timeout: 45_000 });

        const panel = await openLedger(page, orderId);
        await expect(rowOf(panel, wrongId)).toContainText(`+${rp(WRONG)}`);
        await expect(panel.getByTestId(`ledger-balance-${wrongId}`)).toHaveText(signed(before.lastBalance + WRONG));

        const { id, reversesId } = await reverse(page, panel, wrongId, { type: "Payout", amount: WRONG });

        await test.step("then: reversing row added", async () => {
          expect.soft(reversesId).toBe(wrongId);
          await expect.soft(typeOf(panel, id)).toHaveText("Payout");
          await expect.soft(rowOf(panel, id).getByTestId("source-badge-manual")).toBeVisible();
          await expect.soft(rowOf(panel, id)).toContainText(`−${rp(WRONG)}`);
          await expect.soft(panel.getByTestId(`ledger-reversal-${id}`)).toHaveText(reversalLine(WRONG));
          await expect.soft(entriesOfType(panel, "Payout")).toHaveCount(2);
          expect.soft((await account(page, orderId)).entries).toBe(before.entries + 2);
        });

        await test.step("then: original shown as reversed", async () => {
          const original = rowOf(panel, wrongId);
          await expect.soft(original).toBeVisible();
          await expect.soft(original).toContainText(`+${rp(WRONG)}`);
          await expect.soft(original.getByTestId("source-badge-manual")).toBeVisible();
          await expect.soft(original).toHaveCSS("opacity", "0.5");
          await expect.soft(panel.getByTestId(`ledger-reverse-${wrongId}`)).toHaveCount(0);
          await expect.soft(panel.getByTestId(`ledger-reverse-${id}`)).toHaveCount(0);
          // The control: the sale's own row, never reversed, is drawn at full strength.
          const sale = entriesOfType(panel, "Estimate");
          await expect.soft(sale).toHaveCSS("opacity", "1");
        });

        await test.step("then: order balance back to before", async () => {
          await expect.soft(panel.getByTestId(`ledger-balance-${id}`)).toHaveText(signed(before.lastBalance));
          await expect.soft(panel.getByTestId("received-value")).toHaveText(money(before.lastBalance + before.initialTotal));
          expect.soft((await account(page, orderId)).lastBalance).toBe(before.lastBalance);
        });

        await test.step("then: settlement analytic metric back to before", async () => {
          await expect
            .soft(async () => {
              const m = await metricOf(page, shop);
              expect(m).toEqual(metricBefore);
            })
            .toPass({ timeout: 45_000 });
        });
      });
    });

    test.describe(`${r.given} wants to undo a wrong entry (imported row on the wrong order)`, () => {
      test(`${r.given} reverse settlement entry (imported row on the wrong order)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const orderId = orderOfCase("g13", r);
        const panel = await openLedger(page, orderId);

        // GIVEN, as the page says it: the imported Payout on this order.
        const imported = entriesOfType(panel, "Payout");
        await expect(imported).toHaveCount(1);
        await expect(imported.getByTestId("source-badge-importer")).toBeVisible();
        await expect(imported).toContainText(`+${rp(IMPORTED)}`);
        const importedId = String(await imported.getAttribute("data-testid")).replace(/^entry-/, "");
        const before = await account(page, orderId);

        const { id, reversesId } = await reverse(page, panel, importedId, { type: "Payout", amount: IMPORTED });

        await test.step("then: reversing row added", async () => {
          expect.soft(reversesId).toBe(importedId);
          await expect.soft(typeOf(panel, id)).toHaveText("Payout");
          await expect.soft(rowOf(panel, id).getByTestId("source-badge-manual")).toBeVisible();
          await expect.soft(rowOf(panel, id)).toContainText(`−${rp(IMPORTED)}`);
          await expect.soft(panel.getByTestId(`ledger-reversal-${id}`)).toHaveText(reversalLine(IMPORTED));
          await expect.soft(entriesOfType(panel, "Payout")).toHaveCount(2);
          expect.soft((await account(page, orderId)).entries).toBe(before.entries + 1);
        });

        await test.step("then: original shown as reversed", async () => {
          const original = rowOf(panel, importedId);
          await expect.soft(original).toBeVisible();
          await expect.soft(original).toContainText(`+${rp(IMPORTED)}`);
          await expect.soft(original.getByTestId("source-badge-importer")).toBeVisible();
          await expect.soft(original).toHaveCSS("opacity", "0.5");
          await expect.soft(panel.getByTestId(`ledger-reverse-${importedId}`)).toHaveCount(0);
          await expect.soft(panel.getByTestId(`ledger-reverse-${id}`)).toHaveCount(0);
          const sale = entriesOfType(panel, "Estimate");
          await expect.soft(sale).toHaveCSS("opacity", "1");
        });

        await test.step("regression: the order's balance loses the imported amount", async () => {
          await expect.soft(panel.getByTestId(`ledger-balance-${id}`)).toHaveText(signed(before.lastBalance - IMPORTED));
          expect.soft((await account(page, orderId)).lastBalance).toBe(before.lastBalance - IMPORTED);
        });
      });
    });
  }
});

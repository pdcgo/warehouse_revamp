import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { API_URL } from "./env";
import { PASSWORD, ROLES, entriesOfType, orderOf, rp, sellingGround, settled, shopOf } from "./settlement_import_helpers";
import type { Ground, Role } from "./settlement_import_helpers";
import { today } from "./settlement_statements";

// ── selling:all wants to record money on an order — the checks behind docs/acceptances/settlement/order_settlement.md,
// action *add settlement entry* (givens 5–11).
//
// An acceptance has no test file of its own (docs/acceptances/guide.md): its checks live in the regression spec of the
// feature its WHEN belongs to — adding an entry to an order's settlement by hand. The rows' statuses are set from this
// file's green results (scripts/acceptance_mark.py), never by the file itself.
//
// The WHEN is what a person does: on the order's page, the ledger's Add Entry → the Add Settlement Entry dialog — a
// type, a direction (Reached us / Taken from us), an amount — then Post Entry. Every order is root's, one unit of the
// ground's product, its Estimate (Rp 100.000) posted by the order's own event. Each role adds to ORDERS OF ITS OWN, so
// no role reads another's row:
// - given 5 (payout · reached us) — a Payout of Rp 60.000, Reached us, on an order that is the only one of a shop of the
//   role's own (so the shop's Settlement metric is that one order); its "with who added it" half on a second order;
// - given 6 (ads fee · taken from us) — an Ads fee of Rp 5.000, Taken from us;
// - given 7 (ads fee returned · reached us) — an Ads fee of Rp 3.000, Reached us (the platform giving a fee back);
// - given 8 (payout · submitted twice by double click) — a Payout of Rp 70.000, Post Entry double-clicked;
// - givens 9–11 are `selling:owner · selling:cs` only (initial-total-is-postable-by-cs-and-owners — selling:admin may
//   not author the sale; a `regression:` test pins that the form does not offer it to selling:admin):
//   - 9 (order with no estimate) — an order whose account holds no live Estimate: its placement Estimate was taken down
//     by root's reversal before the role opens it, and the page says "No marketplace selling price was recorded". ⚠ The
//     decision's own case — an account that never opened (a-missing-account-is-fixed-by-hand) — cannot be seeded:
//     placement refuses a 0 total (platform-total-is-required-at-finalize) and the order's event always opens the
//     account. The role records the sale, Rp 100.000, as the ledger writes a sale: Taken from us (−);
//   - 10 (order already has an estimate) — the order's placement Estimate is live;
//   - 11 (estimate reversed) — the same reversal, and the right figure (Rp 90.000) recorded after it.
//
// How each then is read:
// - `row added as manual (with who added it)` — the new row (its id from the SettlementPost answer) is of the type and
//   amount posted and carries the Manual source badge; "with who added it" = the badge reads *Manual · <the role's
//   name>* (the-source-is-a-badge). It was ❌ (a-manual-entry-names-its-adder-by-id: the badge read the user's id)
//   until #117 made the ledger name each row's actor; now a step of every role's given-5 test.
// - `order balance increases / decreases by the amount` — the new row's running balance is the account's balance
//   before (read from OrderSettlementDetail) ± the amount, and the Received card moves by the same amount.
// - `recorded in settlement analytic metric` — Analytic › Settlement by shop, narrowed to the role's shop (7 days):
//   Received reads the payout, Gap the sale less it.
// - `recorded once` — Post Entry double-clicked: one Payout row on the ledger (re-read after a reload), one new entry
//   on the account, its balance moved once.
// - `estimate recorded on the order` / `new estimate recorded on the order` — the new Estimate row is Manual with the
//   amount, the no-estimate notice is gone and the Estimate card reads the figure (OrderSettlementDetail's
//   initialTotal too).
// - `cannot add a second estimate` — the dialog's type list offers no Estimate (the ordinary five are there), and the
//   same SettlementPost sent anyway with the role's token is refused `failed_precondition`; the order keeps one
//   Estimate.
test.describe("selling:all wants to record money on an order — add settlement entry", () => {
  test.describe.configure({ timeout: 120_000 });

  const SALE = 100_000; // settlement_import_helpers' PLATFORM_TOTAL — every order's Estimate
  const PAYOUT = 60_000;
  const ADS_FEE = 5_000;
  const ADS_FEE_BACK = 3_000;
  const DOUBLE_PAYOUT = 70_000;
  const RIGHT_SALE = 90_000;
  const ref = (k: string) => `AE${SUFFIX}${k}`;
  const SALE_ROLES = ROLES.filter((r) => r.key !== "adm");

  // The orders, per role: `${given}-${role key}` → order id.
  const ground = {
    g: undefined as Ground | undefined,
    shop: "",
    metricShop: {} as Record<string, string>,
    order: {} as Record<string, string>,
  };
  const orderOfCase = (given: string, r: { key: string }) => ground.order[`${given}-${r.key}`]!;
  const shopOfOrder = (orderId: string) =>
    Object.entries(ground.metricShop).find(([key]) => ground.order[`g5-${key}`] === orderId)?.[1] ?? ground.shop;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "AE", 24);
    ground.g = g;
    const everyone = [g.users.own, g.users.adm, g.users.cs];
    ground.shop = await shopOf(page, g, `E2E AE shop ${SUFFIX}`, `AE0${SUFFIX}`, "MARKETPLACE_SHOPEE", everyone);

    for (const r of ROLES) {
      // Given 5's main order is the only order of a shop of the role's own — the shop's metric is that order alone.
      ground.metricShop[r.key] = await shopOf(page, g, `E2E AE metric ${r.key} ${SUFFIX}`, `AEM${r.n}${SUFFIX}`, "MARKETPLACE_SHOPEE", everyone);
      ground.order[`g5-${r.key}`] = await orderOf(page, g, ground.metricShop[r.key]!, ref(`5${r.key}`));
      for (const given of ["g6", "g7", "g8"]) {
        ground.order[`${given}-${r.key}`] = await orderOf(page, g, ground.shop, ref(`${given}${r.key}`));
      }
    }
    for (const r of SALE_ROLES) {
      for (const given of ["g9", "g10", "g11"]) {
        ground.order[`${given}-${r.key}`] = await orderOf(page, g, ground.shop, ref(`${given}${r.key}`));
      }
    }
    ground.order["g9-adm"] = await orderOf(page, g, ground.shop, ref("g9adm"));

    // Every order's Estimate is posted by the order's listener — wait for each account to open on it.
    const detail = (orderId: string) => api(page, "settlement.v1.SettlementService/OrderSettlementDetail", { teamId: g.team, orderId });
    for (const orderId of Object.values(ground.order)) {
      await expect.poll(async () => Number((await detail(orderId)).settlement?.initialTotal ?? 0), { timeout: 30_000 }).toBe(SALE);
    }

    // Givens 9 and 11 (and the admin regression): the placement Estimate taken down by root's reversal — the account
    // holds no live sale, so the page says no selling price was recorded.
    for (const key of ["g9-own", "g9-cs", "g9-adm", "g11-own", "g11-cs"]) {
      const orderId = ground.order[key]!;
      const entries = ((await detail(orderId)).entries ?? []) as Array<{ id: string; settlementType: string }>;
      const estimate = entries.find((e) => e.settlementType === "SETTLEMENT_TYPE_INITIAL_TOTAL");
      expect(estimate).toBeTruthy();
      await api(page, "settlement.v1.SettlementWriteService/SettlementPost", {
        teamId: g.team,
        orderId,
        shopId: ground.shop,
        uniqueId: `reverse-ae-${SUFFIX}-${key}`,
        settlementType: "SETTLEMENT_TYPE_INITIAL_TOTAL",
        sourceType: "SOURCE_TYPE_MANUAL",
        change: SALE,
        occurredOn: today(),
        reversesId: estimate!.id,
        note: "estimate taken down",
      });
      // proto3 JSON leaves a zero out: an account whose sale is down reads no `initialTotal` at all.
      await expect.poll(async () => Number((await detail(orderId)).settlement?.initialTotal ?? 0), { timeout: 30_000 }).toBe(0);
    }
    await page.close();
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

  // A request sent anyway, with the page's own token — the answer read whatever its status.
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

  // The order's page, its ledger loaded (a sale row drawn, whatever it now reads).
  async function openLedger(page: Page, orderId: string): Promise<Locator> {
    await page.goto(`/orders/${orderId}`);
    const panel = page.getByTestId("order-ledger-panel");
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(entriesOfType(panel, "Estimate").first()).toBeVisible({ timeout: 10_000 });
    await settled(page);
    return panel;
  }

  // Add Entry → the dialog, the type picked from its list.
  async function openAddEntry(page: Page, panel: Locator): Promise<Locator> {
    await panel.getByTestId("add-entry").click();
    const dialog = page.getByTestId("add-entry-dialog");
    await expect(dialog).toBeVisible({ timeout: 3_000 });
    await expect(dialog).toContainText("Add Settlement Entry");
    return dialog;
  }

  async function openTypes(dialog: Locator): Promise<void> {
    await dialog.getByTestId("entry-type").click();
    await expect(dialog.getByTestId("entry-type-option-fund")).toBeVisible({ timeout: 3_000 });
  }

  // WHEN — Add Entry, the type, the direction, the amount, then Post Entry. Returns the new row's id from the answer.
  async function addEntry(
    page: Page,
    panel: Locator,
    o: { type: string; direction: "in" | "out"; amount: number; double?: boolean },
  ): Promise<string> {
    const dialog = await openAddEntry(page, panel);
    await openTypes(dialog);
    await dialog.getByTestId(`entry-type-option-${o.type}`).click();
    await dialog.getByTestId(`direction-${o.direction}`).click();
    await dialog.getByTestId("entry-amount").fill(String(o.amount));
    await expect(dialog.getByTestId("entry-preview")).toContainText(
      o.direction === "in" ? `This will add ${rp(o.amount)} to the order.` : `This will take ${rp(o.amount)} from the order.`,
    );

    const posted = page.waitForResponse((res) => res.url().endsWith("/warehouse.settlement.v1.SettlementWriteService/SettlementPost"));
    const submit = dialog.getByTestId("entry-submit");
    if (o.double) {
      await submit.dblclick();
    } else {
      await submit.click();
    }
    const answer = await posted;
    expect(answer.ok()).toBeTruthy();
    const id = String((await answer.json()).entry.id);
    await expect(dialog).toBeHidden({ timeout: 3_000 });
    await expect(panel.getByTestId(`entry-${id}`)).toBeVisible({ timeout: 10_000 });
    return id;
  }

  const typeOf = (panel: Locator, id: string) => panel.getByTestId(`ledger-type-${id}`);
  const rowOf = (panel: Locator, id: string) => panel.getByTestId(`entry-${id}`);

  for (const r of ROLES) {
    test.describe(`${r.given} wants to record money on an order (payout · reached us)`, () => {
      test(`${r.given} add settlement entry (payout · reached us)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const orderId = orderOfCase("g5", r);
        const panel = await openLedger(page, orderId);
        const before = await account(page, orderId);
        await expect(panel.getByTestId("received-value")).toHaveText(money(before.lastBalance + before.initialTotal));

        const id = await addEntry(page, panel, { type: "fund", direction: "in", amount: PAYOUT });

        // #117 fixed the ❌ (the-source-is-a-badge: *Manual · <who typed it>*) — the ledger now names each row's actor,
        // so the row the role has just added reads its own NAME, not its user id; folded into each role's own test.
        await test.step("then: row added as manual with who added it", async () => {
          await expect.soft(typeOf(panel, id)).toHaveText("Payout");
          const badge = rowOf(panel, id).getByTestId("source-badge-manual");
          await expect.soft(badge).toBeVisible();
          await expect.soft(badge).toHaveText(new RegExp(`^\\s*Manual\\s*·\\s*Imp AE ${r.given} ${SUFFIX}\\s*$`));
          await expect.soft(rowOf(panel, id)).toContainText(`+${rp(PAYOUT)}`);
        });

        await test.step("then: order balance increases by the amount", async () => {
          await expect.soft(panel.getByTestId(`ledger-balance-${id}`)).toHaveText(signed(before.lastBalance + PAYOUT));
          await expect.soft(panel.getByTestId("received-value")).toHaveText(money(before.lastBalance + before.initialTotal + PAYOUT));
          expect.soft((await account(page, orderId)).lastBalance).toBe(before.lastBalance + PAYOUT);
        });

        await test.step("then: recorded in settlement analytic metric", async () => {
          // Analytic › Settlement by shop, narrowed to the role's own shop (this order alone): Received is the payout,
          // the Gap the sale less it.
          const shop = shopOfOrder(orderId);
          await expect
            .soft(async () => {
              await page.goto(`/analytic?g=shop&m=metrics/settlement&r=7d&shop=${shop}`);
              await settled(page);
              await expect(page.getByTestId(`analytic-cell-${shop}-received`)).toHaveText(rp(PAYOUT), { timeout: 3_000 });
              await expect(page.getByTestId(`analytic-cell-${shop}-gap`)).toHaveText(rp(SALE - PAYOUT));
            })
            .toPass({ timeout: 45_000 });
        });
      });
    });

    test.describe(`${r.given} wants to record money on an order (ads fee · taken from us)`, () => {
      test(`${r.given} add settlement entry (ads fee · taken from us)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const orderId = orderOfCase("g6", r);
        const panel = await openLedger(page, orderId);
        const before = await account(page, orderId);

        const id = await addEntry(page, panel, { type: "external_ads_fee", direction: "out", amount: ADS_FEE });

        await test.step("then: row added as manual", async () => {
          await expect.soft(typeOf(panel, id)).toHaveText("Ads fee");
          await expect.soft(rowOf(panel, id).getByTestId("source-badge-manual")).toBeVisible();
          await expect.soft(rowOf(panel, id).locator('[data-testid^="source-badge-"]')).toHaveCount(1);
          await expect.soft(rowOf(panel, id)).toContainText(`−${rp(ADS_FEE)}`);
        });

        await test.step("then: order balance decreases by the amount", async () => {
          await expect.soft(panel.getByTestId(`ledger-balance-${id}`)).toHaveText(signed(before.lastBalance - ADS_FEE));
          await expect.soft(panel.getByTestId("received-value")).toHaveText(money(before.lastBalance + before.initialTotal - ADS_FEE));
          expect.soft((await account(page, orderId)).lastBalance).toBe(before.lastBalance - ADS_FEE);
        });
      });
    });

    test.describe(`${r.given} wants to record money on an order (ads fee returned · reached us)`, () => {
      test(`${r.given} add settlement entry (ads fee returned · reached us)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const orderId = orderOfCase("g7", r);
        const panel = await openLedger(page, orderId);
        const before = await account(page, orderId);

        const id = await addEntry(page, panel, { type: "external_ads_fee", direction: "in", amount: ADS_FEE_BACK });

        await test.step("then: order balance increases by the amount", async () => {
          await expect.soft(typeOf(panel, id)).toHaveText("Ads fee");
          await expect.soft(rowOf(panel, id)).toContainText(`+${rp(ADS_FEE_BACK)}`);
          await expect.soft(panel.getByTestId(`ledger-balance-${id}`)).toHaveText(signed(before.lastBalance + ADS_FEE_BACK));
          await expect.soft(panel.getByTestId("received-value")).toHaveText(money(before.lastBalance + before.initialTotal + ADS_FEE_BACK));
          expect.soft((await account(page, orderId)).lastBalance).toBe(before.lastBalance + ADS_FEE_BACK);
        });
      });
    });

    test.describe(`${r.given} wants to record money on an order (payout · submitted twice by double click)`, () => {
      test(`${r.given} add settlement entry (payout · submitted twice by double click)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const orderId = orderOfCase("g8", r);
        const panel = await openLedger(page, orderId);
        const before = await account(page, orderId);
        const posts: string[] = [];
        page.on("request", (req) => {
          if (req.url().endsWith("SettlementWriteService/SettlementPost")) posts.push(req.postData() ?? "");
        });

        const id = await addEntry(page, panel, { type: "fund", direction: "in", amount: DOUBLE_PAYOUT, double: true });
        await settled(page);

        await test.step("then: recorded once", async () => {
          await expect.soft(entriesOfType(panel, "Payout")).toHaveCount(1);
          await expect.soft(panel.getByTestId(`ledger-balance-${id}`)).toHaveText(signed(before.lastBalance + DOUBLE_PAYOUT));
          const after = await account(page, orderId);
          expect.soft(after.entries).toBe(before.entries + 1);
          expect.soft(after.lastBalance).toBe(before.lastBalance + DOUBLE_PAYOUT);
          // Read again from a fresh load — no second row arriving late.
          const reloaded = await openLedger(page, orderId);
          await expect.soft(entriesOfType(reloaded, "Payout")).toHaveCount(1);
          await expect.soft(reloaded.getByTestId("received-value")).toHaveText(money(before.lastBalance + before.initialTotal + DOUBLE_PAYOUT));
        });
        test.info().annotations.push({ type: "SettlementPost requests", description: String(posts.length) });
      });
    });
  }

  for (const r of SALE_ROLES) {
    test.describe(`${r.given} wants to record a missing sale (order with no estimate)`, () => {
      test(`${r.given} add settlement entry (order with no estimate)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const orderId = orderOfCase("g9", r);
        const panel = await openLedger(page, orderId);

        // GIVEN, as the page says it: no selling price is recorded — the sale taken down, nothing live.
        await expect(panel.getByTestId("no-estimate-notice")).toBeVisible();
        await expect(panel.getByTestId("sold-value")).toHaveCount(0);
        const estimates = await entriesOfType(panel, "Estimate").count();

        const id = await addEntry(page, panel, { type: "initial_total", direction: "out", amount: SALE });

        await test.step("then: estimate recorded on the order", async () => {
          await expect.soft(typeOf(panel, id)).toHaveText("Estimate");
          await expect.soft(rowOf(panel, id).getByTestId("source-badge-manual")).toBeVisible();
          await expect.soft(rowOf(panel, id)).toContainText(`−${rp(SALE)}`);
          await expect.soft(entriesOfType(panel, "Estimate")).toHaveCount(estimates + 1);
          await expect.soft(panel.getByTestId("no-estimate-notice")).toHaveCount(0);
          await expect.soft(panel.getByTestId("sold-value")).toHaveText(rp(SALE));
          expect.soft((await account(page, orderId)).initialTotal).toBe(SALE);
        });
      });
    });

    test.describe(`${r.given} wants to record a missing sale (order already has an estimate)`, () => {
      test(`${r.given} add settlement entry (order already has an estimate)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const orderId = orderOfCase("g10", r);
        const panel = await openLedger(page, orderId);

        // GIVEN, as the page says it: the sale is recorded — one Estimate, the Estimate card reading it.
        await expect(entriesOfType(panel, "Estimate")).toHaveCount(1);
        await expect(panel.getByTestId("sold-value")).toHaveText(rp(SALE));

        const dialog = await openAddEntry(page, panel);
        await openTypes(dialog);

        await test.step("then: cannot add a second estimate", async () => {
          // The form: the ordinary five are offered, the sale is not.
          for (const type of ["fund", "external_ads_fee", "affiliate_fee", "marketplace_adjustment", "other"]) {
            await expect.soft(dialog.getByTestId(`entry-type-option-${type}`)).toBeVisible();
          }
          await expect.soft(dialog.getByTestId("entry-type-option-initial_total")).toHaveCount(0);
          await page.keyboard.press("Escape");

          // The server: the same post sent anyway, with the role's own token, is refused.
          const res = await send(page, "settlement.v1.SettlementWriteService/SettlementPost", {
            teamId: ground.g!.team,
            orderId,
            shopId: ground.shop,
            uniqueId: `manual-ae-second-${SUFFIX}-${r.key}`,
            settlementType: "SETTLEMENT_TYPE_INITIAL_TOTAL",
            sourceType: "SOURCE_TYPE_MANUAL",
            change: -SALE,
            occurredOn: today(),
          });
          expect.soft(res.status).not.toBe(200);
          expect.soft(res.json.code).toBe("failed_precondition");
          const after = await account(page, orderId);
          expect.soft(after.initialTotal).toBe(SALE);
          expect.soft(after.entries).toBe(1);
          const reloaded = await openLedger(page, orderId);
          await expect.soft(entriesOfType(reloaded, "Estimate")).toHaveCount(1);
          await expect.soft(reloaded.getByTestId("sold-value")).toHaveText(rp(SALE));
        });
      });
    });

    test.describe(`${r.given} wants to fix a wrong estimate (estimate reversed)`, () => {
      test(`${r.given} add settlement entry (estimate reversed)`, async ({ page }) => {
        await login(page, ground.g!.usernames[r.key], PASSWORD);
        const orderId = orderOfCase("g11", r);
        const panel = await openLedger(page, orderId);

        // GIVEN, as the page says it: the wrong Estimate (Rp 100.000) and its reversal — nothing live.
        const estimates = entriesOfType(panel, "Estimate");
        await expect(estimates).toHaveCount(2);
        await expect(panel.locator('[data-testid^="ledger-reversal-"]')).toHaveCount(1);
        await expect(panel.getByTestId("no-estimate-notice")).toBeVisible();

        const id = await addEntry(page, panel, { type: "initial_total", direction: "out", amount: RIGHT_SALE });

        await test.step("then: new estimate recorded on the order", async () => {
          await expect.soft(typeOf(panel, id)).toHaveText("Estimate");
          await expect.soft(rowOf(panel, id).getByTestId("source-badge-manual")).toBeVisible();
          await expect.soft(rowOf(panel, id)).toContainText(`−${rp(RIGHT_SALE)}`);
          await expect.soft(estimates).toHaveCount(3);
          await expect.soft(panel.getByTestId("no-estimate-notice")).toHaveCount(0);
          await expect.soft(panel.getByTestId("sold-value")).toHaveText(rp(RIGHT_SALE));
          expect.soft((await account(page, orderId)).initialTotal).toBe(RIGHT_SALE);
        });

        await test.step("regression: the wrong estimate stays shown, as reversed", async () => {
          // The order's own Estimate row keeps its Order badge, and no Reverse is offered on it or on its reversal.
          const original = estimates.filter({ has: page.getByTestId("source-badge-order") });
          await expect.soft(original).toHaveCount(1);
          await expect.soft(original.locator('[data-testid^="ledger-reverse-"]')).toHaveCount(0);
          await expect.soft(panel.locator('[data-testid^="ledger-reversal-"]')).toHaveCount(1);
        });
      });
    });
  }

  test.describe("selling:admin wants to record a missing sale — regression", () => {
    test("selling:admin add settlement entry — regression: the sale is not offered to selling:admin", async ({ page }) => {
      const admin: Role = ROLES.find((r) => r.key === "adm")!;
      await login(page, ground.g!.usernames[admin.key], PASSWORD);
      const panel = await openLedger(page, orderOfCase("g9", admin));
      await expect(panel.getByTestId("no-estimate-notice")).toBeVisible();

      const dialog = await openAddEntry(page, panel);
      await openTypes(dialog);
      await test.step("regression: the ordinary five are offered to selling:admin, the sale is not", async () => {
        for (const type of ["fund", "external_ads_fee", "affiliate_fee", "marketplace_adjustment", "other"]) {
          await expect.soft(dialog.getByTestId(`entry-type-option-${type}`)).toBeVisible();
        }
        await expect.soft(dialog.getByTestId("entry-type-option-initial_total")).toHaveCount(0);
      });
    });
  });
});

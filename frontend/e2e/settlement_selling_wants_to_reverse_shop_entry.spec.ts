import { expect, test } from "@playwright/test";
import type { Locator, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { API_URL } from "./env";
import { SUFFIX, api, login } from "./restock_helpers";
import { PASSWORD, ROLES, importThroughDialog, rp, sellingGround, settled, shopOf } from "./settlement_import_helpers";
import type { Ground } from "./settlement_import_helpers";
import { tiktokStatement, today } from "./settlement_statements";

// ── selling:owner · selling:admin wants to undo a wrong shop entry — the checks behind
// docs/acceptances/settlement/shop_entry.md, action *reverse shop entry* (givens 5, 6 and 7).
//
// An acceptance has no test file of its own (docs/acceptances/guide.md): its checks live in the regression spec of the
// feature its WHEN belongs to — reversing a row on Penyelesaian › Entri Toko (/settlement/shop-entries). The rows'
// statuses are set from this file's green results (scripts/acceptance_mark.py), never by the file itself. The page's
// older regression (the_shop_entries.spec.ts, root only) stays as it is.
//
// The WHEN is what a person does: the row's Reverse → the "Reverse This Entry" confirm (it names the opposite amount, the
// row's kind and its shop) → Post Reversal. A row is never edited or deleted (a-correction-is-a-new-row): the reversal is
// a further row of the same kind, the exact opposite amount, on the same shop, pointing back at the row it undoes; a row
// is reversed ONCE (a-shop-entry-reverses-inline). One selling team, its roles owner and admin (cs has no row); every
// role works on shops of its OWN, so no role reads another's rows:
// - given 5 (imported fee on the wrong shop) — the role's "wrong" TikTok shop already holds a hand payout of Rp 60.000
//   (root's — the shop's money before the mistake). In the test the role reads the shop's figures, then imports a TikTok
//   statement into that shop whose only line is a *GMV Payment for TikTok Ads* of −Rp 25.000 with no order (an ads fee
//   that belonged to the team's other shop) and reverses that imported fee;
// - given 6 (already reversed) — root posts an ads fee of −Rp 15.000 on a shop of the role's and reverses it, keyed as the
//   page keys it (`reverse-<id>`);
// - given 7 (reversed by 2 people at once) — root posts an ads fee of −Rp 18.000 on a shop of the role's; the role and
//   the team's other reader open it at once, both press Reverse and both press Post Reversal in the same instant.
//
// How each then is read:
// - `reversing row added on the same shop` — the SettlementPost answer is a row on the wrong shop pointing back at the
//   fee; the shop's list (the server narrowed to it) gains it: Ads fee, +Rp 25.000, Manual, "Reverses #<fee>", its shop
//   cell naming the wrong shop; the team's other shop (where the fee belonged) still lists nothing.
// - `original shown as reversed` — the imported fee stays with its Import badge and −Rp 25.000, drawn muted (opacity 0.5,
//   the payout beside it 1), reads "Reversed" and offers no Reverse; nor does the reversal.
// - `received back to before` — the Received card on the shop's list reads what it read before the import (and the
//   server's total agrees).
// - `settlement analytic metric back to before` — Analytic › Settlement by shop, narrowed to the wrong shop (7 days):
//   every cell of its row reads what it read before the import, after Received was seen counting the fee.
// - `cannot reverse it again` — the reversed row and its reversal offer no Reverse; the server refuses a second reversal
//   under a new key (failed_precondition, "already reversed") and answers the page's own key with the existing reversal;
//   the shop still holds two rows.
// - `reversed once` — after the two confirms, the shop holds the fee and ONE reversal (both screens, and the server);
//   every answer that succeeded names that one row. A `regression:` step races two reversals under DIFFERENT keys through
//   the contract: one is written, the other refused.
test.describe("selling:owner · selling:admin wants to undo a wrong shop entry — reverse shop entry", () => {
  test.describe.configure({ timeout: 180_000 });

  const READERS = ROLES.filter((r) => r.key !== "cs");
  type Reader = (typeof READERS)[number];

  const BEFORE_PAYOUT = 60_000; // given 5 — the wrong shop's money before the mistake
  const FEE = 25_000; // given 5 — the imported ads fee, on the wrong shop
  const DONE = 15_000; // given 6 — the ads fee already reversed
  const RACED = 18_000; // given 7 — the ads fee two people reverse at once
  const KEYED = 12_000; // given 7's regression — the ads fee raced under two keys

  // TikTok's adjustment ids are 19 digits — unique per role and run (a row's key is its content, across teams).
  const adjustmentId = (r: Reader) => `78${SUFFIX}${r.n}05`.padEnd(19, "0");

  const ground = {
    g: undefined as Ground | undefined,
    right: { id: "", name: "" }, // the shop the fee belonged to
    wrong: {} as Record<string, { id: string; name: string }>, // given 5, per role
    done: {} as Record<string, { shop: string; entry: string; reversal: string }>, // given 6, per role
    raced: {} as Record<string, { shop: string; entry: string }>, // given 7, per role
    keyed: {} as Record<string, { shop: string; entry: string }>, // given 7's regression, per role
  };

  // A shop-addressed row (no order), posted by hand under the page's token — its id from the SettlementPost answer.
  async function postToShop(
    page: Page,
    shopId: string,
    o: { key: string; type: string; change: number; reversesId?: string },
  ): Promise<string> {
    const posted = await api(page, "settlement.v1.SettlementWriteService/SettlementPost", {
      teamId: ground.g!.team,
      shopId,
      uniqueId: o.key,
      settlementType: o.type,
      sourceType: "SOURCE_TYPE_MANUAL",
      change: o.change,
      occurredOn: today(),
      ...(o.reversesId ? { reversesId: o.reversesId, note: `reverses #${o.reversesId}` } : {}),
    });
    return String(posted.entry.id);
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "YR", 1);
    ground.g = g;
    const everyone = [g.users.own, g.users.adm, g.users.cs];

    ground.right.name = `E2E YR right shop ${SUFFIX}`;
    ground.right.id = await shopOf(page, g, ground.right.name, `YRB${SUFFIX}`, "MARKETPLACE_TIKTOK", everyone);

    for (const r of READERS) {
      const own = g.users[r.key];
      const rest = everyone.filter((u) => u !== own);

      // Given 5 — the role's wrong shop, granted to the role FIRST (its primary CS, so the role's import runs), with the
      // shop's money before the mistake.
      const wrongName = `E2E YR wrong ${r.key} ${SUFFIX}`;
      const wrong = await shopOf(page, g, wrongName, `YRA${r.n}${SUFFIX}`, "MARKETPLACE_TIKTOK", [own, ...rest]);
      ground.wrong[r.key] = { id: wrong, name: wrongName };
      await postToShop(page, wrong, { key: `manual-yr-${SUFFIX}-pay-${r.key}`, type: "SETTLEMENT_TYPE_FUND", change: BEFORE_PAYOUT });

      // Given 6 — an ads fee already reversed, keyed as the page keys a reversal.
      const doneShop = await shopOf(page, g, `E2E YR done ${r.key} ${SUFFIX}`, `YRC${r.n}${SUFFIX}`, "MARKETPLACE_SHOPEE", everyone);
      const entry = await postToShop(page, doneShop, {
        key: `manual-yr-${SUFFIX}-done-${r.key}`,
        type: "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE",
        change: -DONE,
      });
      const reversal = await postToShop(page, doneShop, {
        key: `reverse-${entry}`,
        type: "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE",
        change: DONE,
        reversesId: entry,
      });
      ground.done[r.key] = { shop: doneShop, entry, reversal };

      // Given 7 — an ads fee two people reverse at once; and, for its regression, one raced under two keys.
      const racedShop = await shopOf(page, g, `E2E YR raced ${r.key} ${SUFFIX}`, `YRD${r.n}${SUFFIX}`, "MARKETPLACE_SHOPEE", everyone);
      ground.raced[r.key] = {
        shop: racedShop,
        entry: await postToShop(page, racedShop, {
          key: `manual-yr-${SUFFIX}-raced-${r.key}`,
          type: "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE",
          change: -RACED,
        }),
      };
      const keyedShop = await shopOf(page, g, `E2E YR keyed ${r.key} ${SUFFIX}`, `YRE${r.n}${SUFFIX}`, "MARKETPLACE_SHOPEE", everyone);
      ground.keyed[r.key] = {
        shop: keyedShop,
        entry: await postToShop(page, keyedShop, {
          key: `manual-yr-${SUFFIX}-keyed-${r.key}`,
          type: "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE",
          change: -KEYED,
        }),
      };
    }
    await page.close();
  });

  // An RPC under the page's signed-in token that may be REFUSED: its status and its JSON body, never a throw.
  async function send(page: Page, method: string, body: unknown): Promise<{ status: number; json: Record<string, any> }> {
    return page.evaluate(
      async ([m, b, apiUrl]) => {
        const token =
          window.sessionStorage.getItem("warehouse_revamp.token") ?? window.localStorage.getItem("warehouse_revamp.token");
        const res = await fetch(`${apiUrl}/warehouse.${m as string}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(b),
        });
        return { status: res.status, json: (await res.json()) as Record<string, any> };
      },
      [method, body, API_URL] as const,
    );
  }

  // The shop's rows as the server lists them to the role (ShopSettlementEntryList, every day), and its Received total.
  async function serverRows(
    page: Page,
    shopId: string,
  ): Promise<{ rows: { id: string; change: number; reversesId: string; reversedById: string }[]; received: number }> {
    const res = await api(page, "settlement.v1.SettlementService/ShopSettlementEntryList", {
      teamId: ground.g!.team,
      filter: { shopId },
      page: { page: 1, limit: 50 },
    });
    const byId = (res.items?.[0]?.entry?.mapData ?? {}) as Record<string, any>;
    const rows = ((res.ids ?? []) as string[])
      .map((id) => byId[String(id)])
      .filter((row) => row !== undefined)
      .map((row) => ({
        id: String(row.entry.id),
        change: Number(row.entry.change ?? 0),
        reversesId: String(row.entry.reversesId ?? "0"),
        reversedById: String(row.reversedById ?? "0"),
      }));
    return { rows, received: Number(res.totalReceived ?? 0) };
  }

  // Penyelesaian › Entri Toko, narrowed to a shop (or the whole team), once its list has answered.
  async function openShopEntries(page: Page, shopId = ""): Promise<void> {
    await page.goto(`/settlement/shop-entries${shopId ? `?shop=${shopId}` : ""}`);
    await expect(page.getByTestId("shop-entries-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("shop-entries-count")).toHaveText(/^\d+$/, { timeout: 10_000 });
    await settled(page);
  }

  const listRows = (page: Page): Locator => page.locator('[data-testid="shop-entries-table"] tbody tr[data-testid^="shop-entry-"]');
  const rowOf = (page: Page, id: string) => page.getByTestId(`shop-entry-${id}`);
  const shopCell = (page: Page, id: string) => rowOf(page, id).locator("td").nth(1);

  // Analytic › Settlement by shop, narrowed to one shop: every cell of its row, as drawn.
  async function metricOf(page: Page, shop: string): Promise<Record<string, string>> {
    await page.goto(`/analytic?g=shop&m=metrics/settlement&r=7d&shop=${shop}`);
    await settled(page);
    await expect(page.getByTestId(`analytic-cell-${shop}-received`)).toBeVisible({ timeout: 3_000 });
    const cells = page.locator(`[data-testid^="analytic-cell-${shop}-"]`);
    const out: Record<string, string> = {};
    for (const cell of await cells.all()) {
      out[(await cell.getAttribute("data-testid"))!.replace(`analytic-cell-${shop}-`, "")] = (await cell.innerText()).trim();
    }
    return out;
  }

  // WHEN, up to the confirm — the row's Reverse, and the confirm read: the opposite amount, the kind, the shop.
  async function openReverse(page: Page, entryId: string, o: { amount: string; shop: string }): Promise<Locator> {
    await page.getByTestId(`shop-entry-reverse-${entryId}`).click();
    const confirm = page.getByRole("alertdialog", { name: "Reverse This Entry" });
    await expect(confirm).toBeVisible({ timeout: 3_000 });
    await expect(confirm).toContainText(o.amount);
    await expect(confirm).toContainText("Ads fee");
    await expect(confirm).toContainText(o.shop);
    return confirm;
  }

  const posted = (page: Page) =>
    page.waitForResponse((res) => res.url().endsWith("/warehouse.settlement.v1.SettlementWriteService/SettlementPost"));

  for (const r of READERS) {
    const other = READERS.find((x) => x.key !== r.key)!;

    test.describe(`${r.given} wants to undo a wrong shop entry (imported fee on the wrong shop)`, () => {
      test(`${r.given} reverse shop entry (imported fee on the wrong shop)`, async ({ page }) => {
        const g = ground.g!;
        const wrong = ground.wrong[r.key]!;
        await login(page, g.usernames[r.key], PASSWORD);

        // BEFORE — the wrong shop as it stands with its own money alone: its metric (the payout's fold landed) and its
        // list's Received card.
        let metricBefore: Record<string, string> = {};
        await expect(async () => {
          metricBefore = await metricOf(page, wrong.id);
          expect(metricBefore.received).toBe(rp(BEFORE_PAYOUT));
        }).toPass({ timeout: 45_000 });
        await openShopEntries(page, wrong.id);
        await expect(page.getByTestId("shop-entries-count")).toHaveText("1");
        const receivedBefore = (await page.getByTestId("shop-entries-received").innerText()).trim();
        expect(receivedBefore).toBe(`+${rp(BEFORE_PAYOUT)}`);
        const payout = (await serverRows(page, wrong.id)).rows[0]!.id;

        // GIVEN — the role imports the day's TikTok statement into the wrong shop: an ads fee with no order, which posts
        // to the shop (an-entry-names-an-order-or-a-shop).
        const dialog = await importThroughDialog(
          page,
          wrong.id,
          tiktokStatement([{ id: adjustmentId(r), kind: "GMV Payment for TikTok Ads", amount: -FEE }]),
          "tiktok_statement.xlsx",
        );
        await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
        await expect(dialog.getByTestId("tally-posted-value")).toHaveText("1");
        await dialog.getByTestId("import-close").click();

        // … and the metric counts it.
        await expect(async () => {
          const m = await metricOf(page, wrong.id);
          expect(m.received).toBe(rp(BEFORE_PAYOUT - FEE));
        }).toPass({ timeout: 45_000 });

        await openShopEntries(page, wrong.id);
        const fee = listRows(page).filter({ has: page.locator('[data-testid^="shop-entry-kind-"]', { hasText: /^Ads fee$/ }) });
        await expect(fee).toHaveCount(1);
        const feeId = (await fee.getAttribute("data-testid"))!.replace("shop-entry-", "");
        await expect(page.getByTestId(`shop-entry-amount-${feeId}`)).toHaveText(`−${rp(FEE)}`);
        await expect(fee.getByTestId("source-badge-importer")).toBeVisible();
        await expect(page.getByTestId("shop-entries-received")).toHaveText(`+${rp(BEFORE_PAYOUT - FEE)}`);

        // WHEN — Reverse on the fee, the confirm read, Post Reversal.
        const confirm = await openReverse(page, feeId, { amount: `+${rp(FEE)}`, shop: wrong.name });
        const answered = posted(page);
        await confirm.getByTestId("confirm-action").click();
        const answer = await answered;
        expect(answer.ok()).toBeTruthy();
        const entry = (await answer.json()).entry;
        const id = String(entry.id);
        await expect(confirm).toBeHidden({ timeout: 3_000 });
        await expect(rowOf(page, id)).toBeVisible({ timeout: 10_000 });

        await test.step("then: reversing row added on the same shop", async () => {
          expect.soft(String(entry.reversesId ?? "")).toBe(feeId);
          expect.soft(String(entry.shopId ?? "")).toBe(wrong.id);
          expect.soft(entry.orderId ?? "0").toBe("0");
          // On the shop's own list (the server narrowed to it): the same kind, the opposite amount, by hand, pointing back.
          await expect.soft(page.getByTestId(`shop-entry-kind-${id}`)).toHaveText("Ads fee");
          await expect.soft(page.getByTestId(`shop-entry-amount-${id}`)).toHaveText(`+${rp(FEE)}`);
          await expect.soft(rowOf(page, id).getByTestId("source-badge-manual")).toBeVisible();
          await expect.soft(page.getByTestId(`shop-entry-reversal-${id}`)).toHaveText(`Reverses #${feeId}`);
          await expect.soft(shopCell(page, id)).toContainText(wrong.name);
          await expect.soft(page.getByTestId("shop-entries-count")).toHaveText("3");
          const server = await serverRows(page, wrong.id);
          expect.soft(server.rows.map((x) => x.id).sort()).toEqual([payout, feeId, id].sort());
          // On the team's whole list it is drawn on the wrong shop too — never moved to the shop the fee belonged to.
          await openShopEntries(page);
          await expect.soft(shopCell(page, id)).toContainText(wrong.name);
          await expect.soft(shopCell(page, id)).not.toContainText(ground.right.name);
          expect.soft((await serverRows(page, ground.right.id)).rows).toHaveLength(0);
          await openShopEntries(page, wrong.id);
        });

        await test.step("then: original shown as reversed", async () => {
          const original = rowOf(page, feeId);
          await expect.soft(original).toBeVisible();
          await expect.soft(page.getByTestId(`shop-entry-amount-${feeId}`)).toHaveText(`−${rp(FEE)}`);
          await expect.soft(original.getByTestId("source-badge-importer")).toBeVisible();
          await expect.soft(original).toHaveCSS("opacity", "0.5");
          await expect.soft(page.getByTestId(`shop-entry-reversed-${feeId}`)).toHaveText("Reversed");
          await expect.soft(page.getByTestId(`shop-entry-reverse-${feeId}`)).toHaveCount(0);
          await expect.soft(page.getByTestId(`shop-entry-reverse-${id}`)).toHaveCount(0);
          // The control: the payout, never reversed, is drawn at full strength and still offers Reverse.
          await expect.soft(rowOf(page, payout)).toHaveCSS("opacity", "1");
          await expect.soft(page.getByTestId(`shop-entry-reverse-${payout}`)).toBeVisible();
        });

        await test.step("then: received back to before", async () => {
          await expect.soft(page.getByTestId("shop-entries-received")).toHaveText(receivedBefore);
          expect.soft((await serverRows(page, wrong.id)).received).toBe(BEFORE_PAYOUT);
        });

        await test.step("then: settlement analytic metric back to before", async () => {
          await expect
            .soft(async () => {
              const m = await metricOf(page, wrong.id);
              expect(m).toEqual(metricBefore);
            })
            .toPass({ timeout: 45_000 });
        });
      });
    });

    test.describe(`${r.given} wants to undo a wrong shop entry (already reversed)`, () => {
      test(`${r.given} reverse shop entry (already reversed)`, async ({ page }) => {
        const g = ground.g!;
        const done = ground.done[r.key]!;
        await login(page, g.usernames[r.key], PASSWORD);

        // WHEN — the role opens the shop's entries to reverse the fee once more.
        await openShopEntries(page, done.shop);

        await test.step("then: cannot reverse it again", async () => {
          // On screen: the fee reads Reversed and offers no Reverse; nor does its reversal.
          await expect.soft(page.getByTestId("shop-entries-count")).toHaveText("2");
          await expect.soft(page.getByTestId(`shop-entry-reversed-${done.entry}`)).toHaveText("Reversed");
          await expect.soft(rowOf(page, done.entry)).toHaveCSS("opacity", "0.5");
          await expect.soft(page.getByTestId(`shop-entry-reversal-${done.reversal}`)).toHaveText(`Reverses #${done.entry}`);
          await expect.soft(page.getByTestId(`shop-entry-reverse-${done.entry}`)).toHaveCount(0);
          await expect.soft(page.getByTestId(`shop-entry-reverse-${done.reversal}`)).toHaveCount(0);
          await expect.soft(listRows(page).getByRole("button", { name: /^Reverse$/ })).toHaveCount(0);

          // Through the contract, with the role's token: a second reversal under a new key is refused …
          const again = await send(page, "settlement.v1.SettlementWriteService/SettlementPost", {
            teamId: g.team,
            shopId: done.shop,
            uniqueId: `reverse-${done.entry}-again-${r.key}`,
            settlementType: "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE",
            sourceType: "SOURCE_TYPE_MANUAL",
            change: DONE,
            occurredOn: today(),
            reversesId: done.entry,
          });
          expect.soft(again.status).toBe(400);
          expect.soft(again.json.code).toBe("failed_precondition");
          expect.soft(String(again.json.message ?? "")).toContain("already reversed");
          // … and the page's own key answers with the reversal already there, writing nothing.
          const same = await send(page, "settlement.v1.SettlementWriteService/SettlementPost", {
            teamId: g.team,
            shopId: done.shop,
            uniqueId: `reverse-${done.entry}`,
            settlementType: "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE",
            sourceType: "SOURCE_TYPE_MANUAL",
            change: DONE,
            occurredOn: today(),
            reversesId: done.entry,
          });
          expect.soft(same.status).toBe(200);
          expect.soft(String(same.json.entry?.id ?? "")).toBe(done.reversal);
          const server = await serverRows(page, done.shop);
          expect.soft(server.rows.map((x) => x.id).sort()).toEqual([done.entry, done.reversal].sort());
          await openShopEntries(page, done.shop);
          await expect.soft(page.getByTestId("shop-entries-count")).toHaveText("2");
        });
      });
    });

    test.describe(`${r.given} wants to undo a wrong shop entry (reversed by 2 people at once)`, () => {
      test(`${r.given} reverse shop entry (reversed by 2 people at once)`, async ({ page, browser }) => {
        const g = ground.g!;
        const raced = ground.raced[r.key]!;
        const shopName = `E2E YR raced ${r.key} ${SUFFIX}`;
        await login(page, g.usernames[r.key], PASSWORD);
        // The second person — the team's other reader, on a page of their own.
        const second = await browser.newPage();
        await login(second, g.usernames[other.key], PASSWORD);

        // WHEN — both open the shop's entries, both press Reverse on the fee, and both press Post Reversal at once.
        await openShopEntries(page, raced.shop);
        await openShopEntries(second, raced.shop);
        const confirms = [
          await openReverse(page, raced.entry, { amount: `+${rp(RACED)}`, shop: shopName }),
          await openReverse(second, raced.entry, { amount: `+${rp(RACED)}`, shop: shopName }),
        ];
        const answers: Promise<Response>[] = [posted(page), posted(second)];
        await Promise.all(confirms.map((c) => c.getByTestId("confirm-action").click()));
        const results = await Promise.all(
          answers.map(async (p) => {
            const res = await p;
            return { ok: res.ok(), json: (await res.json()) as Record<string, any> };
          }),
        );

        await test.step("then: reversed once", async () => {
          // The server: the fee and ONE reversal pointing back at it.
          const server = await serverRows(page, raced.shop);
          expect.soft(server.rows).toHaveLength(2);
          const reversals = server.rows.filter((x) => x.reversesId === raced.entry);
          expect.soft(reversals).toHaveLength(1);
          const reversal = reversals[0]?.id ?? "";
          expect.soft(server.rows.find((x) => x.id === raced.entry)?.reversedById).toBe(reversal);
          // Every answer that succeeded names that one row; one that did not was refused as already reversed.
          for (const res of results) {
            if (res.ok) expect.soft(String(res.json.entry?.id ?? "")).toBe(reversal);
            else expect.soft(["failed_precondition", "already_exists", "aborted"]).toContain(res.json.code);
          }
          expect.soft(results.some((res) => res.ok)).toBe(true);
          // Both screens, read again: two rows, the fee Reversed, one reversal.
          for (const p of [page, second]) {
            await openShopEntries(p, raced.shop);
            await expect.soft(p.getByTestId("shop-entries-count")).toHaveText("2");
            await expect.soft(listRows(p)).toHaveCount(2);
            await expect.soft(p.getByTestId(`shop-entry-reversed-${raced.entry}`)).toHaveText("Reversed");
            await expect.soft(p.locator('[data-testid^="shop-entry-reversal-"]')).toHaveCount(1);
            await expect.soft(p.getByTestId(`shop-entry-reversal-${reversal}`)).toHaveText(`Reverses #${raced.entry}`);
          }
          expect.soft(server.received).toBe(0);
        });

        await test.step("regression: two reversals at once under different keys write one", async () => {
          const keyed = ground.keyed[r.key]!;
          const body = (k: string) => ({
            teamId: g.team,
            shopId: keyed.shop,
            uniqueId: `race-${k}-${keyed.entry}`,
            settlementType: "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE",
            sourceType: "SOURCE_TYPE_MANUAL",
            change: KEYED,
            occurredOn: today(),
            reversesId: keyed.entry,
          });
          const both = await Promise.all([
            send(page, "settlement.v1.SettlementWriteService/SettlementPost", body("a")),
            send(second, "settlement.v1.SettlementWriteService/SettlementPost", body("b")),
          ]);
          expect.soft(both.filter((x) => x.status === 200)).toHaveLength(1);
          const refused = both.filter((x) => x.status !== 200);
          expect.soft(refused).toHaveLength(1);
          expect.soft(refused[0]?.json.code).toBe("failed_precondition");
          const server = await serverRows(page, keyed.shop);
          expect.soft(server.rows).toHaveLength(2);
          expect.soft(server.rows.filter((x) => x.reversesId === keyed.entry)).toHaveLength(1);
        });

        await second.close();
      });
    });
  }
});

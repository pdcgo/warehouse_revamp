import { expect, test } from "@playwright/test";
import type { Locator, Page, Response } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { openShops } from "./pickers";
import { SUFFIX, api, login } from "./restock_helpers";
import { PASSWORD, ROLES, rp, sellingGround, settled, shopOf } from "./settlement_import_helpers";
import type { Ground } from "./settlement_import_helpers";
import { today } from "./settlement_statements";

// ── selling:owner · selling:admin wants to find a shop's entries — the checks behind
// docs/acceptances/settlement/shop_entry.md, action *filter shop entries* (given 4).
//
// An acceptance has no test file of its own (docs/acceptances/guide.md): its checks live in the regression spec of the
// feature its WHEN belongs to — narrowing Penyelesaian › Entri Toko (/settlement/shop-entries) with its filter strip.
// The rows' statuses are set from this file's green results (scripts/acceptance_mark.py), never by the file itself.
// *open shop entries* is settlement_selling_wants_to_open_shop_entries.spec.ts; the page's older regression
// (the_shop_entries.spec.ts, root only) stays as it is.
//
// Given 4 (shop and kind chosen) — a selling team of its own with TWO Shopee shops, A and B, read by both roles the
// given names (owner, admin — cs has no row). Root posts six shop-addressed rows by hand (no order, today), so the
// filter has something on each side of it:
//   A: Withdrawal −100.000 · Ads fee −20.000 · Ads fee −7.000 · Payout +60.000
//   B: Ads fee −30.000 · Withdrawal −50.000
// Before the filter the cards count 6, Received +Rp 3.000 (every row but the withdrawals), Withdrawn Rp 150.000.
// WHEN — the role chooses shop A in the shop field and *Ads fee* in the kind field (the controls, not the address).
//
// How each then is read:
// - `cards total only the filtered rows` — the list the server answers for (shop A, Ads fee) — its request carries both
//   — holds exactly A's two ads fees; the cards then count 2, Received −Rp 27.000 (= the two rows' sum, read off the
//   rows too) and Withdrawn Rp 0 — never the team's 6 / +Rp 3.000 / Rp 150.000, nor B's ads fee or A's other rows.
// - `filter kept after reload` — the address holds `shop=<A>` and `kind=external_ads_fee`; after a reload the shop
//   field still names shop A, the kind field still reads Ads fee, the list asked for is again (shop A, Ads fee), and
//   the same two rows and the same cards are back.
test.describe("selling:owner · selling:admin wants to find a shop's entries — filter shop entries", () => {
  test.describe.configure({ timeout: 120_000 });

  const READERS = ROLES.filter((r) => r.key !== "cs");

  // Shop A's rows, then shop B's — every one posted by hand today, addressed to its shop.
  const A_WITHDRAWN = 100_000;
  const A_ADS_1 = 20_000;
  const A_ADS_2 = 7_000;
  const A_PAYOUT = 60_000;
  const B_ADS = 30_000;
  const B_WITHDRAWN = 50_000;

  const ADS_KIND = "external_ads_fee"; // the kind's URL word (the wire enum's name, lower-cased)
  const ADS_TYPE = "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE";

  const ground = {
    e: undefined as
      | { g: Ground; shopA: string; shopB: string; nameA: string; adsA: string[]; otherA: string[]; rowsB: string[] }
      | undefined,
  };

  // A shop-addressed row (no order), posted by hand by root — its id from the SettlementPost answer.
  async function postToShop(page: Page, g: Ground, shopId: string, key: string, settlementType: string, change: number) {
    return String(
      (
        await api(page, "settlement.v1.SettlementWriteService/SettlementPost", {
          teamId: g.team,
          shopId,
          uniqueId: `manual-osf-${SUFFIX}-${key}`,
          settlementType,
          sourceType: "SOURCE_TYPE_MANUAL",
          change,
          occurredOn: today(),
        })
      ).entry.id,
    );
  }

  // Given 4 — two shops of one team, each with rows of several kinds.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "EF", 1);
    const nameA = `E2E EF shop A ${SUFFIX}`;
    const grant = [g.users.own, g.users.adm, g.users.cs];
    const shopA = await shopOf(page, g, nameA, `EFA${SUFFIX}`, "MARKETPLACE_SHOPEE", grant);
    const shopB = await shopOf(page, g, `E2E EF shop B ${SUFFIX}`, `EFB${SUFFIX}`, "MARKETPLACE_SHOPEE", grant);

    const otherA = [await postToShop(page, g, shopA, "a-wd", "SETTLEMENT_TYPE_WITHDRAWAL", -A_WITHDRAWN)];
    const adsA = [
      await postToShop(page, g, shopA, "a-ads1", ADS_TYPE, -A_ADS_1),
      await postToShop(page, g, shopA, "a-ads2", ADS_TYPE, -A_ADS_2),
    ];
    otherA.push(await postToShop(page, g, shopA, "a-fund", "SETTLEMENT_TYPE_FUND", A_PAYOUT));
    const rowsB = [
      await postToShop(page, g, shopB, "b-ads", ADS_TYPE, -B_ADS),
      await postToShop(page, g, shopB, "b-wd", "SETTLEMENT_TYPE_WITHDRAWAL", -B_WITHDRAWN),
    ];

    ground.e = { g, shopA, shopB, nameA, adsA, otherA, rowsB };
    await page.close();
  });

  const listRows = (page: Page): Locator => page.locator('[data-testid="shop-entries-table"] tbody tr[data-testid^="shop-entry-"]');

  // The list answer the page asked for with this shop and this kind in its filter — proof the SERVER narrowed.
  const listedFor = (page: Page, shop: string, type: string): Promise<Response> =>
    page.waitForResponse((r) => {
      if (!r.url().endsWith("/ShopSettlementEntryList")) return false;
      const body = r.request().postData() ?? "";
      return body.includes(`"shopId":"${shop}"`) && body.includes(`"${type}"`);
    });

  // The rows on screen, as their ids, ascending.
  const shownIds = async (page: Page) =>
    (await listRows(page).evaluateAll((rows) => rows.map((r) => r.getAttribute("data-testid")!.replace("shop-entry-", ""))))
      .map(Number)
      .sort((a, b) => a - b)
      .map(String);
  const sorted = (ids: string[]) => [...ids].map(Number).sort((a, b) => a - b).map(String);

  // The filtered list: A's two ads fees, and cards that total them alone.
  async function expectFiltered(page: Page, adsA: string[]) {
    await expect(listRows(page)).toHaveCount(2);
    expect(await shownIds(page)).toEqual(sorted(adsA));
    await expect(page.getByTestId(`shop-entry-amount-${adsA[0]}`)).toHaveText(`−${rp(A_ADS_1)}`);
    await expect(page.getByTestId(`shop-entry-amount-${adsA[1]}`)).toHaveText(`−${rp(A_ADS_2)}`);
    await expect(page.getByTestId("shop-entries-count")).toHaveText("2");
    await expect(page.getByTestId("shop-entries-received")).toHaveText(`−${rp(A_ADS_1 + A_ADS_2)}`);
    await expect(page.getByTestId("shop-entries-withdrawn")).toHaveText(rp(0));
  }

  for (const r of READERS) {
    test.describe(`${r.given} wants to find a shop's entries (shop and kind chosen)`, () => {
      test(`${r.given} filter shop entries (shop and kind chosen)`, async ({ page }) => {
        const e = ground.e!;
        await login(page, e.g.usernames[r.key], PASSWORD);

        // GIVEN — the page as it opens (Last 1 month, every shop, every kind): the team's six rows.
        await page.goto("/settlement/shop-entries");
        await expect(page.getByTestId("shop-entries-page")).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId("shop-entries-count")).toHaveText("6", { timeout: 10_000 });
        await expect(page.getByTestId("shop-entries-received")).toHaveText(`+${rp(A_PAYOUT - A_ADS_1 - A_ADS_2 - B_ADS)}`);
        await expect(page.getByTestId("shop-entries-withdrawn")).toHaveText(rp(A_WITHDRAWN + B_WITHDRAWN));
        await settled(page);

        // WHEN — the role chooses shop A, then the kind Ads fee, in the filter strip.
        const shopField = page.getByTestId("shop-entries-shop-filter");
        await openShops(shopField);
        await shopField.getByTestId(`shop-select-option-${e.shopA}`).click();
        await expect(shopField.getByTestId("shop-select")).toHaveValue(e.nameA);
        await expect(page.getByTestId("shop-entries-count")).toHaveText("4");

        const narrowed = listedFor(page, e.shopA, ADS_TYPE);
        await page.getByTestId("shop-entries-kind").click();
        const adsOption = page.getByTestId(`shop-entries-kind-option-${ADS_KIND}`);
        await expect(adsOption).toBeVisible();
        await adsOption.click();
        await narrowed;
        await settled(page);

        await test.step("then: cards total only the filtered rows", async () => {
          await expectFiltered(page, e.adsA);
          // The cards are the rows' own sum: Received = the two amounts shown.
          const shown = await page.locator('[data-testid^="shop-entry-amount-"]').allTextContents();
          const sum = shown.reduce((s, t) => s + (t.startsWith("−") ? -1 : 1) * Number(t.replace(/[^\d]/g, "")), 0);
          expect(sum).toBe(-(A_ADS_1 + A_ADS_2));
          // Nothing of B's, nor A's other kinds, is on the list.
          for (const id of [...e.otherA, ...e.rowsB]) await expect(page.getByTestId(`shop-entry-${id}`)).toHaveCount(0);
          await expect(page.getByTestId("shop-entries-count")).not.toHaveText("6");
          await expect(page.getByTestId("shop-entries-withdrawn")).not.toHaveText(rp(A_WITHDRAWN + B_WITHDRAWN));
        });

        await test.step("then: filter kept after reload", async () => {
          // The filter is in the address …
          const url = new URL(page.url());
          expect(url.pathname).toBe("/settlement/shop-entries");
          expect(url.searchParams.get("shop")).toBe(e.shopA);
          expect(url.searchParams.get("kind")).toBe(ADS_KIND);

          // … so a reload asks for the same list and draws the same filter, rows and cards.
          const again = listedFor(page, e.shopA, ADS_TYPE);
          await page.reload();
          await again;
          await expect(page.getByTestId("shop-entries-page")).toBeVisible({ timeout: 10_000 });
          await expect(shopField.getByTestId("shop-select")).toHaveValue(e.nameA, { timeout: 10_000 });
          await expect(page.getByTestId("shop-entries-kind")).toContainText("Ads fee");
          await expectFiltered(page, e.adsA);
          expect(new URL(page.url()).searchParams.get("shop")).toBe(e.shopA);
          expect(new URL(page.url()).searchParams.get("kind")).toBe(ADS_KIND);
          await settled(page);
        });
      });
    });
  }
});

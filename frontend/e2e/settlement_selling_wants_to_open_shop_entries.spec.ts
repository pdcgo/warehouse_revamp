import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import { PASSWORD, ROLES, importThroughDialog, rp, sellingGround, settled, shopOf } from "./settlement_import_helpers";
import type { Ground } from "./settlement_import_helpers";
import { SHOPEE_INCOME, SHOPEE_WITHDRAWAL, shopeeStatement, today } from "./settlement_statements";

// ── selling:owner · selling:admin wants to see money not tied to an order — the checks behind
// docs/acceptances/settlement/shop_entry.md, action *open shop entries* (givens 1, 2 and 3).
//
// An acceptance has no test file of its own (docs/acceptances/guide.md): its checks live in the regression spec of the
// feature its WHEN belongs to — opening Penyelesaian › Entri Toko (/settlement/shop-entries). The rows' statuses are set
// from this file's green results (scripts/acceptance_mark.py), never by the file itself. The page's older regression
// (the_shop_entries.spec.ts, root only) stays as it is; *filter shop entries* and *reverse shop entry* get specs of
// their own WHENs.
//
// The page lists the whole team's shop rows (no shop chosen, Last 1 month), so each given is a SELLING TEAM OF ITS OWN
// with one Shopee shop, read by both roles the given names (owner, admin — cs has no row). Every WHEN is the role
// opening the page as it opens; nothing is written by the roles:
// - given 1 (withdrawal · shop ads fee · imported row with no order) — the team's OWNER imports the day's Shopee
//   statement through the Import File dialog: a successful *Penarikan Dana* of Rp 300.000 (a withdrawal names no order)
//   and a *Penghasilan dari Pesanan* of Rp 75.000 whose No. Pesanan no order carries (an-unmatched-ref-posts-to-the-shop);
//   root posts a shop-level ads fee of Rp 20.000 by hand (no Shopee row is ever an ads fee — san_excel_readers).
// - given 2 (imported row matching 2 active orders) — root places TWO live orders on the shop carrying the same Order ID,
//   then the owner imports a Rp 50.000 *Penghasilan dari Pesanan* on that Order ID: no one order is credited, the row
//   posts to the shop (two-live-orders-on-a-ref-post-to-the-shop).
// - given 3 (entry belongs to 3 Nov · learned 10 Nov) — root posts by hand a payout of Rp 40.000 that BELONGS to the day
//   a week back, learned today, plus a withdrawal of today for contrast. A learned day cannot be back-dated (it is
//   stamped at insert), so the given's "10 Nov" is today and its "3 Nov" the day seven days before it.
//
// How each then is read:
// - `withdrawal, ads fee and unmatched row shown as rows` — exactly three rows, kinds Withdrawal (−Rp 300.000), Ads fee
//   (−Rp 20.000) and Payout (+Rp 75.000); the cards count 3.
// - `withdrawal counted in withdrawn, not in received` — Withdrawn reads Rp 300.000, Received +Rp 55.000 (the payout less
//   the ads fee), never the −Rp 245.000 a withdrawal counted in it would make.
// - `unmatched row shows its Order ID with order not found` — the payout's Reference reads "Ref <Order ID> · no order
//   found".
// - `imported row links to its statement` — each imported row's From cell is a link "Statement <day>" to the import it
//   came from (the file the dialog opened), by its uploader; following it opens that import's page on the shop. The
//   hand-posted ads fee reads "Posted by hand", no link.
// - `row shows its Order ID and both orders` — the row's Reference reads "Ref <Order ID> · 2 live orders: #a, #b",
//   both order ids, ascending; the team's only shop row (count 1, +Rp 50.000).
// - `shown on 10 Nov with for 3 Nov` — the payout's Date cell reads today with "for <a week back>" under it (today's
//   withdrawal reads its day alone); the window bucketing is by the LEARNED day: a window of today alone lists it, a
//   window of the day it belongs to lists nothing.
test.describe("selling:owner · selling:admin wants to see money not tied to an order — open shop entries", () => {
  test.describe.configure({ timeout: 120_000 });

  const READERS = ROLES.filter((r) => r.key !== "cs");

  const WITHDRAWN = 300_000; // given 1 — the imported withdrawal
  const UNMATCHED = 75_000; // given 1 — the imported payout no order carries
  const ADS = 20_000; // given 1 — the hand-posted shop ads fee
  const SEVERAL = 50_000; // given 2 — the imported payout on an Order ID two live orders carry
  const LATE = 40_000; // given 3 — the payout learned today for a day a week back
  const TODAY_WITHDRAWN = 10_000; // given 3 — a withdrawal of today, for contrast
  const ref = (k: string) => `OSE${SUFFIX}${k}`;

  const ground = {
    rows: undefined as { g: Ground; shop: string; name: string; file: string; ads: string; ownerName: string } | undefined, // given 1
    several: undefined as { g: Ground; shop: string; orders: string[] } | undefined, // given 2
    late: undefined as { g: Ground; shop: string; late: string; now: string; day: string } | undefined, // given 3
  };

  // Jakarta days, `yyyy-mm-dd`.
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // A day as the page writes it (formatDayShort): "15 Nov", the year only when it is not this year's.
  const dayShort = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
    return `${d} ${month}${String(y) !== today().slice(0, 4) ? ` ${y}` : ""}`;
  };

  // A shop-addressed row (no order), posted by hand by root — its id from the SettlementPost answer.
  async function postToShop(page: Page, g: Ground, shopId: string, key: string, settlementType: string, change: number, occurredOn = today()) {
    return String(
      (
        await api(page, "settlement.v1.SettlementWriteService/SettlementPost", {
          teamId: g.team,
          shopId,
          uniqueId: `manual-ose-${SUFFIX}-${key}`,
          settlementType,
          sourceType: "SOURCE_TYPE_MANUAL",
          change,
          occurredOn,
        })
      ).entry.id,
    );
  }

  // The team's owner imports a statement through the dialog; returns the import's file id (the page it opens).
  async function ownerImports(page: Page, shop: string, file: Buffer, posted: number): Promise<string> {
    const dialog = await importThroughDialog(page, shop, file);
    await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
    await expect(dialog.getByTestId("tally-posted-value")).toHaveText(String(posted));
    await dialog.getByTestId("open-imported-file").click();
    await expect(page.getByTestId("import-detail-shop")).toBeVisible({ timeout: 10_000 });
    return new URL(page.url()).pathname.split("/").pop()!;
  }

  // Given 1 — a withdrawal and an unmatched payout imported by the owner, a shop ads fee posted by hand.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "EN", 1);
    const name = `E2E EN shop ${SUFFIX}`;
    // The owner's grant is the first: the shop's primary CS, so its statements import.
    const shop = await shopOf(page, g, name, `ENO${SUFFIX}`, "MARKETPLACE_SHOPEE", [g.users.own, g.users.adm, g.users.cs]);
    const ads = await postToShop(page, g, shop, "ads", "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE", -ADS);

    const owner = await browser.newPage();
    await login(owner, g.usernames.own, PASSWORD);
    const file = await ownerImports(
      owner,
      shop,
      shopeeStatement([
        { kind: SHOPEE_WITHDRAWAL, description: `Penarikan Dana ${SUFFIX} ose`, amount: -WITHDRAWN },
        { kind: SHOPEE_INCOME, description: `Penghasilan dari Pesanan #${ref("N")}`, ref: ref("N"), amount: UNMATCHED },
      ]),
      2,
    );
    await owner.close();

    ground.rows = { g, shop, name, file, ads, ownerName: `Imp EN selling:owner ${SUFFIX}` };
    await page.close();
  });

  // Given 2 — two live orders on one Order ID, and a payout imported on it.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "EM", 2);
    const shop = await shopOf(page, g, `E2E EM shop ${SUFFIX}`, `EMO${SUFFIX}`, "MARKETPLACE_SHOPEE", [g.users.own, g.users.adm, g.users.cs]);
    const orders: string[] = [];
    for (const k of ["a", "b"]) {
      const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
        idempotencyKey: `e2e-ose-${ref("M")}-${k}`,
        shipmentChannelId: "1",
        teamId: g.team,
        shopId: shop,
        warehouseId: g.warehouse,
        customerName: `E2E OSE Buyer ${ref("M")} ${k}`,
        platformTotal: 100_000,
        platformCreatedAtUnix: Math.floor(Date.now() / 1000),
        orderExternalRefId: ref("M"), // the SAME Order ID on both
        items: [{ productId: g.productId, productCode: g.code, name: `E2E ${g.code}`, quantity: 1 }],
      });
      orders.push(String(placed.order.id));
    }
    orders.sort((a, b) => Number(a) - Number(b));

    const owner = await browser.newPage();
    await login(owner, g.usernames.own, PASSWORD);
    await ownerImports(
      owner,
      shop,
      shopeeStatement([{ kind: SHOPEE_INCOME, description: `Penghasilan dari Pesanan #${ref("M")}`, ref: ref("M"), amount: SEVERAL }]),
      1,
    );
    await owner.close();

    ground.several = { g, shop, orders };
    await page.close();
  });

  // Given 3 — a payout learned today for the day a week back, and a withdrawal of today.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g = await sellingGround(page, "EL", 1);
    const shop = await shopOf(page, g, `E2E EL shop ${SUFFIX}`, `ELO${SUFFIX}`, "MARKETPLACE_SHOPEE", [g.users.own, g.users.adm, g.users.cs]);
    const day = addDays(today(), -7);
    const late = await postToShop(page, g, shop, "late", "SETTLEMENT_TYPE_FUND", LATE, day);
    const now = await postToShop(page, g, shop, "now", "SETTLEMENT_TYPE_WITHDRAWAL", -TODAY_WITHDRAWN);

    ground.late = { g, shop, late, now, day };
    await page.close();
  });

  // WHEN — the role opens Penyelesaian › Entri Toko as it opens (or on a window, for given 3's bucketing proof), once
  // its list has answered.
  async function openShopEntries(page: Page, query = ""): Promise<void> {
    await page.goto(`/settlement/shop-entries${query}`);
    await expect(page.getByTestId("shop-entries-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("shop-entries-count")).toHaveText(/^\d+$/, { timeout: 10_000 });
    await settled(page);
  }

  const listRows = (page: Page): Locator => page.locator('[data-testid="shop-entries-table"] tbody tr[data-testid^="shop-entry-"]');
  // The list's one row of a kind, by its business word.
  const rowOfKind = (page: Page, kind: string): Locator =>
    listRows(page).filter({ has: page.locator('[data-testid^="shop-entry-kind-"]', { hasText: new RegExp(`^${kind}$`) }) });
  const idOf = async (row: Locator) => (await row.getAttribute("data-testid"))!.replace("shop-entry-", "");

  for (const r of READERS) {
    test.describe(`${r.given} wants to see money not tied to an order (withdrawal · shop ads fee · imported row with no order)`, () => {
      test(`${r.given} open shop entries (withdrawal · shop ads fee · imported row with no order)`, async ({ page }) => {
        const e = ground.rows!;
        await login(page, e.g.usernames[r.key], PASSWORD);

        // WHEN — the role opens the page.
        await openShopEntries(page);

        const withdrawal = rowOfKind(page, "Withdrawal");
        const ads = rowOfKind(page, "Ads fee");
        const payout = rowOfKind(page, "Payout");

        await test.step("then: withdrawal, ads fee and unmatched row shown as rows", async () => {
          await expect(listRows(page)).toHaveCount(3);
          await expect(page.getByTestId("shop-entries-count")).toHaveText("3");
          for (const row of [withdrawal, ads, payout]) await expect(row).toHaveCount(1);
          await expect(page.getByTestId(`shop-entry-amount-${await idOf(withdrawal)}`)).toHaveText(`−${rp(WITHDRAWN)}`);
          await expect(page.getByTestId(`shop-entry-amount-${e.ads}`)).toHaveText(`−${rp(ADS)}`);
          expect(await idOf(ads)).toBe(e.ads);
          await expect(page.getByTestId(`shop-entry-amount-${await idOf(payout)}`)).toHaveText(`+${rp(UNMATCHED)}`);
          // Each on its shop.
          for (const row of [withdrawal, ads, payout]) await expect(row.locator("td").nth(1)).toContainText(e.name);
        });

        await test.step("then: withdrawal counted in withdrawn, not in received", async () => {
          await expect(page.getByTestId("shop-entries-withdrawn")).toHaveText(rp(WITHDRAWN));
          // Received = the payout less the ads fee; a withdrawal counted in it would read −Rp 245.000.
          await expect(page.getByTestId("shop-entries-received")).toHaveText(`+${rp(UNMATCHED - ADS)}`);
          await expect(page.getByTestId("shop-entries-received")).not.toHaveText(`−${rp(WITHDRAWN - UNMATCHED + ADS)}`);
        });

        await test.step("then: unmatched row shows its Order ID with order not found", async () => {
          await expect(page.getByTestId(`shop-entry-ref-${await idOf(payout)}`)).toHaveText(`Ref ${ref("N")} · no order found`);
        });

        await test.step("then: imported row links to its statement", async () => {
          const statement = `Statement ${dayShort(today())}`;
          for (const row of [withdrawal, payout]) {
            const id = await idOf(row);
            const link = page.getByTestId(`shop-entry-import-${id}`);
            await expect(link).toHaveText(statement);
            await expect(link).toHaveAttribute("href", `/settlement/imports/${e.file}`);
            // By who uploaded the statement — the team's owner.
            await expect(page.getByTestId(`shop-entry-by-${id}`)).toContainText(e.ownerName);
          }
          // The hand-posted row has no statement: it says so, and links nowhere.
          await expect(page.getByTestId(`shop-entry-import-${e.ads}`)).toHaveText("Posted by hand");
          await expect(page.getByTestId(`shop-entry-import-${e.ads}`)).not.toHaveAttribute("href", /./);

          // Following the link opens the import the row came from, on its shop.
          await page.getByTestId(`shop-entry-import-${await idOf(payout)}`).click();
          await expect(page).toHaveURL(new RegExp(`/settlement/imports/${e.file}(\\?|$)`));
          await expect(page.getByTestId("import-detail-shop")).toContainText(e.name, { timeout: 10_000 });
        });
      });
    });

    test.describe(`${r.given} wants to see money not tied to an order (imported row matching 2 active orders)`, () => {
      test(`${r.given} open shop entries (imported row matching 2 active orders)`, async ({ page }) => {
        const e = ground.several!;
        await login(page, e.g.usernames[r.key], PASSWORD);

        // WHEN — the role opens the page.
        await openShopEntries(page);

        await test.step("then: row shows its Order ID and both orders", async () => {
          // The payout is the team's one shop row: credited to neither order.
          await expect(listRows(page)).toHaveCount(1);
          await expect(page.getByTestId("shop-entries-count")).toHaveText("1");
          const row = rowOfKind(page, "Payout");
          await expect(row).toHaveCount(1);
          const id = await idOf(row);
          await expect(page.getByTestId(`shop-entry-amount-${id}`)).toHaveText(`+${rp(SEVERAL)}`);
          await expect(page.getByTestId(`shop-entry-ref-${id}`)).toHaveText(
            `Ref ${ref("M")} · 2 live orders: ${e.orders.map((o) => `#${o}`).join(", ")}`,
          );
        });
      });
    });

    test.describe(`${r.given} wants to see money not tied to an order (entry belongs to 3 Nov · learned 10 Nov)`, () => {
      test(`${r.given} open shop entries (entry belongs to 3 Nov · learned 10 Nov)`, async ({ page }) => {
        const e = ground.late!;
        await login(page, e.g.usernames[r.key], PASSWORD);

        // WHEN — the role opens the page.
        await openShopEntries(page);

        await test.step("then: shown on 10 Nov with for 3 Nov", async () => {
          // Its Date cell: the day it was learned (today), and under it the day it belongs to.
          const late = page.getByTestId(`shop-entry-${e.late}`);
          await expect(late).toBeVisible();
          await expect(page.getByTestId(`shop-entry-amount-${e.late}`)).toHaveText(`+${rp(LATE)}`);
          await expect(late.locator("td").first().locator("p")).toHaveText([dayShort(today()), `for ${dayShort(e.day)}`]);
          // A row learned on the day it belongs to reads its day alone.
          await expect(page.getByTestId(`shop-entry-${e.now}`).locator("td").first().locator("p")).toHaveText([dayShort(today())]);

          // The window counts it on the day it was LEARNED: today alone lists it …
          await openShopEntries(page, `?range=${today()}..${today()}`);
          await expect(page.getByTestId(`shop-entry-${e.late}`)).toBeVisible();
          await expect(page.getByTestId("shop-entries-count")).toHaveText("2");
          // … the day it belongs to lists nothing.
          await openShopEntries(page, `?range=${e.day}..${e.day}`);
          await expect(page.getByTestId("shop-entries-count")).toHaveText("0");
          await expect(page.getByTestId(`shop-entry-${e.late}`)).toHaveCount(0);
          await expect(page.getByTestId("shop-entries-empty")).toBeVisible();
        });
      });
    });
  }
});

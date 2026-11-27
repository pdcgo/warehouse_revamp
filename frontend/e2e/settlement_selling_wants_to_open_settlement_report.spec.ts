import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { SUFFIX, api, login } from "./restock_helpers";
import {
  PASSWORD,
  PLATFORM_TOTAL,
  ROLES,
  importThroughDialog,
  orderOf,
  rp,
  sellingGround,
  settled,
  shopOf,
} from "./settlement_import_helpers";
import type { Ground } from "./settlement_import_helpers";
import { SHOPEE_WITHDRAWAL, shopeeStatement, today } from "./settlement_statements";

// ── selling:owner · selling:admin wants to see how much of the sales reached us — the checks behind
// docs/acceptances/settlement/report.md, action *open settlement report* (givens 1 and 2).
//
// An acceptance has no test file of its own (docs/acceptances/guide.md): its checks live in the regression spec of the
// feature its WHEN belongs to — opening Penyelesaian › Laporan (/settlement/report). The rows' statuses are set from
// this file's green results (scripts/acceptance_mark.py), never by the file itself. The report's older regression
// (the_settlement_report.spec.ts) stays as it is; change report period / group report by person / open shop entries
// from report go in THIS file too.
//
// The report is read only, and its whole team is one summary (the page has no shop filter), so each given is a SELLING
// TEAM OF ITS OWN, read by both of its roles (owner, admin — the only ones the given names; cs gets no row):
// - given 1 (sales Rp 1.000.000 · received Rp 900.000 · withdrawn Rp 500.000) — ONE real order placed by root whose
//   marketplace total is Rp 1.000.000 (its Estimate is posted by the order's own event), a Payout of Rp 900.000 on it
//   and a Withdrawal of Rp 500.000 on its shop (a withdrawal names no order — withdrawal-is-a-settlement-type), both
//   posted by hand by root;
// - given 2 (1 order cancelled) — a Rp 250.000 order placed and CANCELLED by root (the cancel is posted by the order's
//   own event, a machine-only row), then a live Rp 100.000 order. Seeded STEP BY STEP, each step's fold seen on the
//   report before the next (250.000 → 0 → 100.000), so the role's 100.000 can only be the live order after the cancel
//   landed — never a moment where only the live order had folded.
//
// How each then is read, on the report as the page opens it (Last 1 month, by day):
// - `sales, received and withdrawn shown` — the summary's Sales, Received and Withdrawn tiles.
// - `gap Rp 100.000 and take rate 10%` — the Gap tile and the Take rate tile ("10% of the selling price").
// - `withdrawal counted in position, not in received` — Received stays Rp 900.000 (not 900.000 − 500.000) while
//   Position to date is Rp 600.000: the gap PLUS what was withdrawn (withdrawal-counts-in-the-position).
// - `each day shown as a row over time` — the Over time table holds one row per day of the window, newest first, the
//   quiet days included: page 1 is today and the 19 days before it, the pager counts every day of the month window,
//   page 2 ends on the window's first day; today's row carries the day's six figures and yesterday's reads Rp 0.
//   (Every row is posted today: the report buckets a row on the day it was LEARNED, so a dated past day cannot be
//   seeded — the quiet days prove the one-row-per-day rule.)
// - `as-of date and time shown` — the "As of <day> <hh:mm> WIB" line under the summary: today's date, a clock time no
//   earlier than the seed's last post and no later than the read (the service's last fold — a-money-metric-says-as-of-when).
// - `cancelled order not counted in sales` — Sales reads Rp 100.000 (the live order alone, the Rp 250.000 cancelled one
//   counted nowhere), on the summary and on today's row.
//
// Action *change report period* (givens 3 and 4) — the WHEN is the page's own two controls, driven as a person does: the
// grain segment (Day · Month · Year) and the date range's calendar (two days, then Apply). Both read given 1's team (read
// only), so a month row carries real figures and a too-long range has a loaded report on screen to replace:
// - given 3 (month · 3 months) — Month, then three CALENDAR months picked on the calendar: the 1st of the month two back
//   through the current month's last day. `3 rows, one per month` — the Over time table holds exactly three rows, newest
//   first, keyed and labelled by their month (`yyyy-mm`); this month's row carries the seeded figures, the two before it
//   read Rp 0. (⚠ The quick range *Last 3 months* is not this window: it is counted on the calendar from today
//   (the-quick-ranges-are-days-then-months-then-years — on 22 Nov it starts on 23 Aug), so by month it draws FOUR rows,
//   August's tail included. The report names that for the owner; the check picks the three months themselves.)
// - given 4 (range longer than a year) — today and the 400 days before it (401 days) picked on the calendar.
//   `report not loaded, message says a year at most` — the line under the picker reads *That range covers 401 days. A
//   report reads at most 366 — pick a year at most.* (a-metric-reads-at-most-a-year); not one read is sent for that
//   window, no figure stays on screen (every tile —, no Over time row, no as-of line) and no refusal is shown either.
//
// Action *group report by person* (givens 5 and 6) — the WHEN is the ranking's *By person* button. Each given is a
// selling team of its own again, read by owner and admin:
// - given 5 (orders by Ani and Budi · imported shop row) — Ani and Budi, two CS of the team, each place ONE order with
//   their own token (Ani Rp 200.000, Budi Rp 500.000); Ani's grant is the shop's first, so she is its primary CS. BUDI
//   then imports the day's Shopee statement through the Import File dialog: one successful *Penarikan Dana* of
//   Rp 400.000 — a shop row, no order. `each person's position shown, largest first` — By person lists exactly the two
//   of them (the readers created nothing), Ani (Rp 600.000) above Budi (Rp 500.000), each row's Position to date read
//   off the screen and falling down the list. `imported shop row counted to the shop's primary CS` — the shop answers
//   Ani as its primary (ShopAccessCheck), and the Rp 400.000 sits in HER row's Withdrawn and position, never in the
//   uploader's: Budi's row carries his own order alone (Withdrawn Rp 0) — counted for its actor, he would rank first
//   at Rp 900.000. Without the shop row Budi would rank first too, so the order of the list proves both rules at once.
// - given 6 (imported shop row · shop has no primary CS) — ⚠ CONFLICT, checked as the row reads and marked `test.fail`:
//   a shop with no primary CS CANNOT import (a-shop-with-no-primary-cs-cannot-import — the shop check refuses the file
//   with *"choose a primary CS first"*, and settlement refuses such a row too, settlement-asks-the-shop-for-its-primary-cs),
//   and the person an imported row counts for is the primary AT IMPORT TIME, written once on the row. So the given's
//   row cannot exist: nothing of it reaches the summary. One owner-only test: a `regression:` step proves what IS built
//   (the shop answers no primary, its file is refused with that reason), then `not listed by person, still counted in
//   the summary` reads the row's words — the By person list empty, and Withdrawn waiting for the Rp 300.000 the refused
//   file never posted. The report names the conflict for the owner.
//
// Action *open shop entries from report* (given 7) — the WHEN is a By shop row of the report, clicked (it opens that
// shop's own entries on the report's window — the-shop-entries-page-is-accepted). A selling team of its own with TWO
// shops, each with money addressed to the shop and no order, posted by root today: shop A a withdrawal of Rp 300.000
// and a shop-level ads fee of Rp 20.000, shop B a withdrawal of Rp 700.000 — so a list of every shop, or of the other
// one, cannot pass for A's. Read by owner and admin on the report as it opens: by shop, Last 1 month.
// `shop entries opened on that shop and last month` — the page is Shop Entries, its address names shop A and no range
// (Last 1 month is the default), its shop filter shows shop A and its window picker *Last 1 month*; every list read it
// sends asks for shop A over the SAME window the report read (from the report's own requests), which is last month
// through today; and it lists shop A's two entries alone (count 2, Withdrawn Rp 300.000 — none of shop B's).
// (Every row is posted today — a learned day cannot be back-dated — so the window is proven on the request, not by a
// row outside it.)
test.describe("selling:owner · selling:admin wants to see how much of the sales reached us — open settlement report", () => {
  test.describe.configure({ timeout: 120_000 });

  const READERS = ROLES.filter((r) => r.key !== "cs");

  const SALE = 1_000_000; // given 1's order
  const RECEIVED = 900_000;
  const WITHDRAWN = 500_000;
  const CANCELLED = 250_000; // given 2's cancelled order
  const ANI_SALE = 200_000; // given 5 — Ani's order
  const BUDI_SALE = 500_000; // given 5 — Budi's order
  const SHOP_ROW = 400_000; // given 5 — the imported withdrawal, a shop row
  const NO_PRIMARY_ROW = 300_000; // given 6 — the withdrawal a shop with no primary CS tries to import
  const SHOP_A_WITHDRAWN = 300_000; // given 7 — shop A's withdrawal
  const SHOP_A_ADS = 20_000; // given 7 — shop A's shop-level ads fee
  const SHOP_B_WITHDRAWN = 700_000; // given 7 — the other shop's withdrawal
  const ref = (k: string) => `VR${SUFFIX}${k}`;

  const ground = {
    sales: undefined as Ground | undefined,
    cancel: undefined as Ground | undefined,
    seededAt: 0, // ms — just before given 1's last post
    people: undefined as { g: Ground; shop: string; ani: string; budi: string } | undefined, // given 5
    noPrimary: undefined as { g: Ground; shop: string } | undefined, // given 6
    entries: undefined as { g: Ground; shopA: string; shopB: string; nameA: string; a: string[]; b: string[] } | undefined, // given 7
  };

  // The report as the role (or root on the team) opens it: the defaults — Last 1 month, by day, by shop.
  async function openReport(page: Page): Promise<void> {
    await page.goto("/settlement/report");
    await expect(page.getByTestId("settlement-report-page")).toBeVisible({ timeout: 10_000 });
  }

  // Poll the report (it is FOLDED behind the scenes, so a post lands a moment later) until the summary reads `want`.
  async function reportReads(page: Page, want: Record<string, string>, timeout = 45_000): Promise<void> {
    await expect(async () => {
      await openReport(page);
      for (const [tile, value] of Object.entries(want)) {
        await expect(page.getByTestId(`report-${tile}-value`)).toHaveText(value, { timeout: 3_000 });
      }
      await settled(page);
    }).toPass({ timeout });
  }

  // Work in the given team: the active team is per tab, in sessionStorage (TeamContext).
  async function useTeam(page: Page, teamId: string): Promise<void> {
    await page.evaluate((id) => window.sessionStorage.setItem("warehouse_revamp.team", id), teamId);
  }

  // One order of `total` on `shop`, 1 unit — orderOf with the marketplace's total as the case needs it.
  async function orderOfTotal(page: Page, g: Ground, shop: string, key: string, total: number): Promise<string> {
    const placed = await api(page, "selling.v1.OrderService/OrderCreate", {
      idempotencyKey: `e2e-vr-${ref(key)}`,
      shipmentChannelId: "1",
      teamId: g.team,
      shopId: shop,
      warehouseId: g.warehouse,
      customerName: `E2E VR Buyer ${ref(key)}`,
      platformTotal: total,
      platformCreatedAtUnix: Math.floor(Date.now() / 1000),
      orderExternalRefId: ref(key),
      items: [{ productId: g.productId, productCode: g.code, name: `E2E ${g.code}`, quantity: 1 }],
    });
    return String(placed.order.id);
  }

  // The order's live sale on its settlement account; −1 while the account has not opened yet (a 404 until the order's
  // event posts the Estimate).
  const liveSale = async (page: Page, g: Ground, orderId: string) => {
    try {
      const res = await api(page, "settlement.v1.SettlementService/OrderSettlementDetail", { teamId: g.team, orderId });
      return Number(res.settlement?.initialTotal ?? 0);
    } catch {
      return -1;
    }
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    // ── given 1 — one order sold Rp 1.000.000, Rp 900.000 paid out on it, Rp 500.000 withdrawn from its shop.
    const g1 = await sellingGround(page, "VR", 2);
    ground.sales = g1;
    const users1 = [g1.users.own, g1.users.adm, g1.users.cs];
    const shop1 = await shopOf(page, g1, `E2E VR shop ${SUFFIX}`, `VR0${SUFFIX}`, "MARKETPLACE_SHOPEE", users1);
    const order1 = await orderOfTotal(page, g1, shop1, "1", SALE);
    await expect.poll(() => liveSale(page, g1, order1), { timeout: 30_000 }).toBe(SALE);

    await api(page, "settlement.v1.SettlementWriteService/SettlementPost", {
      teamId: g1.team,
      orderId: order1,
      shopId: shop1,
      uniqueId: `manual-vr-${SUFFIX}-fund`,
      settlementType: "SETTLEMENT_TYPE_FUND",
      sourceType: "SOURCE_TYPE_MANUAL",
      change: RECEIVED,
      occurredOn: today(),
    });
    ground.seededAt = Date.now();
    await api(page, "settlement.v1.SettlementWriteService/SettlementPost", {
      teamId: g1.team,
      shopId: shop1, // a withdrawal is SHOP-addressed — no order
      uniqueId: `manual-vr-${SUFFIX}-withdrawal`,
      settlementType: "SETTLEMENT_TYPE_WITHDRAWAL",
      sourceType: "SOURCE_TYPE_MANUAL",
      change: -WITHDRAWN,
      occurredOn: today(),
    });

    // ── given 2 — a Rp 250.000 order cancelled, then a live Rp 100.000 one; each fold seen before the next step.
    const g2 = await sellingGround(page, "VC", 3);
    ground.cancel = g2;
    const users2 = [g2.users.own, g2.users.adm, g2.users.cs];
    const shop2 = await shopOf(page, g2, `E2E VC shop ${SUFFIX}`, `VC0${SUFFIX}`, "MARKETPLACE_SHOPEE", users2);
    await useTeam(page, g2.team);

    const cancelled = await orderOfTotal(page, g2, shop2, "c", CANCELLED);
    await expect.poll(() => liveSale(page, g2, cancelled), { timeout: 30_000 }).toBe(CANCELLED);
    await reportReads(page, { sales: rp(CANCELLED) });

    await api(page, "selling.v1.OrderService/OrderCancel", { teamId: g2.team, orderId: cancelled });
    // The cancel ZEROES the live sale (cancel-zeroes-the-live-sale), then folds into the report.
    await expect.poll(() => liveSale(page, g2, cancelled), { timeout: 30_000 }).toBe(0);
    await reportReads(page, { sales: rp(0) });

    const live = await orderOf(page, g2, shop2, ref("l"));
    await expect.poll(() => liveSale(page, g2, live), { timeout: 30_000 }).toBe(PLATFORM_TOTAL);
    await page.close();
  });

  // Givens 5 and 6 — the person ranking's grounds.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    // ── given 5 — Ani and Budi, two CS of a team of its own; Ani's grant comes first, so she is the shop's primary CS.
    const g5 = await sellingGround(page, "VP", 2);
    const person = async (name: string) => {
      const username = `e2evp${name.toLowerCase()}${SUFFIX}`;
      const made = await api(page, "user.v1.UserService/CreateUser", {
        teamId: g5.team,
        username,
        password: PASSWORD,
        name: `${name} ${SUFFIX}`,
        role: "ROLE_SELLING_CS",
      });
      return { id: String(made.user.id), username };
    };
    const ani = await person("Ani");
    const budi = await person("Budi");
    const shop5 = await shopOf(page, g5, `E2E VP shop ${SUFFIX}`, `VP0${SUFFIX}`, "MARKETPLACE_SHOPEE", [
      ani.id,
      budi.id,
      g5.users.own,
      g5.users.adm,
    ]);
    ground.people = { g: g5, shop: shop5, ani: ani.id, budi: budi.id };

    // Each places ONE order with their own token — the order's creator is who the ranking counts it for.
    const signedIn = async (username: string) => {
      const p = await browser.newPage();
      await login(p, username, PASSWORD);
      return p;
    };
    const aniPage = await signedIn(ani.username);
    const aniOrder = await orderOfTotal(aniPage, g5, shop5, "pa", ANI_SALE);
    await aniPage.close();
    const budiPage = await signedIn(budi.username);
    const budiOrder = await orderOfTotal(budiPage, g5, shop5, "pb", BUDI_SALE);
    await expect.poll(() => liveSale(page, g5, aniOrder), { timeout: 30_000 }).toBe(ANI_SALE);
    await expect.poll(() => liveSale(page, g5, budiOrder), { timeout: 30_000 }).toBe(BUDI_SALE);

    // BUDI imports the day's statement: one successful withdrawal — a shop row, no order.
    const dialog = await importThroughDialog(
      budiPage,
      shop5,
      shopeeStatement([{ kind: SHOPEE_WITHDRAWAL, description: `Penarikan Dana ${SUFFIX} vp`, amount: -SHOP_ROW }]),
    );
    await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
    await expect(dialog.getByTestId("tally-posted-value")).toHaveText("1");
    await dialog.getByTestId("import-close").click();
    await budiPage.close();

    // ── given 6 — a team of its own with a shop nobody is granted: it has no primary CS.
    const g6 = await sellingGround(page, "VN", 1);
    const shop6 = await shopOf(page, g6, `E2E VN shop ${SUFFIX}`, `VN0${SUFFIX}`, "MARKETPLACE_SHOPEE", []);
    ground.noPrimary = { g: g6, shop: shop6 };
    await page.close();
  });

  // Given 7 — two shops of a team of its own, each with money addressed to the shop and no order.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    const g7 = await sellingGround(page, "VE", 1);
    const users7 = [g7.users.own, g7.users.adm, g7.users.cs];
    const nameA = `E2E VE shop A ${SUFFIX}`;
    const shopA = await shopOf(page, g7, nameA, `VEA${SUFFIX}`, "MARKETPLACE_SHOPEE", users7);
    const shopB = await shopOf(page, g7, `E2E VE shop B ${SUFFIX}`, `VEB${SUFFIX}`, "MARKETPLACE_SHOPEE", users7);
    // A shop-addressed row (no order), posted by hand by root — its id from the SettlementPost answer.
    const post = async (shopId: string, key: string, settlementType: string, change: number) =>
      String(
        (
          await api(page, "settlement.v1.SettlementWriteService/SettlementPost", {
            teamId: g7.team,
            shopId,
            uniqueId: `manual-ve-${SUFFIX}-${key}`,
            settlementType,
            sourceType: "SOURCE_TYPE_MANUAL",
            change,
            occurredOn: today(),
          })
        ).entry.id,
      );
    const a = [
      await post(shopA, "aw", "SETTLEMENT_TYPE_WITHDRAWAL", -SHOP_A_WITHDRAWN),
      await post(shopA, "ads", "SETTLEMENT_TYPE_EXTERNAL_ADS_FEE", -SHOP_A_ADS),
    ];
    const b = [await post(shopB, "bw", "SETTLEMENT_TYPE_WITHDRAWAL", -SHOP_B_WITHDRAWN)];
    ground.entries = { g: g7, shopA, shopB, nameA, a, b };
    await page.close();
  });

  // The six figure cells of one Over time row: Sales, Received, Withdrawn, Gap, Take rate, Position to date.
  async function rowFigures(row: Locator): Promise<string[]> {
    const cells = row.locator("td");
    await expect(cells).toHaveCount(7);
    return (await cells.allInnerTexts()).slice(1).map((t) => t.trim());
  }

  // Jakarta days, as the report labels them — `yyyy-mm-dd`.
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // "Last 1 month" — the day AFTER the same date a month back, through today (jakartaWindowOf).
  const monthWindowStart = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
    const last = new Date(Date.UTC(y, m - 1, 0)).getUTCDate(); // the previous month's last day
    const back = new Date(Date.UTC(y, m - 2, Math.min(d, last)));
    return addDays(back.toISOString().slice(0, 10), 1);
  };
  const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  // A Jakarta wall-clock minute of the day.
  const jakartaMinute = (ms: number) => {
    const [h, m] = new Date(ms)
      .toLocaleTimeString("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .split(":")
      .map(Number) as [number, number];
    return h * 60 + m;
  };
  // The 1st of the month `n` months before a day's month — `yyyy-mm-01`.
  const monthBack = (iso: string, n: number) => {
    const [y, m] = iso.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
  };
  // The last day of a day's month.
  const monthEnd = (iso: string) => {
    const [y, m] = iso.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  };

  // Pick an absolute range on the report's calendar, as a person does: open the range picker, page the month view back or
  // forward to each day, click both days, then Apply.
  async function pickRange(page: Page, from: string, to: string): Promise<void> {
    await page.getByTestId("report-range").click();
    await expect(page.getByTestId("report-range-panel")).toBeVisible();
    for (const day of [to, from]) {
      const cell = page.getByTestId(`report-range-day-${day}`);
      for (const step of ["prev", "next"] as const) {
        for (let i = 0; i < 24 && (await cell.count()) === 0; i++) {
          await page.getByTestId(`report-range-${step}`).click();
        }
      }
      await cell.click();
    }
    await page.getByTestId("report-range-apply").click();
    await expect(page.getByTestId("report-range-panel")).toBeHidden();
  }

  for (const r of READERS) {
    test.describe(`${r.given} wants to see how much of the sales reached us (sales Rp 1.000.000 · received Rp 900.000 · withdrawn Rp 500.000)`, () => {
      test(`${r.given} open settlement report (sales Rp 1.000.000 · received Rp 900.000 · withdrawn Rp 500.000)`, async ({ page }) => {
        const g = ground.sales!;
        await login(page, g.usernames[r.key], PASSWORD);

        // WHEN — the role opens Penyelesaian › Laporan (the fold may still be landing — the report is polled).
        await reportReads(page, { sales: rp(SALE), received: rp(RECEIVED), withdrawn: rp(WITHDRAWN) });

        await test.step("then: sales, received and withdrawn shown", async () => {
          await expect(page.getByTestId("report-sales")).toContainText("Selling price");
          await expect(page.getByTestId("report-sales-value")).toHaveText(rp(SALE));
          await expect(page.getByTestId("report-received")).toContainText("Received");
          await expect(page.getByTestId("report-received-value")).toHaveText(rp(RECEIVED));
          await expect(page.getByTestId("report-withdrawn")).toContainText("Withdrawn");
          await expect(page.getByTestId("report-withdrawn-value")).toHaveText(rp(WITHDRAWN));
        });

        await test.step("then: gap Rp 100.000 and take rate 10%", async () => {
          await expect(page.getByTestId("report-gap-value")).toHaveText(rp(100_000));
          await expect(page.getByTestId("report-take-rate-value")).toHaveText(/^10% /);
          await expect(page.getByTestId("report-take-rate-value")).toHaveText("10% of the selling price");
        });

        await test.step("then: withdrawal counted in position, not in received", async () => {
          // Not in received: what the platform moved toward us stays Rp 900.000, the withdrawal not taken off it.
          await expect(page.getByTestId("report-received-value")).toHaveText(rp(RECEIVED));
          await expect(page.getByTestId("report-received-value")).not.toHaveText(rp(RECEIVED - WITHDRAWN));
          // In position: the gap PLUS what was withdrawn.
          await expect(page.getByTestId("report-position-value")).toHaveText(rp(100_000 + WITHDRAWN));
        });

        await test.step("then: each day shown as a row over time", async () => {
          const day = today();
          const from = monthWindowStart(day);
          const days = daysBetween(from, day);
          const table = page.getByTestId("report-series-table");
          const rows = table.locator("tbody tr");

          // Page 1: today and the 19 days before it, newest first — the quiet days included.
          await expect(rows).toHaveCount(20);
          const ids = await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-testid")));
          expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => `report-series-row-${addDays(day, -i)}`));
          // The pager counts the window's days: two pages of 20 ("1 of 2") — page 2 below holds the rest.
          await expect(page.getByTestId("page-text")).toHaveText(new RegExp(`^\\s*1\\D+${Math.ceil(days / 20)}\\s*$`));

          // Today's row carries the day's figures; yesterday's is a quiet day.
          const todayRow = page.getByTestId(`report-series-row-${day}`);
          await expect(todayRow.locator("td").first()).toHaveText(day);
          expect(await rowFigures(todayRow)).toEqual([
            rp(SALE),
            rp(RECEIVED),
            rp(WITHDRAWN),
            rp(100_000),
            "10% of the selling price",
            rp(100_000 + WITHDRAWN),
          ]);
          const quiet = await rowFigures(page.getByTestId(`report-series-row-${addDays(day, -1)}`));
          expect(quiet.slice(0, 4)).toEqual([rp(0), rp(0), rp(0), rp(0)]);
          expect(quiet[5]).toBe(rp(0));

          // Page 2: the rest of the window, down to its first day.
          await page.getByTestId("page-next").click();
          await expect(rows).toHaveCount(days - 20);
          await expect(rows.first()).toHaveAttribute("data-testid", `report-series-row-${addDays(day, -20)}`);
          await expect(rows.last()).toHaveAttribute("data-testid", `report-series-row-${from}`);
        });

        await test.step("then: as-of date and time shown", async () => {
          const asOf = page.getByTestId("report-as-of");
          await expect(asOf).toBeVisible();
          const text = (await asOf.innerText()).trim();
          const m = text.match(/^As of (\d{1,2} \S+) (\d{2}):(\d{2}) WIB$/);
          expect(m, `as-of line "${text}"`).not.toBeNull();

          // Today's date, as the app writes a day (its own locale, Jakarta time).
          const todayLabel = await page.evaluate(() => {
            const p = Object.fromEntries(
              new Intl.DateTimeFormat(document.documentElement.lang || undefined, { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })
                .formatToParts(new Date())
                .map((x) => [x.type, x.value]),
            );
            return `${p.day} ${p.month}`;
          });
          expect(m![1]).toBe(todayLabel);

          // A clock time: the service's last fold — no earlier than the seed's last post, no later than now.
          const shown = Number(m![2]) * 60 + Number(m![3]);
          expect(shown).toBeGreaterThanOrEqual(jakartaMinute(ground.seededAt));
          expect(shown).toBeLessThanOrEqual(jakartaMinute(Date.now()));
        });
      });
    });

    test.describe(`${r.given} wants to see how much of the sales reached us (1 order cancelled)`, () => {
      test(`${r.given} open settlement report (1 order cancelled)`, async ({ page }) => {
        const g = ground.cancel!;
        await login(page, g.usernames[r.key], PASSWORD);

        // WHEN — the role opens the report (beforeAll already saw the live order fold in after the cancel).
        await reportReads(page, { sales: rp(PLATFORM_TOTAL) });

        await test.step("then: cancelled order not counted in sales", async () => {
          // The live order alone — the Rp 250.000 cancelled one is in neither the headline nor the day.
          await expect(page.getByTestId("report-sales-value")).toHaveText(rp(PLATFORM_TOTAL));
          await expect(page.getByTestId("report-sales-value")).not.toHaveText(rp(PLATFORM_TOTAL + CANCELLED));
          const todayRow = page.getByTestId(`report-series-row-${today()}`);
          expect((await rowFigures(todayRow))[0]).toBe(rp(PLATFORM_TOTAL));
          // Nothing reached us for it either: the whole live sale is the gap.
          await expect(page.getByTestId("report-received-value")).toHaveText(rp(0));
          await expect(page.getByTestId("report-gap-value")).toHaveText(rp(PLATFORM_TOTAL));
        });
      });
    });

    test.describe(`${r.given} wants to compare periods (month · 3 months)`, () => {
      test(`${r.given} change report period (month · 3 months)`, async ({ page }) => {
        const g = ground.sales!;
        await login(page, g.usernames[r.key], PASSWORD);
        // The report as it opens (Last 1 month, by day), given 1's figures folded in.
        await reportReads(page, { sales: rp(SALE), received: rp(RECEIVED), withdrawn: rp(WITHDRAWN) });

        // WHEN — by month, over three calendar months: the 1st of the month two back through this month's last day.
        const day = today();
        const months = [0, 1, 2].map((n) => monthBack(day, n)); // newest first, `yyyy-mm-01`
        const from = months[2]!;
        const to = monthEnd(day);
        await page.getByTestId("report-grain-month").click();
        await expect(page).toHaveURL(/[?&]grain=month(&|$)/);
        await pickRange(page, from, to);
        await expect(page).toHaveURL(new RegExp(`[?&]range=${from}\\.\\.${to}(&|$)`));

        await test.step("then: 3 rows, one per month", async () => {
          const rows = page.getByTestId("report-series-table").locator("tbody tr");
          await expect(rows).toHaveCount(3);
          const ids = await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-testid")));
          expect(ids).toEqual(months.map((m) => `report-series-row-${m}`));
          for (const [i, m] of months.entries()) {
            await expect(rows.nth(i).locator("td").first()).toHaveText(m.slice(0, 7));
          }
          // Each row is its month's: this month carries the seeded figures, the two before it are quiet.
          expect(await rowFigures(rows.nth(0))).toEqual([
            rp(SALE),
            rp(RECEIVED),
            rp(WITHDRAWN),
            rp(100_000),
            "10% of the selling price",
            rp(100_000 + WITHDRAWN),
          ]);
          for (const i of [1, 2]) {
            const quiet = await rowFigures(rows.nth(i));
            expect(quiet.slice(0, 4)).toEqual([rp(0), rp(0), rp(0), rp(0)]);
            expect(quiet[5]).toBe(rp(0));
          }
          // One page: three periods, nothing to turn to.
          await expect(page.getByTestId("page-text")).toHaveText(/^\s*1\D+1\s*$/);
          await expect(page.getByTestId("page-next")).toBeDisabled();
        });
      });
    });

    test.describe(`${r.given} wants to compare periods (range longer than a year)`, () => {
      test(`${r.given} change report period (range longer than a year)`, async ({ page }) => {
        // Was ❌ (a-report-over-a-year-keeps-the-last-windows-figures): listQuery's keepPreviousData held a DISABLED
        // query's answer, so the last window's report stayed on screen. Fixed by #130 (`listQueryWhile(valid)` keeps
        // nothing while the range is refused) — the check below is the then, as written.
        const g = ground.sales!;
        await login(page, g.usernames[r.key], PASSWORD);
        // A loaded report on screen first — the one a longer range must not keep showing.
        await reportReads(page, { sales: rp(SALE) });

        // Every read the report sends from here on.
        const reads: string[] = [];
        page.on("request", (req) => {
          if (req.url().includes("SettlementAnalyticService/")) reads.push(req.url());
        });

        // WHEN — today and the 400 days before it (401 days), picked on the calendar.
        const day = today();
        const from = addDays(day, -400);
        await pickRange(page, from, day);
        await expect(page).toHaveURL(new RegExp(`[?&]range=${from}\\.\\.${day}(&|$)`));

        await test.step("then: report not loaded, message says a year at most", async () => {
          await expect(page.getByTestId("report-range-invalid")).toHaveText(
            "That range covers 401 days. A report reads at most 366 — pick a year at most.",
          );
          await settled(page);
          // Not loaded: nothing is asked of the server for that window …
          expect(reads).toEqual([]);
          // … and no figure stays on screen — the last window's report is not kept up under the new range. (Soft, so a
          // run names every part still drawn.)
          for (const tile of ["sales", "received", "withdrawn", "gap", "take-rate", "position"]) {
            await expect.soft(page.getByTestId(`report-${tile}-value`)).toHaveText("—", { timeout: 3_000 });
          }
          await expect.soft(page.getByTestId("report-series-row-" + day)).toHaveCount(0, { timeout: 3_000 });
          await expect.soft(page.getByTestId("report-series-table")).toHaveCount(0, { timeout: 3_000 });
          await expect.soft(page.getByTestId("report-as-of")).toHaveCount(0, { timeout: 3_000 });
          await expect.soft(page.getByTestId("report-groups-empty")).toBeVisible({ timeout: 3_000 });
          // The message is the screen's own, not a refusal from the server.
          await expect(page.getByTestId("report-error")).toHaveCount(0);
        });
      });
    });

    test.describe(`${r.given} wants to know who carries the gap (orders by Ani and Budi · imported shop row)`, () => {
      test(`${r.given} group report by person (orders by Ani and Budi · imported shop row)`, async ({ page }) => {
        const p = ground.people!;
        await login(page, p.g.usernames[r.key], PASSWORD);
        // The report as it opens, every seed folded in: both orders' sales and the imported withdrawal.
        await reportReads(page, { sales: rp(ANI_SALE + BUDI_SALE), withdrawn: rp(SHOP_ROW) });

        // WHEN — the ranking grouped by person.
        await page.getByTestId("report-group-user").click();
        await expect(page).toHaveURL(/[?&]group=user(&|$)/);
        // The regrouped rows have LANDED — not the shop rows kept on screen while they load.
        const table = page.getByTestId("report-groups-table");
        await expect(table.locator("thead th").first()).toHaveText("Person");
        await expect(page.getByTestId(`report-group-row-${p.shop}`)).toHaveCount(0);
        await expect(page.getByTestId(`report-group-row-${p.ani}`)).toBeVisible();
        await settled(page);

        const rows = table.locator("tbody tr");
        const num = (s: string) => Number(s.replace(/[^\d]/g, ""));

        await test.step("then: each person's position shown, largest first", async () => {
          // Exactly the two who placed orders — the readers created nothing, so they are no row of it.
          await expect(rows).toHaveCount(2);
          const ids = await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute("data-testid")));
          expect(ids).toEqual([`report-group-row-${p.ani}`, `report-group-row-${p.budi}`]);
          await expect(rows.nth(0).locator("td").first()).toHaveText(`Ani ${SUFFIX}`);
          await expect(rows.nth(1).locator("td").first()).toHaveText(`Budi ${SUFFIX}`);
          await expect(page.getByTestId(`report-group-row-${p.g.users[r.key]}`)).toHaveCount(0);

          // Each person's own position to date, as the screen shows it …
          const positions: string[] = [];
          for (const i of [0, 1]) positions.push((await rowFigures(rows.nth(i)))[5]!);
          expect(positions).toEqual([rp(ANI_SALE + SHOP_ROW), rp(BUDI_SALE)]);
          // … falling down the list: the largest first.
          expect(num(positions[0]!)).toBeGreaterThan(num(positions[1]!));
          // And each one's own sales — Ani's order and Budi's, never the other's.
          expect((await rowFigures(rows.nth(0)))[0]).toBe(rp(ANI_SALE));
          expect((await rowFigures(rows.nth(1)))[0]).toBe(rp(BUDI_SALE));
        });

        await test.step("then: imported shop row counted to the shop's primary CS", async () => {
          // Ani is the shop's primary CS — as the shop itself answers it.
          const check = await api(page, "selling.v1.ShopService/ShopAccessCheck", { teamId: p.g.team, shopId: p.shop, userId: p.budi });
          expect(String(check.primaryUserId)).toBe(p.ani);

          // The Rp 400.000 withdrawal Budi imported is HERS: in her Withdrawn and her position, on top of her order …
          const ani = await rowFigures(page.getByTestId(`report-group-row-${p.ani}`));
          expect(ani[2]).toBe(rp(SHOP_ROW));
          expect(ani[5]).toBe(rp(ANI_SALE + SHOP_ROW));
          // … and never its uploader's: Budi carries his own order alone.
          const budi = await rowFigures(page.getByTestId(`report-group-row-${p.budi}`));
          expect(budi[2]).toBe(rp(0));
          expect(budi[5]).toBe(rp(BUDI_SALE));
          // The team's summary holds it once.
          await expect(page.getByTestId("report-withdrawn-value")).toHaveText(rp(SHOP_ROW));
        });
      });
    });

    test.describe(`${r.given} wants to check a shop's entries (by shop · last month)`, () => {
      test(`${r.given} open shop entries from report (by shop · last month)`, async ({ page }) => {
        const e = ground.entries!;
        await login(page, e.g.usernames[r.key], PASSWORD);

        // The window the REPORT reads — every metric read it sends carries it as a date-range filter.
        const reportWindows: { from: string; to: string }[] = [];
        // Every read the Shop Entries page sends — its filter, as sent.
        const entryReads: { shopId: string; from: string; to: string; kinds: number }[] = [];
        page.on("request", (req) => {
          const url = req.url();
          if (url.endsWith("/MetricSearch") || url.endsWith("/MetricData")) {
            const w = req.postDataJSON()?.filters?.[0]?.dateRangeFilter;
            if (w) reportWindows.push({ from: w.dateMin, to: w.dateMax });
          }
          if (url.endsWith("/ShopSettlementEntryList")) {
            const f = req.postDataJSON()?.filter ?? {};
            entryReads.push({ shopId: String(f.shopId ?? "0"), from: f.postedFrom ?? "", to: f.postedTo ?? "", kinds: (f.settlementTypes ?? []).length });
          }
        });

        // GIVEN — the report as it opens, every seed folded in: by shop, Last 1 month.
        await reportReads(page, { withdrawn: rp(SHOP_A_WITHDRAWN + SHOP_B_WITHDRAWN) });
        await expect(page.getByTestId("report-range")).toContainText("Last 1 month");
        await expect(page).not.toHaveURL(/[?&](group|range)=/);
        await expect(page.getByTestId("report-groups-table").locator("thead th").first()).toHaveText("Shop");
        await expect(page.getByTestId(`report-group-row-${e.shopB}`)).toBeVisible();
        const row = page.getByTestId(`report-group-row-${e.shopA}`);
        await expect(row).toBeVisible();
        const reportWindow = reportWindows.at(-1)!;

        // WHEN — the role opens shop A's row.
        await row.click();

        await test.step("then: shop entries opened on that shop and last month", async () => {
          // Shop Entries, on that shop: the address names shop A — and no range, Last 1 month being the default.
          await expect(page.getByTestId("shop-entries-page")).toBeVisible({ timeout: 10_000 });
          const url = new URL(page.url());
          expect(url.pathname).toBe("/settlement/shop-entries");
          expect(url.searchParams.get("shop")).toBe(e.shopA);
          expect(url.searchParams.get("range")).toBeNull();
          // The page's own filters show it: shop A in the shop filter, Last 1 month in the window picker.
          await expect(page.getByTestId("shop-entries-shop-filter").getByTestId("shop-select")).toHaveValue(e.nameA, { timeout: 10_000 });
          await expect(page.getByTestId("shop-entries-range")).toContainText("Last 1 month");

          // Shop A's entries alone: its two rows, none of shop B's …
          const list = page.getByTestId("shop-entries-table");
          for (const id of e.a) await expect(list.getByTestId(`shop-entry-${id}`)).toBeVisible({ timeout: 10_000 });
          for (const id of e.b) await expect(page.getByTestId(`shop-entry-${id}`)).toHaveCount(0);
          await expect(list.locator('tbody tr[data-testid^="shop-entry-"]')).toHaveCount(2);
          // … and the cards total them alone.
          await expect(page.getByTestId("shop-entries-count")).toHaveText("2");
          await expect(page.getByTestId("shop-entries-withdrawn")).toHaveText(rp(SHOP_A_WITHDRAWN));
          await settled(page);

          // Asked of the server that way: every list read named shop A over the report's own window — last month,
          // through today — and no kind.
          expect(entryReads.length).toBeGreaterThan(0);
          expect(reportWindow).toEqual({ from: monthWindowStart(today()), to: today() });
          for (const read of entryReads) expect(read).toEqual({ shopId: e.shopA, from: reportWindow.from, to: reportWindow.to, kinds: 0 });
        });
      });
    });
  }

  // Given 6 — ⚠ CONFLICT with a-shop-with-no-primary-cs-cannot-import: one owner-only test (see the header).
  const NO_PRIMARY_CONFLICT =
    "conflict: a-shop-with-no-primary-cs-cannot-import — a shop with no primary CS cannot import (its file is refused, " +
    "and the person an imported row counts for is the primary at import time), so the given's row never exists " +
    "and nothing of it reaches the summary";
  test.describe("selling:owner wants to know who carries the gap (imported shop row · shop has no primary CS)", () => {
    test("selling:owner group report by person (imported shop row · shop has no primary CS)", async ({ page }) => {
      test.fail(true, NO_PRIMARY_CONFLICT);
      const n = ground.noPrimary!;
      await login(page, n.g.usernames.own, PASSWORD);

      await test.step("regression: a shop with no primary CS cannot import — its file is refused (a-shop-with-no-primary-cs-cannot-import)", async () => {
        const check = await api(page, "selling.v1.ShopService/ShopAccessCheck", { teamId: n.g.team, shopId: n.shop, userId: n.g.users.own });
        expect(Number(check.primaryUserId ?? 0)).toBe(0);
        const dialog = await importThroughDialog(
          page,
          n.shop,
          shopeeStatement([{ kind: SHOPEE_WITHDRAWAL, description: `Penarikan Dana ${SUFFIX} vn`, amount: -NO_PRIMARY_ROW }]),
        );
        await expect(dialog.getByTestId("import-failed-reason")).toContainText("choose a primary CS first", { timeout: 15_000 });
        await dialog.getByTestId("import-close").click();
      });

      // WHEN — the report, its ranking grouped by person.
      await openReport(page);
      await page.getByTestId("report-group-user").click();
      await expect(page).toHaveURL(/[?&]group=user(&|$)/);
      await settled(page);

      await test.step("then: not listed by person, still counted in the summary", async () => {
        // Not listed by person: the ranking has no row.
        await expect(page.getByTestId("report-groups-empty")).toBeVisible();
        // Still counted in the summary: the shop row's Rp 300.000 in Withdrawn — which a refused file never posts.
        await reportReads(page, { withdrawn: rp(NO_PRIMARY_ROW) }, 20_000);
      });
    });
  });
});

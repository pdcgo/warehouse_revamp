import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { SUFFIX, login } from "./restock_helpers";
import { PASSWORD, ROLES, importThroughDialog, importsOf, orderOf, sellingGround, settled, shopOf } from "./settlement_import_helpers";
import type { Ground, Role } from "./settlement_import_helpers";
import { SHOPEE_INCOME, SHOPEE_WITHDRAWAL, shopeeStatement, today } from "./settlement_statements";

// ── selling:all wants to check what an import did — the check behind docs/acceptances/settlement/settlement_importer.md
//
// An acceptance has no test file of its own (docs/acceptances/guide.md#acceptances-are-markdown): its check lives in the
// regression spec of the feature its WHEN belongs to — open import detail, the file's own page
// (/settlement/imports/:fileId). settlement_imports.spec.ts is a serial chain on root and one fixture file; this is its
// own file beside it, as settlement_selling_wants_to_import*.spec.ts are. The row's status is the owner's, set by hand on
// the owner's instruction — never by this file.
//
// GIVEN (Shopee shop · statement · imported): every selling role (selling:owner, selling:admin, selling:cs —
// `selling:all`) imports, into a shop of its own, a statement BUILT for the test whose six rows each end differently:
//   two income rows on this shop's orders      → POSTED to their order
//   one income row whose ref no order carries  → POSTED to the shop (an-unmatched-ref-posts-to-the-shop)
//   a Gagal withdrawal and the row returning it → SKIPPED (only-a-successful-withdrawal-is-recorded)
//   one row of a type nobody has mapped        → HELD
// WHEN: Penyelesaian › Impor, narrowed to the shop → click the import's row → its page.
//
// THEN `each row shown with its result` — every one of the six rows is on the page, with what became of it. Read on
// every view the page offers (`lines-tab-*`, whichever exist, every page of each), so a view added later is read too.
//
// Built 2026-11-19 (backlog #93; the 🔄 2026-11-19 line under the-prototype-and-its-contract-are-accepted,
// settlement_importer_decision.md): after Held · Skipped · Posted to the shop the page now offers **Posted** (every
// posted row — one on its order reads "Posted to its order" with the order linked, `line-order-<lineId>` → /orders/<id>)
// and **Already there** (the rows imported before). Held · Skipped · Posted · Already there hold every row once and count
// what the tally counts, so the then is a real check for every role. It was a test.fail until then (the page listed only
// Held · Skipped · Posted to the shop — e2e_report/tester/20261119-072523-acceptance-open-import-detail.md); the then
// stays ⬜ until the owner's word. The per-role regression that pinned the three old views while the then was expected
// to fail is folded into the then. The regression after it pins the half of #93 no acceptance row names: the same
// statement imported again — every row Already there, the order still linked — and a view longer than a page, read a
// page at a time. Since #94 (the page's phone layout) the pages are the growing pager's (`lines-pager`, readView) and an
// empty view is the empty hint (`lines-empty`); the phone's own checks are settlement_import_detail_phone.spec.ts.
test.describe("selling:all wants to check what an import did — open import detail", () => {
  test.describe.configure({ timeout: 150_000 });

  const COND = "Shopee shop · statement · imported";
  const KINDS = { then: "T", again: "X" } as const;
  type Kind = keyof typeof KINDS;
  const OWNER = ROLES[0];

  const PAYOUT_A = 85_000;
  const PAYOUT_B = 90_000;
  const TO_SHOP = 60_000;
  const WITHDRAWN = 50_000;
  const UNMAPPED = 1_500;
  const UNMAPPED_KIND = "Biaya Tak Dikenal";

  // The regression's statement: one row on the shop's order, one successful withdrawal (it names no order), and
  // NO_ORDER_ROWS refs no order carries — 22 posted rows, more than the page's 20 a page.
  const PAID_OUT = 40_000;
  const NO_ORDER_ROWS = 20;

  // The page's words for a row's result (en.json settlementImports.result / .reason).
  const POSTED_TO_ORDER = "Posted to its order";
  const POSTED_TO_SHOP = "Posted to the shop — the row names no order";
  const EXISTING = "Already in the ledger — imported before";
  const NO_ORDER = "No order with this ref";
  const UNMAPPED_TYPE = "A type nobody has mapped yet";
  const FAILED_WITHDRAWAL = "A withdrawal that did not succeed";

  // The marketplace's Order ID ("No. Pesanan") — unique per role, test and row, and per run.
  const ref = (r: Role, k: Kind, i: number) => `SD${SUFFIX}${r.key.toUpperCase()}${KINDS[k]}${i}`;
  const at = (r: Role, k: Kind) => `${r.key}-${KINDS[k]}`;

  const ground = {
    g: undefined as Ground | undefined,
    shops: {} as Record<string, { id: string; name: string }>,
    orders: {} as Record<string, string[]>,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const page = await browser.newPage();
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);

    // 3 roles × 2 orders for the then, 1 for the regression — a unit each.
    const g = await sellingGround(page, "ID", 14);
    ground.g = g;

    let n = 0;
    const shopFor = async (r: Role, k: Kind, orders: number) => {
      const name = `E2E Imp Detail ${KINDS[k]} ${r.key} ${SUFFIX}`;
      const id = await shopOf(page, g, name, `ID${++n}${SUFFIX}`, "MARKETPLACE_SHOPEE", [g.users[r.key]]);
      ground.shops[at(r, k)] = { id, name };
      ground.orders[at(r, k)] = [];
      for (let i = 1; i <= orders; i++) ground.orders[at(r, k)]!.push(await orderOf(page, g, id, ref(r, k, i)));
    };
    for (const r of ROLES) await shopFor(r, "then", 2);
    await shopFor(OWNER, "again", 1);
    await page.close();
  });

  /** The statement of the given: six rows, each ending differently (see the header). */
  function statement(r: Role): Buffer {
    const k: Kind = "then";
    const tag = `${SUFFIX} ${r.key} ${KINDS[k]}`;
    return shopeeStatement([
      { kind: SHOPEE_INCOME, description: `Penghasilan ${ref(r, k, 1)}`, ref: ref(r, k, 1), amount: PAYOUT_A },
      { kind: SHOPEE_INCOME, description: `Penghasilan ${ref(r, k, 2)}`, ref: ref(r, k, 2), amount: PAYOUT_B },
      { kind: SHOPEE_INCOME, description: `Penghasilan ${ref(r, k, 9)}`, ref: ref(r, k, 9), amount: TO_SHOP },
      { kind: SHOPEE_WITHDRAWAL, description: `Penarikan Dana ${tag}`, amount: -WITHDRAWN, status: "Gagal" },
      { kind: SHOPEE_WITHDRAWAL, description: `Pengembalian Penarikan Dana ${tag}`, amount: WITHDRAWN },
      { kind: UNMAPPED_KIND, description: `Biaya ${tag}`, amount: -UNMAPPED },
    ]);
  }

  /** The regression's statement: the order row, the withdrawal, then the refs no order carries (100…). */
  function statementAgain(): Buffer {
    const k: Kind = "again";
    return shopeeStatement([
      { kind: SHOPEE_INCOME, description: `Penghasilan ${ref(OWNER, k, 1)}`, ref: ref(OWNER, k, 1), amount: PAYOUT_A },
      { kind: SHOPEE_WITHDRAWAL, description: `Penarikan Dana ${SUFFIX} ${OWNER.key} ${KINDS[k]}`, amount: -PAID_OUT },
      ...Array.from({ length: NO_ORDER_ROWS }, (_, i) => ({
        kind: SHOPEE_INCOME,
        description: `Penghasilan ${ref(OWNER, k, 100 + i)}`,
        ref: ref(OWNER, k, 100 + i),
        amount: 1_000 + i,
      })),
    ]);
  }

  /** GIVEN: the role imports the statement through Import File — the dialog has said what it did. */
  async function imported(page: Page, shop: string, file: Buffer) {
    const dialog = await importThroughDialog(page, shop, file);
    await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
    await dialog.getByTestId("import-close").click();
  }

  /** WHEN: Penyelesaian › Impor narrowed to the shop, its newest upload clicked — its page. */
  async function opened(page: Page, shop: { id: string; name: string }, uploads: number) {
    const rows = await importsOf(page, shop.id);
    await expect(rows).toHaveCount(uploads);
    await rows.first().click();
    await expect(page.getByTestId("import-detail-shop")).toContainText(shop.name, { timeout: 10_000 });
    await settled(page);
  }

  type Line = { id: string; text: string; result: string; order: string | null; orderTestId: string | null };
  type View = { count: number; pageRows: number[]; lines: Line[] };

  const linesShown = (page: Page) => page.locator('[data-testid^="line-row-"]');
  const lineListAnswered = (page: Page) =>
    page.waitForResponse((res) => res.url().includes("/UploadedFileLineList"), { timeout: 15_000 }).catch(() => null);

  /**
   * One view, opened and read to its last page: the count its tab names, the rows each page showed, and every row with
   * its result (the "Why" column) and the order it links. The list keeps the previous page on screen while the next
   * one loads, so each page waits for its own answer, for the previous page's first row to leave, and for as many rows
   * as the tab's count leaves for it.
   *
   * The pager is the growing pager since #94 (`lines-pager`, GrowingPager): no "p of n" text — the page you are on is
   * the number marked `aria-current="page"`, › is `lines-pager-next`, the per-page selector `lines-pager-size` (desktop).
   * Its › REPLACES the rows with the next page's (the page passes its page number to the list RPC) — it does not append
   * — so each page is read on its own and its rows added to the view's.
   */
  async function readView(page: Page, view: string): Promise<View> {
    const tab = page.getByTestId(`lines-tab-${view}`);
    const count = Number(/\((\d+)\)/.exec(await tab.innerText())?.[1] ?? NaN);
    if ((await tab.getAttribute("aria-selected")) !== "true") {
      const answered = lineListAnswered(page);
      await tab.click();
      await answered;
    }
    await expect(tab).toHaveAttribute("aria-selected", "true");

    const pager = page.getByTestId("lines-pager");
    const size = Number((await pager.getByTestId("lines-pager-size").innerText()).trim());
    const pages = Math.max(1, Math.ceil(count / size));
    const seen: View = { count, pageRows: [], lines: [] };
    let previousFirst: string | undefined;
    for (let p = 1; p <= pages; p++) {
      if (p > 1) {
        const answered = lineListAnswered(page);
        await pager.getByTestId("lines-pager-next").click();
        await answered;
        if (previousFirst) await expect(page.getByTestId(`line-row-${previousFirst}`)).toHaveCount(0);
      }
      await expect(pager.getByTestId(`lines-pager-page-${p}`)).toHaveAttribute("aria-current", "page");
      const expected = Math.min(size, count - (p - 1) * size);
      if (expected > 0) await expect.soft(linesShown(page), `${view}, page ${p}: its rows`).toHaveCount(expected);
      else await expect.soft(page.getByTestId("lines-empty"), `${view}: no rows here`).toBeVisible();
      await settled(page);

      const lines = await linesShown(page).evaluateAll((els) =>
        els.map((el) => {
          const link = el.querySelector('[data-testid^="line-order-"]');
          return {
            id: el.getAttribute("data-testid")!.replace("line-row-", ""),
            text: (el as HTMLElement).innerText,
            result: el.querySelector('[data-testid^="line-reason-"]')?.textContent?.trim() ?? "",
            order: link?.getAttribute("href") ?? null,
            orderTestId: link?.getAttribute("data-testid") ?? null,
          };
        }),
      );
      seen.pageRows.push(lines.length);
      seen.lines.push(...lines);
      previousFirst = lines[0]?.id;
    }
    // The last page read: the pager knows no page after it.
    await expect.soft(pager.getByTestId("lines-pager-next"), `${view}: › is off on its last page`).toBeDisabled();
    return seen;
  }

  /** Every view the page offers, by its test id's tail (held, skipped, toShop, posted, existing, …). */
  async function everyView(page: Page): Promise<Record<string, View>> {
    const tabs = page.locator('[data-testid^="lines-tab-"]');
    await expect(tabs.first()).toBeVisible();
    const ids = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("lines-tab-", "")));
    const views: Record<string, View> = {};
    for (const id of ids) views[id] = await readView(page, id);
    return views;
  }

  /** The tally's four numbers, as the page draws them. */
  async function tallyOf(page: Page) {
    const value = async (id: string) => Number((await page.getByTestId(`tally-${id}-value`).innerText()).trim());
    return { posted: await value("posted"), existing: await value("existing"), held: await value("held"), skipped: await value("skipped") };
  }

  const n = (v: number) => v.toLocaleString("id-ID");
  // A row's ref, whole — SD…X1 must not match SD…X100 (a row's text runs its cells together, so no \b after a digit).
  const hasRef = (l: Line, r: string) => new RegExp(`${r}(?!\\d)`).test(l.text);
  const withRef = (v: View | undefined, r: string) => (v?.lines ?? []).filter((l) => hasRef(l, r));

  for (const r of ROLES) {
    test(`${r.given} open import detail (${COND})`, async ({ page }) => {
      const g = ground.g!;
      const shop = ground.shops[at(r, "then")]!;
      const orders = ground.orders[at(r, "then")]!;
      await login(page, g.usernames[r.key], PASSWORD);
      await imported(page, shop.id, statement(r));

      // WHEN — Penyelesaian › Impor, the shop's one upload, clicked.
      await opened(page, shop, 1);

      await test.step("then: each row shown with its result", async () => {
        // The tally: 3 posted (one of them to the shop), none already there, 1 held, 2 skipped.
        const tally = await tallyOf(page);
        expect.soft(tally).toEqual({ posted: 3, existing: 0, held: 1, skipped: 2 });
        await expect.soft(page.getByTestId("tally-posted")).toContainText("1 to the shop");
        await expect.soft(page.getByTestId("import-detail-period")).toContainText(today());

        const views = await everyView(page);
        const read = Object.entries(views)
          .map(([v, x]) => `${v} (${x.count}: ${x.lines.length} read)`)
          .join(", ");

        // Held · Skipped · Posted · Already there each count what the tally counts, and list that many rows.
        for (const [view, figure] of [
          ["held", tally.held],
          ["skipped", tally.skipped],
          ["posted", tally.posted],
          ["existing", tally.existing],
        ] as const) {
          expect.soft(views[view]?.count, `the ${view} tab's count is the tally's — views read: ${read}`).toBe(figure);
          expect.soft(views[view]?.lines.length, `the ${view} tab lists its count — views read: ${read}`).toBe(figure);
        }
        expect.soft(views.toShop?.count, `Posted to the shop counts the tally's "1 to the shop"`).toBe(1);

        // Every row of the statement, once, among the four.
        const all = ["held", "skipped", "posted", "existing"].flatMap((v) => views[v]?.lines ?? []);
        expect.soft(new Set(all.map((l) => l.id)).size, `the statement's six rows, each shown — views read: ${read}`).toBe(6);
        expect.soft(all.length, `no row listed twice among held · skipped · posted · already there`).toBe(6);

        // POSTED TO ITS ORDER — the two rows on this shop's orders, each with its order linked.
        for (const [i, payout] of [
          [1, PAYOUT_A],
          [2, PAYOUT_B],
        ] as const) {
          const rows = withRef(views.posted, ref(r, "then", i));
          expect.soft(rows, `row ${ref(r, "then", i)} on Posted — views read: ${read}`).toHaveLength(1);
          const row = rows[0];
          expect.soft(row?.result, `row ${ref(r, "then", i)}'s result`).toBe(POSTED_TO_ORDER);
          expect.soft(row?.order, `row ${ref(r, "then", i)} links its order`).toBe(`/orders/${orders[i - 1]}`);
          expect.soft(row?.orderTestId).toBe(`line-order-${row?.id}`);
          expect.soft(row?.text).toContain(n(payout));
          expect.soft(row?.text).toContain("Payout");
        }

        // POSTED TO THE SHOP — the ref no order carries: on Posted, and the same row on Posted to the shop, and why.
        const toShop = withRef(views.posted, ref(r, "then", 9));
        expect.soft(toShop, `row ${ref(r, "then", 9)} on Posted — views read: ${read}`).toHaveLength(1);
        expect.soft(toShop[0]?.result).toBe(NO_ORDER);
        expect.soft(toShop[0]?.order, "a row posted to the shop links no order").toBeNull();
        expect.soft(toShop[0]?.text).toContain(n(TO_SHOP));
        expect.soft(toShop[0]?.text).toContain("Payout");
        expect.soft(views.toShop?.lines.map((l) => l.id)).toEqual(toShop.map((l) => l.id));

        // SKIPPED — the failed withdrawal and the row returning it: recorded as nothing, and why.
        expect.soft(views.skipped?.lines).toHaveLength(2);
        for (const row of views.skipped?.lines ?? []) {
          expect.soft(row.text).toContain(SHOPEE_WITHDRAWAL);
          expect.soft(row.text).toContain(n(WITHDRAWN));
          expect.soft(row.result).toBe(FAILED_WITHDRAWAL);
        }

        // HELD — the type nobody has mapped: not recorded as anything, and why.
        expect.soft(views.held?.lines).toHaveLength(1);
        const held = views.held?.lines[0];
        expect.soft(held?.text).toContain(UNMAPPED_KIND);
        expect.soft(held?.text).toContain("Not mapped");
        expect.soft(held?.text).toContain(n(UNMAPPED));
        expect.soft(held?.result).toBe(UNMAPPED_TYPE);
      });
    });
  }

  // Regression (no then of its own — #93's other half): the page opens on Held; Posted lists every posted row a page at
  // a time (the withdrawal "Posted to the shop — the row names no order"); and the same statement imported again
  // (the-row-key-is-the-only-dedupe) lists every row under Already there, the order still linked.
  test(`${OWNER.given} the same statement imported again — every row Already there, its order linked, a page at a time`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const g = ground.g!;
    const shop = ground.shops[at(OWNER, "again")]!;
    const [orderId] = ground.orders[at(OWNER, "again")]!;
    const onOrder = ref(OWNER, "again", 1);
    const rows = NO_ORDER_ROWS + 2;
    await login(page, g.usernames[OWNER.key], PASSWORD);

    // The first import: every row posted — one to its order, the withdrawal and the 20 unknown refs to the shop.
    await imported(page, shop.id, statementAgain());
    await opened(page, shop, 1);
    await expect(page.getByTestId("lines-tab-held")).toHaveAttribute("aria-selected", "true");
    expect.soft(await tallyOf(page)).toEqual({ posted: rows, existing: 0, held: 0, skipped: 0 });
    await expect.soft(page.getByTestId("tally-posted")).toContainText(`${NO_ORDER_ROWS} to the shop`);

    const posted = await readView(page, "posted");
    expect.soft(posted.count).toBe(rows);
    expect.soft(posted.pageRows, "Posted read a page at a time — 20, then the rest").toEqual([20, rows - 20]);
    expect.soft(new Set(posted.lines.map((l) => l.id)).size).toBe(rows);
    const first = withRef(posted, onOrder);
    expect.soft(first).toHaveLength(1);
    expect.soft(first[0]?.result).toBe(POSTED_TO_ORDER);
    expect.soft(first[0]?.order).toBe(`/orders/${orderId}`);
    const withdrawal = posted.lines.filter((l) => l.text.includes(SHOPEE_WITHDRAWAL));
    expect.soft(withdrawal).toHaveLength(1);
    expect.soft(withdrawal[0]?.result).toBe(POSTED_TO_SHOP);
    expect.soft(withdrawal[0]?.order).toBeNull();
    expect.soft(withdrawal[0]?.text).toContain(n(PAID_OUT));
    const unknown = posted.lines.filter((l) => l.result === NO_ORDER);
    expect.soft(unknown).toHaveLength(NO_ORDER_ROWS);
    expect.soft(unknown.filter((l) => l.order !== null)).toHaveLength(0);

    const toShop = await readView(page, "toShop");
    expect.soft(toShop.count).toBe(NO_ORDER_ROWS);
    expect.soft(toShop.lines.map((l) => l.id).sort()).toEqual(unknown.map((l) => l.id).sort());

    // The same file again: nothing posts; every row is already in the ledger.
    await imported(page, shop.id, statementAgain());
    await opened(page, shop, 2);
    expect.soft(await tallyOf(page)).toEqual({ posted: 0, existing: rows, held: 0, skipped: 0 });

    const again = await readView(page, "existing");
    expect.soft(again.count).toBe(rows);
    expect.soft(again.pageRows, "Already there read a page at a time — 20, then the rest").toEqual([20, rows - 20]);
    expect.soft(new Set(again.lines.map((l) => l.id)).size).toBe(rows);
    expect.soft(again.lines.filter((l) => l.result !== EXISTING).map((l) => `${l.text} → ${l.result}`)).toEqual([]);
    const linked = again.lines.filter((l) => l.order !== null);
    expect.soft(linked.map((l) => hasRef(l, onOrder)), "only the order's row links an order").toEqual([true]);
    expect.soft(linked[0]?.order).toBe(`/orders/${orderId}`);
    expect.soft(linked[0]?.orderTestId).toBe(`line-order-${linked[0]?.id}`);

    const none = await readView(page, "posted");
    expect.soft(none.count).toBe(0);

    // The order link opens the order: back on Already there (page 1 — the order's row is the file's first).
    const answered = lineListAnswered(page);
    await page.getByTestId("lines-tab-existing").click();
    await answered;
    const link = page.getByTestId(`line-order-${linked[0]?.id}`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    await expect(page.getByTestId("order-ledger-panel")).toBeVisible({ timeout: 10_000 });
    await settled(page);
  });
});

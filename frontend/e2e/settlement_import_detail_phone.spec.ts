import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ROOT_PASSWORD, ROOT_USERNAME } from "./global-setup";
import { SUFFIX, login } from "./restock_helpers";
import { PASSWORD, ROLES, importThroughDialog, orderOf, sellingGround, settled, shopOf } from "./settlement_import_helpers";
import { SHOPEE_INCOME, SHOPEE_WITHDRAWAL, shopeeStatement, today } from "./settlement_statements";

// ── THE SETTLEMENT IMPORT DETAIL PAGE ON A PHONE (backlog #94) — /settlement/imports/:fileId below `md`.
//
// The rules (docs/business/settlement/settlement_importer_decision.md):
//   ## the-import-detail-phone-prototype-is-accepted — below `md` the page draws its own arrangement: the shop as the
//      title with Download as an icon on that row, the five tabs (Held first) on one sliding row, each statement row a
//      BLOCK (ref + amount, the result + its order link(s), the importer's detail, type → recorded as, day · sheet),
//      skeletons while loading (another tab never shows the previous tab's rows), the empty hint, the growing pager —
//      and, on both shells, the standing rules: one GrowingPager (`lines-pager`; the desktop keeps 10 / 20 / 50), the
//      EmptyHint in place of the table on an empty tab (`lines-empty`, "No rows here."), ListSkeleton on first loads;
//   ## the-import-pages-tab-note-stays-on-a-phone — each tab's explanation line on EVERY tab, wrapped whole;
//   ## a-phone-import-block-opens-only-its-order-link — a block opens nothing itself; only its order link(s) do.
// Pinned here as structure and behaviour, never pixel or font sizes.
//
// THE GROUND — one Shopee statement BUILT in the spec (settlement_statements.ts), imported once by the selling owner of
// a team and shop of this spec's own (tag "IP", shop code IPH…, refs SPH<SUFFIX>…: every ref and description carries
// SUFFIX — a Shopee row's key is its content, across every team):
//   1 income row on the shop's order          → Posted, to its order (`line-order-<id>`)
//   21 income rows whose ref no order carries → Posted to the shop — one more than a page (20), so the pager has a 2nd
//   a Gagal withdrawal and the row returning it → Skipped
//   1 row of a type nobody has mapped          → Held
//   Already there                              → empty (nothing was imported before)
//
// SIGN-IN: the phone shell has no `current-user` line, which the sign-in waits for — so the page signs in wide, then
// becomes the 390 × 844 phone this describe declares (the pattern of the_goods_in_transit / the_team_balance specs).
// The pager here REPLACES the rows with the next page's (the page passes its page number to the list RPC); the trail of
// page numbers is what grows (GrowingPager, `the-accounts-pager-grows-with-the-pages-opened`).
test.describe("the settlement import detail on a phone (#94)", () => {
  test.describe.configure({ timeout: 120_000 });

  const PHONE = { width: 390, height: 844 };
  const WIDE = { width: 1280, height: 720 };
  const OWNER = ROLES[0];
  const PAGE = 20; // the page's own page size — a phone draws no per-page selector

  const PAYOUT = 85_000;
  const WITHDRAWN = 50_000;
  const UNMAPPED = 1_500;
  const UNMAPPED_KIND = `Biaya Ponsel ${SUFFIX}`;
  const TO_SHOP_ROWS = PAGE + 1;
  const SHEET = "Rincian Transaksi"; // the Shopee reader's sheet name (settlement_importer_v1/statement.go)

  const ref = (tail: string) => `SPH${SUFFIX}${tail}`;
  const ON_ORDER = ref("O1");
  const unknownRef = (i: number) => ref(`U${100 + i}`);

  // The page's words (en.json settlementImports.detail.*Note / .noLines, .result / .reason).
  const VIEWS = ["held", "skipped", "toShop", "posted", "existing"] as const;
  type View = (typeof VIEWS)[number];
  const NOTE: Record<View, string> = {
    held: "These rows could not post. Once the reason is fixed, upload the same file again — only these rows go in.",
    skipped:
      "These rows are not recorded, by design — they repeat money another row already carries, or a withdrawal that did not go through.",
    toShop:
      "These rows went to the shop: their order was not found, or their ref is on several live orders (each named). An order entered later does not receive them.",
    posted:
      "Every row that posted — each to the order its ref names, or to the shop: a row that names no order, like a withdrawal, or whose order was not found (those are also under Posted to the shop).",
    existing: "These rows were already in the ledger — the same rows, imported before — so nothing was posted again.",
  };
  const COUNT: Record<View, number> = { held: 1, skipped: 2, toShop: TO_SHOP_ROWS, posted: TO_SHOP_ROWS + 1, existing: 0 };
  const NO_ROWS = "No rows here.";
  const POSTED_TO_ORDER = "Posted to its order";
  const NO_ORDER = "No order with this ref";
  const UNMAPPED_TYPE = "A type nobody has mapped yet";
  const FAILED_WITHDRAWAL = "A withdrawal that did not succeed";

  const state = { username: "", uploader: "", shop: { id: "", name: "" }, orderId: "", fileId: "" };

  function statement(): Buffer {
    const tag = `${SUFFIX} phone`;
    return shopeeStatement([
      { kind: SHOPEE_INCOME, description: `Penghasilan ${ON_ORDER}`, ref: ON_ORDER, amount: PAYOUT },
      ...Array.from({ length: TO_SHOP_ROWS }, (_, i) => ({
        kind: SHOPEE_INCOME,
        description: `Penghasilan ${unknownRef(i)}`,
        ref: unknownRef(i),
        amount: 1_000 + i,
      })),
      { kind: SHOPEE_WITHDRAWAL, description: `Penarikan Dana ${tag}`, amount: -WITHDRAWN, status: "Gagal" },
      { kind: SHOPEE_WITHDRAWAL, description: `Pengembalian Penarikan Dana ${tag}`, amount: WITHDRAWN },
      { kind: UNMAPPED_KIND, description: `Biaya ${tag}`, amount: -UNMAPPED },
    ]);
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    // ⚠ A hook's browser.newPage() takes the FIRST test's `test.use` — here the phone's 390 × 844 — and the sign-in
    // waits for the desktop shell's `current-user`: the ground's pages are sized wide on purpose.
    const root = await browser.newPage({ viewport: WIDE, hasTouch: false });
    await login(root, ROOT_USERNAME, ROOT_PASSWORD);
    const g = await sellingGround(root, "IP", 2);
    state.username = g.usernames[OWNER.key];
    state.uploader = `Imp IP ${OWNER.given} ${SUFFIX}`;
    state.shop.name = `E2E Imp Phone ${SUFFIX}`;
    state.shop.id = await shopOf(root, g, state.shop.name, `IPH1${SUFFIX}`, "MARKETPLACE_SHOPEE", [g.users[OWNER.key]]);
    state.orderId = await orderOf(root, g, state.shop.id, ON_ORDER);
    await root.close();

    // The owner imports it through Import File, on the desktop the dialog was built for, and opens its page.
    const owner = await browser.newPage({ viewport: WIDE, hasTouch: false });
    await login(owner, state.username, PASSWORD);
    await settled(owner);
    const dialog = await importThroughDialog(owner, state.shop.id, statement());
    await expect(dialog.getByTestId("import-summary")).toBeVisible({ timeout: 45_000 });
    await dialog.getByTestId("open-imported-file").click();
    await expect(owner).toHaveURL(/\/settlement\/imports\/\d+/);
    state.fileId = /\/settlement\/imports\/(\d+)/.exec(owner.url())![1]!;
    await expect(owner.getByTestId("import-detail-shop")).toContainText(state.shop.name, { timeout: 10_000 });
    await settled(owner);
    await owner.close();
  });

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────

  const rowsOf = (page: Page) => page.locator('[data-testid^="line-row-"]');
  const lineListAnswered = (page: Page) =>
    page.waitForResponse((res) => res.url().includes("/UploadedFileLineList"), { timeout: 15_000 }).catch(() => null);

  /** The statement's day as a row draws it — short, *19 Nov*, in the app's language (en); the year only when not this year. */
  const shortDay = (page: Page) =>
    page.evaluate((d) => {
      const [y, m, day] = d.split("-").map(Number);
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" })
          .formatToParts(new Date(Date.UTC(y!, m! - 1, day!)))
          .map((p) => [p.type, p.value]),
      );
      return `${parts.day} ${parts.month}`;
    }, today());

  async function openDetail(page: Page) {
    await page.goto(`/settlement/imports/${state.fileId}`);
    await expect(page.getByTestId("import-detail-shop")).toContainText(state.shop.name, { timeout: 10_000 });
    await expect(page.getByTestId("lines-tab-held")).toHaveAttribute("aria-selected", "true");
    await expect(rowsOf(page)).toHaveCount(COUNT.held);
    await settled(page);
  }

  /** Signed in wide (the phone shell has no `current-user`), then the phone this describe declares; the file's page. */
  async function onPhone(page: Page) {
    await page.setViewportSize(WIDE);
    await login(page, state.username, PASSWORD);
    await settled(page);
    await page.setViewportSize(PHONE);
    await openDetail(page);
  }

  /** A tab opened and its own rows landed (its first page) — or its empty hint. Returns the count its label names. */
  async function openTab(page: Page, view: View): Promise<number> {
    const tab = page.getByTestId(`lines-tab-${view}`);
    const count = Number(/\((\d+)\)/.exec(await tab.innerText())?.[1] ?? NaN);
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("lines-loading")).toHaveCount(0, { timeout: 15_000 });
    if (count === 0) await expect(page.getByTestId("lines-empty")).toBeVisible();
    else await expect(rowsOf(page)).toHaveCount(Math.min(count, PAGE));
    await settled(page);
    return count;
  }

  type Block = {
    id: string;
    tag: string;
    role: string | null;
    tabindex: string | null;
    ref: string | null;
    amount: string | null;
    amountColor: string | null;
    reason: string | null;
    detail: string | null;
    type: string | null;
    when: string | null;
    order: string | null;
    orderText: string | null;
  };

  /** Every block on screen, each part read by its test id (null = the part is not drawn). */
  const blocksOf = (page: Page): Promise<Block[]> =>
    rowsOf(page).evaluateAll((els) =>
      els.map((el) => {
        const id = el.getAttribute("data-testid")!.replace("line-row-", "");
        const part = (p: string) => el.querySelector(`[data-testid="line-${p}-${id}"]`) as HTMLElement | null;
        const text = (p: string) => {
          const e = part(p);
          return e ? (e.textContent ?? "").replace(/\s+/g, " ").trim() : null;
        };
        const amount = part("amount");
        const link = part("order") as HTMLAnchorElement | null;
        return {
          id,
          tag: el.tagName,
          role: el.getAttribute("role"),
          tabindex: el.getAttribute("tabindex"),
          ref: text("ref"),
          amount: text("amount"),
          amountColor: amount ? getComputedStyle(amount).color : null,
          reason: text("reason"),
          detail: text("detail"),
          type: text("type"),
          when: text("when"),
          order: link?.getAttribute("href") ?? null,
          orderText: link ? (link.textContent ?? "").trim() : null,
        };
      }),
    );

  // ── the phone ──────────────────────────────────────────────────────────────────────────────────────────────────

  test.describe("390 × 844", () => {
    test.use({ viewport: PHONE, hasTouch: true });

    test("the page is the phone's arrangement — its title row, one sliding tab row, every tab's note, each row a block, an empty tab's hint", async ({
      page,
    }) => {
      await onPhone(page);
      const day = await shortDay(page);

      await test.step("the title row: the shop, Download as its icon; the period and who uploaded it", async () => {
        const header = page.getByTestId("import-detail-header");
        await expect(header).toHaveAttribute("data-layout", "phone");
        await expect(header.getByTestId("import-detail-shop")).toHaveText(state.shop.name);
        const download = header.getByTestId("download-original");
        await expect(download).toBeVisible();
        await expect.soft(download, "Download is an icon — its name is its label, not drawn text").toHaveText("");
        await expect.soft(download).toHaveAttribute("aria-label", "Download original");
        await expect.soft(header.getByTestId("import-detail-period")).toContainText(today());
        await expect.soft(header.getByTestId("import-detail-uploaded-by")).toContainText(state.uploader);

        const tally = async (id: string) => Number((await page.getByTestId(`tally-${id}-value`).innerText()).trim());
        expect.soft({ posted: await tally("posted"), existing: await tally("existing"), held: await tally("held"), skipped: await tally("skipped") }).toEqual({
          posted: COUNT.posted,
          existing: 0,
          held: COUNT.held,
          skipped: COUNT.skipped,
        });
      });

      await test.step("no table: the rows are blocks; the five tabs on one row, Held first, none cut, nothing past the phone's edge", async () => {
        await expect(page.locator("table")).toHaveCount(0);
        await expect(page.getByTestId("lines-table")).toHaveAttribute("data-layout", "phone");

        const tabs = await page.locator('[data-testid^="lines-tab-"]').evaluateAll((els) =>
          els.map((e) => ({
            id: e.getAttribute("data-testid")!,
            top: Math.round(e.getBoundingClientRect().top),
            cut: e.scrollWidth > e.clientWidth + 1,
          })),
        );
        expect.soft(tabs.map((t) => t.id)).toEqual(VIEWS.map((v) => `lines-tab-${v}`));
        expect.soft(new Set(tabs.map((t) => t.top)).size, `one row of tabs: ${JSON.stringify(tabs)}`).toBe(1);
        expect.soft(tabs.filter((t) => t.cut).map((t) => t.id), "no tab shrinks under its label").toEqual([]);
        for (const v of VIEWS) await expect.soft(page.getByTestId(`lines-tab-${v}`)).toContainText(`(${COUNT[v]})`);
        const wide = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, phone: window.innerWidth }));
        expect.soft(wide.page, "nothing runs past the phone's edge").toBeLessThanOrEqual(wide.phone);
      });

      let heldColor: string | null = null;
      for (const view of VIEWS) {
        await test.step(`${view}: its note whole, and each of its rows a block`, async () => {
          const count = await openTab(page, view);
          expect.soft(count).toBe(COUNT[view]);

          // the-import-pages-tab-note-stays-on-a-phone — on every tab, wrapped whole: never cut, clamped or hidden.
          const note = page.getByTestId("lines-note");
          await expect.soft(note).toBeVisible();
          await expect.soft(note).toHaveText(NOTE[view]);
          const box = await note.evaluate((el) => ({
            cutDown: el.scrollHeight > el.clientHeight + 1,
            cutAcross: el.scrollWidth > el.clientWidth + 1,
            clamp: getComputedStyle(el).getPropertyValue("-webkit-line-clamp"),
          }));
          expect.soft(box.cutDown || box.cutAcross, `${view}'s note is not cut: ${JSON.stringify(box)}`).toBe(false);
          expect.soft(["none", ""]).toContain(box.clamp);

          if (count === 0) {
            const empty = page.getByTestId("lines-empty");
            await expect.soft(empty).toContainText(NO_ROWS);
            await expect.soft(rowsOf(page)).toHaveCount(0);
            await expect.soft(page.getByTestId("lines-table")).toHaveCount(0);
            return;
          }

          const blocks = await blocksOf(page);
          expect.soft(blocks).toHaveLength(Math.min(COUNT[view], PAGE));
          for (const b of blocks) {
            const at = `${view}, block ${b.id}`;
            expect.soft(b.tag, `${at}: a block, not a table row`).not.toBe("TR");
            for (const part of ["ref", "amount", "reason", "type", "when"] as const) {
              expect.soft(b[part], `${at}: line-${part}-${b.id} drawn`).toBeTruthy();
            }
            expect.soft(b.when, `${at}: day · sheet`).toBe(`${day} · ${SHEET}`);
          }

          if (view === "held") {
            const [b] = blocks;
            expect.soft(b?.ref, "a row naming no order reads —").toBe("—");
            expect.soft(b?.amount).toBe(`−Rp ${UNMAPPED.toLocaleString("id-ID")}`);
            expect.soft(b?.reason).toBe(UNMAPPED_TYPE);
            expect.soft(b?.type).toContain(UNMAPPED_KIND);
            expect.soft(b?.type).toContain("Not mapped");
            expect.soft(b?.order).toBeNull();
            heldColor = b?.amountColor ?? null;
          }
          if (view === "skipped") {
            expect.soft(blocks.map((b) => b.amount).sort()).toEqual([`Rp 50.000`, `−Rp 50.000`].sort());
            for (const b of blocks) {
              expect.soft(b.ref).toBe("—");
              expect.soft(b.reason).toBe(FAILED_WITHDRAWAL);
              expect.soft(b.type, "a skipped row is recorded as nothing — its type alone").toBe(SHOPEE_WITHDRAWAL);
              expect.soft(b.order).toBeNull();
            }
          }
          if (view === "toShop") {
            for (const b of blocks) {
              expect.soft(b.ref).toMatch(new RegExp(`^SPH${SUFFIX}U1\\d\\d$`));
              expect.soft(b.reason).toBe(NO_ORDER);
              expect.soft(b.order, "a row posted to the shop links no order").toBeNull();
              expect.soft(b.type).toContain(SHOPEE_INCOME);
              expect.soft(b.type).toContain("Payout");
            }
          }
          if (view === "posted") {
            const onOrder = blocks.filter((b) => b.ref === ON_ORDER);
            expect.soft(onOrder, `the order's row is on Posted's first page`).toHaveLength(1);
            const b = onOrder[0];
            expect.soft(b?.amount).toBe(`Rp ${PAYOUT.toLocaleString("id-ID")}`);
            expect.soft(b?.reason).toBe(POSTED_TO_ORDER);
            expect.soft(b?.order).toBe(`/orders/${state.orderId}`);
            expect.soft(b?.orderText).toBe(`#${state.orderId}`);
            expect.soft(b?.type).toContain(SHOPEE_INCOME);
            expect.soft(b?.type).toContain("Payout");
            // Red when money left: the held row's −Rp 1.500 is not drawn as the payout's Rp 85.000.
            expect.soft(heldColor, "money that left reads in another colour").not.toBe(b?.amountColor ?? null);
            const others = blocks.filter((x) => x.ref !== ON_ORDER);
            expect.soft(others.filter((x) => x.reason !== NO_ORDER).map((x) => `${x.ref}: ${x.reason}`)).toEqual([]);
          }
        });
      }
    });

    test("a block opens nothing itself — only its order link opens the order", async ({ page }) => {
      await onPhone(page);
      await openTab(page, "posted");
      const here = page.url();

      const blocks = await blocksOf(page);
      const onOrder = blocks.find((b) => b.ref === ON_ORDER);
      expect(onOrder, "the order's row is on Posted's first page").toBeTruthy();
      const id = onOrder!.id;
      const block = page.getByTestId(`line-row-${id}`);

      // Nothing to press: no link, no role, no tab stop.
      expect.soft(onOrder!.tag).not.toBe("A");
      expect.soft(onOrder!.role).toBeNull();
      expect.soft(onOrder!.tabindex).toBeNull();

      // A tap on the block itself — its corner, its type line, its day line — goes nowhere.
      await block.tap({ position: { x: 6, y: 6 } });
      await page.getByTestId(`line-type-${id}`).tap();
      await page.getByTestId(`line-when-${id}`).tap();
      await settled(page);
      await expect(page).toHaveURL(here);
      await expect(block).toBeVisible();

      // A block with no order (posted to the shop): a tap goes nowhere either.
      const shopRow = blocks.find((b) => b.reason === NO_ORDER)!;
      await page.getByTestId(`line-row-${shopRow.id}`).tap({ position: { x: 6, y: 6 } });
      await settled(page);
      await expect(page).toHaveURL(here);

      // Its order link opens the order.
      await page.getByTestId(`line-order-${id}`).tap();
      await expect(page).toHaveURL(new RegExp(`/orders/${state.orderId}$`));
      await expect(page.getByTestId("order-detail-page")).toBeVisible({ timeout: 10_000 });
      await settled(page);
    });

    test("the pager grows: a page of 20 blocks, › opens the rest and adds its number, no per-page selector", async ({ page }) => {
      await onPhone(page);
      await openTab(page, "toShop");
      const pager = page.getByTestId("lines-pager");
      const rows = rowsOf(page);

      await expect(rows).toHaveCount(PAGE);
      await expect(pager).toBeVisible();
      await expect.soft(pager.getByTestId("lines-pager-size"), "a phone keeps the list's page size").toHaveCount(0);
      await expect(pager.getByTestId("lines-pager-page-1")).toHaveAttribute("aria-current", "page");
      await expect(pager.getByTestId("lines-pager-page-2"), "page 1 had a next — its number is there").toBeVisible();
      await expect.soft(pager.getByTestId("lines-pager-prev")).toBeDisabled();
      const first = await blocksOf(page);

      const answered = lineListAnswered(page);
      await pager.getByTestId("lines-pager-next").tap();
      await answered;
      await expect(page.getByTestId(`line-row-${first[0]!.id}`)).toHaveCount(0);
      await expect(rows).toHaveCount(TO_SHOP_ROWS - PAGE);
      await expect(page.getByTestId("lines-loading"), "the next page is no first load — no skeleton").toHaveCount(0);
      await expect(pager.getByTestId("lines-pager-page-2")).toHaveAttribute("aria-current", "page");
      await expect.soft(pager.getByTestId("lines-pager-page-1"), "page 1 stays one tap away").toBeVisible();
      await expect.soft(pager.getByTestId("lines-pager-next"), "the last page: › is off").toBeDisabled();
      await expect.soft(pager.getByTestId("lines-pager-page-3")).toHaveCount(0);
      const second = await blocksOf(page);

      const read = [...first, ...second];
      expect.soft(new Set(read.map((b) => b.id)).size, "two pages, no row twice").toBe(TO_SHOP_ROWS);
      expect.soft(read.map((b) => b.ref).sort()).toEqual(Array.from({ length: TO_SHOP_ROWS }, (_, i) => unknownRef(i)).sort());

      // Back to 1: its first 20 again, 2 still there.
      await pager.getByTestId("lines-pager-page-1").tap();
      await expect(page.getByTestId(`line-row-${first[0]!.id}`)).toBeVisible();
      await expect(rows).toHaveCount(PAGE);
      await expect.soft(pager.getByTestId("lines-pager-page-2")).toBeVisible();

      // Another tab starts the trail over.
      await openTab(page, "held");
      await expect(pager.getByTestId("lines-pager-page-1")).toHaveAttribute("aria-current", "page");
      await expect.soft(pager.getByTestId("lines-pager-page-2")).toHaveCount(0);
      await expect.soft(pager.getByTestId("lines-pager-next")).toBeDisabled();
    });
  });

  // ── the desktop (the standing rules the go-live applied to both shells) ────────────────────────────────────────

  test.describe("desktop", () => {
    test("an empty tab's hint replaces the table; another tab shows its skeleton, never the previous tab's rows; 10 / 20 / 50 a page", async ({
      page,
    }) => {
      await login(page, state.username, PASSWORD);
      await settled(page);
      await openDetail(page);
      const pager = page.getByTestId("lines-pager");
      const rows = rowsOf(page);
      const day = await shortDay(page);

      // Held's one row, in the table; its day cell short (*19 Nov*).
      await expect(page.locator('table[data-testid="lines-table"]')).toBeVisible();
      const [held] = await blocksOf(page);
      const heldRow = page.getByTestId(`line-row-${held!.id}`);
      await expect.soft(heldRow.locator("td").first()).toHaveText(day);
      await expect.soft(pager.getByTestId("lines-pager-size")).toHaveText("20");

      await test.step("another tab: its skeleton while its rows load — Held's row never stands under Skipped", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const LIST = "**/*UploadedFileLineList*";
        await page.route(LIST, async (route) => {
          await gate;
          await route.continue();
        });
        try {
          await page.getByTestId("lines-tab-skipped").click();
          await expect(page.getByTestId("lines-tab-skipped")).toHaveAttribute("aria-selected", "true");
          await expect(page.getByTestId("lines-loading")).toBeVisible();
          await expect(heldRow).toHaveCount(0);
          await expect(rows).toHaveCount(0);
          await expect.soft(page.getByTestId("lines-table")).toHaveCount(0);
          await expect.soft(page.getByTestId("lines-note"), "the note is the new tab's at once").toHaveText(NOTE.skipped);
          await expect.soft(page.locator(".chakra-spinner"), "a skeleton, never a spinner").toHaveCount(0);
        } finally {
          release();
        }
        await expect(rows).toHaveCount(COUNT.skipped);
        await expect(page.getByTestId("lines-loading")).toHaveCount(0);
        await page.unroute(LIST);
        for (const b of await blocksOf(page)) expect.soft(b.reason).toBe(FAILED_WITHDRAWAL);
        await settled(page);
      });

      await test.step("the empty tab: the empty hint where the table was, the pager still on screen", async () => {
        await openTab(page, "existing");
        const empty = page.getByTestId("lines-empty");
        await expect(empty).toBeVisible();
        await expect.soft(empty).toContainText(NO_ROWS);
        await expect.soft(page.getByTestId("lines-table")).toHaveCount(0);
        await expect.soft(rows).toHaveCount(0);
        await expect.soft(page.getByTestId("lines-note")).toHaveText(NOTE.existing);
        // the-pager-is-always-on-screen: ‹ [1] ›, both off.
        await expect.soft(pager.getByTestId("lines-pager-page-1")).toHaveAttribute("aria-current", "page");
        await expect.soft(pager.getByTestId("lines-pager-prev")).toBeDisabled();
        await expect.soft(pager.getByTestId("lines-pager-next")).toBeDisabled();
      });

      await test.step("the desktop keeps 10 / 20 / 50 a page", async () => {
        await openTab(page, "posted");
        await expect(rows).toHaveCount(PAGE);
        await pager.getByTestId("lines-pager-size").click();
        for (const n of ["10", "20", "50"]) await expect.soft(page.getByRole("option", { name: n, exact: true })).toBeVisible();
        await page.getByRole("option", { name: "10", exact: true }).click();
        await expect(rows).toHaveCount(10);
        await expect.soft(pager.getByTestId("lines-pager-size")).toHaveText("10");
        await expect.soft(pager.getByTestId("lines-pager-page-1")).toHaveAttribute("aria-current", "page");
        await expect.soft(pager.getByTestId("lines-pager-page-2")).toBeVisible();
        await settled(page);
      });
    });
  });
});

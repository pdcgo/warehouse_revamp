import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { settlementImportScenario } from "../../../../.storybook/settlementImportScenario";
import { shopForWrite } from "../../../../.storybook/shopStub";
import { tabsDoNotOverlap } from "../../../features/warehouseTransfer/storyPhone";
import { AtFailed, IMPORT_DETAIL_META, fitsTheScreen, heldLines, loaded, shopeeDone } from "./kit";

// IMPORT DETAIL ON A PHONE — THE PAGE (the-import-detail-phone-prototype-is-accepted, accepted 2026-11-19): below `md`
// the page draws its own arrangement, each part an accepted rule (docs/technical/frontend/context_decision.md unless
// named):
//
//   back · title row              the shop (20px, every-phone-title-is-20px), its badges wrapping after the name,
//                                 Download as its icon at the row's end (a-phone-header-action-is-an-icon)
//   the tally                     FileTally as it is — Posted (and how many to the shop) · Already there · Held · Skipped
//   tabs: one row, slides         nothing-runs-past-a-phones-edge — the transfer lists' row
//                                 (the-transfer-lists-read-as-blocks-on-a-phone, docs/business/inventory/…)
//   each tab's note               kept on every tab, wrapped whole (the-import-pages-tab-note-stays-on-a-phone,
//                                 docs/business/settlement/settlement_importer_decision.md)
//   loading                       the page's shape, never a spinner (motion-is-small-quick-and-shared — ListSkeleton)
//
// The rows as blocks are ./PhoneRows.stories.tsx; Mobile (../index.stories.tsx) is the page at 390 as a whole. The tabs
// and their rows are the accepted ones (the-prototype-and-its-contract-are-accepted and its 🔄 2026-11-19 line):
// Held · Skipped · Posted to the shop · Posted · Already there.

const meta = {
  title: "Pages/Settlement/ImportDetail/Phone",
  ...IMPORT_DETAIL_META,
  globals: { viewport: { value: "phone390" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE TABS SLIDE — the five accepted tabs in their order, on one row inside the screen that slides sideways (no bar
// drawn, a tab never shrinks), each label whole; the last is reached and opens its rows.
export const TheTabsSlide: Story = {
  name: "The tabs slide",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`line-row-${heldLines()[0]!.id}`);

    const tabs = [...canvasElement.querySelectorAll('[data-testid^="lines-tab-"]')].map((e) => e.getAttribute("data-testid"));
    await expect(tabs).toEqual([
      "lines-tab-held",
      "lines-tab-skipped",
      "lines-tab-toShop",
      "lines-tab-posted",
      "lines-tab-existing",
    ]);
    await tabsDoNotOverlap(canvasElement);

    const last = canvas.getByTestId("lines-tab-existing");
    last.scrollIntoView({ inline: "end", block: "nearest" });
    await userEvent.click(last);
    await expect(last).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(canvas.getByTestId("lines-empty")).toBeVisible(), { timeout: 5000 });
  },
};

// EVERY TAB KEEPS ITS NOTE (the-import-pages-tab-note-stays-on-a-phone) — under the tab row, on all five tabs, what the
// tab's rows are; wrapped in full, never cut to a line or hidden. Held's is the only place the page says how to retry.
export const EveryTabKeepsItsNote: Story = {
  name: "Every tab keeps its note",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`line-row-${heldLines()[0]!.id}`);

    const says: [string, RegExp][] = [
      ["held", /^These rows could not post\. .*upload the same file again — only these rows go in\.$/],
      ["skipped", /^These rows are not recorded, by design/],
      ["toShop", /An order entered later does not receive them\.$/],
      ["posted", /^Every row that posted/],
      ["existing", /so nothing was posted again\.$/],
    ];
    for (const [view, text] of says) {
      const tab = canvas.getByTestId(`lines-tab-${view}`);
      tab.scrollIntoView({ inline: "nearest", block: "nearest" });
      await userEvent.click(tab);
      await expect(tab).toHaveAttribute("aria-selected", "true");

      const note = canvas.getByTestId("lines-note");
      await expect(note).toBeVisible();
      await expect(note).toHaveTextContent(text);
      // Whole: nothing clipped at its end or its foot, nothing past the screen's edge.
      await expect(note.scrollWidth).toBeLessThanOrEqual(note.clientWidth);
      await expect(note.scrollHeight).toBeLessThanOrEqual(note.clientHeight + 1);
      await expect(note.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    }

    // At 390 Held's note runs to several lines — it wraps rather than being cut to one.
    await userEvent.click(canvas.getByTestId("lines-tab-held"));
    const note = canvas.getByTestId("lines-note");
    await expect(note.getBoundingClientRect().height).toBeGreaterThan(parseFloat(getComputedStyle(note).lineHeight) * 1.5);
  },
};

// THE FIRST LOAD IS THE PAGE'S SHAPE — a title and bars, never a spinner on an empty page.
export const LoadingThePage: Story = {
  name: "Loading the file",
  beforeEach: () => {
    settlementImportScenario.fileHoldMs = 60_000;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const skeleton = await canvas.findByTestId("import-detail-loading");
    await expect(skeleton).toBeVisible();
    await expect(canvas.queryByTestId("import-detail-shop")).toBeNull();
    await expect(canvasElement.querySelector(".chakra-spinner")).toBeNull();
    await expect(canvas.getByTestId("back-to-imports")).toBeVisible();
  },
};

// A FILE REFUSED WHOLE — its failure first, then an empty tally and empty tabs: nothing past the edge.
export const AFailedFile: Story = {
  name: "A failed file",
  render: () => <AtFailed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("import-detail-failure")).toHaveTextContent("belong to Melati Store");
    await waitFor(() => expect(canvas.getByTestId("lines-empty")).toBeVisible(), { timeout: 5000 });
    await fitsTheScreen(canvasElement);
  },
};

// THE ORIGINAL DOWNLOADS FROM ITS ICON — the same signed link, minted when asked.
export const DownloadFromItsIcon: Story = {
  name: "Download from its icon",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const open = spyOn(window, "open").mockReturnValue(null);

    await userEvent.click(canvas.getByTestId("download-original"));

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        `https://example.invalid/proof/${shopeeDone!.documentId}`,
        "_blank",
        "noopener,noreferrer",
      ),
    );
    open.mockRestore();
  },
};

// ── The narrowest phone, and Indonesian ─────────────────────────────────────────────────────────────────────────

const LONG_SHOP = "Melati Official Store Grosir Jakarta Barat Kebon Jeruk";

// AT 320 WITH A LONG SHOP NAME — the name wraps at full width (never clamped), its badges after it, the Download icon
// stays on the row's end inside the screen; the tabs still sit side by side; nothing runs past the edge.
export const At320: Story = {
  name: "320px, a long shop name",
  globals: { viewport: { value: "mobile1" } },
  beforeEach: () => {
    shopForWrite(shopeeDone!.shopId)!.shop.name = LONG_SHOP;
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(window.innerWidth).toBe(320);

    const shop = canvas.getByTestId("import-detail-shop");
    await waitFor(() => expect(shop).toHaveTextContent(LONG_SHOP));
    await expect(shop.scrollWidth).toBeLessThanOrEqual(shop.clientWidth);
    await expect(canvas.getByTestId("download-original").getBoundingClientRect().right).toBeLessThanOrEqual(
      window.innerWidth,
    );
    await canvas.findByTestId(`line-row-${heldLines()[0]!.id}`);
    await tabsDoNotOverlap(canvasElement);
    await fitsTheScreen(canvasElement);
  },
};

// IN INDONESIAN — the longer tab labels still sit side by side, and the block's words are the catalogue's; the by-line's
// time is the app's, in WIB (a-table-date-is-short-and-every-time-is-wib).
export const Indonesian: Story = {
  name: "In Indonesian",
  globals: { locale: "id", viewport: { value: "phone390" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const [, refused] = heldLines();

    await expect(canvas.getByTestId("download-original")).toHaveAccessibleName("Unduh file asli");
    await expect(canvas.getByTestId("lines-tab-held")).toHaveTextContent("Ditahan (2)");
    await expect(canvas.getByTestId("lines-tab-toShop")).toHaveTextContent("Tercatat ke toko (3)");
    await expect(await canvas.findByTestId(`line-reason-${refused!.id}`)).toHaveTextContent("Ditolak oleh penyelesaian");
    await expect(canvas.getByTestId(`line-type-${refused!.id}`)).toHaveTextContent("Pencairan");
    await expect(canvas.getByTestId(`line-when-${refused!.id}`)).toHaveTextContent(/^27 Sep · Rincian Transaksi$/);
    await expect(canvas.getByTestId("import-detail-uploaded-by")).toHaveTextContent(/Diunggah oleh .+, 28 Sep 2026\D+09\.10$/);
    await tabsDoNotOverlap(canvasElement);
    await fitsTheScreen(canvasElement);
  },
};

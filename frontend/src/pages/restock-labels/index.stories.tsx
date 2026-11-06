import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { LABELS_META, printedPaperMm, sheet } from "./stories/kit";

// RESTOCK LABELS — the screen as it opens: Default and Mobile sit FIRST, straight under RestockLabels (owner: *"default
// dan mobile taruh di depan saja"*). The same title also holds the folders below. Its rules are grouped by the part of
// the screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Header    back to where it was opened, Cetak and Ctrl+P
//   Restocks  the Restok card — several restocks, Tambah Restok, the jump to a restock's labels, the one-by-one read
//   Settings  the label set up in mm — paper, grid, padding, text, name lines, the run, remembered
//   States    a restock in each other status, a selling team, the old address
//   ToPrint   Yang Dicetak — each label once with its count, what is left out

const meta = {
  title: "Pages/Inventory/Restock/RestockLabels",
  ...LABELS_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 503, counted in — THE DEFAULTS (the-label-is-set-up-in-mm): a 35 × 15 mm paper, one label on it, no gap; the SKU, the
 * placement and the name on the label, bold, not centred; no date. And THE SCREEN RULES
 * (the-restock-labels-follow-the-screen-rules): back is its icon, Cetak carries its own — and is the one print button,
 * with no Unduh PDF beside it (cetak-is-the-one-print-button).
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    await expect(canvas.getByTestId("labels-paper-width")).toHaveValue("35");
    await expect(canvas.getByTestId("labels-paper-height")).toHaveValue("15");
    await expect(canvas.getByTestId("labels-rows")).toHaveValue("1");
    await expect(canvas.getByTestId("labels-columns")).toHaveValue("1");
    await expect(canvas.getByTestId("labels-gap")).toHaveValue("0");
    await expect(printedPaperMm()).toEqual({ width: 35, height: 15 });

    const first = within(canvas.getByTestId("labels-paper-0"));
    await expect(first.getByTestId("label-sku")).toHaveTextContent("SKU-BERAS-5K");
    await expect(first.getByTestId("label-placement")).toHaveTextContent("A-01-1");
    await expect(first.getByTestId("label-name")).toHaveTextContent("Beras Pandan Wangi 5kg");
    await expect(first.queryByTestId("label-date")).toBeNull();
    await expect(getComputedStyle(first.getByTestId("label-sku")).fontWeight).toBe("700");

    // THE PAGE IS SETTINGS, A PREVIEW AND WHAT PRINTS (the-label-page-is-settings-and-a-preview,
    // the-print-list-is-each-label-and-its-count) — one paper in the Pratinjau card, titled with its size; the labels in
    // Yang Dicetak.
    const preview = canvas.getByTestId("labels-preview");
    await expect(within(preview).getByTestId("labels-paper-0")).toBeInTheDocument();
    await expect(within(preview).getByTestId("labels-preview-size")).toHaveTextContent("paper 35 × 15 mm · 1 × 1 labels");
    await expect(within(canvas.getByTestId("labels-to-print")).getByTestId("labels-sheet")).toBeInTheDocument();

    await expect(canvas.getByTestId("labels-back")).toHaveTextContent("");
    await expect(canvas.getByTestId("labels-print").querySelector("svg")).not.toBeNull();
    await expect(canvas.queryByTestId("labels-download")).toBeNull();
    await expect(canvas.queryByText("Download PDF")).toBeNull();
    await expect(canvas.getByTestId("labels-run")).toHaveTextContent("labels 1–27 of 27 · 27 papers");
  },
};

// A PHONE (every-page-has-a-mobile-story) — the title's row is one row and Cetak is its icon, alone
// (a-phone-header-action-is-an-icon); the settings come before the preview; nothing runs past the screen's edge
// (nothing-runs-past-a-phones-edge).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await sheet(canvasElement);

    const print = canvas.getByTestId("labels-print");
    await expect(print).toHaveAccessibleName("Print");
    await expect(print).toHaveTextContent("");
    await expect(canvas.queryByTestId("labels-download")).toBeNull();
    const middle = (el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      return (box.top + box.bottom) / 2;
    };
    await expect(Math.abs(middle(print) - middle(canvas.getByTestId("labels-back")))).toBeLessThan(4);
    await expect(
      canvas.getByTestId("labels-settings").compareDocumentPosition(canvas.getByTestId("labels-sheet")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

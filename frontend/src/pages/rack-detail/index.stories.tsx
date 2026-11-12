import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { RACK_DETAIL_META, loaded, stock } from "./stories/kit";

// RACK DETAIL — the screen as it opens: Default and Mobile sit FIRST, straight under RackDetail. The same title also holds
// the folders below. Its rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   Found     Report Found from the shelf — staff and the Owner, only what this warehouse has held
//   Header    back to where it was opened, the title that sticks
//   History   Riwayat — the Penempatan lens, who moved it, a former user
//   Move      Move Goods — one rack or two, everything, the refusals, a counted product
//   Sample    Record Sample — what it takes, a counted product
//   Sections  three sections on one page under a nav, and a click on it jumping there
//   Shelf     an empty rack

const meta = {
  title: "Pages/Inventory/Racks/RackDetail",
  ...RACK_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The rack as staff read it: the code, each product's team and stock count (a-rack-shows-its-stock-count-for-now), and
// the acts; back is its icon, the acts carry theirs, the figures are the card strip, the sections are one page under a
// nav (a-rack-page-is-one-page-of-sections). In units only — a warehouse is given no price and no value
// (a-warehouse-sees-ready-value-but-a-shelf-only-units; Root's priced shelf is Shelf / Root reads the value).
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("rack-detail-code")).toHaveTextContent("A-01-1");
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("12"));
    await expect(stock(canvas).getByTestId("rack-stock-onhand-73")).toHaveTextContent("5");
    await expect(stock(canvas).getByTestId("rack-stock-onhand-74")).toHaveTextContent("8");
    // WHOSE IT IS, in its own column: three teams' goods on one rack.
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-team-74")).toHaveTextContent("Toko Melati"));
    await expect(stock(canvas).getByTestId("rack-stock-team-73")).toHaveTextContent("Toko Kenanga");
    await expect(stock(canvas).getByTestId("rack-stock-team-71")).toHaveTextContent("Gudang Pusat");

    await expect(canvas.getByTestId("rack-detail-back")).toHaveTextContent("");
    await expect(canvas.getByTestId("rack-action-move").querySelector("svg")).not.toBeNull();
    await expect(canvas.getByTestId("rack-action-sample").querySelector("svg")).not.toBeNull();
    await expect(canvas.getByTestId("rack-summary")).toBeVisible();
    await expect(canvas.getByTestId("rack-summary-count")).toHaveTextContent("25 units");
    await expect(canvas.queryByTestId("rack-summary-value")).toBeNull();
    await expect(stock(canvas).queryByTestId("rack-unit-cost-71")).toBeNull();
    await expect(canvas.getByTestId("section-nav")).toBeVisible();
  },
};

// A PHONE (every-page-has-a-mobile-story) — the title's row is one row and its acts fold into `⋯`: a staff member has
// three — Report Found (staff-may-report-a-found) beside Record Sample and Move Goods — and past two they all fold
// (a-phone-header-action-is-an-icon); the sections' chips stick at the top in place of the nav; each product is a block,
// no headings (a-phone-reads-each-line-as-a-block), and no price line under it for a warehouse
// (a-warehouse-sees-ready-value-but-a-shelf-only-units); nothing runs past the screen's edge (nothing-runs-past-a-phones-edge).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("rack-action-move")).toBeNull();
    await userEvent.click(canvas.getByTestId("rack-actions"));
    const move = await screen.findByTestId("rack-action-move");
    await waitFor(() => expect(move).toBeVisible());
    // One word, as the other two (the-move-reads-pindah-rak).
    await expect(move).toHaveTextContent(/^Move$/);
    await expect(screen.getByTestId("rack-action-report-found")).toBeVisible();
    await userEvent.keyboard("{Escape}");

    await expect(canvas.getByTestId("section-nav-strip")).toBeVisible();
    await expect(canvas.queryByTestId("section-nav")).toBeNull();
    await expect(within(canvas.getByTestId("rack-detail-stock")).queryAllByRole("columnheader")).toHaveLength(0);
    await waitFor(() => expect(stock(canvas).getByTestId("rack-stock-onhand-71")).toHaveTextContent("12"));
    // No price on the block's last line for a warehouse — Root's *Rp … × 12 … Rp …* is Shelf / Root reads the value, phone.
    await expect(stock(canvas).queryByTestId("rack-line-price-71")).toBeNull();
    await expect(stock(canvas).getByTestId("rack-stock-row-71")).not.toHaveTextContent("Rp");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

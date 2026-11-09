import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { At503, WAREHOUSE_DETAIL_META, loaded } from "./stories/kit";

// RESTOCK WAREHOUSE DETAIL — the screen as it opens: Default and Mobile sit FIRST, straight under RestockWarehouseDetail
// (owner: *"default dan mobile taruh di depan saja"*). The same title also holds the folders below. Its rules are grouped
// by the part of the screen they are about, one file each in ./stories (stories-are-grouped-by-the-part-of-the-screen):
//
//   Actions     the title row's acts, by status
//   Payment     the total, the courier's charge owed back, its slip, the label photo it opens
//   Products    the count, where the units went, the broken units' photo and rack
//   SignForBox  Sign for Box — its dialog, and the move to arrived
//   States      the delivery in each other status, as it opens
//   Timeline    the selling team's edit in the warehouse's trail

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * An ongoing delivery at Gudang Pusat — THE SCREEN RULES AND THE SELLING PAGE'S SHAPE
 * (the-warehouse-restock-detail-follows-the-screen-rules): the tracking number is the title, never the order id; the
 * sections are one page under a nav; the selling team's note is read, with no Ubah. And THE BOX, NOT THE PURCHASE
 * (the-warehouse-reads-the-box-not-the-purchase): no Pembayaran, no supplier, no price or line total.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-title")).toHaveTextContent("JNE0123456789");
    await expect(canvas.queryByTestId("restock-detail-invoice")).toBeNull();
    await expect(canvas.getByTestId("restock-detail-from")).toHaveTextContent("Toko Melati");
    await expect(canvas.queryByTestId("restock-detail-paid-from")).toBeNull();

    // THE BOX FIRST (the-restock-page-leads-with-the-box): Produk leads the nav, then Kiriman.
    const nav = [...canvasElement.querySelectorAll<HTMLElement>("[data-testid^='section-nav-']")].map((el) => el.dataset.testid);
    await expect(nav.slice(0, 2)).toEqual(["section-nav-products", "section-nav-delivery"]);
    for (const key of ["note", "timeline"]) {
      await expect(nav).toContain(`section-nav-${key}`);
    }
    await expect(canvas.queryAllByTestId("section-nav-payment")).toHaveLength(0);
    await expect(canvas.queryByTestId("restock-detail-total")).toBeNull();
    await expect(canvas.queryAllByTestId(/^restock-detail-supplier-/)).toHaveLength(0);
    await expect(canvas.getByTestId("restock-detail-items")).not.toHaveTextContent("Rp");

    const notes = canvas.getByTestId("restock-detail-note-section");
    await expect(within(notes).getByTestId("restock-detail-note")).toHaveTextContent("Untuk promo 10.10");
    await expect(within(notes).queryByTestId("restock-notes-edit")).toBeNull();
  },
};

// A PHONE (every-page-has-a-mobile-story) — the title row is one row and its acts are their icons
// (a-phone-header-action-is-an-icon); each line is a block, no headings (a-phone-reads-each-line-as-a-block); nothing runs
// past the screen's edge (nothing-runs-past-a-phones-edge). 503 is counted in, so its blocks carry the problems and places.
export const Mobile: Story = {
  name: "Mobile",
  render: () => <At503 />,
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-action-labels-503")).toHaveAccessibleName("Print");
    const items = canvas.getByTestId("restock-detail-items");
    await expect(within(items).queryAllByRole("columnheader")).toHaveLength(0);
    const rice = canvas.getByTestId("restock-detail-item-74");
    await expect(within(rice).getByTestId("restock-detail-broken-74-note")).toHaveTextContent("Karung sobek");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

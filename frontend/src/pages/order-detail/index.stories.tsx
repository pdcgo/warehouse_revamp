import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { FULL, ORDER_DETAIL_META } from "./stories/kit";

// ONE ORDER — the detail as it is, on a desktop and on a phone: Default and Mobile sit FIRST, straight under
// OrderDetailPage. The same title also holds the folders below, so Storybook draws it as a folder with these two stories
// leading it. Its rules are grouped by the part of the screen they are about, one file each in ./stories
// (stories-are-grouped-by-the-part-of-the-screen):
//
//   Actions   the header's actions — Cancel, Edit Resi, Force Return
//   Items     the lines: the price with its markup, three decimals, the picture, the placeholder
//   Money     the two totals, and the settlement ledger
//   Notes     Catatan — the notes, newest first, and Add Note
//   Shipping  the buyer's username under the customer, the order's own leg, and the shipping label
//   States    without the marks, a warehouse reading another team's order, not found, a bad id, every gap marked
//   Timeline  the status rows and the people on them

const meta = {
  title: "Pages/Order/OrderDetailPage",
  ...ORDER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: "Default",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());

    // The header is the ORDER's, and stays put while the sections scroll under it.
    await expect(canvas.getByTestId("order-detail-title")).toHaveTextContent(FULL.id.toString());

    // ONE PAGE OF SECTIONS, not tabs (`the-order-detail-is-one-page-of-sections`): every section is
    // on the page at once, and the nav lists them.
    await expect(canvas.queryByTestId("order-detail-tabs")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("section-items")).toBeInTheDocument();
    await expect(canvas.getByTestId("section-timeline")).toBeInTheDocument();

    for (const line of FULL.items) {
      await expect(canvas.getByText(line.name)).toBeInTheDocument();
    }
  },
};

// THE SAME ORDER, ON A PHONE-SHAPED CANVAS (owner). What to look at: the header and its actions, the
// section chips that replace the left nav, and the item table — the widest thing on the page, in its
// own scroll box.
//
// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only, and the story runner has one
// fixed viewport (MobileLayout.stories), so an assertion here would describe a width nothing renders
// at. This is for looking. The shell around it is Layouts/Mobile/AppShell.
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
};

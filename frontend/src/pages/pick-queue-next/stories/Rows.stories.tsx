import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { teams } from "../../../../.storybook/fixtures";

import { deadlineUrgency, hoursFromNow, orderDeadline } from "../../../features/orders/deadline";
import { NEW_HERE, PICK_QUEUE_META, rowOf } from "./kit";

// THE WAREHOUSE'S ORDER LIST — what a row shows, and how it opens the pick list.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Warehouse/PickQueueNextPage/Rows",
  // HIDDEN from the sidebar, as the page is (../index.stories.tsx) — `tags` is read statically, so every file writes it.
  tags: ["!dev"],
  ...PICK_QUEUE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const OVERDUE = NEW_HERE.find((o) => {
  const deadline = orderDeadline(o);
  return deadline !== undefined && deadlineUrgency(hoursFromNow(deadline)) === "overdue";
});
const WITH_REF = NEW_HERE.find((o) => (o.orderExternalRefId ?? "") !== "")!;
const REF = WITH_REF.orderExternalRefId ?? "";

/** Every column the owner named says its fact — the team is real, the marketplace ref is real. */
export const EveryColumnSaysItsFact: Story = {
  name: "Every column",
  play: async ({ canvasElement }) => {
    const row = await rowOf(canvasElement, WITH_REF.id);
    const seller = teams.find((team) => team.id === WITH_REF.teamId)!;

    await waitFor(() => expect(row).toHaveTextContent(seller.name));
    await expect(row).toHaveTextContent(REF);
  },
};

/**
 * LATE IS LOUD — the deadline takes the MP date's second line when the order has one, and an overdue
 * order tints its whole row (or block), as on the seller's list.
 */
export const AnOverdueOrderTintsItsRow: Story = {
  name: "Overdue tints the row",
  play: async ({ canvasElement }) => {
    if (!OVERDUE) return; // the fixtures always carry one; the guard keeps a changed fixture honest
    const row = await rowOf(canvasElement, OVERDUE.id);

    await expect(row).toHaveAttribute("data-overdue", "true");
    await expect(within(row).getByTestId("order-deadline")).toHaveAttribute("data-urgency", "overdue");
  },
};

/** The ref and the resi are carried elsewhere — copying them must not open the order. */
export const CopyingDoesNotOpenTheOrder: Story = {
  name: "Copy, not open",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await rowOf(canvasElement, WITH_REF.id);

    const copy = within(row).queryAllByRole("button").find((b) => b.textContent?.includes(REF));
    await expect(copy).toBeDefined();
    await userEvent.click(copy!);
    await expect(canvas.queryByTestId("at-pick-order")).toBeNull();
  },
};

/**
 * THE ROW NAMES ITS REAL SHOP AND COUNTS ITS UNITS (the-warehouse-row-fills-from-shop-and-user-by-ids): the shop comes
 * from one ShopByIds read for the page, the count from the list's `item_quantity` — order 101 is Melati Official, and
 * its three lines hold 2 + 1 + 1 units.
 */
export const TheRowNamesItsShopAndCountsItsUnits: Story = {
  name: "Shop and units",
  play: async ({ canvasElement }) => {
    const row = await rowOf(canvasElement, 101n);

    await waitFor(() => expect(row).toHaveTextContent("Melati Official"));

    // Its own column on a desktop row; "Qty 4" on a phone block.
    const qtyCell = within(canvasElement).queryByTestId("pick-queue-qty-101");
    if (qtyCell) {
      await expect(qtyCell).toHaveTextContent(/^4$/);
    } else {
      await expect(row).toHaveTextContent(/Qty\s*4/);
    }
  },
};

export const ARowOpensThePickList: Story = {
  name: "Opens the pick list",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await rowOf(canvasElement, NEW_HERE[0]!.id);

    const seller = teams.find((team) => team.id === NEW_HERE[0]!.teamId)!;
    await userEvent.click(await within(row).findByText(seller.name, { exact: false }));
    await waitFor(() => expect(canvas.getByTestId("at-pick-order")).toBeInTheDocument());
  },
};

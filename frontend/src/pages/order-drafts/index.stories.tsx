import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orderDrafts, teams } from "../../../.storybook/fixtures";
import { OrderDraftsPage } from "./index";

// THE DRAFTS TAB OF THE ORDERS SCREEN — its own route (#195), reached from the orders tab strip.
//
// Two jobs, and the second is the one that gets under-built: opening a draft to finish it, and
// PRUNING. Nothing expires, so bulk delete is load-bearing rather than a convenience.
//
//   | story                           | the rule it pins                                           |
//   | ------------------------------- | ---------------------------------------------------------- |
//   | Default                         | the strip with Drafts active, one row per draft             |
//   | EachRowSaysWhatIsLeft           | "1 of 3 unmapped" / "Ready" — not a bare yes/no              |
//   | AWarehouseHasNoDrafts           | a draft has ONE side — the team that typed it                |
//   | TheReferenceOpensTheDraft       | the row's way in                                            |
//   | AStatusTabGoesBackToTheList     | the strip is shared — a status tab returns to /orders       |
//   | BulkDeleteConfirmsFirst         | destructive → ConfirmDialog, and the toast counts            |

const SELLER = teams[1]!; // Toko Melati (12) — the only team with drafts
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

const UNMAPPED = orderDrafts.find((d) => d.unmappedItemCount > 0)!; // 201
const READY = orderDrafts.find((d) => d.unmappedItemCount === 0)!; // 202

const Routed = routedPage(
  [
    { path: "/order-drafts", element: <OrderDraftsPage /> },
    marker("/order-drafts/:draftId", "at-draft-detail"),
    marker("/orders", "at-order-list"),
  ],
  "/order-drafts",
);

const meta = {
  title: "Pages/Order/OrderDraftsPage",
  component: OrderDraftsPage,
  parameters: {
    signedIn: true,
    dataRouter: true,
    layout: "fullscreen",
  },
  beforeEach: asTeam(SELLER.id),
  render: () => <Routed />,
} satisfies Meta<typeof OrderDraftsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`draft-row-${UNMAPPED.id}`)).toBeInTheDocument());
    await expect(canvas.getByTestId(`draft-row-${READY.id}`)).toBeInTheDocument();
  },
};

// THE SAME LIST, ON A PHONE-SHAPED CANVAS (owner). What to look at: the tab strip at a width that
// cannot hold it, and the "Still needed" badges wrapping in their cell.
//
// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only (see OrderDetailPage.Mobile).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/**
 * WHAT IS LEFT TO DO, SPELLED OUT — not reduced to ready / not-ready.
 *
 * Somebody scanning forty drafts is choosing which to open next, and "one line unmapped" is a
 * different amount of work from "needs a warehouse". A draft with nothing left says Ready.
 */
export const EachRowSaysWhatIsLeft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const unmapped = await canvas.findByTestId(`draft-unmapped-${UNMAPPED.id}`);
    await expect(unmapped).toHaveTextContent(
      `${UNMAPPED.unmappedItemCount} of ${UNMAPPED.itemCount}`,
    );
    await expect(canvas.getByTestId(`draft-ready-${READY.id}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId(`draft-ready-${UNMAPPED.id}`)).toBeNull();
  },
};

/**
 * A DRAFT HAS ONE SIDE — unlike an order, which a warehouse reads from the shipping end.
 *
 * Both of Melati's drafts name Gudang Pusat as their warehouse, and Gudang Pusat still sees none:
 * a draft is not work for the building until it is promoted. ⚠ Widening this to the two-sided order
 * scope is the change this story exists to catch.
 */
export const AWarehouseHasNoDrafts: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-drafts-empty")).toBeInTheDocument());
    await expect(canvas.queryByTestId(`draft-row-${UNMAPPED.id}`)).toBeNull();
  },
};

export const TheReferenceOpensTheDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId(`open-draft-${UNMAPPED.id}`));
    await waitFor(() => expect(canvas.getByTestId("at-draft-detail")).toBeInTheDocument());
  },
};

/**
 * THE STRIP IS THE ORDERS SCREEN'S, with Drafts active. A status tab here is not a filter on drafts
 * — it goes back to the order list, landing on the tab that was clicked (`?status=`).
 */
export const AStatusTabGoesBackToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("orders-tab-packed"));
    await waitFor(() => expect(canvas.getByTestId("at-order-list")).toBeInTheDocument());
  },
};

/**
 * BULK DELETE CONFIRMS FIRST, and says how many.
 *
 * Select-all ticks this PAGE, the button carries the count, and nothing is deleted until the dialog
 * is confirmed. The toast repeats the server's `deleted`, which can be smaller than what was asked.
 */
export const BulkDeleteConfirmsFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`draft-row-${READY.id}`)).toBeInTheDocument());
    await expect(canvas.queryByTestId("delete-selected-drafts")).toBeNull();

    await userEvent.click(within(canvas.getByTestId("select-all-drafts")).getByRole("checkbox", { hidden: true }));

    const button = await canvas.findByTestId("delete-selected-drafts");
    await expect(button).toHaveTextContent(String(orderDrafts.length));

    await userEvent.click(button);

    // The dialog portals out of the canvas.
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await expect(
      await screen.findByText(`${orderDrafts.length} draft(s) deleted`),
    ).toBeInTheDocument();
  },
};

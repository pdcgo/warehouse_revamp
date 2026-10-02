import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { orderDrafts, shops, teams, users } from "../../../.storybook/fixtures";
import { OrderDraftsPage } from "./index";

// THE DRAFTS TAB OF THE ORDERS SCREEN — its own route (#195), drawn as the seller list's Drafts tab
// (`the-draft-list-is-the-drafts-tab`): the same strip, the same row grammar, fewer columns.
//
// Two jobs, and the second is the one that gets under-built: opening a draft to finish it, and
// PRUNING. Nothing expires, so bulk delete is load-bearing rather than a convenience.
//
//   | story                           | the rule it pins                                           |
//   | ------------------------------- | ---------------------------------------------------------- |
//   | Default                         | the stage strip with Drafts active, one row per draft       |
//   | EachRowSaysWhatIsLeft           | "1 of 3 unmapped" / "Ready" — not a bare yes/no              |
//   | TheSummaryCountsWhatItCan       | total and oldest are real; ready is this page, and marked    |
//   | WhatIsLeftSitsUnderTheReference | first gap named, the rest counted, all on the title          |
//   | TheRowIsRealFieldsOnly          | shop and author are the draft's own — no invented cell       |
//   | AWarehouseHasNoDrafts           | a draft has ONE side — the team that typed it                |
//   | TheRowOpensTheDraft             | the whole row is the way in                                  |
//   | CopyingTheReferenceStaysHere    | the reference copies, and does not open the draft            |
//   | AStageTabGoesBackToTheList      | the strip is shared — a stage tab returns to /orders        |
//   | OneDraftDeletesFromItsMenu      | the kebab's delete confirms, like the bulk one               |
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

/**
 * THREE NUMBERS, and only the third is partial. The total is the server's page count, the oldest is one
 * ASC row off the same RPC (201 was written first), and "ready" counts the page on screen — which its
 * label says, and which carries a ⚠.
 */
export const TheSummaryCountsWhatItCan: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("draft-summary-total-value")).toHaveTextContent(String(orderDrafts.length)),
    );
    await waitFor(() => expect(canvas.getByTestId("draft-summary-oldest-value")).toHaveTextContent("2 days"));

    const ready = canvas.getByTestId("draft-summary-ready");
    await expect(within(ready).getByTestId("draft-summary-ready-value")).toHaveTextContent("1 of 2");
    await expect(within(ready).getByTestId("not-implemented-readyCount")).toBeInTheDocument();
  },
};

/**
 * WHAT IS LEFT SITS UNDER THE REFERENCE — where the order list puts the stage. The first gap is named
 * and the rest counted, so the cell stays two lines; every gap is on the badge's title.
 */
export const WhatIsLeftSitsUnderTheReference: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId(`draft-row-${UNMAPPED.id}`);

    await expect(within(row).getByTestId(`draft-gaps-${UNMAPPED.id}`)).toHaveTextContent("Unmapped lines");
    await expect(within(row).getByTestId("order-ref")).toHaveTextContent(UNMAPPED.externalId);
  },
};

/**
 * EVERY CELL IS THE DRAFT'S OWN FIELD — the shop it was pushed for, the person who wrote it. The order
 * list's mocked creator has no place here, and so neither does a ⚠ on the row.
 */
export const TheRowIsRealFieldsOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId(`draft-row-${UNMAPPED.id}`);
    const shop = shops.find((item) => item.id === UNMAPPED.shopId)!;
    const author = users.find((item) => item.id === UNMAPPED.authorUserId)!;

    await waitFor(() => expect(row).toHaveTextContent(shop.name));
    await waitFor(() =>
      expect(within(row).getByTestId("order-placed-by")).toHaveTextContent(author.name),
    );
    await expect(within(row).queryAllByTestId(/^not-implemented-/)).toHaveLength(0);
  },
};

export const TheRowOpensTheDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId(`draft-updated-${UNMAPPED.id}`));
    await waitFor(() => expect(canvas.getByTestId("at-draft-detail")).toBeInTheDocument());
  },
};

/** The reference is carried to the marketplace's dashboard — copying it must not also leave. */
export const CopyingTheReferenceStaysHere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByTestId(`draft-row-${UNMAPPED.id}`);

    await userEvent.click(within(row).getByTestId("order-ref"));
    await expect(canvas.queryByTestId("at-draft-detail")).toBeNull();
  },
};

/**
 * THE STRIP IS THE ORDER LIST'S, with Drafts active. A stage tab here is not a filter on drafts — it
 * goes back to the order list, landing on the tab that was clicked (`?status=`).
 */
export const AStageTabGoesBackToTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("orders-tab-processed"));
    await waitFor(() => expect(canvas.getByTestId("at-order-list")).toBeInTheDocument());
  },
};

/** One draft, from its own menu — destructive, so it confirms, and names the reference it removes. */
export const OneDraftDeletesFromItsMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId(`draft-actions-${READY.id}`));

    const item = await screen.findByTestId(`draft-delete-${READY.id}`);
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByRole("alertdialog")).toHaveTextContent(READY.externalId);
    await userEvent.click(confirm);

    await expect(await screen.findByText("1 draft(s) deleted")).toBeInTheDocument();
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

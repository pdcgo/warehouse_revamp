import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, routedPage } from "../../../.storybook/pageStory";
import { SETTLEMENT_NEVER_OPENED, orders, teams } from "../../../.storybook/fixtures";
import { OrdersPage } from "./index";
import { SellerOrdersPage } from "./SellerOrders";

// a-missing-account-is-found-by-its-opened-at, design accepted in the-settlement-missing-badge-is-accepted
// (docs/business/settlement/context_decision.md). The order list with what the decision adds: a *Settlement not opened* filter (`OrderListFilter.settlement_not_opened`, built)
// and, on a row whose account never opened (`settlement_opened_at_unix` 0), a warning badge beside its stage — so the
// orders a person must fix by hand on the order page (a-missing-account-is-fixed-by-hand) are a click away, not a grep.
//
// LIVE for every reader of the list since the accept — TheLiveListShowsIt pins it on the routed `/orders` (OrdersPage).
// Toko Melati's 103 and 109 are the fixtures that never opened.

const TEAM = teams[1]!; // Toko Melati (12)

const Seller = routedPage(
  [
    { path: "/orders", element: <SellerOrdersPage /> },
    marker("/orders/new", "at-order-create"),
    marker("/orders/:orderId", "at-order-detail"),
  ],
  "/orders",
);

const Live = routedPage(
  [
    { path: "/orders", element: <OrdersPage /> },
    marker("/orders/:orderId", "at-order-detail"),
  ],
  "/orders",
);

const meta = {
  title: "Pages/Order/SellerOrderListSettlementMissing",
  component: SellerOrdersPage,
  parameters: { signedIn: true, dataRouter: true, layout: "fullscreen" },
  beforeEach: asTeam(TEAM.id),
  render: () => <Seller />,
} satisfies Meta<typeof SellerOrdersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const OWN = orders.filter((o) => o.teamId === TEAM.id);
const MISSING = OWN.filter((o) => SETTLEMENT_NEVER_OPENED.has(o.id));
const OPENED = OWN.filter((o) => !SETTLEMENT_NEVER_OPENED.has(o.id));

/** The filter's control: inline on a desktop canvas, inside the sheet on a phone-width one. */
async function filterControls(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const open = canvas.queryByTestId("orders-filters-open");

  if (!open) {
    return canvas;
  }

  await userEvent.click(open);
  const sheet = await screen.findByTestId("orders-filters-sheet");
  await waitFor(() => expect(sheet).toBeVisible());

  return within(sheet);
}

// THE BADGE: every row whose account never opened carries it, beside its stage; a row that opened carries none.
export const TheRowSaysTheAccountNeverOpened: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId(`order-row-${OWN[0]!.id}`);

    for (const o of MISSING) {
      await expect(canvas.getByTestId(`order-settlement-missing-${o.id}`)).toHaveTextContent(/no settlement account/i);
    }

    for (const o of OPENED) {
      await expect(canvas.queryByTestId(`order-settlement-missing-${o.id}`)).toBeNull();
    }
  },
};

// THE FILTER: ticked, the list is exactly the orders still missing an account — the server's filter, so the pager
// counts them too; Clear brings every order back.
export const TheFilterListsOnlyTheMissing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId(`order-row-${OWN[0]!.id}`);

    const controls = await filterControls(canvasElement);
    await userEvent.click(controls.getByText(/settlement not opened/i));

    await waitFor(() => expect(canvas.queryByTestId(`order-row-${OPENED[0]!.id}`)).toBeNull());

    for (const o of MISSING) {
      await expect(canvas.getByTestId(`order-row-${o.id}`)).toBeInTheDocument();
    }

    for (const o of OPENED) {
      await expect(canvas.queryByTestId(`order-row-${o.id}`)).toBeNull();
    }

    await userEvent.click(await screen.findByTestId("orders-filters-clear"));
    await waitFor(() => expect(canvas.getByTestId(`order-row-${OPENED[0]!.id}`)).toBeInTheDocument());
  },
};

// THE SAME LIST ON A PHONE-SHAPED CANVAS — for looking: the filter sits in the sheet with the others, the badge on
// the row's second line. No play(): the viewport global resizes the workbench canvas only.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

// THE LIVE LIST SHOWS IT (the-settlement-missing-badge-is-accepted): the routed `/orders` — what every reader opens —
// carries the badge on the rows that never opened, none on the rest, and offers the filter.
export const TheLiveListShowsIt: Story = {
  render: () => <Live />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId(`order-row-${MISSING[0]!.id}`);

    for (const o of MISSING) {
      await expect(canvas.getByTestId(`order-settlement-missing-${o.id}`)).toHaveTextContent(/no settlement account/i);
    }

    await expect(canvas.queryByTestId(`order-settlement-missing-${OPENED[0]!.id}`)).toBeNull();

    const controls = await filterControls(canvasElement);
    await expect(controls.getByText(/settlement not opened/i)).toBeInTheDocument();
  },
};

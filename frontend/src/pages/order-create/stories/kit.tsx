import { useMemo } from "react";

import { Text } from "@chakra-ui/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { todayDateInput } from "../../../lib/datetime";
import { OrderCreatePage } from "../index";

// WHAT EVERY ORDER-CREATE STORY FILE SHARES — the page's stories are split by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen): `../index.stories.tsx` holds Default and Mobile, this folder one
// file per part. Each file keeps its own `title` literal — Storybook reads it statically — and spreads the rest from here.
//
// The FIRST page storied, rather than another shared component — and the reason is that this screen
// is where stock leaves the building. Placing an order draws its goods out of the chosen warehouse in
// the same transaction that writes it, so the rules below are not form polish: they are what stops an
// order being taken for goods that are not there.
//
// ⚠ THIS STORY BUILDS ITS OWN ROUTER, via `parameters: { dataRouter: true }`.
//
// The page's unsaved-work guard is `useBlocker`, which needs a DATA router — the global
// `<MemoryRouter>` in .storybook/preview.tsx has no data-router context and the hook throws. Nesting
// one router inside another is refused by react-router, so the decorator stands down entirely and the
// routes below are the app's, cut down to the four this page can reach.

export const routes = [
  { path: "/order-create", element: <OrderCreatePage /> },
  // The three destinations, stubbed as markers. A story asserts it ARRIVED — pulling in the real
  // orders list would make this a test of that page's queries instead.
  { path: "/orders", element: <Text data-testid="at-orders">Orders</Text> },
  { path: "/orders/:orderId", element: <Text data-testid="at-order-detail">Order detail</Text> },
  // Where a saved draft, and a deleted one, go: the drafts list (the-draft-opens-in-the-order-form).
  { path: "/order-drafts", element: <Text data-testid="at-drafts">Drafts</Text> },
];

// ⚠ MEMOISED. Storybook calls `render` on every re-render, so building the router inline would hand
// the page a fresh one each time — and with it a fresh history, resetting the navigation this file
// exists to assert on.
function RoutedOrderCreate() {
  const router = useMemo(() => createMemoryRouter(routes, { initialEntries: ["/order-create"] }), []);

  return <RouterProvider router={router} />;
}

/** Everything in a file's meta but its title. */
export const ORDER_CREATE_META = {
  component: OrderCreatePage,
  parameters: {
    // `useTeam()` throws outside a TeamProvider, and this page reads the current team on every path.
    signedIn: true,
    // See the note above — the page cannot mount under the shared MemoryRouter.
    dataRouter: true,
    layout: "fullscreen",
  },
  render: () => <RoutedOrderCreate />,
};

// Two products, a name and a shop — the smallest order this form will accept. Reused by the rules
// that need a placeable order rather than an empty form.
export async function pickProduct(canvasElement: HTMLElement, productId: bigint) {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-create-add-line"));

  const option = await screen.findByTestId(`product-picker-option-${productId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);

  await userEvent.click(await screen.findByTestId("product-picker-confirm"));
}

// THE MARKETPLACE'S ORDER DATE — required to place (platform-created-at-is-required-at-finalize). Picked off the
// calendar the way a person picks it: the trigger opens it, today's cell sets the day (at 00:00), Escape closes it.
export async function pickOrderDate(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-create-order-date"));

  const content = await screen.findByTestId("order-create-order-date-content");
  await waitFor(() => expect(content).toBeVisible());

  const today = content.querySelector<HTMLElement>(`[data-part="table-cell-trigger"][data-value="${todayDateInput()}"]`);
  await userEvent.click(today!);
  await userEvent.keyboard("{Escape}");
}

// THE SELL PRICE — what the buyer paid on the storefront, required to place (platform-total-is-required-at-finalize).
// Comfortably over what one Kopi costs us (18.500 + the 2.000 fee), so no margin warning stands between Create and
// the order.
export async function fillSellPrice(canvasElement: HTMLElement, amount = "50000") {
  const canvas = within(canvasElement);

  await userEvent.type(canvas.getByTestId("order-marketplace-total"), amount, { delay: 10 });
}

// THE MARKETPLACE REF — required to place (an-order-ref-is-required-by-the-rpc). PASTED, as a ref usually arrives: one
// change to the box rather than a re-render of the whole form per keystroke.
export async function fillOrderRef(canvasElement: HTMLElement, ref = "260101AAAA0001") {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-external-ref-id"));
  await userEvent.paste(ref);
}

// Sets the quantity of the line at `index`, the way a person types it.
export async function typeQuantity(canvasElement: HTMLElement, index: number, quantity: string) {
  const canvas = within(canvasElement);

  await waitFor(() => expect(canvas.getByTestId(`order-line-qty-${index}`)).toBeInTheDocument());

  const qty = canvas.getByTestId(`order-line-qty-${index}`);
  await userEvent.clear(qty);
  await userEvent.type(qty, quantity, { delay: 40 });
}

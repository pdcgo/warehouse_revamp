import { useMemo } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { products, shops } from "../../../.storybook/fixtures";
import { OrderCreatePage } from "./index";

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

const routes = [
  { path: "/order-create", element: <OrderCreatePage /> },
  // The three destinations, stubbed as markers. A story asserts it ARRIVED — pulling in the real
  // orders list would make this a test of that page's queries instead.
  { path: "/orders", element: <Text data-testid="at-orders">Orders</Text> },
  { path: "/orders/:orderId", element: <Text data-testid="at-order-detail">Order detail</Text> },
  { path: "/order-drafts/:draftId", element: <Text data-testid="at-draft-detail">Draft detail</Text> },
];

// ⚠ MEMOISED. Storybook calls `render` on every re-render, so building the router inline would hand
// the page a fresh one each time — and with it a fresh history, resetting the navigation this file
// exists to assert on.
function RoutedOrderCreate() {
  const router = useMemo(() => createMemoryRouter(routes, { initialEntries: ["/order-create"] }), []);

  return <RouterProvider router={router} />;
}

const meta = {
  title: "Pages/Order/OrderCreate",
  component: OrderCreatePage,
  parameters: {
    // `useTeam()` throws outside a TeamProvider, and this page reads the current team on every path.
    signedIn: true,
    // See the note above — the page cannot mount under the shared MemoryRouter.
    dataRouter: true,
    layout: "fullscreen",
  },
  render: () => <RoutedOrderCreate />,
} satisfies Meta<typeof OrderCreatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// THE SAME FORM, ON A PHONE-SHAPED CANVAS (owner) — the first of the order screens to get one.
//
// It is the same page and the same data: only the canvas is narrow, which is what the form's own
// responsive rules answer to. Worth looking at here, in this order:
//
//   - the two columns collapse into one, so "which shop / which warehouse" no longer sits beside the
//     lines it governs — it sits ABOVE them, which is the reading order the design wanted anyway;
//   - the totals card stops being a sticky right rail and lands at the bottom, after the lines;
//   - every picker's option rows are 44px here against 36px on a desktop (theme.ts, OPTION_PY), and a
//     product row's controls stack rather than squeeze.
//
// ⚠ NO `play()`, DELIBERATELY. The `viewport` global resizes the WORKBENCH canvas only — the story
// runner has one fixed viewport (see MobileLayout.stories) — so an assertion written here would be
// making a claim about a width the test never renders at. This story is for looking.
//
// The shell around it on a real phone (the compact top bar, the bottom tab bar) is its own story:
// Layouts/Mobile/AppShell. What this one shows is the PAGE inside that shell.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Two products, a name and a shop — the smallest order this form will accept. Reused by the rules
// that need a placeable order rather than an empty form.
async function pickProduct(canvasElement: HTMLElement, productId: bigint) {
  const canvas = within(canvasElement);

  await userEvent.click(canvas.getByTestId("order-create-add-line"));

  const option = await screen.findByTestId(`product-picker-option-${productId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);

  await userEvent.click(await screen.findByTestId("product-picker-confirm"));
}

// THE WAREHOUSE ARRIVES PRE-FILLED, from the team's configured default (#145) — and the picker is
// therefore usable on first paint. A default the SYSTEM invents would move real goods out of the
// wrong building; a default the TEAM configured is the team stating where it ships from.
export const WarehousePrefilledFromTheTeamDefault: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // "Pick a warehouse first" is the hint shown beside the disabled picker. Its ABSENCE is the
    // assertion: the pre-fill landed, so nothing is waiting on the person.
    await waitFor(() => expect(canvas.queryByTestId("order-create-need-warehouse")).toBeNull());
    await expect(canvas.getByTestId("order-create-add-line")).toBeEnabled();
  },
};

// The form starts EMPTY — no placeholder line. Lines arrive by picking products, so a blank row would
// be one you can neither remove nor use (#165). Create is what refuses an order with nothing on it.
export const StartsWithNoLinesAndCannotBeCreated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-create-no-products")).toBeInTheDocument();
    await expect(canvas.queryByTestId("order-lines-table")).toBeNull();
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// Picking reconciles the WHOLE ticked set into lines, and each line reads its stock and its HPP from
// the chosen warehouse — one batched read for all of them, not one per line.
export const PickingProductsAddsALineWithStockAndHpp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await pickProduct(canvasElement, products[0]!.id);

    await waitFor(() => expect(canvas.getByTestId("order-lines-table")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-line-0")).toHaveTextContent(products[0]!.name);
    // 40 on the shelf, from the fixtures — the figure is the warehouse's, not the catalogue's.
    await waitFor(() => expect(canvas.getByTestId("order-line-stock-0")).toHaveTextContent("40"));
  },
};

// ⚠ THE RULE THIS PAGE EXISTS FOR. A line the warehouse cannot fill is summarised at the TOP as well
// as marked on the row, because on a long order the failing line is off screen — and "Create is
// disabled and I cannot see why" is the state this form must never be in.
export const AShortLineIsAnnouncedAtTheTopAndBlocksCreate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Fixture product 72 has THREE on the shelf.
    await pickProduct(canvasElement, products[1]!.id);
    await waitFor(() => expect(canvas.getByTestId("order-line-qty-0")).toBeInTheDocument());

    const qty = canvas.getByTestId("order-line-qty-0");
    await userEvent.clear(qty);
    await userEvent.type(qty, "5", { delay: 40 });

    await waitFor(() => expect(canvas.getByTestId("order-create-short")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// SAVE AS DRAFT asks for far less than Create, and that gap is the whole point of the button: a
// half-finished order — no shop chosen, waiting on the buyer — needs somewhere to live that does NOT
// touch the shelves. Anything typed at all is enough.
export const SaveAsDraftIsEnabledWhileCreateStillRefuses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await waitFor(() => expect(canvas.getByTestId("order-create-save-draft")).toBeEnabled());
    // No shop, no lines — Create is still right to refuse.
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// A half-typed order is real work — several lines, an address, a customer on the phone — and a
// mis-aimed click on Back threw all of it away silently. The guard only fires while the form is
// DIRTY, so "opened it, changed my mind" is untouched.
export const LeavingWithUnsavedWorkAsksFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("order-create-back"));

    // Blocked: the dialog is up and the page is still here.
    await expect(await screen.findByTestId("confirm-action")).toBeInTheDocument();
    await expect(canvas.getByTestId("order-create-page")).toBeInTheDocument();
  },
};

// …and confirming lets it through. The other half of the rule: a guard that cannot be dismissed is a
// trap rather than a safety net.
export const ConfirmingTheDiscardLeaves: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("order-create-back"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await waitFor(() => expect(screen.getByTestId("at-orders")).toBeInTheDocument());
  },
};

// The successful path, end to end — and the last line is the one that matters. `savedRef` is set
// BEFORE the navigation, so the guard above does not ask whether to discard the order that was just
// placed. That is not hypothetical: it is what happened the first time this shipped.
export const PlacingTheOrderNavigatesWithoutAskingToDiscard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    // ShopSelect renders INLINE (it has to work inside modal Dialogs), so its options are in the
    // canvas rather than a portal.
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);

    // Product 71: 40 on the shelf against a quantity of 1, so nothing is short.
    await pickProduct(canvasElement, products[0]!.id);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    // No discard dialog on the way out.
    await expect(screen.queryByTestId("confirm-action")).toBeNull();
  },
};

// ── WHAT THE REBUILT FORM ADDED (owner) ─────────────────────────────────────────────────────────

// ⚠ A BUNDLE'S PRODUCTS ARE REAL LINES. They are drawn from the same warehouse, judged by the same
// rule and SENT with the order — only the grouping has nowhere to live (mark 1). The short-line
// alert is the proof: a slot asking for more than the shelf holds blocks Create exactly as a
// hand-picked line does. If bundles were decorative, this would pass in silence and the totals would
// promise stock the order never draws.
export const ABundlesProductsAreOrderedLikeAnyOther: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(within(canvas.getByTestId("bundle-search")).getByRole("combobox"));

    const hampers = await screen.findByTestId("bundle-option-hampers");
    await waitFor(() => expect(hampers).toBeVisible());
    await userEvent.click(hampers);

    // Teh Melati (72) has THREE on the shelf in the fixtures.
    const qty = await canvas.findByTestId("slot-qty-72");
    await userEvent.clear(qty);
    await userEvent.type(qty, "5", { delay: 40 });

    await waitFor(() => expect(canvas.getByTestId("order-create-short")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// THE RECEIPT FILE LEADS, AND THE TWO NUMBERS IT CARRIES SIT WITH IT (owner) — the marketplace's
// order id and the courier's tracking number are printed on one piece of paper, so they are one card
// at the top rather than two fields three cards apart. The other half of the move is that the
// customer card no longer holds a courier or a file.
export const TheReceiptFileLeadsWithBothOfItsNumbers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const receiptCard = canvas.getByTestId("order-create-receipt-preview").closest("div[class*='card__root']");
    await expect(receiptCard).not.toBeNull();
    await expect(within(receiptCard as HTMLElement).getByTestId("order-external-ref-id")).toBeInTheDocument();
    await expect(within(receiptCard as HTMLElement).getByTestId("order-receipt-code")).toBeInTheDocument();

    // The old home of the courier + upload, now empty of them.
    await expect(canvas.queryByTestId("order-receipt-section")).toBeNull();
  },
};

// ── THE CHECKS AT CREATE (owner) ────────────────────────────────────────────────────────────────

// ⚠ AN ERROR IS NOT AN "ARE YOU SURE". One number in both boxes is a transcription mistake every
// time — the order it would place cannot be found again from either side — so the dialog offers a
// way BACK and nothing else, and the RPC is never reached.
export const TheSameNumberInBothBoxesRefusesToPlace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);

    await pickProduct(canvasElement, products[0]!.id);

    // The same reference typed into both — the case the rule exists for.
    await userEvent.type(canvas.getByTestId("order-external-ref-id"), "JP2026081500471183", {
      delay: 10,
    });
    await userEvent.type(canvas.getByTestId("order-receipt-code"), "JP2026081500471183", {
      delay: 10,
    });

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    const dialog = await screen.findByTestId("order-checks-dialog");
    await expect(within(dialog).getByTestId("order-check-refsIdentical")).toBeInTheDocument();
    // No way through: the order was NOT placed and the form is still here.
    await expect(within(dialog).queryByTestId("order-checks-place")).toBeNull();
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();
  },
};

// …and a WARNING is the other half of the rule: a thin margin is a decision somebody is entitled to
// make, so it is shown, and then it can be overruled. The order really is placed afterwards — the
// dialog is a question, not a second Create button.
export const AThinMarginAsksFirstAndThenPlaces: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);

    await pickProduct(canvasElement, products[0]!.id);

    // Sold for less than it cost — comfortably under the 35% floor.
    await userEvent.type(canvas.getByTestId("order-marketplace-total"), "1000", { delay: 10 });

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    const dialog = await screen.findByTestId("order-checks-dialog");
    await expect(within(dialog).getByTestId("order-check-profitBelowFloor")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByTestId("order-checks-place"));

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// ⚠ THE WAREHOUSE LEADS THE FORM (owner). It is not a field of the order — it is what every figure
// on the screen is measured against — so it sits in its own band above the cards, under the strip
// that says what the screen cannot do yet. This pins the ORDER of those three, because the whole
// point of the change is the reading order: what is unfinished → which building → the order itself.
export const TheWarehouseLeadsTheFormUnderTheWarning: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const top = (el: HTMLElement) => el.getBoundingClientRect().top;

    const warning = canvas.getByTestId("not-implemented-summary");
    const band = canvas.getByTestId("order-warehouse-band");
    const firstCard = canvas.getByTestId("order-create-receipt-preview");

    await expect(top(warning)).toBeLessThan(top(band));
    await expect(top(band)).toBeLessThan(top(firstCard));

    // …and it left the Order Information card behind: the picker is in the band, nowhere else.
    await expect(canvas.getAllByTestId("order-warehouse")).toHaveLength(1);
    await expect(band).toContainElement(canvas.getByTestId("order-warehouse"));
  },
};

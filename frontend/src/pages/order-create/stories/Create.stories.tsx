import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { products, shops } from "../../../../.storybook/fixtures";
import { withTakeRefusal } from "../../../../.storybook/sessionScenario";
import { OrderTransactionRefusalReason } from "../../../gen/warehouse/inventory/v1/order_transaction_pb";
import { ORDER_CREATE_META, fillOrderRef, fillSellPrice, pickOrderDate, pickProduct } from "./kit";

// ORDER CREATE — what Create needs, the checks it asks, and where it goes.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderCreate/Create",
  ...ORDER_CREATE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THERE IS NO SAVE AS DRAFT (a-draft-becomes-an-order-through-order-create): a person never drafts — only the
// third-party app does — so the form has Create alone.
export const TheFormHasNoSaveAsDraft: Story = {
  name: "No Save as Draft",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await expect(canvas.queryByTestId("order-create-save-draft")).toBeNull();
    // No shop, no lines — Create is still right to refuse.
    await expect(canvas.getByTestId("order-create-save")).toBeDisabled();
  },
};

// The successful path, end to end — and the last line is the one that matters. `savedRef` is set
// BEFORE the navigation, so the guard above does not ask whether to discard the order that was just
// placed. That is not hypothetical: it is what happened the first time this shipped.
export const PlacingTheOrderNavigatesWithoutAskingToDiscard: Story = {
  name: "Places, no discard ask",
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
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
    // No discard dialog on the way out.
    await expect(screen.queryByTestId("confirm-action")).toBeNull();
  },
};

// A TAKE THE WAREHOUSE REFUSES SAYS WHY (a-refusal-names-its-reason-and-every-line). The quote said the shelf had it;
// by the time Create ran, another order had taken it — the quote is advisory and the take is the authority. The
// server passes the take's refusal through (its code and its OrderTransactionRefusal detail), so the form names the
// reason and the product by the name it was picked by — never "internal", and never a bare status code. Nothing
// navigates: there is no order to go to.
export const ARefusedTakeNamesItsReasonAndTheLine: Story = {
  name: "Refused take",
  beforeEach: withTakeRefusal(OrderTransactionRefusalReason.NOT_ENOUGH_STOCK, [
    { productId: products[0]!.id, wanted: 1n, available: 0n },
  ]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);

    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    const refusal = await canvas.findByTestId("order-create-refusal");
    await expect(refusal).toHaveAttribute("data-reason", "notEnoughStock");
    await expect(refusal).toHaveTextContent("The warehouse does not hold enough for this order");
    await expect(canvas.getByTestId(`order-create-refusal-line-${products[0]!.id}`)).toHaveTextContent(
      `${products[0]!.name}: wants 1, the warehouse holds 0`,
    );

    // Not the generic line, and not a status code.
    await expect(canvas.queryByTestId("order-create-error")).toBeNull();
    await expect(refusal).not.toHaveTextContent(/internal|failed_precondition/i);
    await expect(screen.queryByTestId("at-order-detail")).toBeNull();
  },
};

// ── THE CHECKS AT CREATE (owner) ────────────────────────────────────────────────────────────────

// THE SAME NUMBER IN BOTH BOXES IS ALLOWED (the-order-id-may-be-the-tracking-number): some marketplaces use the order
// id AS the tracking number, so nothing compares the two, and the order is placed.
export const TheSameNumberInBothBoxesPlaces: Story = {
  name: "Same number twice",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);

    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);

    // The same reference in both. PASTED, as a reference usually arrives: it is one change per box rather than
    // eighteen re-renders of this whole form, which kept the story inside its timeout once the sell price joined the
    // fields it fills.
    await userEvent.click(canvas.getByTestId("order-external-ref-id"));
    await userEvent.paste("JP2026081500471183");
    await userEvent.click(canvas.getByTestId("order-receipt-code"));
    await userEvent.paste("JP2026081500471183");
    await waitFor(() => expect(canvas.getByTestId("order-receipt-code")).toHaveValue("JP2026081500471183"));

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    // If anything else asks first (a thin margin), it is a WARNING with a way through. Nothing here is an error.
    const dialog = await screen.findByTestId("order-checks-dialog").catch(() => null);
    if (dialog) {
      const place = within(dialog).getByTestId("order-checks-place");
      await waitFor(() => expect(place).toBeVisible());
      await userEvent.click(place);
    }

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// …and a WARNING is the other half of the rule: a thin margin is a decision somebody is entitled to
// make, so it is shown, and then it can be overruled. The order really is placed afterwards — the
// dialog is a question, not a second Create button.
export const AThinMarginAsksFirstAndThenPlaces: Story = {
  name: "Thin margin asks",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });

    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);

    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);

    // Sold for less than it cost — comfortably under the 35% floor.
    await userEvent.type(canvas.getByTestId("order-marketplace-total"), "1000", { delay: 10 });
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);

    const dialog = await screen.findByTestId("order-checks-dialog");
    await expect(within(dialog).getByTestId("order-check-profitBelowFloor")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByTestId("order-checks-place"));

    await waitFor(() => expect(screen.getByTestId("at-order-detail")).toBeInTheDocument());
  },
};

// THE MARKETPLACE'S ORDER DATE IS REQUIRED TO PLACE (platform-created-at-is-required-at-finalize): an order complete in
// every other way keeps Create off until it is set, and the field carries the red asterisk that says why. The buyer's
// username, left empty, holds nothing (the-buyers-username-is-optional).
export const TheMarketplaceOrderDateIsRequiredToPlace: Story = {
  name: "Order date required",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickProduct(canvasElement, products[0]!.id);
    await fillSellPrice(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    await waitFor(() => expect(canvas.getByTestId("order-line-0")).toBeInTheDocument());
    await expect(create).toBeDisabled();

    await pickOrderDate(canvasElement);
    await waitFor(() => expect(create).toBeEnabled());
    await expect(canvas.getByTestId("order-create-buyer-username")).toHaveValue("");
  },
};

// THE SELL PRICE IS REQUIRED TO PLACE (platform-total-is-required-at-finalize) — settlement opens the order's account
// on what the buyer paid, so an order complete in every other way keeps Create off until it is filled, and the field
// carries the red asterisk that says why.
export const CreateStaysOffUntilTheSellPriceIsFilled: Story = {
  name: "Sell price required",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillOrderRef(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    const sell = canvas.getByTestId("order-marketplace-total");
    await waitFor(() => expect(canvas.getByTestId("order-line-0")).toBeInTheDocument());
    await expect(create).toBeDisabled();
    // A required field, as the order date is — the label carries the red asterisk.
    await expect(sell).toBeRequired();

    await fillSellPrice(canvasElement);
    await waitFor(() => expect(create).toBeEnabled());

    // Emptied again, it holds Create again.
    await userEvent.clear(sell);
    await waitFor(() => expect(create).toBeDisabled());
  },
};

// THE MARKETPLACE REF IS REQUIRED TO PLACE (an-order-ref-is-required-by-the-rpc) — the request's validation refuses an
// empty one, so an order complete in every other way keeps Create off until it is typed, and the field carries the red
// asterisk that says why. Spaces alone are still empty.
export const TheMarketplaceRefIsRequiredToPlace: Story = {
  name: "Ref required",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("order-create-customer-name"), "Bu Ani", { delay: 40 });
    await userEvent.click(canvas.getByTestId("shop-select"));
    const shop = await canvas.findByTestId(`shop-select-option-${shops[0]!.id}`);
    await waitFor(() => expect(shop).toBeVisible());
    await userEvent.click(shop);
    await pickProduct(canvasElement, products[0]!.id);
    await pickOrderDate(canvasElement);
    await fillSellPrice(canvasElement);

    const create = canvas.getByTestId("order-create-save");
    const ref = canvas.getByTestId("order-external-ref-id");
    await waitFor(() => expect(canvas.getByTestId("order-line-0")).toBeInTheDocument());
    await expect(create).toBeDisabled();
    await expect(ref).toBeRequired();

    await fillOrderRef(canvasElement, "   ");
    await expect(create).toBeDisabled();

    await userEvent.clear(ref);
    await fillOrderRef(canvasElement);
    await waitFor(() => expect(create).toBeEnabled());
  },
};

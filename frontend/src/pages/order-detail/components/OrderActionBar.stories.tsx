import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { OrderActionBar } from "./OrderActionBar";

// #11 — the detail page's buttons for the moves that had none (rowActions.ts): a shipped order may be marked a problem,
// a problem order returned or written off. Forward actions first, destructive ones last (splitActions); three fit, so
// none folds into ⋯. The kebab's own stories (OrderRowActions) pin the confirms and the moves.
//
// every-allowed-move-has-a-button: shipped also offers Mark as Lost — four, so the two destructive ones (Return Goods,
// Mark as Lost) fold into ⋯ — and completed offers Return Goods, alone and inline.
const meta = {
  title: "Pages/Order/OrderActionBar",
  component: OrderActionBar,
  parameters: { signedIn: true },
  beforeEach: asTeam(12n),
  args: { teamId: 12n, orderId: 106n, stage: "shipped", warehouseId: 11n },
} satisfies Meta<typeof OrderActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const buttons = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByTestId("order-action-bar"))
    .getAllByRole("button")
    .map((b) => b.getAttribute("data-testid"));

export const Shipped: Story = {
  play: async ({ canvasElement }) => {
    await expect(buttons(canvasElement)).toEqual([
      "order-action-complete",
      "order-action-markProblem",
      "order-action-more",
    ]);
  },
};

/** Shipped's fourth action: Mark as Lost, in ⋯ beside Return Goods — and it confirms before it moves. */
export const ShippedOffersLost: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("order-action-more"));
    const lost = await screen.findByTestId("order-action-markLost");
    await waitFor(() => expect(lost).toBeVisible());
    await expect(screen.getByTestId("order-action-returnGoods")).toBeInTheDocument();
    await userEvent.click(lost);

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/Mark order #106 as lost\?/)).toBeInTheDocument();
    await userEvent.click(confirm);
    // A toast from an earlier story may still be on screen — at least one says so.
    await expect((await screen.findAllByText("Order moved to Lost")).length).toBeGreaterThan(0);
  },
};

/** A completed order's one action: Return Goods, inline, confirmed first. */
export const CompletedOffersReturn: Story = {
  args: { stage: "completed" },
  play: async ({ canvasElement }) => {
    await expect(buttons(canvasElement)).toEqual(["order-action-returnGoods"]);
    await userEvent.click(within(canvasElement).getByTestId("order-action-returnGoods"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/Return the goods on order #106\?/)).toBeInTheDocument();
    await userEvent.click(confirm);
    // A toast from an earlier story may still be on screen — at least one says so.
    await expect((await screen.findAllByText("Order moved to Return")).length).toBeGreaterThan(0);
  },
};

export const Problem: Story = {
  args: { stage: "problem" },
  play: async ({ canvasElement }) => {
    await expect(buttons(canvasElement)).toEqual([
      "order-action-resolveDispute",
      "order-action-returnGoods",
      "order-action-markLost",
    ]);
  },
};

// A phone: three actions are all behind ⋯ (a-phone-header-action-is-an-icon).
export const ProblemOnAPhone: Story = {
  args: { stage: "problem", compact: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("order-action-more")).toBeInTheDocument();
  },
};

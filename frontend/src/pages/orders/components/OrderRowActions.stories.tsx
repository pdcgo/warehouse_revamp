import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { OrderRowActions } from "./OrderRowActions";

// #11 — THE MOVES THE SERVER ALLOWED WITH NO BUTTON (the-action-menu-is-a-table-keyed-by-status, rowActions.ts). §Status
// Move draws `shipped → problem`, `problem → return` and `problem → lost`; the row's kebab now offers each, to the end
// that may make it, every item with its icon, and the two destructive ones through a ConfirmDialog.
//
//   | story                                   | the rule it pins                                                       |
//   | --------------------------------------- | ---------------------------------------------------------------------- |
//   | AShippedOrderCanBeMarkedAProblem        | shipped: Return Goods · Complete · Mark as Problem · Mark as Lost       |
//   | AProblemOrderReturnsOrIsLost            | problem: Resolve Dispute · Return Goods · Mark as Lost                  |
//   | MarkAsLostFromAProblemConfirms          | Lost is destructive: confirm first, then the move                      |
//   | ReturnGoodsFromAProblemConfirms         | Return is destructive: confirm first, then the move                    |
//   | TheWarehouseEndIsOfferedOnlyTheReturn   | the warehouse reading a problem order may force the return, nothing else |
//   | ShippedOffersLost                       | shipped → Mark as Lost, confirmed (every-allowed-move-has-a-button)     |
//   | CompletedOffersReturn                   | completed → Return Goods, confirmed (every-allowed-move-has-a-button)   |
//
// Order 106 is Toko Melati's (12), shipped from Gudang Pusat (11); the stub's OrderStatusChange moves it whatever the
// stage asked, so each story names the stage the kebab is keyed on.
const meta = {
  title: "Pages/Order/OrderRowActions",
  component: OrderRowActions,
  parameters: { signedIn: true },
  beforeEach: asTeam(12n),
  args: { teamId: 12n, orderId: 106n, stage: "shipped", warehouseId: 11n },
} satisfies Meta<typeof OrderRowActions>;

export default meta;
type Story = StoryObj<typeof meta>;

async function openKebab(canvasElement: HTMLElement) {
  await userEvent.click(within(canvasElement).getByTestId("order-actions-106"));
  const detail = await screen.findByTestId("order-detail-106");
  await waitFor(() => expect(detail).toBeVisible());
}

/** The items the kebab holds, in order, after "open the order". */
function items() {
  return screen
    .getAllByRole("menuitem")
    .map((el) => el.getAttribute("data-testid"))
    .filter((id) => id !== "order-detail-106");
}

export const AShippedOrderCanBeMarkedAProblem: Story = {
  play: async ({ canvasElement }) => {
    await openKebab(canvasElement);

    await expect(items()).toEqual([
      "order-returnGoods-106",
      "order-complete-106",
      "order-markProblem-106",
      "order-markLost-106",
    ]);
    const problem = screen.getByTestId("order-markProblem-106");
    await expect(problem).toHaveTextContent("Mark as Problem");
    // Every menu item carries its icon.
    await expect(problem.querySelector("svg")).not.toBeNull();

    // A waystation, not an end: it moves at once, no confirm.
    await userEvent.click(problem);
    await expect(screen.queryByTestId("confirm-action")).toBeNull();
    await expect(await screen.findByText("Order moved to Problem")).toBeInTheDocument();
  },
};

export const AProblemOrderReturnsOrIsLost: Story = {
  args: { stage: "problem" },
  play: async ({ canvasElement }) => {
    await openKebab(canvasElement);

    await expect(items()).toEqual(["order-resolveDispute-106", "order-returnGoods-106", "order-markLost-106"]);
    for (const id of ["order-resolveDispute-106", "order-returnGoods-106", "order-markLost-106"]) {
      await expect(screen.getByTestId(id).querySelector("svg")).not.toBeNull();
    }
  },
};

export const MarkAsLostFromAProblemConfirms: Story = {
  args: { stage: "problem" },
  play: async ({ canvasElement }) => {
    await openKebab(canvasElement);
    await userEvent.click(screen.getByTestId("order-markLost-106"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/Mark order #106 as lost\?/)).toBeInTheDocument();
    await userEvent.click(confirm);

    // A toast from an earlier story may still be on screen — at least one says so.
    await expect((await screen.findAllByText("Order moved to Lost")).length).toBeGreaterThan(0);
  },
};

export const ReturnGoodsFromAProblemConfirms: Story = {
  args: { stage: "problem" },
  play: async ({ canvasElement }) => {
    await openKebab(canvasElement);
    await userEvent.click(screen.getByTestId("order-returnGoods-106"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    // A toast from an earlier story may still be on screen — at least one says so.
    await expect((await screen.findAllByText("Order moved to Return")).length).toBeGreaterThan(0);
  },
};

// a-forced-return-follows-the-status-move: the warehouse may force `problem → return`; the dispute and the write-off are
// customer service's, so they are absent — not greyed.
export const TheWarehouseEndIsOfferedOnlyTheReturn: Story = {
  args: { teamId: 11n, stage: "problem" },
  beforeEach: asTeam(11n),
  play: async ({ canvasElement }) => {
    await openKebab(canvasElement);

    await expect(items()).toEqual(["order-returnGoods-106"]);
  },
};

// every-allowed-move-has-a-button: the courier lost a shipped parcel before delivery — written off directly, without passing
// through `problem`. Destructive, so it confirms first.
export const ShippedOffersLost: Story = {
  play: async ({ canvasElement }) => {
    await openKebab(canvasElement);
    const lost = screen.getByTestId("order-markLost-106");
    await expect(lost).toHaveTextContent("Mark as Lost");
    await expect(lost.querySelector("svg")).not.toBeNull();
    await userEvent.click(lost);

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/Mark order #106 as lost\?/)).toBeInTheDocument();
    await userEvent.click(confirm);

    // A toast from an earlier story may still be on screen — at least one says so.
    await expect((await screen.findAllByText("Order moved to Lost")).length).toBeGreaterThan(0);
  },
};

// every-allowed-move-has-a-button: the buyer sends a delivered order back. Its only action, and it confirms first.
export const CompletedOffersReturn: Story = {
  args: { stage: "completed" },
  play: async ({ canvasElement }) => {
    await openKebab(canvasElement);
    await expect(items()).toEqual(["order-returnGoods-106"]);
    await userEvent.click(screen.getByTestId("order-returnGoods-106"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText(/Return the goods on order #106\?/)).toBeInTheDocument();
    await userEvent.click(confirm);

    // A toast from an earlier story may still be on screen — at least one says so.
    await expect((await screen.findAllByText("Order moved to Return")).length).toBeGreaterThan(0);
  },
};

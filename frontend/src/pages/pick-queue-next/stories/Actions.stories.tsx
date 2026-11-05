import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { orderExportScenario } from "../../../../.storybook/sessionScenario";

import { OrderExportView } from "../../../gen/warehouse/selling/v1/order_pb";
import { NEW_HERE, PICK_QUEUE_META, PROCESSED_HERE, rowOf } from "./kit";

// THE WAREHOUSE'S ORDER LIST — the row's ⋯ moves, and the bulk bar.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Warehouse/PickQueueNextPage/Actions",
  // HIDDEN from the sidebar, as the page is (../index.stories.tsx) — `tags` is read statically, so every file writes it.
  tags: ["!dev"],
  ...PICK_QUEUE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The menu offers the warehouse's moves — from Dikonfirmasi, forward to picked AND back to the queue. */
export const TheMenuOffersOnlyAllowedMoves: Story = {
  name: "Menu moves",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await rowOf(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PROCESSED_HERE.id}`));

    const id = PROCESSED_HERE.id;
    for (const to of ["picked", "toConfirm"]) {
      await waitFor(() => expect(screen.getByTestId(`pick-queue-move-${id}-${to}`)).toBeVisible());
    }
    // No skip: a processed order is picked before it can be handed over.
    await expect(screen.queryByTestId(`pick-queue-move-${id}-handover`)).toBeNull();
  },
};

/** Going back to the queue is a warning with a reason — the button waits until one is written. */
export const GoingBackAsksForAReason: Story = {
  name: "Back asks a reason",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await rowOf(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PROCESSED_HERE.id}`));

    const back = await screen.findByTestId(`pick-queue-move-${PROCESSED_HERE.id}-toConfirm`);
    await waitFor(() => expect(back).toBeVisible());
    await userEvent.click(back);

    const confirm = await screen.findByTestId("step-back-confirm");
    await expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByTestId("step-back-reason"), "Not on the shelf", { delay: 20 });
    await expect(confirm).toBeEnabled();
  },
};

/** A move runs for real, through OrderStatusChange: Perlu konfirmasi → Dikonfirmasi. */
export const AForwardStepRunsForReal: Story = {
  name: "Forward step",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const order = NEW_HERE[0]!;
    await rowOf(canvasElement, order.id);

    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${order.id}`));
    const item = await screen.findByTestId(`pick-queue-move-${order.id}-confirm`);
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);

    await expect(await screen.findByText(/Moved to Confirmed/)).toBeInTheDocument();
  },
};

/**
 * THE ACTIONS ARE ON SCREEN FROM THE START (owner). With nothing ticked the bar says to tick, the actions
 * that need a selection are off, and Export is on (the whole filtered list); a tick turns them on.
 */
export const TheActionsAreThereFromTheStart: Story = {
  name: "Bulk bar from the start",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const order = NEW_HERE[0]!;
    await rowOf(canvasElement, order.id);

    await expect(canvas.getByTestId("pick-queue-bulk-hint")).toBeInTheDocument();
    await expect(canvas.getByTestId("pick-queue-bulk-move")).toBeDisabled();
    await expect(canvas.getByTestId("pick-queue-bulk-print")).toBeDisabled();
    await expect(canvas.getByTestId("pick-queue-bulk-handover")).toBeDisabled();
    await expect(canvas.getByTestId("pick-queue-bulk-export")).toBeEnabled();

    await userEvent.click(within(canvas.getByTestId(`pick-queue-select-${order.id}`)).getByRole("checkbox", { hidden: true }));
    await waitFor(() => expect(canvas.getByTestId("pick-queue-bulk-count")).toHaveTextContent("1 selected"));
    await expect(canvas.getByTestId("pick-queue-bulk-print")).toBeEnabled();
    await expect(canvas.getByTestId("pick-queue-bulk-handover")).toBeEnabled();

    await userEvent.click(canvas.getByTestId("pick-queue-bulk-clear"));
    await waitFor(() => expect(canvas.getByTestId("pick-queue-bulk-hint")).toBeInTheDocument());
  },
};

/**
 * THE BAR EXPORTS THE SELECTION WHEN THERE IS ONE (the-bulk-actions-are-always-on-screen) — in the warehouse's
 * columns, only the ticked order.
 */
export const ExportTakesTheTickedRows: Story = {
  name: "Export the ticked",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const order = NEW_HERE[0]!;

    await rowOf(canvasElement, order.id);
    await userEvent.click(within(canvas.getByTestId(`pick-queue-select-${order.id}`)).getByRole("checkbox", { hidden: true }));
    await userEvent.click(canvas.getByTestId("pick-queue-bulk-export"));

    await expect(await screen.findByText("Export ready — the file is downloading")).toBeInTheDocument();

    const asked = orderExportScenario.last!;
    await expect(asked.view).toBe(OrderExportView.WAREHOUSE);
    await expect(asked.orderIds).toEqual([order.id]);
  },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { orderDetailFor } from "../../../../.storybook/fixtures";

import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { HERE, NEW_HERE, PICK_QUEUE_META, PROCESSED_HERE, rowOf } from "./kit";

// THE WAREHOUSE'S ORDER LIST — the handover, find-parcel and validation scans.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Warehouse/PickQueueNextPage/Scans",
  // HIDDEN from the sidebar, as the page is (../index.stories.tsx) — `tags` is read statically, so every file writes it.
  tags: ["!dev"],
  ...PICK_QUEUE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const PICKED_HERE = HERE.find((o) => o.status === OrderStatus.PICKED)!;
const resiOf = (o: { receiptCode: string }) => o.receiptCode;

/**
 * THE HANDOVER SCAN, MASS MODE — a picked parcel is ready, the same label again does not double, a parcel
 * at another step is an error, and the button hands over what is ready (off while nothing is).
 */
export const HandoverScanCollectsAndChecks: Story = {
  name: "Handover · mass",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("warehouse-orders-handover"));
    const dialog = await screen.findByTestId("handover-dialog");
    await userEvent.click(within(dialog).getByText("Mass pickup"));

    const submit = await within(dialog).findByTestId("handover-submit");
    await expect(submit).toBeDisabled();

    const scan = within(dialog).getByTestId("handover-scan");
    await userEvent.type(scan, `${resiOf(PICKED_HERE)}{Enter}`, { delay: 10 });
    await waitFor(() =>
      expect(within(dialog).getByTestId(`handover-entry-${resiOf(PICKED_HERE)}`)).toHaveAttribute("data-state", "ready"),
    );

    // The same label again — still one row.
    await userEvent.type(scan, `${resiOf(PICKED_HERE)}{Enter}`, { delay: 10 });
    await expect(within(dialog).getAllByTestId(`handover-entry-${resiOf(PICKED_HERE)}`)).toHaveLength(1);

    // A parcel still being picked (processed) — an error.
    await userEvent.type(scan, `${resiOf(PROCESSED_HERE)}{Enter}`, { delay: 10 });
    await waitFor(() =>
      expect(within(dialog).getByTestId(`handover-entry-${resiOf(PROCESSED_HERE)}`)).toHaveAttribute("data-state", "wrongStep"),
    );

    await expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() =>
      expect(within(dialog).getByTestId(`handover-entry-${resiOf(PICKED_HERE)}`)).toHaveAttribute("data-state", "handedOver"),
    );
  },
};

/** Mass off: a good scan is handed over at once, one by one. */
export const HandoverOneByOne: Story = {
  name: "Handover · one by one",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("warehouse-orders-handover"));
    const dialog = await screen.findByTestId("handover-dialog");

    await userEvent.type(within(dialog).getByTestId("handover-scan"), `${resiOf(PICKED_HERE)}{Enter}`, { delay: 10 });
    await waitFor(() =>
      expect(within(dialog).getByTestId(`handover-entry-${resiOf(PICKED_HERE)}`)).toHaveAttribute("data-state", "handedOver"),
    );
    await expect(within(dialog).queryByTestId("handover-submit")).toBeNull();
  },
};

/** Finding a parcel in a sack: a wrong label is not it, the right one sounds a match — no server asked. */
export const FindParcelSoundsAMatch: Story = {
  name: "Find parcel",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-picked"));
    await rowOf(canvasElement, PICKED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PICKED_HERE.id}`));

    const item = await screen.findByTestId(`pick-queue-find-${PICKED_HERE.id}`);
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);

    const dialog = await screen.findByTestId("find-parcel-dialog");
    const scan = within(dialog).getByTestId("find-parcel-scan");

    await userEvent.type(scan, "NOT-THIS-ONE{Enter}", { delay: 10 });
    await waitFor(() => expect(within(dialog).getByTestId("find-parcel-result")).toHaveAttribute("data-match", "false"));

    await userEvent.type(scan, `${resiOf(PICKED_HERE)}{Enter}`, { delay: 10 });
    await waitFor(() => expect(within(dialog).getByTestId("find-parcel-result")).toHaveAttribute("data-match", "true"));
  },
};

/** The validation scan: an unknown item and one too many are errors; every line exact unlocks the step. */
export const ValidationNeedsEveryLineExact: Story = {
  name: "Validation, exact lines",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await rowOf(canvasElement, NEW_HERE[0]!.id);

    await userEvent.click(canvas.getByTestId("pick-tab-confirm"));
    await rowOf(canvasElement, PROCESSED_HERE.id);
    await userEvent.click(canvas.getByTestId(`pick-queue-actions-${PROCESSED_HERE.id}`));

    const item = await screen.findByTestId(`pick-queue-validate-${PROCESSED_HERE.id}`);
    await waitFor(() => expect(item).toBeVisible());
    await userEvent.click(item);

    const dialog = await screen.findByTestId("validate-dialog");
    const lines = orderDetailFor(PROCESSED_HERE.id)!.items;
    await waitFor(() => expect(within(dialog).getByTestId("validate-lines")).toBeInTheDocument());

    const scan = within(dialog).getByTestId("validate-scan");
    await userEvent.type(scan, "NO-SUCH-SKU{Enter}", { delay: 10 });
    await expect(within(dialog).getByTestId("validate-problem")).toHaveTextContent("NO-SUCH-SKU");

    const next = within(dialog).getByTestId("validate-next");
    await expect(next).toBeDisabled();

    for (const line of lines) {
      for (let n = 0; n < line.quantity; n += 1) {
        await userEvent.type(scan, `${line.sku}{Enter}`, { delay: 10 });
      }
    }
    await waitFor(() => expect(within(dialog).getByTestId("validate-complete")).toBeInTheDocument());
    await expect(next).toBeEnabled();

    // One more of the first line is too many.
    await userEvent.type(scan, `${lines[0]!.sku}{Enter}`, { delay: 10 });
    await expect(within(dialog).getByTestId("validate-problem")).toBeInTheDocument();
  },
};

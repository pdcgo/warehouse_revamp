import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { At504, WAREHOUSE_DETAIL_META, actionsIn, loaded, trailRows } from "./kit";

// RESTOCK WAREHOUSE DETAIL — Sign for Box — its dialog, and the move to arrived, from ongoing and from lost.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/SignForBox",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectStatus(canvas: ReturnType<typeof within>, status: RestockRequestStatus) {
  await waitFor(() =>
    expect(within(canvas.getByTestId("restock-detail-status")).getByTestId(`restock-status-${status}`)).toBeVisible(),
  );
}

// Signing for the box confirms, moves 501 to arrived, and lands in the trail — after which only Accept is left.
export const SignForBoxMovesItToArrived: Story = {
  name: "Moves it to arrived",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(1));

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await expectStatus(canvas, RestockRequestStatus.ARRIVED);
    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-accept-501", "restock-action-labels-501"]));
    await waitFor(() => expect(trailRows(canvasElement)).toHaveLength(2));
    await expect(trailRows(canvasElement)[1]).toHaveTextContent("Signed for the box");
    await expect(canvas.getByTestId("restock-detail-arrived-at")).not.toHaveTextContent("—");
  },
};

// THE COURIER'S CHARGE IN THE SIGN DIALOG IS NOT KEPT YET (the-cod-can-be-noted-when-the-box-arrives) — the page says so
// at the top, and the dialog's charge carries the mark.
export const TheSignDialogMarksItsCourierCharge: Story = {
  name: "Courier charge, marked",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const charge = await screen.findByTestId("sign-courier");
    await waitFor(() => expect(charge).toBeVisible());
    await expect(within(charge).getByTestId("not-implemented-arrivalCod")).toHaveTextContent("1");
  },
};

// a-late-lost-box-is-signed-for-as-arrived — the lost parcel turned up: signed for, lost → arrived, then accepted as usual.
export const ALateLostBoxIsSignedForAsArrived: Story = {
  name: "A late lost box",
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-504"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await expectStatus(canvas, RestockRequestStatus.ARRIVED);
    await waitFor(() => expect(actionsIn(canvasElement)).toEqual(["restock-action-accept-504", "restock-action-labels-504"]));
    const move = await canvas.findByTestId("restock-timeline-3-move");
    await expect(within(move).getByTestId(`restock-status-${RestockRequestStatus.LOST}`)).toBeVisible();
    await expect(within(move).getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toBeVisible();
  },
};

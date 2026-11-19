import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { toaster } from "../../../components/feedback/Toaster";
import { storedRestockForStory } from "../../../features/restock/storyRestock";
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

/** Ada, then the amount and its note, in the open sign dialog. */
async function noteTheCharge(amount: string, note: string) {
  await userEvent.click(await screen.findByTestId("sign-courier-asked-yes"));
  await userEvent.type(await screen.findByTestId("sign-courier-charge"), amount, { delay: 20 });
  await userEvent.type(screen.getByTestId("sign-courier-note"), note, { delay: 20 });
}

// THE CHARGE NOTED AT THE DOOR IS KEPT AND SHOWN (the-courier-charge-is-noted-at-tiba-and-final-at-terima) — before the
// sign, Kiriman's Ongkir COD reads "—"; signed with a charge, it reads the charge and its note, said as NOTED — final at
// Terima, owed back from then. The dialog carries no mark, and no toast says to enter it again.
export const TheChargeNotedAtTheDoorIsShown: Story = {
  name: "Courier charge, kept and shown",
  // The toaster is module-level: a story reading its own toasts clears the last story's first.
  beforeEach: () => {
    toaster.remove();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("restock-detail-courier-charge")).toBeNull();

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const charge = await screen.findByTestId("sign-courier");
    await waitFor(() => expect(charge).toBeVisible());
    await expect(within(charge).queryByTestId(/^not-implemented-/)).toBeNull();
    await noteTheCharge("15000", "Biaya COD");
    const confirm = screen.getByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await expectStatus(canvas, RestockRequestStatus.ARRIVED);
    await expect(await screen.findByText("Restock marked as arrived")).toBeInTheDocument();
    await expect(screen.queryByText(/enter it again at Accept/)).toBeNull();

    const delivery = canvas.getByTestId("restock-detail-info");
    await waitFor(() => expect(within(delivery).getByTestId("restock-detail-courier-charge")).toHaveTextContent("Rp 15.000"));
    await expect(within(delivery).getByTestId("restock-detail-courier-charge-note")).toHaveTextContent("Biaya COD");
    await expect(within(delivery).getByTestId("restock-detail-courier-charge-owed")).toHaveTextContent(
      "Noted by this warehouse when the box was signed for — final when it is accepted",
    );
  },
};

// A LATE LOST BOX TAKES THE CHARGE THE SAME WAY (a-late-lost-box-is-signed-for-as-arrived,
// the-courier-charge-is-noted-at-tiba-and-final-at-terima) — 504, given up, signed for with the courier's charge: kept on
// the restock and shown in Kiriman, as for a box on its way.
export const ALateLostBoxTakesTheCharge: Story = {
  name: "A late lost box · its charge",
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-504"));
    await noteTheCharge("12500", "Biaya COD");
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await expectStatus(canvas, RestockRequestStatus.ARRIVED);
    const delivery = canvas.getByTestId("restock-detail-info");
    await waitFor(() => expect(within(delivery).getByTestId("restock-detail-courier-charge")).toHaveTextContent("Rp 12.500"));
    await expect((await storedRestockForStory(504n)).warehouseAdditionalCostNote).toBe("Biaya COD");
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

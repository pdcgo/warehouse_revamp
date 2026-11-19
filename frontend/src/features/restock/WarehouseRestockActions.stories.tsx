import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { holdUploads } from "../../../.storybook/uploadScenario";
import { toaster } from "../../components/feedback/Toaster";
import { storedRestockForStory, storyRestock } from "./storyRestock";
import { WarehouseRestockActions } from "./WarehouseRestockActions";

// WHAT THE WAREHOUSE MAY DO, by status: ongoing → Sign for Box, Accept; arrived → Accept; lost → Sign for Box (a late
// box — a-late-lost-box-is-signed-for-as-arrived); accepted → its labels and receipt.
const meta = {
  title: "Features/Restock/WarehouseRestockActions",
  component: WarehouseRestockActions,
  parameters: { signedIn: true },
  args: { teamId: 11n, variant: "buttons", request: storyRestock(501n) },
  // The toaster is module-level, so the last story's toasts are still up — and a story reading its own would find two.
  beforeEach: () => {
    toaster.remove();
  },
} satisfies Meta<typeof WarehouseRestockActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ongoing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("restock-action-sign-501")).toBeInTheDocument();
    await expect(canvas.getByTestId("restock-action-accept-501")).toBeInTheDocument();
  },
};

export const Arrived: Story = {
  args: { request: storyRestock(502n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("restock-action-accept-502")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-action-sign-502")).toBeNull();
  },
};

export const LostCanBeSignedFor: Story = {
  args: { request: storyRestock(504n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("restock-action-sign-504")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-action-accept-504")).toBeNull();
  },
};

export const AsARow: Story = { args: { variant: "row" } };

// TANDAI TIBA ONLY MARKS (tiba-marks-and-terima-is-final): the dialog says stock waits for Terima, and its toast never
// says "received". THE COURIER'S CHARGE CAN BE NOTED IN IT (the-cod-can-be-noted-when-the-box-arrives) — optional, with a
// note once there is an amount, as at Terima — and KEPT (the-courier-charge-is-noted-at-tiba-and-final-at-terima): the
// sign sends it, the restock holds it, and no mark or toast says to enter it again at Terima.
export const SignForBoxNotesTheCourierCharge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());

    await expect(screen.getByText(/stock does not go up until you accept it/)).toBeVisible();
    await expect(within(screen.getByTestId("sign-courier")).queryByTestId(/^not-implemented-/)).toBeNull();
    // ASKED FIRST (the-charge-is-asked-for-before-it-is-filled) — unticked, nothing to fill, and the sign goes ahead.
    await expect(screen.queryByTestId("sign-courier-charge")).toBeNull();
    await expect(confirm).toBeEnabled();

    // Ticked, the amount and the note are required — the sign waits for them; the slip's photo is optional.
    await userEvent.click(screen.getByTestId("sign-courier-asked-yes"));
    await expect(await screen.findByTestId("sign-courier-photo-pick")).toBeVisible();
    await expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByTestId("sign-courier-charge"), "15000", { delay: 20 });
    await expect(await screen.findByTestId("sign-courier-note-error")).toBeVisible();
    await expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByTestId("sign-courier-note"), "COD handling fee", { delay: 20 });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await expect(await screen.findByText("Restock marked as arrived")).toBeInTheDocument();
    await expect(screen.queryByText(/enter it again at Accept/)).toBeNull();

    // KEPT on the restock — what both its pages show and Terima opens with; no slip was picked, so none.
    const stored = await storedRestockForStory(501n);
    await expect(stored.warehouseAdditionalCost).toBe(15000);
    await expect(stored.warehouseAdditionalCostNote).toBe("COD handling fee");
    await expect(stored.warehouseAdditionalCostFile).toBe("");
  },
};

// THE SLIP IS KEPT WITH THE CHARGE, as at Terima (the-courier-slip-has-an-optional-photo): picked, it goes up at once under
// this warehouse; the sign waits while it is on its way, then sends it with the charge, and the restock keeps it beside it.
export const SignForBoxKeepsTheSlip: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(screen.getByTestId("sign-courier-asked-yes"));
    await userEvent.type(await screen.findByTestId("sign-courier-charge"), "15000", { delay: 20 });
    await userEvent.type(screen.getByTestId("sign-courier-note"), "COD handling fee", { delay: 20 });
    await waitFor(() => expect(confirm).toBeEnabled());

    // On its way: the photo shows, the sign waits.
    const release = holdUploads();
    await userEvent.upload(
      screen.getByTestId("sign-courier-photo-input"),
      new File([new Uint8Array([137, 80, 78, 71])], "nota.png", { type: "image/png" }),
    );
    await waitFor(() => expect(screen.getByTestId("sign-courier-photo-shown")).toHaveAttribute("data-state", "uploading"));
    await expect(confirm).toBeDisabled();

    // Landed: kept, and the sign is free.
    release();
    await waitFor(() => expect(screen.getByTestId("sign-courier-photo-shown")).toHaveAttribute("data-state", "kept"));
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    await expect(await screen.findByText("Restock marked as arrived")).toBeInTheDocument();

    const stored = await storedRestockForStory(501n);
    await expect(stored.warehouseAdditionalCost).toBe(15000);
    await expect(stored.warehouseAdditionalCostFile).toMatch(/^stub-upload-/);
  },
};

// …and a sign with no charge says only that it is marked.
export const SignForBoxWithoutACharge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);

    await expect(await screen.findByText("Restock marked as arrived")).toBeInTheDocument();
    await expect(screen.queryByText(/enter it again at Accept/)).toBeNull();
    await expect((await storedRestockForStory(501n)).warehouseAdditionalCost).toBe(0);
  },
};

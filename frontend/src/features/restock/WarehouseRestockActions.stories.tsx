import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { toaster } from "../../components/feedback/Toaster";
import { storyRestock } from "./storyRestock";
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
// note once there is an amount, as at Terima. Not kept yet: the page's mark sits by the title, and a second toast says to
// enter it again at Terima.
export const SignForBoxNotesTheCourierCharge: Story = {
  args: { codMark: <span data-testid="story-cod-mark">mark</span> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("restock-action-sign-501"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());

    await expect(screen.getByText(/stock does not go up until you accept it/)).toBeVisible();
    await expect(within(screen.getByTestId("sign-courier")).getByTestId("story-cod-mark")).toBeVisible();
    // The slip's photo sits under it, optional (the-courier-slip-has-an-optional-photo).
    await expect(screen.getByTestId("sign-courier-photo-pick")).toBeVisible();
    // Optional — nothing typed, the sign goes ahead.
    await expect(confirm).toBeEnabled();

    await userEvent.type(screen.getByTestId("sign-courier-charge"), "15000", { delay: 20 });
    await expect(await screen.findByTestId("sign-courier-note-error")).toBeVisible();
    await expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByTestId("sign-courier-note"), "COD handling fee", { delay: 20 });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await expect(await screen.findByText("Restock marked as arrived")).toBeInTheDocument();
    await expect(
      await screen.findByText("What was entered for the courier's charge was not kept — enter it again at Accept."),
    ).toBeInTheDocument();
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
    await expect(screen.queryByText("What was entered for the courier's charge was not kept — enter it again at Accept.")).toBeNull();
  },
};

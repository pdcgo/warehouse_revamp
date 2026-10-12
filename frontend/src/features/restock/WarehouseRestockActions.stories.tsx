import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { STORY_PENDING, storyRestock } from "./storyRestock";
import { WarehouseRestockActions } from "./WarehouseRestockActions";

// WHAT THE WAREHOUSE MAY DO, by status: ongoing → Sign for Box, Accept; arrived → Accept; lost → Sign for Box (a late
// box — a-late-lost-box-is-signed-for-as-arrived); accepted → its labels and receipt.
const meta = {
  title: "Features/Restock/WarehouseRestockActions",
  component: WarehouseRestockActions,
  parameters: { signedIn: true },
  args: { teamId: 11n, variant: "buttons", pending: STORY_PENDING, request: storyRestock(501n) },
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

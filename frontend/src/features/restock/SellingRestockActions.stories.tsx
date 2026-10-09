import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SellingRestockActions } from "./SellingRestockActions";
import { STORY_PENDING, storyRestock } from "./storyRestock";

// WHAT THE SELLING TEAM MAY DO, by status (the-warehouse-signs-and-accepts-the-team-does-the-rest): ongoing → Edit,
// Cancel, Mark Lost; arrived → Edit Lines; anything else → nothing, never a disabled button the server would refuse.
const meta = {
  title: "Features/Restock/SellingRestockActions",
  component: SellingRestockActions,
  parameters: { signedIn: true },
  args: { teamId: 12n, variant: "buttons", pending: STORY_PENDING, request: storyRestock(501n) },
} satisfies Meta<typeof SellingRestockActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ongoing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("restock-action-edit-501")).toBeInTheDocument();
    await expect(canvas.getByTestId("restock-action-cancel-501")).toBeInTheDocument();
    await expect(canvas.getByTestId("restock-action-mark-lost-501")).toBeInTheDocument();
  },
};

export const Arrived: Story = {
  args: { request: storyRestock(502n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("restock-action-edit-lines-502")).toBeInTheDocument();
    await expect(canvas.queryByTestId("restock-action-cancel-502")).toBeNull();
    await expect(canvas.queryByTestId("restock-action-mark-lost-502")).toBeNull();
  },
};

export const AcceptedHasNone: Story = {
  args: { request: storyRestock(503n) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId(/restock-action-/)).toBeNull();
  },
};

export const AsAMenu: Story = { args: { variant: "menu" } };

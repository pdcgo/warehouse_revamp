import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ORDERS } from "../../fixtures";
import { OrderCustomListPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Orders/OrderCustomList",
  component: OrderCustomListPage,
  parameters: { docs: { description: { component: description } } },
  args: { orders: ORDERS },
} satisfies Meta<typeof OrderCustomListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ THE COLUMNS ARE DIFFERENT, not merely filtered. A custom order has no shop and no marketplace,
// so those columns are replaced rather than left permanently empty.
export const ColumnsSuitAHandRaisedOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Raised by")).toBeVisible();
    await expect(canvas.getByText("Source")).toBeVisible();
    // The queue's shop/marketplace columns are absent, not blank.
    await expect(canvas.queryByText("Shop")).toBeNull();
  },
};

export const FilteringByStatus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("choice-tab-cancelled"));

    await waitFor(async () => {
      await expect(canvas.getByText("ORD-4475")).toBeVisible();
    });
    await expect(canvas.queryByText("ORD-4471")).toBeNull();
  },
};

export const Empty: Story = {
  args: { orders: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No custom orders");
  },
};

export const Loading: Story = { args: { orders: [], loading: true } };

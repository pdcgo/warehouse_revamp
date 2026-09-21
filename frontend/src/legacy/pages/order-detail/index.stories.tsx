import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ORDERS, ORDER_LINES, ORDER_TIMELINE } from "../../fixtures";
import { OrderDetailPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Orders/OrderDetail",
  component: OrderDetailPage,
  parameters: { docs: { description: { component: description } } },
  args: { order: ORDERS[0], lines: ORDER_LINES, timeline: ORDER_TIMELINE },
} satisfies Meta<typeof OrderDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-detail-page")).toHaveTextContent("ORD-4471");
    await expect(canvas.getByTestId("order-timeline")).toBeVisible();
  },
};

// It is a DESTINATION — people arrive from a chat message or a courier complaint — so it carries a
// breadcrumb back to the queue rather than assuming you came from there.
export const IsAddressableAndHasAWayBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("crumb-0").closest("a")).toHaveAttribute("href", "/orders");
  },
};

// A receipt that has not been issued says so. A blank in a shipping field reads as a rendering
// failure, where "not yet issued" is a real state somebody may need to act on.
export const NoReceiptYet: Story = {
  args: { order: ORDERS[2] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("not yet issued")).toBeVisible();
  },
};

// A returned order still shows its whole history — the timeline is exactly what the return has to be
// argued from.
export const Returned: Story = { args: { order: ORDERS[3] } };

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ORDERS } from "../../fixtures";
import { OrderListPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Orders/OrderList",
  component: OrderListPage,
  parameters: { docs: { description: { component: description } } },
  args: { orders: ORDERS },
} satisfies Meta<typeof OrderListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-list-page")).toBeVisible();
    await expect(canvas.getByText("ORD-4471")).toBeVisible();
  },
};

// DECISION 1: status is a TAB STRIP. It is the one filter always applied and always being changed —
// you work the New pile, then the Packing pile — so the current pile is readable without opening
// anything.
export const StatusTabsWorkThePiles: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("choice-tab-packing"));

    await waitFor(async () => {
      await expect(canvas.getByText("ORD-4471")).toBeVisible();
    });
    // Only that pile survives.
    await expect(canvas.queryByText("ORD-4472")).toBeNull();
  },
};

// DECISION 2: the counts are computed from the FULL set, not the filtered one. "How many are left to
// pack" must not change because somebody typed in the search box.
export const CountsIgnoreTheFilters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const before = canvas.getByTestId("summary").textContent;

    await userEvent.click(canvas.getByTestId("choice-tab-delivered"));
    await waitFor(async () => {
      await expect(canvas.queryByText("ORD-4471")).toBeNull();
    });

    await expect(canvas.getByTestId("summary").textContent).toBe(before);
  },
};

// DECISION 3: seven row actions, so ActionCell collapses them behind one kebab — inline they would
// out-weigh the rows they act on.
export const ActionsCollapseIntoAMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("action-cell")[0]).toHaveAttribute("data-mode", "menu");
  },
};

// A missing receipt is stated as missing rather than left blank — a blank cell in a shipping column
// reads as a rendering failure, where "no receipt" is a real and actionable state.
export const MissingReceiptSaysSo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByText("no receipt").length).toBeGreaterThan(0);
  },
};

// A standing condition about the queue is an ALERT, not a toast — it is still true after dismissal.
export const WithNotice: Story = {
  args: { notice: "3 orders failed to import from Shopee this morning." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("order-notice")).toBeVisible();
  },
};

export const Loading: Story = { args: { orders: [], loading: true } };

export const Empty: Story = {
  args: { orders: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No orders in this pile");
  },
};

export const LoadFailed: Story = { args: { orders: [], isError: true } };

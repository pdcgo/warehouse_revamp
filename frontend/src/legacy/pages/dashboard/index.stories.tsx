import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ORDERS } from "../../fixtures";
import { DashboardPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Dashboard/Dashboard",
  component: DashboardPage,
  parameters: { docs: { description: { component: description } } },
  args: {
    waitingOrders: 42,
    lowStock: 7,
    unpaid: 44_000_000n,
    creditLimit: 50_000_000n,
    revenue: 142_000_000n,
    recent: ORDERS,
  },
} satisfies Meta<typeof DashboardPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("dashboard-page")).toBeVisible();
    await expect(canvas.getAllByTestId("statistic")).toHaveLength(4);
  },
};

// DECISION 1: the warnings come FIRST, above the numbers. A credit limit at 88% is the reason to be
// on this screen — putting tiles first means scrolling past good news to find the bad.
export const WarningsComeFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const warnings = canvas.getByTestId("dashboard-warnings");
    const tiles = canvas.getAllByTestId("statistic")[0];

    await expect(warnings).toBeVisible();
    // The warnings block precedes the first tile in document order.
    await expect(warnings.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

// A healthy account shows NO warnings at all — an always-present banner that says "everything is
// fine" trains people to stop reading the place warnings appear.
export const NothingWrongShowsNoWarnings: Story = {
  args: { lowStock: 0, unpaid: 4_000_000n, creditLimit: 50_000_000n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("alert")).toBeNull();
  },
};

// DECISION 3: the recent list is short and LINKS OUT — it shows that things are moving, it is not
// the place to work from.
export const RecentListLinksToTheQueue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("dashboard-all-orders")).toHaveAttribute("href", "/orders");
    // Five rows at most, however many were passed.
    await expect(canvas.getAllByText(/^ORD-/).length).toBeLessThanOrEqual(5);
  },
};

export const Loading: Story = { args: { loading: true, recent: [] } };

// No credit limit configured means the meter is absent rather than showing an empty bar.
export const NoCreditLimit: Story = {
  args: { creditLimit: 0n, unpaid: 0n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("limit-progress")).toBeNull();
  },
};

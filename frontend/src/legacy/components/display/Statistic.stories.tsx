import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { Boxes, Receipt, Wallet } from "lucide-react";
import { expect, within } from "storybook/test";

import { Statistic, description } from "./Statistic";

const meta = {
  title: "Legacy/Components/Display/Statistic",
  component: Statistic,
  parameters: { docs: { description: { component: description } } },
  args: { title: "Stock on hand", children: "12.480", icon: Boxes },
} satisfies Meta<typeof Statistic>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("statistic")).toHaveTextContent("12.480");
  },
};

// Refreshing keeps the previous number ON SCREEN and puts the spinner beside the LABEL. Replacing
// the value collapses the tile's height and makes the whole dashboard jump on every refresh — the
// same reasoning as the always-fresh list rule.
export const RefreshingKeepsTheNumber: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("statistic")).toHaveTextContent("12.480");
    await expect(canvas.getByTestId("spinner")).toBeVisible();
  },
};

export const WithTrend: Story = {
  args: { title: "Revenue this month", children: "Rp 142jt", icon: Wallet, help: "18% vs last month", trend: "up" },
};

export const ARowOfThem: Story = {
  render: () => (
    <HStack gap="3" align="stretch" w="full">
      <Statistic title="Stock on hand" icon={Boxes} tone="active">
        12.480
      </Statistic>
      <Statistic title="Open orders" icon={Receipt} tone="info">
        86
      </Statistic>
      <Statistic title="Unpaid" icon={Wallet} tone="warning" help="3 overdue" trend="down">
        Rp 24jt
      </Statistic>
    </HStack>
  ),
};

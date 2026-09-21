import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { Boxes, Clock, Truck, Wallet } from "lucide-react";
import { expect, within } from "storybook/test";

import { ListSummary, description } from "./ListSummary";

const meta = {
  title: "Legacy/Components/Display/ListSummary",
  component: ListSummary,
  parameters: { docs: { description: { component: description } } },
  args: {
    items: [
      { icon: Boxes, content: <Text>12 items</Text>, tooltip: "Items in this order" },
      { icon: Wallet, content: <Text>Rp 4,2jt</Text>, tooltip: "Order total" },
      { icon: Truck, content: <Text>JNE</Text>, tooltip: "Courier" },
      { icon: Clock, content: <Text>2 days ago</Text>, tooltip: "Created" },
    ],
  },
} satisfies Meta<typeof ListSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

// Every item names itself on hover. Without that the line is a row of unlabelled numbers whose
// meaning has to be learned rather than read — the standard failure of dense summary lines.
export const UnderARowTitle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("list-summary-item")).toHaveLength(4);
  },
};

export const Small: Story = { args: { size: "sm" } };

export const Separated: Story = { args: { separated: true } };

// Hidden items are dropped, not rendered blank — a row with no courier should be shorter, not have
// a gap where the courier would be.
export const HiddenItemsAreDropped: Story = {
  args: {
    items: [
      { icon: Boxes, content: <Text>12 items</Text> },
      { icon: Truck, content: <Text>JNE</Text>, hidden: true },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("list-summary-item")).toHaveLength(1);
  },
};

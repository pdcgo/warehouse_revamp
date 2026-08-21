import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@chakra-ui/react";
import { PackageSearch, SearchX } from "lucide-react";
import { expect, within } from "storybook/test";

import { EmptyHint, description } from "./EmptyHint";

const meta = {
  title: "Legacy/Components/Feedback/EmptyHint",
  component: EmptyHint,
  parameters: { docs: { description: { component: description } } },
  args: { title: "No orders yet", children: "Orders imported from a marketplace will appear here." },
} satisfies Meta<typeof EmptyHint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingYet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No orders yet");
  },
};

// The distinction the component exists to force. "Nothing here yet" and "your filter excluded
// everything" look identical as a blank table, and the reader's next move is different for each —
// go create something, versus widen the filter.
export const FilterExcludedEverything: Story = {
  args: {
    icon: SearchX,
    title: "No results for this filter",
    children: "Try a wider date range, or clear the supplier filter.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("empty-hint")).toHaveTextContent("No results for this filter");
  },
};

export const WithAction: Story = {
  args: {
    icon: PackageSearch,
    title: "No products in this team",
    children: <Button size="sm">Add a product</Button>,
  },
};

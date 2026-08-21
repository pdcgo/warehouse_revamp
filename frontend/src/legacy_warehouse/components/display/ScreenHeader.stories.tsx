import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@chakra-ui/react";
import { PackageOpen } from "lucide-react";
import { expect, within } from "storybook/test";

import { ScreenHeader, description } from "./ScreenHeader";

const meta = {
  title: "LegacyWarehouse/Components/Display/ScreenHeader",
  component: ScreenHeader,
  parameters: { docs: { description: { component: description } } },
  args: { icon: PackageOpen, title: "Inbound" },
} satisfies Meta<typeof ScreenHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("screen-header")).toHaveAttribute("data-screen", "Inbound");
  },
};

// Screen-level actions live in the header; row-level ones live in the row. Mixing them is how a
// header grows a button that only applies to whatever happens to be selected.
export const WithScreenActions: Story = {
  args: {
    actions: (
      <Button size="xs" variant="outline">
        Print barcodes
      </Button>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("screen-actions")).toHaveTextContent("Print barcodes");
  },
};

// ⚠ ONE LINE, NO SUBTITLE. On a trolley-mounted tablet every pixel of header is a row the picker
// cannot see, so a long name clamps rather than wrapping the screen open.
export const ALongNameClampsRatherThanWrapping: Story = {
  args: { title: "Daily stock history for every team in this warehouse" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("screen-header")).toBeVisible();
    await expect(canvas.queryByRole("paragraph", { name: /subtitle/i })).toBeNull();
  },
};

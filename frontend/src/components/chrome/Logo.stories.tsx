import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack, Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { Logo, WarehouseMark } from "./Logo";

const meta = {
  title: "Components/Chrome/Logo",
  component: Logo,
  parameters: {
    docs: {
      description: {
        component:
          "The brand mark (a pitched-roof warehouse with a roller door) plus the wordmark. Line style in the theme accent so it sits beside the lucide icons. Drop the wordmark for a collapsed sidebar. The same geometry lives in public/warehouse.svg — keep the two in sync.",
      },
    },
  },
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// Mark only — what the sidebar shows when it is collapsed.
export const MarkOnly: Story = {
  args: { showWordmark: false },
};

export const Sizes: Story = {
  render: () => (
    <Stack gap="4">
      {[20, 24, 32, 48].map((size) => (
        <Logo key={size} size={size} />
      ))}
    </Stack>
  ),
};

// The mark is drawn with `currentColor` and no fill, so it inherits whatever colour it sits in —
// that is what lets one SVG serve the accent-coloured sidebar and a muted footer alike.
export const MarkInheritsColor: Story = {
  render: () => (
    <HStack gap="6" color="fg.muted">
      <WarehouseMark size={32} />
      <HStack color="brand.solid">
        <WarehouseMark size={32} />
      </HStack>
    </HStack>
  ),
};

export const RendersTheWordmark: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("PDC Warehouse")).toBeInTheDocument();
  },
};

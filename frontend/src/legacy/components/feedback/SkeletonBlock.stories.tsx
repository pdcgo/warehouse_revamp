import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack, Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { SkeletonBlock, description } from "./SkeletonBlock";

const meta = {
  title: "Legacy/Components/Feedback/SkeletonBlock",
  component: SkeletonBlock,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof SkeletonBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextLines: Story = {
  args: { shape: "text", lines: 3 },
  render: (args) => (
    <Stack w="320px">
      <SkeletonBlock {...args} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("skeleton-block")).toHaveAttribute("data-shape", "text");
  },
};

export const Circle: Story = {
  args: { shape: "circle", boxSize: "12" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("skeleton-block")).toHaveAttribute("data-shape", "circle");
  },
};

export const Rect: Story = {
  args: { shape: "rect", height: "24", width: "320px" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("skeleton-block")).toHaveAttribute("data-shape", "rect");
  },
};

// THE reason the component asks for a shape: the placeholder occupies the same space as the real
// content, so nothing jumps when the data lands. A generic grey box would resize on arrival.
export const ShapedLikeARow: Story = {
  render: () => (
    <HStack gap="3" w="360px" borderWidth="1px" p="3" borderRadius="l3">
      <SkeletonBlock shape="circle" boxSize="12" />
      <Stack flex="1" gap="2">
        <SkeletonBlock shape="text" lines={2} />
      </Stack>
      <SkeletonBlock shape="rect" width="16" height="6" />
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("skeleton-block")).toHaveLength(3);
  },
};

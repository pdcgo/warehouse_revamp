import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { TONES } from "../tone";
import { Spinner, description } from "./Spinner";

const meta = {
  title: "Legacy/Components/Feedback/Spinner",
  component: Spinner,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standalone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("spinner")).toBeVisible();
  },
};

// The two sizes MEAN different things — inline beside a label, versus alone in an empty panel. Two
// is the whole scale on purpose: a spinner is the most re-invented element in any app.
export const BothSizes: Story = {
  render: () => (
    <HStack gap="4" align="center">
      <Spinner size="sm" />
      <Spinner size="md" />
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("spinner")).toHaveLength(2);
  },
};

export const EveryTone: Story = {
  render: () => (
    <HStack gap="3">
      {TONES.map((tone) => (
        <Spinner key={tone} tone={tone} size="sm" />
      ))}
    </HStack>
  ),
};

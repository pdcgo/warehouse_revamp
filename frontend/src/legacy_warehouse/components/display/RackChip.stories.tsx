import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { RackChip, description } from "./RackChip";

const meta = {
  title: "LegacyWarehouse/Components/Display/RackChip",
  component: RackChip,
  parameters: { docs: { description: { component: description } } },
  args: { rack: "A-03-2", count: 14 },
} satisfies Meta<typeof RackChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// ⚠ A PLACE IS NOT AN ABSENCE. Stock on the floor unshelved is a real, actionable state — a blank
// cell reads as "we did not load it", where "Unplaced" reads as "go and shelve it". This repo
// already learned this on RackSelect (#136/#139); it applies to displaying a rack too.
export const UnplacedIsShownExplicitly: Story = {
  args: { rack: null, count: 6 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const chip = canvas.getByTestId("rack-chip");
    await expect(chip).toHaveTextContent("Unplaced");
    await expect(chip).toHaveAttribute("data-unplaced", "true");
    // And it is toned as outstanding work, not as neutral data.
    await expect(chip).not.toHaveTextContent("—");
  },
};

// A rack without a count answers half the question — the picker needs to know whether walking there
// is worth it.
export const CountIsPartOfTheAnswer: Story = {
  render: () => (
    <HStack gap="2">
      <RackChip rack="A-03-2" count={14} />
      <RackChip rack="B-11-1" count={1} />
      <RackChip rack="C-02-4" />
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const chips = canvas.getAllByTestId("rack-chip");
    await expect(chips[0]).toHaveTextContent("× 14");
    await expect(chips[2]).not.toHaveTextContent("×");
  },
};

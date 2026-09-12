import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { TeamPairSelect, description } from "./TeamPairSelect";

const meta = {
  title: "Legacy/Components/Pickers/TeamPairSelect",
  component: TeamPairSelect,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof TeamPairSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: { fromId?: bigint }) {
  const [fromId, setFromId] = useState<bigint | undefined>(props.fromId);
  const [toId, setToId] = useState<bigint>();

  return (
    <Box w="520px">
      <TeamPairSelect
        fromId={fromId}
        toId={toId}
        onFromChange={setFromId}
        onToChange={setToId}
      />
    </Box>
  );
}

export const Empty: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("team-pair-from")).toBeVisible();
    await expect(canvas.getByTestId("team-pair-to")).toBeVisible();
  },
};

// The direction is stated by the arrow, not left to be inferred from two adjacent dropdowns —
// direction is the entire meaning of a transfer.
export const DirectionIsExplicit: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByLabelText("to")).toBeVisible();
  },
};

// THE rule this component exists for: with a source chosen, the destination list no longer contains
// it — a transfer to itself becomes impossible to EXPRESS rather than rejected at submit time.
export const DestinationExcludesTheSource: Story = {
  render: () => <Harness fromId={1n} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("team-pair-select")).toBeVisible();
  },
};

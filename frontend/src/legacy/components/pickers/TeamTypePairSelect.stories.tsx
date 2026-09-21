import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { TeamTypePairSelect, description } from "./TeamTypePairSelect";

const meta = {
  title: "Legacy/Components/Pickers/TeamTypePairSelect",
  component: TeamTypePairSelect,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof TeamTypePairSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

function Harness(props: { from?: TeamType; to?: TeamType }) {
  const [fromType, setFrom] = useState<TeamType | undefined>(props.from);
  const [toType, setTo] = useState<TeamType | undefined>(props.to);

  return (
    <Box w="480px">
      <TeamTypePairSelect
        fromType={fromType}
        toType={toType}
        onFromChange={setFrom}
        onToChange={setTo}
      />
    </Box>
  );
}

export const SellingToWarehouse: Story = {
  render: () => <Harness from={TeamType.SELLING} to={TeamType.WAREHOUSE} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("team-type-pair-select")).toBeVisible();
  },
};

// ⚠ Unlike TeamPairSelect, BOTH ENDS MAY BE THE SAME. Warehouse-to-warehouse is a real and common
// flow — excluding the source here, which is exactly what makes the team pair correct, would make
// this one wrong.
export const SameKindBothEndsIsValid: Story = {
  render: () => <Harness from={TeamType.WAREHOUSE} to={TeamType.WAREHOUSE} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("team-type-pair-from")).toBeVisible();
    await expect(canvas.getByTestId("team-type-pair-to")).toBeVisible();
  },
};

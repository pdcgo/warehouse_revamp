import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge, description } from "./TeamTypeBadge";

const meta = {
  title: "Legacy/Components/Badges/TeamTypeBadge",
  component: TeamTypeBadge,
  parameters: { docs: { description: { component: description } } },
  args: { type: TeamType.SELLING },
} satisfies Meta<typeof TeamTypeBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selling: Story = {};

export const Warehouse: Story = { args: { type: TeamType.WAREHOUSE } };

// A person switches teams constantly, so the type has to be readable from the badge alone. All four
// together is how that stays true.
export const EveryType: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {[TeamType.SELLING, TeamType.WAREHOUSE, TeamType.ROOT, TeamType.ADMIN].map((t) => (
        <TeamTypeBadge key={t} type={t} />
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`team-type-badge-${TeamType.SELLING}`)).toHaveTextContent("Selling");
    await expect(canvas.getByTestId(`team-type-badge-${TeamType.ROOT}`)).toHaveTextContent("Root");
  },
};

export const Unspecified: Story = { args: { type: TeamType.UNSPECIFIED } };

import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge, description } from "./TeamTypeBadge";

const meta = {
  title: "Components/Badges/TeamTypeBadge",
  component: TeamTypeBadge,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { type: TeamType.WAREHOUSE },
} satisfies Meta<typeof TeamTypeBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Warehouse: Story = {};

export const Compact: Story = { args: { type: TeamType.SELLING, size: "sm" } };

// ONE place owns team type → colour. Seeing every type together — in BOTH colour modes (toolbar) — is
// how the mapping stays one decision instead of a copy per screen.
export const EveryType: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {[TeamType.WAREHOUSE, TeamType.SELLING, TeamType.ROOT, TeamType.ADMIN].map((t) => (
        <TeamTypeBadge key={t} type={t} />
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`team-type-badge-${TeamType.WAREHOUSE}`)).toHaveTextContent("Warehouse");
    await expect(canvas.getByTestId(`team-type-badge-${TeamType.SELLING}`)).toHaveTextContent("Selling");
    await expect(canvas.getByTestId(`team-type-badge-${TeamType.ROOT}`)).toHaveTextContent("Root");
    await expect(canvas.getByTestId(`team-type-badge-${TeamType.ADMIN}`)).toHaveTextContent("Admin");
  },
};

// An unrecognised type still renders — plain gray and labelled "Team", never a crash and never a
// borrowed colour that would read as a different kind of team.
export const Unknown: Story = {
  args: { type: TeamType.UNSPECIFIED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`team-type-badge-${TeamType.UNSPECIFIED}`)).toHaveTextContent("Team");
  },
};

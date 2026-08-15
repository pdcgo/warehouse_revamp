import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { TeamItem, description } from "./TeamItem";

const meta = {
  title: "Components/TeamItem",
  component: TeamItem,
  parameters: {
    docs: { description: { component: description } },
  },
  args: {
    team: { teamName: "Gudang Pusat", teamType: TeamType.WAREHOUSE, teamId: 11n },
  },
} satisfies Meta<typeof TeamItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Warehouse: Story = {};

export const Selling: Story = {
  args: { team: { teamName: "Toko Melati", teamType: TeamType.SELLING, teamId: 12n } },
};

export const WithAction: Story = {
  args: { action: <Button size="xs">Switch</Button> },
};

// The type badge is colour-coded per team type, and the four are only comparable side by side.
export const EveryTeamType: Story = {
  render: () => (
    <Stack gap="3" w="72">
      {[TeamType.ROOT, TeamType.ADMIN, TeamType.WAREHOUSE, TeamType.SELLING].map((type) => (
        <TeamItem key={type} team={{ teamName: `Team ${type}`, teamType: type, teamId: BigInt(type) }} />
      ))}
    </Stack>
  ),
};

// `imageUrl` is only present on shapes that carry it — a Team has one, a TeamAccessItem does not.
// The component takes a structural type rather than a concrete message for exactly that reason, so
// the initials fallback is a supported case, not a degraded one.
export const FallsBackToInitials: Story = {
  args: { team: { teamName: "Toko Kenanga", teamType: TeamType.SELLING, teamId: 13n } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Toko Kenanga")).toBeInTheDocument();
    await expect(canvas.getByText("Selling")).toBeInTheDocument();
  },
};

// A team with no name still has to render — the id is the last readable thing left, and a blank row
// in a team switcher is unpickable.
export const NamelessTeamShowsItsId: Story = {
  args: { team: { teamId: 99n, teamType: TeamType.WAREHOUSE } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Team #99")).toBeInTheDocument();
  },
};

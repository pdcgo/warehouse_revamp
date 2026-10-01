import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { TeamCell, description } from "./TeamCell";

const meta = {
  title: "Legacy/Components/Cells/TeamCell",
  component: TeamCell,
  parameters: { docs: { description: { component: description } } },
  args: { team: { id: 3n, name: "Gudang Utara", type: TeamType.WAREHOUSE } },
} satisfies Meta<typeof TeamCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("Gudang Utara");
    await expect(canvas.getByTestId(`team-type-badge-${TeamType.WAREHOUSE}`)).toBeVisible();
  },
};

// Why the badge is not ornament: these two rows read identically without it, and the same balance
// figure means opposite things depending on which kind of team it is against.
export const TypeDecidesWhatTheRowMeans: Story = {
  render: () => (
    <Stack gap="2">
      <TeamCell team={{ id: 3n, name: "Jaya Abadi", type: TeamType.WAREHOUSE }} />
      <TeamCell team={{ id: 9n, name: "Jaya Abadi", type: TeamType.SELLING }} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`team-type-badge-${TeamType.WAREHOUSE}`)).toBeVisible();
    await expect(canvas.getByTestId(`team-type-badge-${TeamType.SELLING}`)).toBeVisible();
  },
};

export const Unresolved: Story = {
  args: { team: undefined, teamId: 3n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("#3");
  },
};

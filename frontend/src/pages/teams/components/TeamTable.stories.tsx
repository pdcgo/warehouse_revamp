import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { asPlatformOnly, asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { TeamTable } from "./TeamTable";

// ROOT'S TEAMS LIST MARKS EVERY SELLING TEAM WITH NO RETURN WAREHOUSE (root-sees-which-teams-have-no-return-warehouse).
// Each team sets its own (each-team-sets-its-own-return-warehouse), and order create starts refusing a team without
// one only once none is left — the mark is how root sees that moment.
//
// The stub gives Toko Melati (SL-01) a return warehouse and leaves Toko Kenanga (SL-02) and Toko Anggrek (SL-03)
// without one.

const meta = {
  title: "Pages/Teams/TeamTable",
  component: TeamTable,
  args: { teamType: TeamType.SELLING },
  parameters: {
    // It reads the person's role through useTeam().
    signedIn: true,
  },
  beforeEach: asPlatformOnly(Role.ROOT),
} satisfies Meta<typeof TeamTable>;

export default meta;
type Story = StoryObj<typeof meta>;

// Root sees which selling teams are still missing one — and a team that has set one is never marked.
export const MarksTeamsWithNoReturnWarehouse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("team-no-return-SL-02")).toBeVisible();
    await expect(canvas.getByTestId("team-no-return-SL-03")).toHaveTextContent("No return warehouse");

    await expect(canvas.getByTestId("team-row-SL-01")).toBeVisible();
    await expect(canvas.queryByTestId("team-no-return-SL-01")).not.toBeInTheDocument();
  },
};

// Only root and the Administrator ask — the read is unscoped. A team's own owner sees the list with no mark.
export const NotForATeamsOwnPeople: Story = {
  beforeEach: asRole(Role.SELLING_OWNER),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("team-row-SL-02");

    // Long enough for a read that should not have been made to have answered, had it been.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await waitFor(() => expect(canvas.queryByTestId("team-no-return-SL-02")).not.toBeInTheDocument());
  },
};

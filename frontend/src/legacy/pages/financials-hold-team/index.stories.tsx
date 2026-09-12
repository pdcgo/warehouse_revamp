import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { HOLDS_BY_TEAM } from "../../financeFixtures";
import { FinancialsHoldTeamPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Financials/HoldByTeam",
  component: FinancialsHoldTeamPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: HOLDS_BY_TEAM },
} satisfies Meta<typeof FinancialsHoldTeamPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// Same screen, one level up — the subject is the team rather than the shop.
export const SubjectIsTheTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("hold-screen")).toHaveAttribute("data-subject", "Team");
    await expect(canvas.getByText("Jaya Abadi")).toBeVisible();
  },
};

// The age rule holds here too — Toko Makmur is waiting on a small amount that has been stuck for a
// month, and it leads despite Jaya Abadi being twenty times larger.
export const AgeStillDecidesTheOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("hold-overdue")).toBeVisible();
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };

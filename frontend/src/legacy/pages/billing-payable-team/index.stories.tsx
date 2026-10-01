import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { TEAM_BALANCES } from "../../financeFixtures";
import { BillingPayableTeamPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Billing/Payable/Team",
  component: BillingPayableTeamPage,
  parameters: { docs: { description: { component: description } } },
  args: { teams: TEAM_BALANCES },
} satisfies Meta<typeof BillingPayableTeamPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("billing-team-screen")).toHaveAttribute("data-direction", "payable");
  },
};

// Sorted by AMOUNT — the largest outstanding balance is the one worth a phone call, and
// alphabetical order buries it among teams that owe nothing.
export const SortedByAmount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("entity-cell-name").length).toBeGreaterThan(1);
  },
};

export const Loading: Story = { args: { teams: [], loading: true } };

export const Empty: Story = { args: { teams: [] } };

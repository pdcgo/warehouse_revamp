import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { TEAM_BALANCES } from "../../financeFixtures";
import { BillingTeamBalancePage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Billing/TeamBalance",
  component: BillingTeamBalancePage,
  parameters: { docs: { description: { component: description } } },
  args: { teams: TEAM_BALANCES },
} satisfies Meta<typeof BillingTeamBalancePage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ THE DIRECTION IS IN WORDS, not a minus sign. A signed number requires knowing the convention
// before it means anything — which is exactly what somebody new to the screen does not have.
export const DirectionIsStatedNotSigned: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByText("We owe").length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("Owed to us").length).toBeGreaterThan(0);
    // No negative figures anywhere in the net column.
    await expect(canvas.queryByText(/^-Rp/)).toBeNull();
  },
};

// A team that is square gets a word, not a zero — "Settled" is a state; "Rp 0" is a number somebody
// has to interpret.
export const SettledIsAState: Story = {
  args: {
    teams: [{ id: 3n, name: "Gudang Utara", kind: "warehouse", owed: 5_000_000n, owing: 5_000_000n, limit: 0n }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Settled")).toBeVisible();
  },
};

// Sorted by the size of the imbalance in EITHER direction — the biggest exposure is the one to act
// on, and its sign does not change how urgent it is.
export const SortedByExposureNotSign: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const names = canvas.getAllByTestId("entity-cell-name").map((el) => el.textContent);
    // Gudang Utara is 44jt out of balance — the largest, in the "we owe" direction.
    await expect(names[0]).toContain("Gudang Utara");
  },
};

export const Loading: Story = { args: { teams: [], loading: true } };

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { TEAM_BALANCES } from "../../financeFixtures";
import { InvoiceLimitPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Invoices/Limits",
  component: InvoiceLimitPage,
  parameters: { docs: { description: { component: description } } },
  args: { teams: TEAM_BALANCES },
} satisfies Meta<typeof InvoiceLimitPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// Sorted by PRESSURE, not by name — the account about to be blocked is the one worth looking at, and
// alphabetical order buries it.
export const SortedByPressure: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const names = canvas.getAllByTestId("entity-cell-name").map((el) => el.textContent);
    // Gudang Utara is at 88% of its ceiling; it leads.
    await expect(names[0]).toContain("Gudang Utara");
  },
};

// ⚠ A team with NO limit is SHOWN, marked as having none. An absent row would read as "no limit
// problem here", when the truth is "no limit was ever set" — a different, sometimes worse state.
export const TeamsWithNoLimitAreShownNotOmitted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("not set")).toBeVisible();
    await expect(canvas.getAllByTestId("limit-progress-inactive").length).toBeGreaterThan(0);
  },
};

// The banner exists so the limit is read BEFORE it stops an order — a limit is otherwise invisible
// until somebody on the floor is standing in front of a blocked screen.
export const WarnsBeforeAnyoneIsBlocked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("limit-warning")).toHaveTextContent(/near the ceiling/i);
  },
};

// Nothing near a ceiling means no banner — an always-present warning trains people to stop reading it.
export const NothingAtRisk: Story = {
  args: { teams: TEAM_BALANCES.map((t) => ({ ...t, owing: 0n })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("limit-warning")).toBeNull();
  },
};

export const Loading: Story = { args: { teams: [], loading: true } };

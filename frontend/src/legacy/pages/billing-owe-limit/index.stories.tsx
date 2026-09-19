import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { TEAM_BALANCES } from "../../financeFixtures";
import { BillingOweLimitPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Billing/OweLimit",
  component: BillingOweLimitPage,
  parameters: { docs: { description: { component: description } } },
  args: { teams: TEAM_BALANCES, onSave: fn() },
} satisfies Meta<typeof BillingOweLimitPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ⚠ This screen CONFIGURES; the limit monitor WATCHES. It is sorted by NAME, because you arrive
// knowing which team you came to change — not by pressure, which is the monitor's question.
export const SortedByNameNotPressure: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const names = canvas.getAllByTestId("entity-cell-name").map((el) => el.textContent ?? "");
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    await expect(names).toEqual(sorted);
  },
};

// It points at the monitor rather than trying to be it — merging the two would put an edit control
// on a screen people scan hourly, which is how a ceiling gets raised to clear a blockage.
export const PointsAtTheMonitor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("owe-limit-note")).toHaveTextContent(/limit monitor/i);
  },
};

// A team with no limit is shown as such — "no limit" is a real configuration, and a blank cell would
// read as one that failed to load.
export const NoLimitIsAConfiguration: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("No limit")).toBeVisible();
  },
};

export const EditingALimit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("edit-limit-3"));

    await waitFor(async () => {
      await expect(screen.getByTestId("limit-input")).toBeVisible();
    });

    await userEvent.click(screen.getByTestId("save-limit"));
    await expect(args.onSave).toHaveBeenCalled();
  },
};

export const Loading: Story = { args: { teams: [], loading: true } };

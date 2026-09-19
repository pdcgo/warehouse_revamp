import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { AD_SPEND } from "../../financeFixtures";
import { AccountingAdsMonthlyPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Accounting/Ads/Monthly",
  component: AccountingAdsMonthlyPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: AD_SPEND },
} satisfies Meta<typeof AccountingAdsMonthlyPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ad-spend-screen")).toHaveAttribute("data-grouping", "month");
  },
};

// ⚠ COARSE GROUPING MASKS A LOSING CHANNEL — and this story exists to make that visible rather than
// to pretend otherwise.
//
// The same figures contain a Tokopedia line and a whole shop that lose money. Rolled up to a MONTH
// they disappear: the month nets positive, every badge reads above 1.0, and nothing on this screen
// suggests anything is wrong. That is not a bug in the screen; it is what aggregation does.
//
// It is the reason the ungrouped list exists, and the reason these four are separate screens rather
// than one with a grouping control that people would leave on whatever it was last set to.
export const MonthlyRollupHidesTheLosingChannel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const badges = canvas.getAllByTestId("roas-badge");
    await expect(badges.length).toBeGreaterThan(0);
    // Every month reads as profitable, even though two lines inside them are not.
    await expect(badges.every((b) => Number((b.textContent ?? "").replace("×", "")) >= 1)).toBe(true);
  },
};

export const ChartView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("segment-chart"));
    await waitFor(async () => {
      await expect(canvas.getByTestId("chart")).toBeVisible();
    });
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };

export const Empty: Story = { args: { rows: [] } };

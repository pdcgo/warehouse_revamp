import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { AD_SPEND } from "../../financeFixtures";
import { AccountingAdsListPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Accounting/Ads/List",
  component: AccountingAdsListPage,
  parameters: { docs: { description: { component: description } } },
  args: { rows: AD_SPEND },
} satisfies Meta<typeof AccountingAdsListPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("ad-spend-screen")).toHaveAttribute("data-grouping", "none");
  },
};

// ⚠ ROAS IS THE POINT. Revenue divided by spend is what says whether an ad is worth running, and
// below 1.0 the advertising is LOSING money — which is coloured rather than left to be noticed.
export const RoasBelowOneIsMarkedAsLosing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const badges = canvas.getAllByTestId("roas-badge");
    await expect(badges.length).toBeGreaterThan(0);
    // The Tokopedia line returns less than it costs, so at least one badge reports under 1.
    await expect(badges.some((b) => Number((b.textContent ?? "").replace("×", "")) < 1)).toBe(true);
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

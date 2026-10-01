import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { INVOICES, TEAM_BALANCES } from "../../financeFixtures";
import { BillingTeamDetailPage, description } from "./index";

const meta = {
  title: "Legacy/Pages/Billing/TeamDetail",
  component: BillingTeamDetailPage,
  parameters: { docs: { description: { component: description } } },
  args: { team: TEAM_BALANCES[0], invoices: INVOICES },
} satisfies Meta<typeof BillingTeamDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// THE point of the screen: everything needed for the decision, in one place. Navigating four screens
// to make one phone call is how the call gets made on two of the four.
export const GathersTheWholePosition: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("statistic")).toHaveLength(3);
    await expect(canvas.getByTestId("limit-progress")).toBeVisible();
    await expect(canvas.getByLabelText("Open invoices")).toBeInTheDocument();
  },
};

// BOTH directions in one table. A counterparty who owes us and is owed by us has a net position, and
// splitting the table hides it.
export const BothDirectionsInOneTable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByText("We owe").length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("Owed to us").length).toBeGreaterThan(0);
  },
};

// Its tabs are NAVIGATION — each is a real sub-route, so a colleague asked to look at "their
// payments" can be sent a URL.
export const TabsAreLinkable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("nav-tab-payments")).toHaveAttribute(
      "href",
      "/billing/teams/3/payments",
    );
  },
};

// A counterparty with no credit arrangement shows no meter rather than an empty one.
export const NoCreditLimit: Story = {
  args: { team: { ...TEAM_BALANCES[0], limit: 0n } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("limit-progress")).toBeNull();
  },
};

export const Loading: Story = { args: { invoices: [], loading: true } };

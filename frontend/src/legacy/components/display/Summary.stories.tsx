import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleCheck, Clock, TriangleAlert, Wallet } from "lucide-react";
import { expect, within } from "storybook/test";

import { Summary, SummaryCompact, compactDescription, description } from "./Summary";

const ITEMS = [
  { label: "Paid", value: "Rp 118jt", icon: CircleCheck, tone: "success" as const },
  { label: "Unpaid", value: "Rp 24jt", icon: Clock, tone: "warning" as const },
  { label: "Overdue", value: "Rp 6,4jt", icon: TriangleAlert, tone: "error" as const },
  { label: "Total", value: "Rp 148jt", icon: Wallet, tone: "active" as const },
];

const meta = {
  title: "Legacy/Components/Display/Summary",
  component: Summary,
  parameters: { docs: { description: { component: description } } },
  args: { items: ITEMS },
} satisfies Meta<typeof Summary>;

export default meta;
type Story = StoryObj<typeof meta>;

// The band exists because these four only MEAN something together — reading "Unpaid Rp 24jt" without
// the total tells you nothing. Laying them out as separate Statistic cards would make each look
// independently important and let them wrap apart from each other.
export const ABreakdownReadTogether: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByTestId("summary-item")).toHaveLength(4);
  },
};

export const Loading: Story = { args: { loading: true } };

// Same information at half the weight, for a summary that sits INSIDE a panel or dialog where the
// full-size band would out-shout the content it is summarising.
export const Compact: Story = {
  parameters: { docs: { description: { story: compactDescription } } },
  render: () => <SummaryCompact items={ITEMS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("summary-compact")).toBeVisible();
    await expect(canvas.getAllByTestId("summary-item")).toHaveLength(4);
  },
};

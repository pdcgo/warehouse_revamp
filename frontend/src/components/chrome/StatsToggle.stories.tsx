import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { StatsToggle, description } from "./StatsToggle";

// A real open/shut state, so a click is seen to do something.
function Toggle({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);

  return <StatsToggle open={open} onToggle={() => setOpen((o) => !o)} label="Statistics" compact={compact} testId="stats" />;
}

const meta = {
  title: "Components/Chrome/StatsToggle",
  component: StatsToggle,
  parameters: { docs: { description: { component: description } } },
  args: { open: false, onToggle: () => {}, label: "Statistics" },
} satisfies Meta<typeof StatsToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A desktop's, at the end of the tab row: the icon, the label, a chevron. */
export const Default: Story = {};

export const Open: Story = { args: { open: true } };

/** A phone's, beside Filter: the icon alone, named by its label. */
export const Compact: Story = { args: { compact: true } };

export const CompactOpen: Story = { args: { compact: true, open: true } };

/** It says whether the statistics are open — `aria-expanded` — in both shapes. */
export const ItSaysOpenOrShut: Story = {
  render: () => (
    <>
      <Toggle />
      <Toggle compact />
    </>
  ),
  play: async ({ canvasElement }) => {
    const [wide, compact] = within(canvasElement).getAllByTestId("stats");

    await expect(wide).toHaveTextContent("Statistics");
    await expect(compact).toHaveAccessibleName("Statistics");
    for (const button of [wide!, compact!]) {
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(button);
      await expect(button).toHaveAttribute("aria-expanded", "true");
    }
  },
};

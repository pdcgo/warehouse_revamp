import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, History, Package, Tag } from "lucide-react";
import { expect, userEvent, within } from "storybook/test";

import { SectionNav, description } from "./SectionNav";
import type { NavSection } from "./SectionNav";

type Key = "info" | "price" | "batch" | "history";

const SECTIONS: NavSection<Key>[] = [
  { key: "info", label: "Info", icon: FileText },
  { key: "price", label: "Price", icon: Tag },
  { key: "batch", label: "Batch", icon: Package },
  { key: "history", label: "Stock history", icon: History },
];

// The nav with real state — a click lights the item, as the page's scroll spy would.
function Harness({ compact = false }: { compact?: boolean }) {
  const [active, setActive] = useState<Key>("info");

  return (
    <SectionNav compact={compact} sections={SECTIONS} ariaLabel="Product sections" active={active} onSelect={setActive} />
  );
}

const meta = {
  title: "Components/Chrome/SectionNav",
  component: Harness,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Column: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("navigation", { name: "Product sections" })).toBeInTheDocument();
    await expect(canvas.getByTestId("section-nav-info")).toHaveAttribute("aria-current", "location");

    await userEvent.click(canvas.getByTestId("section-nav-batch"));
    await expect(canvas.getByTestId("section-nav-batch")).toHaveAttribute("aria-current", "location");
    await expect(canvas.getByTestId("section-nav-info")).not.toHaveAttribute("aria-current");
  },
};

// A phone: a strip of chips, the lit one solid.
export const Chips: Story = {
  args: { compact: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("section-nav-strip")).toBeInTheDocument();
    await userEvent.click(canvas.getByTestId("section-nav-history"));
    await expect(canvas.getByTestId("section-nav-history")).toHaveAttribute("aria-current", "location");
  },
};

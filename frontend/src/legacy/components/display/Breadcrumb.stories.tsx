import type { Meta, StoryObj } from "@storybook/react-vite";
import { House } from "lucide-react";
import { expect, within } from "storybook/test";

import { Breadcrumb, description } from "./Breadcrumb";

const meta = {
  title: "Legacy/Components/Display/Breadcrumb",
  component: Breadcrumb,
  parameters: { docs: { description: { component: description } } },
  args: {
    items: [
      { href: "/", icon: House, name: "Home" },
      { href: "/teams/3", name: "Gudang Utara" },
      { href: "/teams/3/racks", name: "Racks" },
      { name: "A-12" },
    ],
  },
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

// The last crumb is where you ARE, so it renders as CurrentLink with aria-current rather than as a
// link — a link to the page you are on is a link that does nothing, and a screen reader needs to be
// told which crumb is the destination.
export const Nested: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("crumb-0").closest("a")).toHaveAttribute("href", "/");
    await expect(canvas.getByTestId("crumb-3").closest("a")).toBeNull();
  },
};

export const TwoLevels: Story = {
  args: { items: [{ href: "/", icon: House, name: "Home" }, { name: "Products" }] },
};

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Boxes, Receipt, Users } from "lucide-react";
import { expect, within } from "storybook/test";

import { NavTabs, description } from "./NavTabs";

type Tab = "stock" | "orders" | "members";

const ITEMS = [
  { key: "stock" as Tab, label: "Stock", icon: Boxes },
  { key: "orders" as Tab, label: "Orders", icon: Receipt },
  { key: "members" as Tab, label: "Members", icon: Users },
];

const meta = {
  title: "Legacy/Components/Display/NavTabs",
  component: NavTabs,
  parameters: { docs: { description: { component: description } } },
  args: { items: ITEMS, value: "stock" as Tab },
} satisfies Meta<typeof NavTabs<Tab>>;

export default meta;
type Story = StoryObj<typeof meta>;

// `hrefFor` is what makes these NAVIGATION rather than a state toggle: each tab becomes a real
// route, so it is linkable, survives a refresh, and the back button moves between tabs.
export const TabsAreRealLinks: Story = {
  args: { hrefFor: (key: Tab) => `/teams/3/${key}` },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("nav-tab-orders")).toHaveAttribute("href", "/teams/3/orders");
  },
};

// Without hrefFor it falls back to controlled tabs — for the rare in-page case where a tab is
// genuinely not a location. If you are picking a FILTER, use ChoiceTabs instead.
export const ControlledFallbackHasNoHref: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("nav-tab-orders")).not.toHaveAttribute("href");
  },
};

// `line` at the top of a page (it divides the page below it); `enclosed` inside a card, where an
// underline would be mistaken for the card's own border.
export const Enclosed: Story = { args: { variant: "enclosed" } };

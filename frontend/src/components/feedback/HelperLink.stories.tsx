import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { HelperLink, description } from "./HelperLink";

// a-helper-link-opens-a-new-tab (docs/business/inventory/restock_decision.md) — the link each of the restock helpers
// gives: the supplier popup's Create Supplier, the account box's Financial Accounts, the accept page's Racks.

const meta = {
  title: "Components/Feedback/HelperLink",
  component: HelperLink,
  parameters: { docs: { description: { component: description } } },
  args: { href: "/inventories/racks", label: "Open Racks", testId: "helper-link" },
} satisfies Meta<typeof HelperLink>;

export default meta;
type Story = StoryObj<typeof meta>;

// A NEW TAB, and the opened page gets no handle on this one — its label, the icon, and *opens in a new tab* in its name.
export const OpensANewTab: Story = {
  name: "Opens a new tab",
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByTestId("helper-link");

    await expect(link.tagName).toBe("A");
    await expect(link).toHaveAttribute("href", "/inventories/racks");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveTextContent("Open Racks");
    await expect(link).toHaveAccessibleName("Open Racks, opens in a new tab");
    await expect(link.querySelector("svg")).not.toBeNull();
  },
};

// Pressed, it leaves the page where it is — the tab it opens is a page of its own (the story stops the browser's own
// opening, once, so the runner opens nothing).
export const PressingItLeavesThisPageAsItIs: Story = {
  name: "Pressing it keeps this page",
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByTestId("helper-link");
    const before = window.location.href;
    link.addEventListener("click", (e) => e.preventDefault(), { once: true });

    await userEvent.click(link);

    await expect(window.location.href).toBe(before);
    await expect(within(canvasElement).getByTestId("helper-link")).toBe(link);
  },
};

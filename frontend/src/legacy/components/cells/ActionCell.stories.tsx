import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRightLeft, Pencil, Printer, Trash2 } from "lucide-react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { ActionCell, description } from "./ActionCell";

const meta = {
  title: "Legacy/Components/Cells/ActionCell",
  component: ActionCell,
  parameters: { docs: { description: { component: description } } },
  args: {
    items: [
      { title: "Edit", icon: Pencil },
      { title: "Move", icon: ArrowRightLeft },
    ],
  },
} satisfies Meta<typeof ActionCell>;

export default meta;
type Story = StoryObj<typeof meta>;

// Two or fewer stay INLINE — reaching for a menu to expose a single edit button is a click nobody
// should have to spend.
export const TwoStayInline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("action-cell")).toHaveAttribute("data-mode", "inline");
    await expect(canvas.getByTestId("action-Edit")).toBeVisible();
  },
};

// THREE OR MORE collapse behind one kebab — the app's row-action rule. Five icon buttons repeated
// down forty rows is two hundred targets competing with the data the table exists to show.
export const ThreeCollapseIntoAMenu: Story = {
  args: {
    items: [
      { title: "Edit", icon: Pencil },
      { title: "Move", icon: ArrowRightLeft },
      { title: "Print label", icon: Printer },
      { title: "Delete", icon: Trash2, tone: "error" },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("action-cell")).toHaveAttribute("data-mode", "menu");

    await userEvent.click(canvas.getByTestId("action-menu-trigger"));

    await waitFor(async () => {
      await expect(screen.getByTestId("action-Delete")).toBeVisible();
    });
  },
};

// Hidden actions do not count towards the inline limit — a row where two of four actions are
// permitted should show those two inline, not a menu with two entries in it.
export const HiddenActionsDoNotCount: Story = {
  args: {
    items: [
      { title: "Edit", icon: Pencil },
      { title: "Move", icon: ArrowRightLeft },
      { title: "Delete", icon: Trash2, hidden: true },
      { title: "Print label", icon: Printer, hidden: true },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("action-cell")).toHaveAttribute("data-mode", "inline");
  },
};

// An icon-only button with no accessible name is unusable to anyone not already familiar with the
// glyph, so the title is always both the aria-label and the tooltip.
export const InlineActionsAreNamed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("button", { name: "Edit" })).toBeVisible();
  },
};

export const NoActionsRendersNothing: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("action-cell")).toBeNull();
  },
};

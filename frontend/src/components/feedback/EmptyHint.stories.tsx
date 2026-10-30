import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Icon } from "@chakra-ui/react";
import { Factory, Plus, SearchX } from "lucide-react";
import { expect, within } from "storybook/test";

import { EmptyHint, description } from "./EmptyHint";

// WHAT AN EMPTY LIST SAYS (an-empty-list-shows-a-hint) — nothing yet, or nothing that matches.

const meta = {
  title: "Components/Feedback/EmptyHint",
  component: EmptyHint,
  parameters: { docs: { description: { component: description } } },
  args: {
    icon: Factory,
    title: "No suppliers yet",
    description: "Add the suppliers this team buys its stock from.",
    testId: "empty-hint",
  },
} satisfies Meta<typeof EmptyHint>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing yet — the subject's icon, what to do, and the action that fills it. */
export const NothingYet: Story = {
  args: {
    action: (
      <Button colorPalette="brand">
        <Icon as={Plus} boxSize="4" />
        New Supplier
      </Button>
    ),
  },
  play: async ({ canvasElement }) => {
    const hint = within(canvasElement).getByTestId("empty-hint");
    await expect(hint).toHaveTextContent("No suppliers yet");
    await expect(hint).toHaveTextContent("Add the suppliers this team buys its stock from.");
    await expect(within(hint).getByRole("button", { name: "New Supplier" })).toBeVisible();
  },
};

/** Nothing matches — a search-off icon and the way back. */
export const NothingMatches: Story = {
  args: {
    icon: SearchX,
    title: "No supplier matches",
    description: "Try another word, or clear the filters.",
    action: (
      <Button variant="outline" colorPalette="gray">
        Clear Filters
      </Button>
    ),
  },
};

/** Small — inside a card or a tab, where a tall block would push the rest off the screen. */
export const Small: Story = { args: { size: "sm" } };

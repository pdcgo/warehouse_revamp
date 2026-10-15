import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { ListSkeleton, description } from "./ListSkeleton";

// WHILE THE FIRST PAGE LOADS, THE SHAPE OF IT (motion-is-small-quick-and-shared).

const meta = {
  title: "Components/Feedback/ListSkeleton",
  component: ListSkeleton,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof ListSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list's first load — five rows of bars, announced as loading. */
export const Rows: Story = {
  play: async ({ canvasElement }) => {
    const skeleton = within(canvasElement).getByRole("status", { name: "Loading" });
    await expect(skeleton).toHaveAttribute("data-testid", "list-skeleton");
  },
};

/** A detail page whose record has not arrived — a title and a line over the rows. */
export const WithHeading: Story = { args: { heading: true, rows: 3 } };

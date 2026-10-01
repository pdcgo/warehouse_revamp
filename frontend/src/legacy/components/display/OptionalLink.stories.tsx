import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { OptionalLink, description } from "./OptionalLink";

const meta = {
  title: "Legacy/Components/Display/OptionalLink",
  component: OptionalLink,
  parameters: { docs: { description: { component: description } } },
  args: { children: <Text>Gudang Utara</Text> },
} satisfies Meta<typeof OptionalLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linked: Story = {
  args: { href: "/teams/3" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("optional-link")).toHaveAttribute("data-linked", "true");
  },
};

// ⚠ With no href it renders NO interactive element — not a disabled link. A link that leads nowhere
// takes a tab stop, is announced as a link, and invites a click that does nothing.
export const UnlinkedIsNotInteractive: Story = {
  args: { href: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("optional-link")).toHaveAttribute("data-linked", "false");
    await expect(canvas.queryByRole("link")).toBeNull();
  },
};

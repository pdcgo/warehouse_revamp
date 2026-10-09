import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack, Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { DeletedBadge, description } from "./DeletedBadge";

const meta = {
  title: "Components/Badges/DeletedBadge",
  component: DeletedBadge,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof DeletedBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    // A word, not the key — a missing catalogue entry would render "common.deleted".
    await expect(within(canvasElement).getByTestId("deleted-badge")).toHaveTextContent(/deleted/i);
  },
};

// Beside the name it qualifies — the way a restock line shows a store that has since been deleted.
export const BesideAName: Story = {
  render: () => (
    <HStack gap="2">
      <Text>Sumber Makmur Lazada Lama</Text>
      <DeletedBadge />
    </HStack>
  ),
};

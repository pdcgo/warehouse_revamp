import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar, Box, Text } from "@chakra-ui/react";
import { expect, waitFor, within } from "storybook/test";

import { ToneBadge } from "../badges/ToneBadge";
import { EntityCell, description } from "./EntityCell";

const meta = {
  title: "Legacy/Components/Cells/EntityCell",
  component: EntityCell,
  parameters: { docs: { description: { component: description } } },
  args: {
    media: (
      <Avatar.Root size="sm">
        <Avatar.Fallback name="Ani Rahayu" />
      </Avatar.Root>
    ),
    name: "Ani Rahayu",
    secondary: <Text fontSize="xs" color="fg.muted">@ani.r</Text>,
  },
} satisfies Meta<typeof EntityCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("Ani Rahayu");
  },
};

// RULE 2: a missing name falls back to the id, never to blank. An empty cell reads as a rendering
// bug; "#4471" is at least something the reader can search for or quote in a message.
export const MissingNameFallsBackToTheId: Story = {
  args: { name: undefined, fallback: "#4471" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("#4471");
  },
};

// RULE 1: the name clips rather than wraps — a wrapping name makes one row taller than its
// neighbours and breaks the column alignment the whole table depends on.
export const LongNameClipsInsteadOfWrapping: Story = {
  args: { name: "Kaos Polos Cotton Combed 30s Lengan Panjang Hitam Ukuran XL" },
  render: (args) => (
    <Box w="200px" borderWidth="1px" p="2">
      <EntityCell {...args} />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(async () => {
      await expect(canvas.getByTestId("entity-cell-name")).toHaveAttribute("data-clipped", "true");
    });
  },
};

// RULE 3: a skeleton only when there is nothing cached to keep.
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell")).toHaveAttribute("data-loading", "true");
  },
};

export const WithTrailingMarker: Story = {
  args: { trailing: <ToneBadge tone="error">Suspended</ToneBadge> },
};

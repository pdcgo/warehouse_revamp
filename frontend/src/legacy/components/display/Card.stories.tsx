import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack, Table, Text } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { Card, description } from "./Card";

const meta = {
  title: "Legacy/Components/Display/Card",
  component: Card,
  parameters: { docs: { description: { component: description } } },
  args: { children: <Text>Rack A-12 · 48 items</Text> },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Hoverable: Story = { args: { hoverable: true } };

// Active is a real ARIA state, not only a tint: a selected card must be ANNOUNCED as selected.
// Colour alone tells a screen-reader user nothing about which card the app is showing.
export const Active: Story = {
  args: { active: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("card")).toHaveAttribute("aria-selected", "true");
  },
};

// Hover and active mean different things and must look different: hover is where the POINTER is,
// active is what the app is showing you elsewhere on screen.
export const HoverVersusActive: Story = {
  render: () => (
    <HStack gap="3" align="stretch">
      <Card hoverable>
        <Text>Hoverable</Text>
      </Card>
      <Card active>
        <Text>Active</Text>
      </Card>
      <Card hoverable active>
        <Text>Both</Text>
      </Card>
    </HStack>
  ),
};

// A table brings its own cell padding; a card adding more produces a visible double gutter around
// every table in the app.
export const WrappingATable: Story = {
  args: {
    table: true,
    children: (
      <Table.Root size="sm">
        <Table.Body>
          <Table.Row>
            <Table.Cell>A-12</Table.Cell>
            <Table.Cell>48</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table.Root>
    ),
  },
};

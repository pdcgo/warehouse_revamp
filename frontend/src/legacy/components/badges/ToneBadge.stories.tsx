import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { TONES } from "../tone";
import { ToneBadge, description } from "./ToneBadge";

const meta = {
  title: "Legacy/Components/Badges/ToneBadge",
  component: ToneBadge,
  parameters: { docs: { description: { component: description } } },
  args: { children: "Badge", tone: "active" },
} satisfies Meta<typeof ToneBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {};

export const Plain: Story = { args: { tone: "plain" } };

// The whole set together — this is the reference for what each tone MEANS, and the only place the
// seven are comparable side by side. A tone that stops being distinguishable from its neighbour
// here has stopped doing its job everywhere.
export const EveryTone: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {TONES.map((tone) => (
        <ToneBadge key={tone} tone={tone} data-testid={`tone-${tone}`}>
          {tone}
        </ToneBadge>
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const tone of TONES) {
      await expect(canvas.getByTestId(`tone-${tone}`)).toBeInTheDocument();
    }
  },
};

// An absent tone must still render — neutral, never blank and never borrowing the accent.
export const NoTone: Story = {
  args: { tone: undefined, children: "Untoned" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Untoned")).toBeVisible();
  },
};

// Solid is available but is not the default: at badge size a solid fill competes with the row it
// sits in. The story exists so a change of default is a visible one.
export const Solid: Story = { args: { variant: "solid", children: "Solid" } };

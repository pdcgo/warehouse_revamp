import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";
import { expect, within } from "storybook/test";

import { TONES } from "../tone";
import { Button, description } from "./Button";

const meta = {
  title: "Legacy/Components/Inputs/Button",
  component: Button,
  parameters: { docs: { description: { component: description } } },
  args: { children: "Save" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIcon: Story = { args: { icon: Plus, children: "New Order" } };

export const Destructive: Story = { args: { tone: "error", icon: Trash2, children: "Delete" } };

export const EveryTone: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {TONES.map((tone) => (
        <Button key={tone} tone={tone}>
          {tone}
        </Button>
      ))}
    </HStack>
  ),
};

// THE reason this component exists: `href` produces a REAL anchor, so middle-click, ctrl-click and
// "copy link address" keep working. An onClick calling navigate() looks identical and breaks all three.
export const HrefIsARealLink: Story = {
  args: { href: "/orders/new", children: "New Order" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const link = canvas.getByRole("link", { name: "New Order" });
    await expect(link).toHaveAttribute("href", "/orders/new");
  },
};

export const Loading: Story = { args: { loading: true } };

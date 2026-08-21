import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { couriers } from "../../../.storybook/fixtures";
import { ShippingBadge, description } from "./ShippingBadge";

const meta = {
  title: "Components/Badges/ShippingBadge",
  component: ShippingBadge,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { code: couriers[0]!.code },
} satisfies Meta<typeof ShippingBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Jne: Story = {};

export const SiCepat: Story = { args: { code: couriers[1]!.code } };

// The badge shows the courier's NAME, which is server data an admin can edit, resolved from the
// shared session catalogue by the stable CODE the shipment stores. That indirection is the reason
// the component exists, so it is what the test asserts.
export const ResolvesTheNameFromTheCatalogue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId(`shipping-badge-${couriers[0]!.code}`)).toHaveTextContent(
      couriers[0]!.name,
    );
  },
};

// A shipment can legitimately have NO courier — a restock request need not be shipped. That renders
// a muted em dash, never an empty badge, which would read as a courier whose name failed to load.
export const NoCourier: Story = {
  args: { code: "" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("—")).toBeInTheDocument();
    await expect(canvas.queryByTestId(/shipping-badge/)).toBeNull();
  },
};

// A courier added to the catalogue after the colour map was written falls back to gray and shows the
// code itself. Degrading rather than crashing is deliberate — the catalogue is curated at runtime.
export const UnknownCourier: Story = {
  args: { code: "kurir-baru" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("shipping-badge-kurir-baru")).toHaveTextContent("kurir-baru");
  },
};

export const EveryCourier: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {couriers.map((c) => (
        <ShippingBadge key={c.code} code={c.code} />
      ))}
    </HStack>
  ),
};

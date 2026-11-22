import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Button, HStack, Stack, Text } from "@chakra-ui/react";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { shipmentChannels as couriers } from "../../../.storybook/fixtures";
import { shipmentChannelClient } from "../../api/clients";
import { useInvalidateShipmentChannels } from "../../features/shipment/queries";
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

export const SiCepat: Story = { args: { code: couriers[2]!.code } };

// THE CODE BRIDGE (the-old-catalogue-bridges-by-code): an old order whose courier was since DELETED still
// shows its name — the catalogue carries deleted channels for exactly this.
export const ADeletedCourierIsStillNamed: Story = {
  args: { code: couriers[3]!.code },
  play: async ({ canvasElement }) => {
    const badge = await within(canvasElement).findByTestId(`shipping-badge-${couriers[3]!.code}`);
    await waitFor(() => expect(badge).toHaveTextContent(couriers[3]!.name));
  },
};

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

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

// A page of rows, then one more row drawn later (a page turn, a row added).
function RowsThenOneMore() {
  const [more, setMore] = useState(false);

  return (
    <Stack gap="2" align="start">
      <HStack gap="2" wrap="wrap" data-testid="story-first-rows">
        {couriers.map((c) => (
          <ShippingBadge key={c.code} code={c.code} />
        ))}
      </HStack>
      <Button data-testid="story-one-more" onClick={() => setMore(true)}>
        Draw Another Row
      </Button>
      {more && (
        <Box data-testid="story-later-row">
          <ShippingBadge code={couriers[1]!.code} />
        </Box>
      )}
    </Stack>
  );
}

// ONE READ FOR EVERY BADGE (#126, through the query cache since #121): the badges on a page share one catalogue entry,
// so a page of rows asks ShipmentChannelList ONCE, and a row drawn later asks nothing (`referenceQuery` — a courier's
// name labels a row). The module-level session cache this replaced did the same by hand.
export const EveryBadgeSharesOneRead: Story = {
  name: "Every badge on a page, and one drawn later, share one ShipmentChannelList",
  beforeEach: () => {
    const spy = spyOn(shipmentChannelClient, "shipmentChannelList");

    return () => spy.mockRestore();
  },
  render: () => <RowsThenOneMore />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = within(canvas.getByTestId("story-first-rows"));

    await waitFor(
      () => expect(first.getByTestId(`shipping-badge-${couriers[0]!.code}`)).toHaveTextContent(couriers[0]!.name),
      { timeout: 5000 },
    );
    await expect(callsOf(shipmentChannelClient.shipmentChannelList)).toBe(1);

    await userEvent.click(canvas.getByTestId("story-one-more"));
    const later = within(await canvas.findByTestId("story-later-row"));
    await expect(later.getByTestId(`shipping-badge-${couriers[1]!.code}`)).toHaveTextContent(couriers[1]!.name);

    await expect(callsOf(shipmentChannelClient.shipmentChannelList)).toBe(1);
  },
};

// Two rows on JNE, and root renaming JNE on the channels screen — the write, then the invalidation every channel
// write runs (useInvalidateShipmentChannels).
function RenameJne() {
  const invalidate = useInvalidateShipmentChannels();
  const [renamed, setRenamed] = useState(false);

  return (
    <Stack gap="2" align="start">
      <HStack gap="2">
        <ShippingBadge code={couriers[0]!.code} />
        <ShippingBadge code={couriers[0]!.code} />
      </HStack>
      <Button
        data-testid="story-rename-courier"
        onClick={async () => {
          await shipmentChannelClient.shipmentChannelUpdate({ channelId: couriers[0]!.id, name: "JNE Express", desc: "" });
          await invalidate();
          setRenamed(true);
        }}
      >
        Rename Courier Elsewhere
      </Button>
      {renamed && <Text data-testid="story-courier-renamed">renamed</Text>}
    </Stack>
  );
}

// A RENAMED COURIER IS RENAMED IN EVERY BADGE ON SCREEN. The catalogue sits under the `shipmentChannels` prefix every
// channel write invalidates, so the badges already drawn re-read and follow — the old session cache was dropped, but a
// badge already mounted kept the old name until it was mounted again.
export const ARenamedCourierIsRenamedInEveryBadge: Story = {
  name: "A courier renamed on the channels screen is renamed in every badge on screen",
  render: () => <RenameJne />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(
      () => {
        for (const badge of canvas.getAllByTestId(`shipping-badge-${couriers[0]!.code}`)) {
          expect(badge).toHaveTextContent(couriers[0]!.name);
        }
      },
      { timeout: 5000 },
    );

    await userEvent.click(canvas.getByTestId("story-rename-courier"));
    await canvas.findByTestId("story-courier-renamed", {}, { timeout: 5000 });

    await waitFor(
      () => {
        for (const badge of canvas.getAllByTestId(`shipping-badge-${couriers[0]!.code}`)) {
          expect(badge).toHaveTextContent("JNE Express");
        }
      },
      { timeout: 5000 },
    );
  },
};

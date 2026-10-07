import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack, Spinner } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { shipmentChannels } from "../../../.storybook/fixtures";
import { useShipmentChannelsByIds } from "../../features/shipment/queries";
import { ShipmentChannelBadge, description } from "./ShipmentChannelBadge";

// The badge is presentational; these stories resolve ids through the REAL ByIds hook against the stub,
// the way an order list will — so they also pin the contract that a deleted channel still comes back.

const [jne, jnt, sicepat, pos] = shipmentChannels;

function Resolved({ ids }: { ids: bigint[] }) {
  const query = useShipmentChannelsByIds(ids);

  if (query.isPending && ids.some((id) => id > 0n)) {
    return <Spinner size="sm" />;
  }

  return (
    <HStack gap="2" wrap="wrap">
      {ids.map((id) => (
        <ShipmentChannelBadge key={id.toString()} channelId={id} channel={query.data?.get(id.toString())} />
      ))}
    </HStack>
  );
}

const meta = {
  title: "Components/Badges/ShipmentChannelBadge",
  component: ShipmentChannelBadge,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { channelId: 0n },
} satisfies Meta<typeof ShipmentChannelBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryCase: Story = {
  render: () => <Resolved ids={[jne!.id, jnt!.id, sicepat!.id, pos!.id, 999n]} />,
};

export const NoChannel: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("shipment-channel-badge-none")).toHaveTextContent("—");
  },
};

// a-deleted-channel-still-resolves-by-id: an old order's deleted courier is NAMED and marked, never blank.
export const ADeletedChannelIsStillNamed: Story = {
  render: () => <Resolved ids={[pos!.id]} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const badge = await canvas.findByTestId(`shipment-channel-badge-${pos!.code}`);
    await expect(badge).toHaveTextContent(pos!.name);
    await expect(canvas.getByTestId(`shipment-channel-badge-deleted-${pos!.code}`)).toBeVisible();
  },
};

// An id that never existed shows as #id — never a borrowed or blank name.
export const AnUnknownIdShowsTheId: Story = {
  render: () => <Resolved ids={[999n]} />,
  play: async ({ canvasElement }) => {
    const badge = await within(canvasElement).findByTestId("shipment-channel-badge-unknown-999");
    await expect(badge).toHaveTextContent("#999");
  },
};

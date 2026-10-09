import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { channelFixture, supplierFixture } from "../../../.storybook/supplierFixtures";
import { type SupplierChannel, SupplierChannelSchema } from "../../gen/warehouse/supplier/v1/supplier_channel_pb";
import type { SupplierRecord } from "../suppliers/adapt";
import { LineSupplier } from "./LineSupplier";

// WHERE A RESTOCK LINE WAS BOUGHT — a supplier and its store, a supplier with no store (a stall), nothing connected,
// and a store deleted since: still named, with a DeletedBadge (a-deleted-supplier-still-shows-with-a-badge).

const SUMBER = supplierFixture("PT Sumber Makmur");
const SINAR = supplierFixture("Toko Grosir Sinar");

const record = (s: typeof SUMBER): SupplierRecord => ({
  id: s.id,
  teamId: s.teamId,
  name: s.name,
  contact: s.contact,
  address: s.address,
  description: s.description,
  deleted: s.deleted,
});

const store = (id: bigint): SupplierChannel => {
  const c = channelFixture(id);

  return create(SupplierChannelSchema, {
    id: c.id,
    supplierId: c.supplierId,
    channelType: c.channelType,
    name: c.name,
    uri: c.uri,
    description: c.description,
    deleted: c.deleted,
  });
};

const suppliers: Record<string, SupplierRecord> = {
  [SUMBER.id.toString()]: record(SUMBER),
  [SINAR.id.toString()]: record(SINAR),
};
const channels: Record<string, SupplierChannel> = { "311": store(311n), "314": store(314n) };

const meta = {
  title: "Features/Restock/LineSupplier",
  component: LineSupplier,
  args: { supplierId: SUMBER.id, supplierChannelId: 311n, suppliers, channels, testId: "line-supplier" },
} satisfies Meta<typeof LineSupplier>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SupplierAndStore: Story = {};

export const AStallWithNoStore: Story = { args: { supplierId: SINAR.id, supplierChannelId: 0n } };

export const NotConnected: Story = {
  args: { supplierId: 0n, supplierChannelId: 0n },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("line-supplier")).toHaveTextContent(/not connected/i);
  },
};

export const ADeletedStoreIsStillNamed: Story = {
  args: { supplierChannelId: 314n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("line-supplier")).toHaveTextContent("Sumber Makmur Lazada Lama");
    await expect(canvas.getByTestId("deleted-badge")).toBeInTheDocument();
  },
};

export const AllFour: Story = {
  render: (args) => (
    <Stack gap="4">
      <LineSupplier {...args} />
      <LineSupplier {...args} supplierId={SINAR.id} supplierChannelId={0n} />
      <LineSupplier {...args} supplierId={0n} supplierChannelId={0n} />
      <LineSupplier {...args} supplierChannelId={314n} />
    </Stack>
  ),
};

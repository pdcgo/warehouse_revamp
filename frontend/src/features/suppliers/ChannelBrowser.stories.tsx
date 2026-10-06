import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { SupplierChannelRecord } from "./adapt";
import { ChannelBrowser } from "./ChannelBrowser";

// A supplier's Channels tab, shared by the manage detail (with its actions) and the discover detail (read-only)
// — supplier-detail-has-channels-and-products-tabs. It searches, filters by type and pages the list it is given.

const channel = (id: number, channelType: Marketplace, name: string, uri = "", description = ""): SupplierChannelRecord => ({
  id: BigInt(id),
  supplierId: 1n,
  channelType,
  name,
  uri,
  description,
});

const FEW = [
  channel(1, Marketplace.SHOPEE, "Sumber Makmur Official", "https://shopee.co.id/sumbermakmur"),
  channel(2, Marketplace.TOKOPEDIA, "Sumber Makmur Store", "https://www.tokopedia.com/sumbermakmur"),
  channel(3, Marketplace.OTHER, "Gudang Cigondewah", "", "0812-1111-9999 · Jl. Cigondewah Kaler 7, Bandung"),
];

const MANY = Array.from({ length: 12 }, (_, i) =>
  channel(100 + i, i % 2 === 0 ? Marketplace.SHOPEE : Marketplace.TIKTOK, `Store ${i + 1}`),
);

const meta = {
  title: "Features/Suppliers/ChannelBrowser",
  component: ChannelBrowser,
  args: { channels: FEW },
} satisfies Meta<typeof ChannelBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadOnly: Story = {};

export const WithActions: Story = {
  args: {
    actions: <Button size="xs">Add Channel</Button>,
    rowActions: () => <Button size="xs" variant="ghost">Edit</Button>,
  },
};

export const Empty: Story = { args: { channels: [] } };

// Read-only means no Actions column at all, not an empty one.
export const ReadOnlyHasNoActionsColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(within(canvas.getByTestId("channels-table")).queryByText("Actions")).toBeNull();
  },
};

export const SearchesNameLinkAndDescription: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByTestId("channels-search"), "tokopedia.com", { delay: 30 });
    await waitFor(() => expect(within(canvas.getByTestId("channels-table")).getAllByRole("row")).toHaveLength(2));

    await userEvent.clear(canvas.getByTestId("channels-search"));
    await userEvent.type(canvas.getByTestId("channels-search"), "cigondewah", { delay: 30 });
    await waitFor(() => expect(canvas.getByTestId("channels-table")).toHaveTextContent("Gudang Cigondewah"));
  },
};

export const Paginates: Story = {
  args: { channels: MANY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(within(canvas.getByTestId("channels-table")).getAllByRole("row")).toHaveLength(1 + 10));
    await userEvent.click(canvas.getByTestId("page-next"));
    await waitFor(() => expect(within(canvas.getByTestId("channels-table")).getAllByRole("row")).toHaveLength(1 + 2));
  },
};

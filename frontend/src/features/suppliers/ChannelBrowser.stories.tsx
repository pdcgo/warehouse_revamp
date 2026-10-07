import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@chakra-ui/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { channelFixture, supplierFixture } from "../../../.storybook/supplierFixtures";
import { ChannelBrowser } from "./ChannelBrowser";

// A supplier's Channels tab, shared by the manage detail (with its actions) and the discover detail (read-only)
// — supplier-detail-has-channels-and-products-tabs. It reads its own page from SupplierChannelList, which searches,
// filters by type and pages on the server (the stub plays it: supplierStub.ts).

const SUMBER = supplierFixture("PT Sumber Makmur"); // team 12's — three live stores and a deleted one
const SINAR = supplierFixture("Toko Grosir Sinar"); // no stores
const BANYAK = supplierFixture("PT Banyak Toko"); // twelve stores — more than a page
const MAKMUR_JAYA = supplierFixture("UD Makmur Jaya"); // team 13's

const SHOPEE_STORE = channelFixture(311n);
const TOKOPEDIA_STORE = channelFixture(312n);
const WEBSITE = channelFixture(313n);
const DELETED_STORE = channelFixture(314n);

const TEAM = 12n;

const meta = {
  title: "Features/Suppliers/ChannelBrowser",
  component: ChannelBrowser,
  args: { teamId: TEAM, supplierId: SUMBER.id },
} satisfies Meta<typeof ChannelBrowser>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("channels-table", {}, { timeout: 4000 });
  return canvas;
}

const rows = (canvas: ReturnType<typeof within>) => within(canvas.getByTestId("channels-table")).getAllByRole("row");

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const ReadOnly: Story = {};

export const WithActions: Story = {
  args: {
    actions: <Button size="xs">Add Channel</Button>,
    rowActions: () => <Button size="xs" variant="ghost">Edit</Button>,
  },
};

export const Empty: Story = { args: { supplierId: SINAR.id } };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// Read-only means no Actions column at all, not an empty one.
export const ReadOnlyHasNoActionsColumn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(within(canvas.getByTestId("channels-table")).queryByText("Actions")).toBeNull();
  },
};

// a-store-delete-is-soft-too: a deleted store is not on the list.
export const ADeletedStoreIsNotListed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 3));
    await expect(canvas.queryByTestId(`channel-row-${DELETED_STORE.id}`)).toBeNull();
  },
};

// The search reads a store's name, its link AND its description.
export const SearchesNameLinkAndDescription: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.type(canvas.getByTestId("channels-search"), "tokopedia.com", { delay: 40 });
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeVisible();

    // "Cigondewah" is only in the website's description. The rows on screen are kept while the next answer
    // loads (HARD RULE 10), so wait for the answer itself, not for a count the previous one already had.
    await userEvent.clear(canvas.getByTestId("channels-search"));
    await userEvent.type(canvas.getByTestId("channels-search"), "cigondewah", { delay: 40 });
    await canvas.findByTestId(`channel-row-${WEBSITE.id}`);
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 1));

    // Nothing matching says so, rather than reading as "no channels".
    await userEvent.clear(canvas.getByTestId("channels-search"));
    await userEvent.type(canvas.getByTestId("channels-search"), "zzz", { delay: 40 });
    await canvas.findByTestId("channels-none-match");
  },
};

export const FiltersByType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(within(canvas.getByTestId("channels-type-filter")).getByTestId("marketplace-select"));
    const option = await canvas.findByRole("option", { name: "Tokopedia" });
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);

    await waitFor(() => expect(canvas.queryByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeNull());
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeVisible();
  },
};

// Twelve stores at ten a page: two pages, newest first.
export const Paginates: Story = {
  args: { supplierId: BANYAK.id },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 10));
    await userEvent.click(canvas.getByTestId("page-next"));
    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 2));
    await expect(canvas.getByTestId("channel-row-351")).toBeVisible();
  },
};

// Reads cross teams: team 12 reads team 13's supplier's stores.
export const AnotherTeamsStoresAreReadable: Story = {
  args: { supplierId: MAKMUR_JAYA.id },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(rows(canvas)).toHaveLength(1 + 2));
    await expect(canvas.getByTestId("channels-table")).toHaveTextContent("Makmur Jaya Grosir");
  },
};

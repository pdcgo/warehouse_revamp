import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { channelFixture } from "../../../../.storybook/supplierFixtures";
import { SUPPLIER_DETAIL_META, AtBanyak, AtCahaya, SHOPEE_STORE, TOKOPEDIA_STORE, loaded } from "./kit";

// SUPPLIER DETAIL — the Stores tab — one list, a row's name then its type (a-store-reads-its-name-then-its-type), its
// labelled Edit and Delete (a-channel-action-is-labelled), its Sold and Ready, the search, the type filter and the
// pager. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierDetail/Stores",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const SUMBER_WEBSITE = channelFixture(313n); // "Cigondewah" is only in its description
const WEBSITE = channelFixture(321n);

// The Channels tab is ONE list, each row wearing its marketplace's badge (channel-type-is-the-marketplace-list).
export const ChannelsAreOneListWithBadges: Story = {
  name: "One list, badges",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId(`channel-row-${SHOPEE_STORE.id}`)).toHaveTextContent("Shopee"));
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toHaveTextContent("Tokopedia");
  },
};

// A plain website is the owner's `custom` — the shared list's Other (custom-is-labelled-other).
export const AWebsiteIsOther: Story = {
  name: "Website is Other",
  render: () => <AtCahaya />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = await canvas.findByTestId(`channel-row-${WEBSITE.id}`);
    await expect(row).toHaveTextContent("Other");
    await expect(row).toHaveTextContent("https://cahayaabadi.co.id");
  },
};

// A STORE READS ITS NAME, THEN ITS TYPE — one cell in two lines, the badge UNDER the name, so the badges line up down
// the list. Its Edit and Delete are labelled buttons.
export const AStoreReadsItsNameThenItsType: Story = {
  name: "Name, then type",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const shopee = await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);
    const tokopedia = canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`);
    const shopeeBadge = within(shopee).getByTestId(/^marketplace-badge-/).getBoundingClientRect();
    const tokopediaBadge = within(tokopedia).getByTestId(/^marketplace-badge-/).getBoundingClientRect();

    await expect(shopeeBadge.top).toBeGreaterThanOrEqual(within(shopee).getByText(SHOPEE_STORE.name).getBoundingClientRect().bottom);
    await expect(shopeeBadge.left).toBe(tokopediaBadge.left);

    await expect(within(shopee).getByTestId(`edit-channel-${SHOPEE_STORE.id}`)).toHaveTextContent("Edit");
    await expect(within(shopee).getByTestId(`delete-channel-${SHOPEE_STORE.id}`)).toHaveTextContent("Delete");
  },
};

// …and on a phone a store is a block: its name, its type under it, the link and the note — Edit and Delete at its foot,
// where they do not squeeze the name.
export const AStoreOnAPhone: Story = {
  name: "Phone · a block",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const block = await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);
    const badge = within(block).getByTestId(/^marketplace-badge-/).getBoundingClientRect();
    const edit = within(block).getByTestId(`edit-channel-${SHOPEE_STORE.id}`).getBoundingClientRect();

    await expect(badge.top).toBeGreaterThanOrEqual(within(block).getByText(SHOPEE_STORE.name).getBoundingClientRect().bottom);
    await expect(edit.top).toBeGreaterThanOrEqual(badge.bottom);
  },
};

// A STORE SHOWS ITS SOLD AND READY — the supplier list's figures for what was bought at this store: the last two columns
// before the actions, the last order and the last restock under them. Real (InventoryService.SupplierGoods by store), so
// unmarked — the marks 2 and 3 now sit on the Produk tab's invented product figures only.
export const AStoreShowsItsSoldAndReady: Story = {
  name: "Sold and Ready",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    const table = canvas.getByTestId("channels-table");
    const headers = within(table).getAllByRole("columnheader");
    await expect(headers.at(-3)).toHaveTextContent(/^Sold/);
    await expect(headers.at(-2)).toHaveTextContent(/^Ready/);
    await expect(within(headers.at(-3)!).queryByTestId("not-implemented-sold")).toBeNull();
    await expect(within(headers.at(-2)!).queryByTestId("not-implemented-ready")).toBeNull();
    await waitFor(() =>
      expect(canvas.getByTestId(`channel-sold-${SHOPEE_STORE.id}`)).toHaveTextContent(/^1\.204ordered \w+ \d+, \d{4}$/),
    );
    await expect(canvas.getByTestId(`channel-ready-${SHOPEE_STORE.id}`)).toHaveTextContent(/^86restocked \w+ \d+, \d{4}$/);
  },
};

// the-channels-tab-searches-filters-and-pages: the search reads the name, the link and the description; nothing
// matching says so, rather than reading as "no channels".
export const ChannelsSearch: Story = {
  name: "Search",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    await userEvent.type(canvas.getByTestId("channels-search"), "official", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeNull());
    await expect(canvas.getByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeVisible();

    // The description is searchable too — "Cigondewah" is only in the website's.
    await userEvent.clear(canvas.getByTestId("channels-search"));
    await userEvent.type(canvas.getByTestId("channels-search"), "cigondewah", { delay: 40 });
    await waitFor(() => expect(canvas.queryByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeNull());
    await expect(canvas.getByTestId(`channel-row-${SUMBER_WEBSITE.id}`)).toBeVisible();

    await userEvent.clear(canvas.getByTestId("channels-search"));
    await userEvent.type(canvas.getByTestId("channels-search"), "zzz", { delay: 40 });
    await canvas.findByTestId("channels-none-match");
  },
};

export const ChannelsFilterByType: Story = {
  name: "Filter by type",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await canvas.findByTestId(`channel-row-${SHOPEE_STORE.id}`);

    await userEvent.click(within(canvas.getByTestId("channels-type-filter")).getByTestId("marketplace-select"));
    await userEvent.click(await canvas.findByRole("option", { name: "Tokopedia" }));

    await waitFor(() => expect(canvas.queryByTestId(`channel-row-${SHOPEE_STORE.id}`)).toBeNull());
    await expect(canvas.getByTestId(`channel-row-${TOKOPEDIA_STORE.id}`)).toBeVisible();
  },
};

// Twelve channels at ten a page, newest first: two pages, the oldest on the second.
export const ChannelsPaginate: Story = {
  name: "Pages",
  render: () => <AtBanyak />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = await canvas.findByTestId("channels-table");
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(1 + 10));

    await userEvent.click(canvas.getByTestId("channels-pager-next"));
    await waitFor(() => expect(within(canvas.getByTestId("channels-table")).getAllByRole("row")).toHaveLength(1 + 2));
    await expect(canvas.getByTestId("channel-row-351")).toBeVisible();

    // every-list-pages-with-the-growing-pager: a page opened is one click away.
    await userEvent.click(canvas.getByTestId("channels-pager-page-1"));
    await waitFor(() => expect(within(canvas.getByTestId("channels-table")).getAllByRole("row")).toHaveLength(1 + 10));
  },
};
